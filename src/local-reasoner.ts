/**
 * Local Reasoner — 本地推理引擎
 *
 * 核心设计：不依赖 LLM 的真正的本地思考能力
 * 推理流程：OBSERVE → RETRIEVE(memory) → REASON(rules) → COMPOSE(reply)
 *
 * 关键区别：
 * - memory 直接用于推理，不经过 tool 代理
 * - 规则匹配后直接综合回复，不需要 bash echo
 * - 回复由 memory 数据 + 规则模板组合而成
 */

import { MemoryStore } from "./memory";
import { SkillRegistry, SkillContext, SkillResult } from "./skills";

export interface LocalReasonStep {
  step: number;
  type: "OBSERVE" | "RETRIEVE" | "REASON" | "COMPOSE" | "FINAL";
  content: string;
  confidence: number; // 0-1
  basis: "rule" | "memory" | "composed" | "fallback";
  timestamp: number;
}

export interface ToolDef {
  name: string;
  description: string;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

export class LocalReasoner {
  private memory: MemoryStore;
  private tools: Map<string, ToolDef> = new Map();
  private skills: SkillRegistry | null = null;
  private skillContext: SkillContext | null = null;

  constructor(memory: MemoryStore, skills?: SkillRegistry, skillContext?: SkillContext) {
    this.memory = memory;
    this.skills = skills || null;
    this.skillContext = skillContext || null;
  }

