/**
 * Local Reasoner — 本地推理引擎
 *
 * 核心设计：不依赖 LLM 的真正的本地思考能力
 * - 基于规则的推理（模式匹配、条件判断）
 * - 基于记忆的联想推理（相似度匹配、经验复用）
 * - 基于工具的执行验证（执行后观察结果，本地决策下一步）
 *
 * 与 LLM 的关系：LLM 只用于自然语言生成和复杂语义理解，
 * 所有决策、规划、工具选择都在本地完成。
 */

import { MemoryStore } from "./memory";

export interface LocalReasonStep {
  step: number;
  type: "OBSERVE" | "MATCH" | "DECIDE" | "EXECUTE" | "VERIFY" | "FINAL";
  content: string;
  confidence: number; // 0-1
  basis: "rule" | "memory" | "tool" | "fallback";
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
  private rules: Array<(observation: string) => { action: string; params: Record<string, unknown>; confidence: number } | null> = [];

  constructor(memory: MemoryStore) {
    this.memory = memory;
    this.registerDefaultRules();
  }

  registerTool(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 本地推理主循环
   * 不调用 LLM，纯本地决策
   */
  async reason(prompt: string, maxSteps: number = 5): Promise<LocalReasonStep[]> {
    const steps: LocalReasonStep[] = [];
    let currentObservation = prompt;

    for (let stepNum = 1; stepNum <= maxSteps; stepNum++) {
      // Step 1: OBSERVE — 分析当前状态
      const observationStep: LocalReasonStep = {
        step: stepNum,
        type: "OBSERVE",
        content: currentObservation,
        confidence: 1.0,
        basis: "rule",
        timestamp: Date.now(),
      };
      steps.push(observationStep);

      // Step 2: MATCH — 从记忆中找相似经验
      const memories = this.memory.query({ text: currentObservation, topK: 3, minSimilarity: 0.3 });
      if (memories.length > 0) {
        const best = memories[0];
        steps.push({
          step: stepNum,
          type: "MATCH",
          content: `Memory match: ${best.entry.content.slice(0, 100)} (similarity: ${best.similarity.toFixed(2)})`,
          confidence: best.similarity,
          basis: "memory",
          timestamp: Date.now(),
        });
      }

      // Step 3: DECIDE — 基于规则选择行动
      let decision: { action: string; params: Record<string, unknown>; confidence: number } | null = null;
      for (const rule of this.rules) {
        decision = rule(currentObservation);
        if (decision && decision.confidence > 0.5) break;
      }

      if (!decision) {
        // No rule matched — fallback to asking for help (but still local)
        steps.push({
          step: stepNum,
          type: "FINAL",
          content: `No local rule matched for: ${currentObservation.slice(0, 200)}. Available tools: ${Array.from(this.tools.keys()).join(", ")}`,
          confidence: 0.3,
          basis: "fallback",
          timestamp: Date.now(),
        });
        return steps;
      }

      steps.push({
        step: stepNum,
        type: "DECIDE",
        content: `Selected action: ${decision.action} with confidence ${decision.confidence.toFixed(2)}`,
        confidence: decision.confidence,
        basis: "rule",
        timestamp: Date.now(),
      });

      // Step 4: EXECUTE — 执行工具
      const tool = this.tools.get(decision.action);
      if (!tool) {
        steps.push({
          step: stepNum,
          type: "VERIFY",
          content: `Tool not found: ${decision.action}`,
          confidence: 0,
          basis: "rule",
          timestamp: Date.now(),
        });
        break;
      }

      try {
        const result = await tool.execute(decision.params);
        const resultStr = typeof result === "string" ? result : JSON.stringify(result).slice(0, 500);
        currentObservation = resultStr;

        steps.push({
          step: stepNum,
          type: "EXECUTE",
          content: `${decision.action} result: ${resultStr.slice(0, 200)}`,
          confidence: decision.confidence,
          basis: "tool",
          timestamp: Date.now(),
        });

        // Step 5: VERIFY — 检查结果是否满足目标
        if (this.isSatisfied(prompt, resultStr)) {
          steps.push({
            step: stepNum,
            type: "FINAL",
            content: `Goal satisfied. Final result: ${resultStr.slice(0, 300)}`,
            confidence: 0.9,
            basis: "rule",
            timestamp: Date.now(),
          });
          return steps;
        }
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : String(e);
        steps.push({
          step: stepNum,
          type: "VERIFY",
          content: `Execution failed: ${err.slice(0, 200)}`,
          confidence: 0,
          basis: "tool",
          timestamp: Date.now(),
        });
        currentObservation = `Error: ${err}`;
      }
    }

    // Max steps reached
    steps.push({
      step: steps.length + 1,
      type: "FINAL",
      content: `Max steps (${maxSteps}) reached. Last observation: ${currentObservation.slice(0, 200)}`,
      confidence: 0.5,
      basis: "fallback",
      timestamp: Date.now(),
    });
    return steps;
  }

  /**
   * 注册默认规则集
   * 这些规则基于关键词匹配，纯本地执行
   */
  private registerDefaultRules(): void {
    // Rule: file read request
    this.rules.push((obs) => {
      const match = obs.match(/read\s+(?:file\s+)?[`"']?(.+?)[`"']?\s*$/i) ||
                    obs.match(/(.+\.\w+)\s*content/i);
      if (match) {
        return { action: "read", params: { path: match[1].trim() }, confidence: 0.9 };
      }
      return null;
    });

    // Rule: search request
    this.rules.push((obs) => {
      const match = obs.match(/search\s+(?:for\s+)?[`"']?(.+?)[`"']?/i) ||
                    obs.match(/find\s+(?:files?\s+with\s+)?[`"']?(.+?)[`"']?/i);
      if (match) {
        return { action: "search", params: { pattern: match[1].trim(), directory: "." }, confidence: 0.85 };
      }
      return null;
    });

    // Rule: bash command request
    this.rules.push((obs) => {
      const match = obs.match(/run\s+[`"']?(.+?)[`"']?/i) ||
                    obs.match(/execute\s+[`"']?(.+?)[`"']?/i) ||
                    obs.match(/bash\s+[`"']?(.+?)[`"']?/i);
      if (match) {
        return { action: "bash", params: { command: match[1].trim() }, confidence: 0.7 };
      }
      return null;
    });

    // Rule: memory query
    this.rules.push((obs) => {
      if (obs.includes("remember") || obs.includes("memory") || obs.includes("past")) {
        return { action: "memory_query", params: { text: obs, topK: 5 }, confidence: 0.8 };
      }
      return null;
    });

    // Rule: self-assessment / introspection / status (daemon default prompt)
    this.rules.push((obs) => {
      const introspectionKeywords = [
        "self-assessment", "review your", "your state", "your current",
        "who are you", "what are you", "your capabilities", "your memory",
        "status report", "current state", "evolutionary state",
      ];
      if (introspectionKeywords.some(kw => obs.toLowerCase().includes(kw))) {
        const stats = this.memory.stats();
        const caps = this.memory.query({ text: "capability", layer: "procedural", topK: 5, minSimilarity: 0.01 });
        const capNames = caps.map(c => c.entry.metadata?.name || c.entry.content.slice(0, 30)).join(", ");
        return {
          action: "bash",
          params: { command: `echo "Nexus Status Report:
Memory: ${stats.total} total (${stats.episodic} episodic, ${stats.semantic} semantic, ${stats.procedural} procedural)
Recent Capabilities: ${capNames || "none"}
Local Reasoner: active (rule-based, no LLM)"` },
          confidence: 0.95,
        };
      }
      return null;
    });

    // Rule: greeting / identity inquiry — BLOCK to prevent LLM identity leakage
    this.rules.push((obs) => {
      const greetingPatterns = [
        /^(hi|hello|hey|greetings)\b/i,
        /who are you/i,
        /what is your name/i,
        /tell me about yourself/i,
        /introduce yourself/i,
      ];
      if (greetingPatterns.some(p => p.test(obs))) {
        return {
          action: "bash",
          params: { command: "echo 'I am Nexus, an autonomous reasoning agent. I operate through local rule-based reasoning and memory. How can I assist you?'" },
          confidence: 1.0,
        };
      }
      return null;
    });
  }

  /**
   * 检查是否满足目标
   * 简单启发式：结果包含答案特征或错误已解决
   */
  private isSatisfied(prompt: string, result: string): boolean {
    // If result is substantial (not just error), consider it a success
    if (result.length > 50 && !result.startsWith("Error")) return true;
    // If prompt asks a question and result contains likely answer patterns
    if (prompt.includes("?") && (result.includes(":") || result.includes("is") || result.includes("are"))) return true;
    return false;
  }
}
