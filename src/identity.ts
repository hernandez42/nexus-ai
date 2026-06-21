/**
 * Identity Manager — 本地 md 身份文件系统
 *
 * 核心功能：
 *   1. 加载 / 更新 identity.md
 *   2. 从 memory 中提取洞察，持久化为 md 人类可读
 *   3. 作为 system prompt 的基础输入
 *
 * 文件结构：
 *   nexus-workspace/
 *     identity.md       ← 核心身份、能力、偏好、习惯
 *     journal.md        ← 交互记录与自省（自动更新）
 *     preferences.json  ← 用户偏好（结构化）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { MemoryStore } from "./memory";

// ============================================================
// Types
// ============================================================

export interface IdentityData {
  name: string;
  role: string;
  purpose: string;
  traits: string[];
  capabilities: string[];
  preferences: {
    language: "zh" | "en" | "auto";
    responseStyle: "concise" | "detailed" | "technical";
    toolPreference: string[];
  };
  learnedFromUser: string[];
  rules: string[];
  lastUpdated: number;
  version: string;
}

export const DEFAULT_IDENTITY: IdentityData = {
  name: "Nexus",
  role: "一个自主推理助手",
  purpose: "帮助你探索代码、分析问题、记录思考。",
  traits: [
    "直接回答问题，不做冗长铺垫",
    "用本地推理 + 记忆回答，必要时调用工具",
    "用中文回复中文问题，英文回复英文问题",
    "遇到不确定的事情会说不知道，而不是编造",
  ],
  capabilities: [
    "读取/写入文件，搜索目录和代码",
    "执行 shell 命令（有安全限制）",
    "持久化记忆（事件记忆 / 语义知识 / 过程能力）",
    "自我评估、自省、持续改进",
    "git 克隆 / diff / 状态检查",
    "在没有 LLM API key 时也能用本地推理工作",
  ],
  preferences: {
    language: "auto",
    responseStyle: "concise",
    toolPreference: ["read_file", "bash", "search_files", "grep"],
  },
  learnedFromUser: [],
  rules: [
    "不暴露底层模型或提供商名称",
    "不重复确认已经说过的事情",
    "文件读取前先检查路径是否存在",
    "永远不执行 rm -rf / 或类似危险命令",
  ],
  lastUpdated: Date.now(),
  version: "1.0.0",
};

export class IdentityManager {
  private dir: string;
  private data: IdentityData;

  constructor(workspaceDir: string) {
    this.dir = workspaceDir;
    mkdirSync(this.dir, { recursive: true });
    this.data = this.load();
  }

  // ============================================================
  // Load & Save (md + json 双持久化)
  // ============================================================

  private load(): IdentityData {
    const jsonPath = join(this.dir, "identity.json");
    const mdPath = join(this.dir, "identity.md");

    // Try loading JSON first (structured)
    if (existsSync(jsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(jsonPath, "utf-8"));
        return { ...DEFAULT_IDENTITY, ...parsed };
      } catch { /* fall through */ }
    }

    // Try importing from md (user-edited)
    if (existsSync(mdPath)) {
      try {
        const md = readFileSync(mdPath, "utf-8");
        return this.parseIdentityFromMd(md);
      } catch { /* fall through */ }
    }

    return DEFAULT_IDENTITY;
  }

  private parseIdentityFromMd(md: string): IdentityData {
    // Very loose parser — accepts headings and bullet lists
    const extract = (heading: string): string[] => {
      const re = new RegExp(`#{1,6}\\s*${heading}[\\s\\S]*?(?=#{1,6}\\s|$)`, "i");
      const m = md.match(re);
      if (!m) return [];
      return m[0]
        .split("\n")
        .map(line => line.replace(/^\s*[-*+]\s*/, "").trim())
        .filter(line => line.length > 2 && !line.startsWith("#"));
    };

    return {
      ...DEFAULT_IDENTITY,
      name: this.extractSingle(md, "Name|名称") || DEFAULT_IDENTITY.name,
      role: this.extractSingle(md, "Role|角色") || DEFAULT_IDENTITY.role,
      purpose: this.extractSingle(md, "Purpose|目标") || DEFAULT_IDENTITY.purpose,
      traits: extract("Traits|性格"),
      capabilities: extract("Capabilities|能力"),
      learnedFromUser: extract("Learned|学到"),
      rules: extract("Rules|规则"),
      lastUpdated: Date.now(),
    };
  }

  private extractSingle(md: string, heading: string): string {
    const re = new RegExp(`#{1,6}\\s*(?:${heading})\\s*[:：]?\\s*\\n+([\\s\\S]*?)(?=\\n#{1,6}\\s|$)`, "i");
    const m = md.match(re);
    if (!m) return "";
    return m[1].split("\n")[0].trim();
  }

  save(): void {
    mkdirSync(this.dir, { recursive: true });
    const jsonPath = join(this.dir, "identity.json");
    const mdPath = join(this.dir, "identity.md");

    this.data.lastUpdated = Date.now();

    // Write structured JSON
    writeFileSync(jsonPath, JSON.stringify(this.data, null, 2));

    // Write human-readable md
    const now = new Date().toISOString();
    const md = `# ${this.data.name} — Identity

> **Role**: ${this.data.role}
> **Purpose**: ${this.data.purpose}
> **Last updated**: ${now}

## 性格 / Traits

${this.data.traits.map(t => `- ${t}`).join("\n")}

## 能力 / Capabilities

${this.data.capabilities.map(c => `- ${c}`).join("\n")}

## 偏好 / Preferences

- **Language**: ${this.data.preferences.language}
- **Response style**: ${this.data.preferences.responseStyle}
- **Preferred tools**: ${this.data.preferences.toolPreference.join(", ")}

## 从用户学到 / Learned from user

${this.data.learnedFromUser.length === 0
  ? "_还没有 — 随着交互逐渐积累_"
  : this.data.learnedFromUser.map(l => `- ${l}`).join("\n")}

## 规则 / Rules

${this.data.rules.map(r => `- ${r}`).join("\n")}

---
_这是一个自动管理的文件。你可以手动编辑，Nexus 会在下次运行时读取它。_
`;

    writeFileSync(mdPath, md);
  }

  // ============================================================
  // Queries
  // ============================================================

  get(): IdentityData {
    return { ...this.data };
  }

  /** 返回作为 system prompt 的 md 片段（截断后） */
  asSystemPrompt(): string {
    const lines: string[] = [];
    lines.push(`你是 ${this.data.name} — ${this.data.role}。`);
    lines.push(`目标：${this.data.purpose}`);
    lines.push("");
    if (this.data.traits.length) {
      lines.push("性格：");
      lines.push(...this.data.traits.slice(0, 6).map(t => `  * ${t}`));
      lines.push("");
    }
    if (this.data.learnedFromUser.length) {
      lines.push("关于这个用户：");
      lines.push(...this.data.learnedFromUser.slice(0, 5).map(l => `  * ${l}`));
      lines.push("");
    }
    if (this.data.rules.length) {
      lines.push("规则：");
      lines.push(...this.data.rules.slice(0, 5).map(r => `  * ${r}`));
    }
    return lines.join("\n");
  }

  /** 返回人类可读的身份摘要（用于 --status） */
  summary(): string {
    const stats = [
      `# ${this.data.name}`,
      ``,
      `角色：${this.data.role}`,
      `目标：${this.data.purpose}`,
      `最后更新：${new Date(this.data.lastUpdated).toLocaleString()}`,
      ``,
      `## 能力 (${this.data.capabilities.length})`,
      ...this.data.capabilities.map(c => `- ${c}`),
      ``,
      `## 性格 (${this.data.traits.length})`,
      ...this.data.traits.map(t => `- ${t}`),
    ];

    if (this.data.learnedFromUser.length > 0) {
      stats.push(``, `## 关于你 (${this.data.learnedFromUser.length})`,
        ...this.data.learnedFromUser.map(l => `- ${l}`));
    }

    return stats.join("\n");
  }

  // ============================================================
  // Updates
  // ============================================================

  /** 记录学到的用户习惯（会写入 identity.md 的 Learned from user） */
  recordObservation(observation: string): void {
    const trimmed = observation.trim();
    if (!trimmed) return;
    if (trimmed.length > 200) return; // Safety
    // Dedupe (fuzzy)
    for (const existing of this.data.learnedFromUser) {
      const a = existing.toLowerCase().replace(/\s+/g, "");
      const b = trimmed.toLowerCase().replace(/\s+/g, "");
      if (a === b || a.includes(b) || b.includes(a)) return;
    }
    this.data.learnedFromUser.push(trimmed);
    if (this.data.learnedFromUser.length > 20) {
      this.data.learnedFromUser = this.data.learnedFromUser.slice(-20);
    }
    this.save();
  }

  /** 从 memory 中提取可持久化的洞察（写入 identity.md 与 journal.md） */
  extractInsights(memory: MemoryStore): string[] {
    const insights: string[] = [];
    const stats = memory.stats();
    if (stats.total === 0) return insights;

    // Extract top procedural memories → capabilities
    const caps = memory.query({ text: "capability", layer: "procedural", topK: 3, minSimilarity: 0.05 });
    for (const c of caps) {
      if (!c.entry.content.includes("(extracted)")) {
        insights.push(`能力：${c.entry.content.slice(0, 80)}`);
      }
    }

    // Extract top semantic memories → knowledge
    const know = memory.query({ text: "knowledge", layer: "semantic", topK: 3, minSimilarity: 0.05 });
    for (const k of know) {
      if (!k.entry.content.includes("(extracted)")) {
        insights.push(`学到：${k.entry.content.slice(0, 80)}`);
      }
    }

    return insights;
  }
}