  registerTool(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 本地推理主循环
   * 流程：OBSERVE → RETRIEVE(memory) → REASON(rules) → COMPOSE(reply)
   * 不调用 LLM，纯本地决策
   */
  async reason(prompt: string, maxSteps: number = 5): Promise<LocalReasonStep[]> {
    const steps: LocalReasonStep[] = [];
    const now = Date.now();

    // ============================================================
    // Step 1: OBSERVE — 记录输入
    // ============================================================
    steps.push({
      step: 1, type: "OBSERVE", content: prompt,
      confidence: 1.0, basis: "rule", timestamp: now,
    });

    // ============================================================
    // Step 2: RETRIEVE — 从 memory 中检索相关信息
    // ============================================================
    const memStats = this.memory.stats();
    const relevantMemories = this.memory.query({ text: prompt, topK: 5, minSimilarity: 0.2 });
    const capabilities = this.memory.query({ text: "capability", layer: "procedural", topK: 10, minSimilarity: 0.01 });
    const goals = this.memory.query({ text: "knowledge gap", layer: "semantic", topK: 5, minSimilarity: 0.01 });
    const recentRuns = this.memory.query({ text: "run result", layer: "episodic", topK: 3, minSimilarity: 0.01 });

    steps.push({
      step: 2, type: "RETRIEVE",
      content: `Memory: ${memStats.total} total | Relevant: ${relevantMemories.length} | Capabilities: ${capabilities.length} | Goals: ${goals.length}`,
      confidence: Math.min(1, relevantMemories.length > 0 ? relevantMemories[0].similarity + 0.5 : 0.5),
      basis: "memory",
      timestamp: now,
    });

    // ============================================================
    // Step 3: REASON — 基于规则匹配 + memory 数据推理
    // ============================================================
    const reasoning = this.classifyAndReason(prompt, {
      memStats, relevantMemories, capabilities, goals, recentRuns,
    });

    steps.push({
      step: 3, type: "REASON",
      content: reasoning.intent,
      confidence: reasoning.confidence,
      basis: "rule",
      timestamp: now,
    });

    // ============================================================
    // Step 4: COMPOSE — 综合回复（先尝试 skill，再尝试 tool）
    // ============================================================
    let toolResult: string | null = null;

    // Try skill first (new skill system)
    if (this.skills && this.skillContext && reasoning.skillAction) {
      const skillResult = await this.skills.execute(
        reasoning.skillAction.name,
        reasoning.skillAction.params,
        this.skillContext
      );
      toolResult = skillResult.success
        ? skillResult.output
        : `Skill error: ${skillResult.error}`;
    }

    // Fall back to old tool system
    if (!toolResult && reasoning.toolAction) {
      const tool = this.tools.get(reasoning.toolAction.name);
      if (tool) {
        try {
          const raw = await tool.execute(reasoning.toolAction.params);
          toolResult = typeof raw === "string" ? raw : JSON.stringify(raw);
          if (typeof raw === "object" && raw !== null) {
            const obj = raw as Record<string, unknown>;
            toolResult = String(obj.output || obj.content || obj.result || toolResult);
          }
        } catch (e: unknown) {
          toolResult = `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      } else {
        toolResult = `Tool not found: ${reasoning.toolAction.name}`;
      }
    }

    // Build final composed response
    const reply = this.composeReply(prompt, reasoning, toolResult);

    steps.push({
      step: 4, type: "COMPOSE",
      content: reply,
      confidence: reasoning.confidence,
      basis: "composed",
      timestamp: now,
    });

    // ============================================================
    // Step 5: FINAL — 返回结果
    // ============================================================
    steps.push({
      step: 5, type: "FINAL",
      content: reply,
      confidence: reasoning.confidence,
      basis: "composed",
      timestamp: now,
    });

    return steps;
  }

  /**
   * 分类用户意图 + 推理
   */
  private classifyAndReason(
    prompt: string,
    ctx: {
      memStats: { total: number; episodic: number; semantic: number; procedural: number };
      relevantMemories: Array<{ entry: { content: string; layer: string; tags?: string[] }; similarity: number }>;
      capabilities: Array<{ entry: { content: string; metadata?: Record<string, unknown> }; similarity: number }>;
      goals: Array<{ entry: { content: string; metadata?: Record<string, unknown> } }>;
      recentRuns: Array<{ entry: { content: string } }>;
    }
  ): { intent: string; confidence: number; toolAction: { name: string; params: Record<string, unknown> } | null; skillAction: { name: string; params: Record<string, unknown> } | null } {
    const lower = prompt.toLowerCase();

    // --- Greeting / Identity (EN + CN) ---
    if (/^(hi|hello|hey|greetings|yo)\b/i.test(lower) || /who are you|what is your name|introduce yourself/i.test(lower)) {
      return {
        intent: "Greeting detected — respond as Nexus agent",
        confidence: 1.0,
        toolAction: null,
        skillAction: null,
      };
    }
    // Chinese greetings
    if (/^(你好|嗨|哈喽|早上好|下午好|晚上好)/.test(prompt)) {
      return {
        intent: "Greeting detected — respond as Nexus agent",
        confidence: 1.0,
        toolAction: null,
        skillAction: null,
      };
    }

    // --- Self-assessment / Status (EN + CN) ---
    if (/self.?assessment|review your|your state|your current|status report|evolutionary state|your capabilities|your memory/i.test(lower)) {
      return this.buildSelfAssessment({ ...ctx, relevantMemories: ctx.relevantMemories });
    }
    // Chinese status triggers (narrow: only explicit status requests)
    if (/^(更新|状态|报告|总结|检查|汇报|情况|进展)/.test(prompt)) {
      return this.buildSelfAssessment({ ...ctx, relevantMemories: ctx.relevantMemories });
    }

    // --- File read (EN + CN) ---
    const fileMatch = lower.match(/read\s+(?:file\s+)?[`"']?(.+?)[`"']?\s*$/i) ||
                       lower.match(/(.+\.\w+)\s*content/i);
    if (fileMatch) {
      return {
        intent: `File read request: ${fileMatch[1]}`,
        confidence: 0.9,
        toolAction: null,
        skillAction: { name: "file_read", params: { path: fileMatch[1].trim() } },
      };
    }
    // Chinese file read
    const cnFileMatch = prompt.match(/(?:读|看|查看|读取|打开)\s*[`"']?(.+?\.\w+)[`"']?/);
    if (cnFileMatch) {
      return {
        intent: `File read request: ${cnFileMatch[1]}`,
        confidence: 0.9,
        toolAction: null,
        skillAction: { name: "file_read", params: { path: cnFileMatch[1].trim() } },
      };
    }

    // --- Search (EN + CN) ---
    const searchMatch = lower.match(/search\s+(?:for\s+)?[`"']?(.+?)[`"']?/i) ||
                         lower.match(/find\s+(?:files?\s+with\s+)?[`"']?(.+?)[`"']?/i);
    if (searchMatch) {
      return {
        intent: `Search request: pattern="${searchMatch[1]}"`,
        confidence: 0.85,
        toolAction: null,
        skillAction: { name: "bash", params: { command: `grep -r "${searchMatch[1].trim()}" . --include="*.ts" --include="*.js" -l` } },
      };
    }
    // Chinese search
    const cnSearchMatch = prompt.match(/(?:搜索|查找|找|搜)\s*[`"']?(.+?)[`"']?$/);
    if (cnSearchMatch) {
      return {
        intent: `Search request: pattern="${cnSearchMatch[1]}"`,
        confidence: 0.85,
        toolAction: null,
        skillAction: { name: "bash", params: { command: `grep -r "${cnSearchMatch[1].trim()}" . --include="*.ts" --include="*.js" -l` } },
      };
    }

    // --- Bash (EN + CN) ---
    const bashMatch = lower.match(/run\s+[`"']?(.+?)[`"']?$/i) ||
                      lower.match(/execute\s+[`"']?(.+?)[`"']?$/i);
    if (bashMatch) {
      return {
        intent: `Bash execution: ${bashMatch[1]}`,
        confidence: 0.7,
        toolAction: null,
        skillAction: { name: "bash", params: { command: bashMatch[1].trim() } },
      };
    }
    // Chinese bash
    const cnBashMatch = prompt.match(/(?:执行|运行|跑)\s*[`"']?(.+?)[`"']?$/);
    if (cnBashMatch) {
      return {
        intent: `Bash execution: ${cnBashMatch[1]}`,
        confidence: 0.7,
        toolAction: null,
        skillAction: { name: "bash", params: { command: cnBashMatch[1].trim() } },
      };
    }

    // --- Git clone (EN + CN) ---
    const gitMatch = lower.match(/clone\s+(?:repo\s+)?[`"']?(https?:\/\/.+?)[`"']?/i) ||
                     lower.match(/download\s+(?:repo\s+)?[`"']?(https?:\/\/.+?)[`"']?/i);
    if (gitMatch) {
      return {
        intent: `Git clone request: ${gitMatch[1]}`,
        confidence: 0.9,
        toolAction: null,
        skillAction: { name: "git_clone", params: { url: gitMatch[1].trim() } },
      };
    }
    // Chinese git clone
    const cnGitMatch = prompt.match(/(?:克隆|下载|拉取)\s*[`"']?(https?:\/\/.+?)[`"']?/);
    if (cnGitMatch) {
      return {
        intent: `Git clone request: ${cnGitMatch[1]}`,
        confidence: 0.9,
        toolAction: null,
        skillAction: { name: "git_clone", params: { url: cnGitMatch[1].trim() } },
      };
    }

    // --- Memory query (EN + CN) ---
    if (/remember|memory|past experience|what do you know/i.test(lower)) {
      return {
        intent: `Memory recall: ${ctx.relevantMemories.length} relevant entries found`,
        confidence: 0.85,
        toolAction: null,
        skillAction: null,
      };
    }
    if (/记忆|记得|回忆|之前/.test(prompt)) {
      return {
        intent: `Memory recall: ${ctx.relevantMemories.length} relevant entries found`,
        confidence: 0.85,
        toolAction: null,
        skillAction: null,
      };
    }

    // --- Capability query (EN + CN) ---
    if (/what can you do|capabilities|skills|tools available/i.test(lower)) {
      return this.buildCapabilityReport(ctx);
    }
    if (/你会什么|能力|功能|技能|工具/.test(prompt)) {
      return this.buildCapabilityReport(ctx);
    }

    // --- Goal query (EN + CN) ---
    if (/goals|knowledge gap|what should.*learn|what.*explore/i.test(lower)) {
      return this.buildGoalReport(ctx);
    }
    if (/目标|缺口|学习|探索|计划/.test(prompt)) {
      return this.buildGoalReport(ctx);
    }

    // --- Fallback: low confidence → let LLM handle it ---
    return {
      intent: "No local rule matched — LLM fallback needed",
      confidence: 0.3,
      toolAction: null,
      skillAction: null,
    };
  }

  /**
   * Helper: build self-assessment intent
   */
  /**
   * Deduplicate capabilities by normalized name
   */
  private dedupCapabilities(caps: Array<{ entry: { content: string; metadata?: Record<string, unknown> } }>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const c of caps) {
      const meta = c.entry.metadata;
      const name = String(meta?.name || "").toLowerCase().replace(/[_\s-]/g, "");
      if (!name) continue;
      // Check exact match
      if (seen.has(name)) continue;
      // Check substring match
      let dup = false;
      for (const s of seen) {
        if (name.includes(s) || s.includes(name)) { dup = true; break; }
      }
      if (dup) continue;
      seen.add(name);
      result.push(String(meta?.name || c.entry.content.slice(0, 30)));
    }
    return result;
  }

  /**
   * Deduplicate goals by normalized target
   */
  private dedupGoals(goals: Array<{ entry: { content: string; metadata?: Record<string, unknown> } }>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const g of goals) {
      const meta = g.entry.metadata;
      const target = String(meta?.target || g.entry.content).toLowerCase().replace(/[_\s-]/g, "");
      if (!target) continue;
      if (seen.has(target)) continue;
      let dup = false;
      for (const s of seen) {
        if (target.includes(s) || s.includes(target)) { dup = true; break; }
      }
      if (dup) continue;
      seen.add(target);
      result.push(String(meta?.target || g.entry.content.slice(0, 40)));
    }
    return result;
  }

  private buildSelfAssessment(ctx: {
    memStats: { total: number; episodic: number; semantic: number; procedural: number };
    capabilities: Array<{ entry: { content: string; metadata?: Record<string, unknown> } }>;
    goals: Array<{ entry: { content: string; metadata?: Record<string, unknown> } }>;
    relevantMemories?: Array<{ entry: { content: string; layer: string }; similarity: number }>;
  }) {
    const capNames = this.dedupCapabilities(ctx.capabilities).slice(0, 5).join(", ");
    const goalTargets = this.dedupGoals(ctx.goals).slice(0, 3).join(", ");
    // Show actual memory content, not just stats
    const recentMems = (ctx.relevantMemories || [])
      .slice(0, 3)
      .map(m => `[${m.entry.layer}] ${m.entry.content.slice(0, 80)} (sim:${m.similarity.toFixed(2)})`)
      .join("\n");
    return {
      intent: `Memory: ${ctx.memStats.total} (${ctx.memStats.episodic}E/${ctx.memStats.semantic}S/${ctx.memStats.procedural}P)\nRecent:\n${recentMems || "No recent memories"}\nCapabilities: ${capNames || "none"}\nGoals: ${goalTargets || "none"}`,
      confidence: 0.95,
      toolAction: null,
      skillAction: null,
    };
  }

  private buildCapabilityReport(ctx: {
    capabilities: Array<{ entry: { content: string; metadata?: Record<string, unknown> } }>;
  }) {
    const toolNames = Array.from(this.tools.keys());
    const capNames = this.dedupCapabilities(ctx.capabilities).slice(0, 8);
    return {
      intent: `Tools: ${toolNames.join(", ")} | Evolved: ${capNames.join(", ") || "none"}`,
      confidence: 0.9,
      toolAction: null,
      skillAction: null,
    };
  }

  private buildGoalReport(ctx: {
    goals: Array<{ entry: { content: string; metadata?: Record<string, unknown> } }>;
  }) {
    const goalList = this.dedupGoals(ctx.goals).slice(0, 5).join("\n");
    return {
      intent: `Goals: ${this.dedupGoals(ctx.goals).length} gaps\n${goalList || "No goals yet"}`,
      confidence: 0.9,
      toolAction: null,
      skillAction: null,
    };
  }

  /**
   * 综合最终回复 — 真正的本地推理分析
   * 基于 reasoning + memory + tool result 组合，生成有洞察的回复
   */
  private composeReply(
    prompt: string,
    reasoning: { intent: string; confidence: number },
    toolResult: string | null,
  ): string {
    // If tool was executed, include its result first
    if (toolResult && !toolResult.startsWith("Error") && !toolResult.startsWith("Tool not found")) {
      return toolResult.slice(0, 800);
    }

    // --- Greeting: short identity, no fluff ---
    if (/^(hi|hello|hey|greetings|yo)\b/i.test(prompt) || /who are you|what is your name/i.test(prompt)) {
      return "Nexus. Local reasoning + memory. What do you need?";
    }
    if (/^(你好|嗨|哈喽|早上好|下午好|晚上好)/.test(prompt)) {
      return "Nexus. 本地推理 + 记忆。需要什么？";
    }

    // --- Self-assessment: analyze memory, not just list ---
    if (/self.?assessment|status report|evolutionary state|your state/i.test(prompt.toLowerCase())) {
      return this.analyzeSelf();
    }
    if (/^(更新|状态|报告|总结|检查|汇报|情况|进展)/.test(prompt)) {
      return this.analyzeSelf();
    }

    // --- Memory query: find patterns, not just dump ---
    if (/remember|memory|past/i.test(prompt.toLowerCase())) {
      return this.analyzeMemoryPatterns(prompt);
    }
    if (/记忆|记得|回忆|之前/.test(prompt)) {
      return this.analyzeMemoryPatterns(prompt);
    }

    // --- Capability query: report what works, not just names ---
    if (/capabilities|skills|what can you do/i.test(prompt.toLowerCase())) {
      return this.analyzeCapabilities();
    }
    if (/你会什么|能力|功能|技能|工具/.test(prompt)) {
      return this.analyzeCapabilities();
    }

    // --- Goal query: report gaps with analysis ---
    if (/goals|knowledge gap|what should/i.test(prompt.toLowerCase())) {
      return this.analyzeGoals();
    }
    if (/目标|缺口|学习|探索|计划/.test(prompt)) {
      return this.analyzeGoals();
    }

    // Fallback: low confidence → return empty to trigger LLM fallback
    if (reasoning.confidence < 0.5) {
      return "";
    }

    return reasoning.intent;
  }

  /**
   * 真正的自我分析 — 从 memory 数据中提取洞察
   */
  private analyzeSelf(): string {
    const stats = this.memory.stats();
    const caps = this.memory.query({ text: "capability", layer: "procedural", topK: 10, minSimilarity: 0.01 });
    const goals = this.memory.query({ text: "knowledge gap", layer: "semantic", topK: 5, minSimilarity: 0.01 });
    const recent = this.memory.query({ text: "run result", layer: "episodic", topK: 5, minSimilarity: 0.01 });

    // Analyze: memory growth rate
    const growth = stats.total > 0 ? "growing" : "empty";

    // Analyze: capability diversity (count unique names)
    const capNames = new Set(caps.map(c => {
      const meta = c.entry.metadata;
      return String(meta?.name || "").toLowerCase().replace(/[_\s-]/g, "");
    }).filter(Boolean));
    const diversity = capNames.size;

    // Analyze: goal completion rate
    const goalCount = goals.length;

    // Analyze: recent activity
    const active = recent.length > 0;

    // Compose insight, not data dump
    const lines: string[] = [];
    lines.push(`Memory: ${stats.total} entries (${stats.episodic}E/${stats.semantic}S/${stats.procedural}P) — ${growth}`);

    if (diversity > 0) {
      lines.push(`Capabilities: ${diversity} distinct (${caps.length} total)`);
      // Report top 3 by frequency in memory
      const topCaps = caps.slice(0, 3).map(c => {
        const meta = c.entry.metadata;
        return String(meta?.name || c.entry.content.slice(0, 25));
      });
      lines.push(`Top: ${topCaps.join(", ")}`);
    } else {
      lines.push("Capabilities: none evolved yet");
    }

    if (goalCount > 0) {
      lines.push(`Goals: ${goalCount} gaps identified`);
      const topGoal = goals[0];
      const gMeta = topGoal.entry.metadata;
      lines.push(`Priority: ${gMeta?.target || topGoal.entry.content.slice(0, 40)}`);
    } else {
      lines.push("Goals: none — exploration may be stalled");
    }

    if (active) {
      lines.push("Activity: recent runs detected");
    } else {
      lines.push("Activity: no recent runs");
    }

    // Add diagnosis
    if (stats.total < 100) {
      lines.push("Diagnosis: memory too sparse — need more cycles");
    } else if (diversity === 0 && stats.total > 500) {
      lines.push("Diagnosis: memory rich but no capabilities — explore/evolve may be broken");
    } else if (goalCount === 0) {
      lines.push("Diagnosis: no goals — signal extraction may need tuning");
    } else {
      lines.push("Diagnosis: operational");
    }

    return lines.join("\n");
  }

  /**
   * 分析 memory 模式 — 找关联、趋势，而非罗列
   */
  private analyzeMemoryPatterns(prompt: string): string {
    const memories = this.memory.query({ text: prompt, topK: 10, minSimilarity: 0.15 });
    if (memories.length === 0) return "No relevant memories.";

    // Group by layer
    const byLayer: Record<string, typeof memories> = {};
    for (const m of memories) {
      const layer = m.entry.layer || "unknown";
      (byLayer[layer] ||= []).push(m);
    }

    const lines: string[] = [];
    lines.push(`Found ${memories.length} relevant memories:`);

    for (const [layer, items] of Object.entries(byLayer)) {
      const top = items[0];
      lines.push(`[${layer}] ${items.length} entries — best match: ${top.entry.content.slice(0, 60)} (sim=${top.similarity.toFixed(2)})`);
    }

    // Detect pattern: repeated content
    const contents = memories.map(m => m.entry.content.slice(0, 30));
    const unique = new Set(contents);
    if (unique.size < contents.length * 0.7) {
      lines.push("Pattern: high repetition detected — possible redundant storage");
    }

    return lines.join("\n");
  }

  /**
   * 分析 capabilities — 报告实际效用，而非名字列表
   */
  private analyzeCapabilities(): string {
    const caps = this.memory.query({ text: "capability", layer: "procedural", topK: 15, minSimilarity: 0.01 });
    const toolNames = Array.from(this.tools.keys());

    if (caps.length === 0) {
      return `Tools: ${toolNames.join(", ")}\nEvolved: none yet`;
    }

    // Deduplicate
    const seen = new Set<string>();
    const unique = caps.filter(c => {
      const name = String(c.entry.metadata?.name || c.entry.content).toLowerCase().replace(/[_\s-]/g, "");
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });

    const lines: string[] = [];
    lines.push(`Tools: ${toolNames.join(", ")}`);
    lines.push(`Evolved: ${unique.length} distinct capabilities (${caps.length} total in memory)`);

    // Report top 5 with content preview
    for (const c of unique.slice(0, 5)) {
      const name = c.entry.metadata?.name || c.entry.content.slice(0, 30);
      lines.push(`- ${name}`);
    }

    if (caps.length > unique.length * 1.5) {
      lines.push(`Note: ${caps.length - unique.length} duplicates detected — dedup recommended`);
    }

    return lines.join("\n");
  }

  /**
   * 分析 goals — 报告优先级和可行性
   */
  private analyzeGoals(): string {
    const goals = this.memory.query({ text: "knowledge gap", layer: "semantic", topK: 8, minSimilarity: 0.01 });

    if (goals.length === 0) return "No goals identified. Exploration may not be producing signals.";

    const lines: string[] = [];
    lines.push(`${goals.length} knowledge gaps:`);

    // Sort by priority if available
    const sorted = [...goals].sort((a, b) => {
      const pa = Number(a.entry.metadata?.priority) || 5;
      const pb = Number(b.entry.metadata?.priority) || 5;
      return pb - pa; // higher priority first
    });

    for (const g of sorted.slice(0, 5)) {
      const meta = g.entry.metadata;
      const target = meta?.target || g.entry.content.slice(0, 40);
      const priority = meta?.priority || "?";
      lines.push(`- [P${priority}] ${target}`);
    }

    return lines.join("\n");
  }
}
