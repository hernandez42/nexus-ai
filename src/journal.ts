/**
 * Journal Manager — 用 Markdown 记录交互与自省
 *
 * 两个文件：
 *   journal.md         ← 最近 N 条交互，人类可读
 *   reflections.md     ← 自我反省记录（每次 --reflect 生成）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";

export interface JournalEntry {
  timestamp: number;
  input: string;
  output: string;
  toolsUsed: string[];
  layer: "episodic" | "semantic" | "procedural";
}

export class Journal {
  private dir: string;
  private maxEntriesInFile = 50;

  constructor(workspaceDir: string) {
    this.dir = workspaceDir;
    mkdirSync(this.dir, { recursive: true });
  }

  private path(): string {
    return join(this.dir, "journal.md");
  }

  private reflectionPath(): string {
    return join(this.dir, "reflections.md");
  }

  record(entry: JournalEntry): void {
    const path = this.path();
    const time = new Date(entry.timestamp).toLocaleString();
    const toolsLine = entry.toolsUsed.length > 0
      ? `  * tools: ${entry.toolsUsed.join(", ")}`
      : "";

    const block = `## ${time}

**你**：${entry.input.slice(0, 500)}

**Nexus**：
${entry.output.split("\n").map(l => "  " + l).join("\n").slice(0, 2000)}

${toolsLine}
*layer: ${entry.layer}*

---

`;

    appendFileSync(path, block);

    // Keep file from growing indefinitely — trim by re-writing
    this.trimIfNeeded();
  }

  private trimIfNeeded(): void {
    const path = this.path();
    if (!existsSync(path)) return;
    try {
      const content = readFileSync(path, "utf-8");
      // Count by ## heading
      const sections = content.split(/\n## /);
      if (sections.length > this.maxEntriesInFile) {
        const keep = sections.slice(-this.maxEntriesInFile);
        writeFileSync(path, "## " + keep.join("\n## "));
      }
    } catch { /* ignore trim errors */ }
  }

  /** 生成一段自省 md 并保存 */
  reflect(context: {
    memoryTotal: number;
    memoryByLayer: { episodic: number; semantic: number; procedural: number };
    capabilities: string[];
    recentObservations: string[];
    unansweredQuestions?: string[];
  }): string {
    const now = new Date().toLocaleString();
    const lines: string[] = [];

    lines.push(`# 自省 · ${now}`);
    lines.push("");
    lines.push(`记忆总数：${context.memoryTotal}`);
    lines.push(`按层：episodic=${context.memoryByLayer.episodic}, semantic=${context.memoryByLayer.semantic}, procedural=${context.memoryByLayer.procedural}`);
    lines.push("");

    lines.push("## 能力");
    if (context.capabilities.length === 0) {
      lines.push("_尚未提炼 — 随交互积累_");
    } else {
      for (const c of context.capabilities.slice(0, 10)) lines.push(`- ${c}`);
    }
    lines.push("");

    lines.push("## 最近观察");
    if (context.recentObservations.length === 0) {
      lines.push("_没有新观察_");
    } else {
      for (const o of context.recentObservations.slice(0, 10)) lines.push(`- ${o}`);
    }
    lines.push("");

    if (context.unansweredQuestions && context.unansweredQuestions.length > 0) {
      lines.push("## 未回答 / 待改进");
      for (const q of context.unansweredQuestions.slice(0, 10)) lines.push(`- ${q}`);
      lines.push("");
    }

    lines.push("## 下一步");
    lines.push("- 更多交互 → 让记忆和能力数据更丰富");
    lines.push("- 配置真实 LLM API key → 启用原生 tool calling");
    lines.push("");
    lines.push("---");
    lines.push("");

    const md = lines.join("\n");
    appendFileSync(this.reflectionPath(), md);
    return md;
  }

  /** 最近一条记录的摘要（用于 --status） */
  recentSummary(n: number = 3): string {
    const path = this.path();
    if (!existsSync(path)) return "(还没有交互记录)";
    try {
      const content = readFileSync(path, "utf-8");
      const sections = content.split(/\n## /).filter(Boolean).slice(-n);
      return sections.map(s => "## " + s.trim()).join("\n\n");
    } catch {
      return "(读取 journal 失败)";
    }
  }
}
