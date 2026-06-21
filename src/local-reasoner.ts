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

  constructor(memory: MemoryStore) {
    this.memory = memory;
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
    // Step 4: COMPOSE — 综合回复（如果有需要执行的工具，先执行）
    // ============================================================
    let toolResult: string | null = null;
    if (reasoning.toolAction) {
      const tool = this.tools.get(reasoning.toolAction.name);
      if (tool) {
        try {
          const raw = await tool.execute(reasoning.toolAction.params);
          toolResult = typeof raw === "string" ? raw : JSON.stringify(raw);
          // Extract useful content from tool result
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
  ): { intent: string; confidence: number; toolAction: { name: string; params: Record<string, unknown> } | null } {
    const lower = prompt.toLowerCase();

    // --- Greeting / Identity ---
    if (/^(hi|hello|hey|greetings|yo)\b/i.test(lower) || /who are you|what is your name|introduce yourself/i.test(lower)) {
      return {
        intent: "Greeting detected — respond as Nexus agent",
        confidence: 1.0,
        toolAction: null,
      };
    }

    // --- Self-assessment / Status ---
    if (/self.?assessment|review your|your state|your current|status report|evolutionary state|your capabilities|your memory/i.test(lower)) {
      const capNames = ctx.capabilities.slice(0, 5).map(c => {
        const meta = c.entry.metadata;
        return meta?.name || c.entry.content.slice(0, 40);
      }).join(", ");
      const goalTargets = ctx.goals.slice(0, 3).map(g => {
        const meta = g.entry.metadata;
        return meta?.target || g.entry.content.slice(0, 40);
      }).join(", ");

      return {
        intent: `Self-assessment: Memory=${ctx.memStats.total} (${ctx.memStats.episodic}E/${ctx.memStats.semantic}S/${ctx.memStats.procedural}P) | Capabilities: ${capNames || "none"} | Goals: ${goalTargets || "none"}`,
        confidence: 0.95,
        toolAction: null,
      };
    }

    // --- File read ---
    const fileMatch = lower.match(/read\s+(?:file\s+)?[`"']?(.+?)[`"']?\s*$/i) ||
                       lower.match(/(.+\.\w+)\s*content/i);
    if (fileMatch) {
      return {
        intent: `File read request: ${fileMatch[1]}`,
        confidence: 0.9,
        toolAction: { name: "read", params: { path: fileMatch[1].trim() } },
      };
    }

    // --- Search ---
    const searchMatch = lower.match(/search\s+(?:for\s+)?[`"']?(.+?)[`"']?/i) ||
                         lower.match(/find\s+(?:files?\s+with\s+)?[`"']?(.+?)[`"']?/i);
    if (searchMatch) {
      return {
        intent: `Search request: pattern="${searchMatch[1]}"`,
        confidence: 0.85,
        toolAction: { name: "search", params: { pattern: searchMatch[1].trim(), directory: "." } },
      };
    }

    // --- Bash ---
    const bashMatch = lower.match(/run\s+[`"']?(.+?)[`"']?$/i) ||
                      lower.match(/execute\s+[`"']?(.+?)[`"']?$/i);
    if (bashMatch) {
      return {
        intent: `Bash execution: ${bashMatch[1]}`,
        confidence: 0.7,
        toolAction: { name: "bash", params: { command: bashMatch[1].trim() } },
      };
    }

    // --- Memory query ---
    if (/remember|memory|past experience|what do you know/i.test(lower)) {
      const memSummary = ctx.relevantMemories.slice(0, 3).map(m =>
        `[${m.entry.layer}] ${m.entry.content.slice(0, 80)}`
      ).join("\n");
      return {
        intent: `Memory recall: ${ctx.relevantMemories.length} relevant entries found`,
        confidence: 0.85,
        toolAction: null,
      };
    }

    // --- Capability query ---
    if (/what can you do|capabilities|skills|tools available/i.test(lower)) {
      const toolNames = Array.from(this.tools.keys());
      const capNames = ctx.capabilities.slice(0, 8).map(c => {
        const meta = c.entry.metadata;
        return meta?.name || c.entry.content.slice(0, 30);
      });
      return {
        intent: `Capability report: ${toolNames.length} tools (${toolNames.join(", ")}) + ${capNames.length} evolved capabilities`,
        confidence: 0.9,
        toolAction: null,
      };
    }

    // --- Goal query ---
    if (/goals|knowledge gap|what should.*learn|what.*explore/i.test(lower)) {
      const goalList = ctx.goals.slice(0, 5).map(g => {
        const meta = g.entry.metadata;
        return `- ${meta?.target || g.entry.content.slice(0, 50)} (priority ${meta?.priority || "?"})`;
      }).join("\n");
      return {
        intent: `Goals: ${ctx.goals.length} knowledge gaps\n${goalList || "No goals identified yet"}`,
        confidence: 0.9,
        toolAction: null,
      };
    }

    // --- Fallback: use memory + general response ---
    if (ctx.relevantMemories.length > 0) {
      const best = ctx.relevantMemories[0];
      return {
        intent: `Memory-relevant response: similarity=${best.similarity.toFixed(2)}, source=[${best.entry.layer}]`,
        confidence: 0.6,
        toolAction: null,
      };
    }

    return {
      intent: "No local rule matched — complex query, LLM fallback needed",
      confidence: 0.3,
      toolAction: null,
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

    // --- Self-assessment: analyze memory, not just list ---
    if (/self.?assessment|status report|evolutionary state|your state/i.test(prompt.toLowerCase())) {
      return this.analyzeSelf();
    }

    // --- Memory query: find patterns, not just dump ---
    if (/remember|memory|past/i.test(prompt.toLowerCase())) {
      return this.analyzeMemoryPatterns(prompt);
    }

    // --- Capability query: report what works, not just names ---
    if (/capabilities|skills|what can you do/i.test(prompt.toLowerCase())) {
      return this.analyzeCapabilities();
    }

    // --- Goal query: report gaps with analysis ---
    if (/goals|knowledge gap|what should/i.test(prompt.toLowerCase())) {
      return this.analyzeGoals();
    }

    // Fallback: reasoning intent (concise)
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
