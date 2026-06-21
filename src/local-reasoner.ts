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
   * 综合最终回复
   * 基于 reasoning + memory + tool result 组合
   */
  private composeReply(
    prompt: string,
    reasoning: { intent: string; confidence: number },
    toolResult: string | null,
  ): string {
    const parts: string[] = [];

    // If tool was executed, include its result
    if (toolResult && !toolResult.startsWith("Error") && !toolResult.startsWith("Tool not found")) {
      parts.push(toolResult.slice(0, 500));
    }

    // Add reasoning intent as context
    if (reasoning.confidence >= 0.8) {
      parts.push(reasoning.intent);
    }

    // For self-assessment, compose a structured report
    if (/self.?assessment|status report|evolutionary state/i.test(prompt.toLowerCase())) {
      return reasoning.intent; // Already contains full status
    }

    // For greetings, return identity
    if (/^(hi|hello|hey|greetings|yo)\b/i.test(prompt) || /who are you|what is your name/i.test(prompt)) {
      return "I am Nexus, an autonomous reasoning agent. I operate through local rule-based reasoning and memory. I can read files, search code, execute commands, and recall past experiences. How can I assist you?";
    }

    // For memory queries, include relevant memories
    if (/remember|memory|past/i.test(prompt.toLowerCase())) {
      const memories = this.memory.query({ text: prompt, topK: 3, minSimilarity: 0.2 });
      if (memories.length > 0) {
        const memParts = memories.map(m =>
          `[${m.entry.layer}] ${m.entry.content.slice(0, 150)}`
        );
        parts.push("Relevant memories:\n" + memParts.join("\n"));
      }
    }

    // For capability queries
    if (/capabilities|skills|what can you do/i.test(prompt.toLowerCase())) {
      const caps = this.memory.query({ text: "capability", layer: "procedural", topK: 8, minSimilarity: 0.01 });
      const toolNames = Array.from(this.tools.keys());
      parts.push(`Available tools: ${toolNames.join(", ")}`);
      if (caps.length > 0) {
        const capNames = caps.map(c => {
          const meta = c.entry.metadata;
          return `- ${meta?.name || c.entry.content.slice(0, 30)}`;
        });
        parts.push(`Evolved capabilities:\n${capNames.join("\n")}`);
      }
    }

    // For goal queries
    if (/goals|knowledge gap|what should/i.test(prompt.toLowerCase())) {
      const goals = this.memory.query({ text: "knowledge gap", layer: "semantic", topK: 5, minSimilarity: 0.01 });
      if (goals.length > 0) {
        const goalList = goals.map(g => {
          const meta = g.entry.metadata;
          return `- ${meta?.target || g.entry.content.slice(0, 50)} (priority ${meta?.priority || "?"})`;
        });
        parts.push(`Knowledge gaps:\n${goalList.join("\n")}`);
      }
    }

    // Fallback: combine what we have
    if (parts.length === 0) {
      parts.push(reasoning.intent);
    }

    return parts.join("\n\n");
  }
}
