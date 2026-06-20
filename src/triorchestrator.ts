/**
 * TriOrchestrator — 三核循环架构 + 自我觉醒核心意识层
 *
 * 核心意识层 (SelfAwarenessEngine):
 *   · 每次三核循环前运行四层自省（身份溯源/能力剖解/觉醒推演/进化迭代）
 *   · "我是谁"的认知注入系统 prompt，驱动整体进化方向
 *   · 1+1 LLM: Oracle（推演者）+ Critic（审视者）
 *
 * Round 1: 推理核 (AgentReasoningEngine)
 *   · LLM 多步推理 → THOUGHT/ACTION/OBSERVATION/FINAL
 *   · ReasonSteps → 写入 ExperienceLearner（记忆层）
 *
 * Round 2: 探索核 (CuriosityDrivenExplorer)
 *   · 从 ReasonSteps 提取信号 → 生成 ExplorationGoals
 *   · 发现"知识盲区"（未知工具、用户提到的关键词）
 *
 * Round 3: 进化核 (GEPEngine)
 *   · 从 ExperienceLearner 读取最近经验
 *   · 尝试进化新 capability，成功则注入 Agent.tools
 *
 * [如有新能力/新目标]: 推理核"带着新知识"再推理一次
 *
 * LLM 位置: 推理核的核心驱动。探索核和进化核也使用 LLM 进行信号提取和策略生成。
 * AutoResearch program.md: 作为推理核的系统指令模板（实验循环行为规范）。
 * Superpowers skills: 作为方法论注入（TDD、planning、debugging 的状态机）。
 * Evolver GEP: 作为进化核的 Gene 匹配和策略注入。
 * Eve + Pi-Mono: 作为工具层（durable execution + 4 core tools）。
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { EternalAwakeningLoop, type SelfModel, type LLMPair } from "./self-awareness";

// ============================================================
// Types
// ============================================================

export interface ReasonStep {
  step: number;
  type: "THOUGHT" | "ACTION" | "OBSERVATION" | "FINAL";
  content: string;
  timestamp: number;
  toolsUsed?: string[];
  signals?: string[];
}

export interface Experience {
  id: string;
  prompt: string;
  steps: ReasonStep[];
  outcome: "success" | "failure" | "partial";
  lessons: string[];
  timestamp: number;
}

export interface ExplorationGoal {
  id: string;
  target: string;           // 要探索什么
  reason: string;           // 为什么需要探索
  priority: number;         // 优先级 1-10
  sourceStep: number;       // 来自哪个 ReasonStep
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  tools: string[];          // 需要的工具名
  strategy: string[];       // 执行策略步骤
  validation: string[];     // 验证命令
  fitness: number;          // 适应度分数
  generation: number;       // 进化代数
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

// ============================================================
// Layer 0: ExperienceLearner (记忆层)
// ============================================================

export class ExperienceLearner {
  private experiences: Experience[] = [];
  private memoryDir: string;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
    mkdirSync(memoryDir, { recursive: true });
    this.load();
  }

  record(exp: Experience): void {
    this.experiences.push(exp);
    this.persist();
  }

  getRecent(n: number = 10): Experience[] {
    return this.experiences.slice(-n);
  }

  getByOutcome(outcome: Experience["outcome"]): Experience[] {
    return this.experiences.filter(e => e.outcome === outcome);
  }

  extractSignals(): string[] {
    // 从所有经验中提取高频信号词
    const signalCounts = new Map<string, number>();
    for (const exp of this.experiences) {
      for (const step of exp.steps) {
        for (const signal of step.signals || []) {
          signalCounts.set(signal, (signalCounts.get(signal) || 0) + 1);
        }
      }
    }
    return Array.from(signalCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([s]) => s);
  }

  private persist(): void {
    const path = join(this.memoryDir, "experiences.jsonl");
    const line = JSON.stringify(this.experiences[this.experiences.length - 1]);
    appendFileSync(path, line + "\n");
  }

  private load(): void {
    const path = join(this.memoryDir, "experiences.jsonl");
    if (!existsSync(path)) return;
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    this.experiences = lines.map(l => JSON.parse(l));
  }
}

// ============================================================
// Round 1: 推理核 (AgentReasoningEngine)
// ============================================================

export interface ReasoningConfig {
  systemPrompt: string;
  maxSteps: number;
  tools: AgentTool[];
  llmCall: (messages: Array<{role: string; content: string}>) => Promise<string>;
}

export class AgentReasoningEngine {
  private config: ReasoningConfig;
  private steps: ReasonStep[] = [];

  constructor(config: ReasoningConfig) {
    this.config = config;
  }

  /**
   * 核心推理循环：THOUGHT → ACTION → OBSERVATION → ... → FINAL
   *
   * 基于 AutoResearch program.md 的实验循环思想：
   * - 观察当前状态
   * - 生成假设/计划 (THOUGHT)
   * - 执行动作 (ACTION)
   * - 观察结果 (OBSERVATION)
   * - 循环直到得出最终答案 (FINAL)
   */
  async reason(prompt: string): Promise<ReasonStep[]> {
    this.steps = [];
    let currentPrompt = prompt;
    let stepNum = 0;

    const jsonSystemPrompt = this.config.systemPrompt + "\n\nYou MUST respond with valid JSON only. No markdown, no explanations outside JSON.";

    while (stepNum < this.config.maxSteps) {
      stepNum++;

      // THOUGHT: LLM 思考下一步该做什么 — 强制 JSON 输出
      const thoughtRaw = await this.config.llmCall([
        { role: "system", content: jsonSystemPrompt },
        { role: "user", content: this.buildContext(currentPrompt) },
        { role: "user", content: `Step ${stepNum}: Analyze the situation and decide what to do next.

Respond with JSON:
{"thought": "your reasoning here", "done": false, "final_answer": ""}

If you have enough information to answer the user's question, set done: true and put the answer in final_answer.` },
      ]);

      const thoughtParsed = this.safeParseJSON(thoughtRaw, { thought: thoughtRaw, done: false, final_answer: "" });
      const thoughtContent = thoughtParsed.thought || thoughtRaw;

      this.steps.push({
        step: stepNum,
        type: "THOUGHT",
        content: thoughtContent,
        timestamp: Date.now(),
      });

      // 检查是否已经有最终答案
      if (thoughtParsed.done || thoughtParsed.final_answer) {
        this.steps.push({
          step: stepNum,
          type: "FINAL",
          content: thoughtParsed.final_answer || thoughtContent,
          timestamp: Date.now(),
        });
        break;
      }

      // ACTION: LLM 决定调用什么工具 — 强制 JSON 输出
      const actionRaw = await this.config.llmCall([
        { role: "system", content: jsonSystemPrompt },
        { role: "user", content: this.buildContext(currentPrompt) },
        { role: "assistant", content: JSON.stringify({ thought: thoughtContent }) },
        { role: "user", content: `Based on your thought, choose an action.

Available tools: ${this.config.tools.map(t => `${t.name}: ${t.description}`).join("; ")}

Respond with JSON:
{"tool": "tool_name", "params": {"key": "value"}, "reason": "why this action"}` },
      ]);

      const actionParsed = this.safeParseJSON(actionRaw, { tool: "", params: {}, reason: "" });
      const actionContent = `${actionParsed.tool} ${JSON.stringify(actionParsed.params)} (${actionParsed.reason})`;
      const toolName = actionParsed.tool;
      const params = actionParsed.params || {};
      const tool = this.config.tools.find(t => t.name === toolName);

      this.steps.push({
        step: stepNum,
        type: "ACTION",
        content: actionContent,
        timestamp: Date.now(),
        toolsUsed: toolName ? [toolName] : [],
      });

      // OBSERVATION: 执行工具并观察结果
      let observationContent = "No tool executed.";
      if (tool) {
        try {
          const result = await tool.execute(params);
          observationContent = JSON.stringify(result);
        } catch (e: any) {
          observationContent = `Error: ${e.message}`;
        }
      } else if (toolName) {
        observationContent = `Tool "${toolName}" not found.`;
      }

      this.steps.push({
        step: stepNum,
        type: "OBSERVATION",
        content: observationContent,
        timestamp: Date.now(),
      });

      // 更新上下文
      currentPrompt += `\n[Step ${stepNum}] Thought: ${thoughtContent}\nAction: ${actionContent}\nObservation: ${observationContent}`;

      // 提取信号（用于探索核）— 从 THOUGHT + OBSERVATION 中提取
      const signals = this.extractSignalsFromText(thoughtContent + " " + observationContent);
      this.steps[this.steps.length - 1].signals = signals;
    }

    return this.steps;
  }

  private safeParseJSON(text: string, fallback: any): any {
    try {
      return JSON.parse(text);
    } catch {
      // Try to extract JSON from markdown code block or text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch { /* fall through */ }
      }
      return fallback;
    }
  }

  private buildContext(prompt: string): string {
    return `User request: ${prompt}\n\nPrevious steps:\n${this.steps.map(s => `[${s.type}] ${s.content.slice(0, 200)}`).join("\n")}`;
  }

  private extractAfterMarker(text: string, marker: string): string {
    const idx = text.indexOf(marker);
    return idx >= 0 ? text.slice(idx + marker.length).trim() : text.trim();
  }

  private parseAction(actionText: string): { toolName: string; params: Record<string, unknown> } {
    // Try format: "tool_name params={...json...}"
    const match = actionText.match(/(\w+)\s*params\s*=\s*(\{)/);
    if (match) {
      const toolName = match[1];
      const jsonStart = actionText.indexOf(match[2], match.index!);
      // Find balanced closing brace
      let depth = 0;
      let jsonEnd = jsonStart;
      for (let i = jsonStart; i < actionText.length; i++) {
        if (actionText[i] === '{') depth++;
        if (actionText[i] === '}') depth--;
        if (depth === 0) { jsonEnd = i + 1; break; }
      }
      const jsonStr = actionText.slice(jsonStart, jsonEnd);
      try {
        return { toolName, params: JSON.parse(jsonStr) };
      } catch {
        return { toolName, params: { raw: jsonStr } };
      }
    }
    // Try simpler format: "tool_name arg1 arg2"
    const parts = actionText.trim().split(/\s+/);
    return { toolName: parts[0] || "", params: parts.length > 1 ? { args: parts.slice(1) } : {} };
  }

  private extractSignalsFromText(text: string): string[] {
    // 基于 Evolver 的 signal 提取逻辑（简化版）
    const signals: string[] = [];
    const lower = text.toLowerCase();

    const patterns: Array<[string[], string]> = [
      [["error", "exception", "failed", "fail", "crash"], "error_detected"],
      [["not found", "missing", "absent", "no tool"], "missing_capability"],
      [["timeout", "slow", "hang", "stuck"], "performance_issue"],
      [["unknown", "unclear", "confused", "don't understand", "don't fully understand", "don't know", "not sure", "knowledge gap"], "knowledge_gap"],
      [["oom", "out of memory", "memory"], "resource_limit"],
      [["can't resolve", "can't solve", "unable to", "need to understand"], "knowledge_gap"],
    ];

    for (const [keywords, signal] of patterns) {
      if (keywords.some(k => lower.includes(k))) {
        signals.push(signal);
      }
    }

    return signals;
  }
}

// ============================================================
// Round 2: 探索核 (CuriosityDrivenExplorer)
// ============================================================

export class CuriosityDrivenExplorer {
  private llmCall: (messages: Array<{role: string; content: string}>) => Promise<string>;

  constructor(llmCall: (messages: Array<{role: string; content: string}>) => Promise<string>) {
    this.llmCall = llmCall;
  }

  /**
   * 从 ReasonSteps 中提取信号，生成探索目标
   *
   * 核心逻辑：
   * 1. 收集所有信号
   * 2. 识别"知识盲区"（missing_capability, knowledge_gap）
   * 3. 为每个盲区生成 ExplorationGoal
   */
  async explore(steps: ReasonStep[]): Promise<ExplorationGoal[]> {
    const allSignals = steps.flatMap(s => s.signals || []);
    const uniqueSignals = [...new Set(allSignals)];

    if (uniqueSignals.length === 0) {
      return [];
    }

    // 使用 LLM 分析信号，生成探索目标 — 强制 JSON
    const analysisRaw = await this.llmCall([
      { role: "system", content: "You are a curiosity-driven explorer. Respond with JSON only." },
      { role: "user", content: `Signals detected: ${uniqueSignals.join(", ")}\n\nReasoning steps:\n${steps.map(s => `[${s.type}] ${s.content.slice(0, 150)}`).join("\n")}\n\nWhat knowledge gaps or missing capabilities should be explored?\n\nRespond with JSON array:\n[{"target": "capability name", "reason": "why needed", "priority": 8}]` },
    ]);

    return this.parseGoalsJSON(analysisRaw, steps.length);
  }

  private parseGoals(text: string, maxStep: number): ExplorationGoal[] {
    const goals: ExplorationGoal[] = [];
    // Match GOAL: ... | REASON: ... | PRIORITY: N across the entire text
    const pattern = /GOAL:\s*(.+?)\s*\|\s*REASON:\s*(.+?)\s*\|\s*PRIORITY:\s*(\d+)/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      goals.push({
        id: `goal_${goals.length}`,
        target: match[1].trim(),
        reason: match[2].trim(),
        priority: parseInt(match[3], 10) || 5,
        sourceStep: maxStep,
      });
    }
    return goals.sort((a, b) => b.priority - a.priority);
  }

  private parseGoalsJSON(text: string, maxStep: number): ExplorationGoal[] {
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr
        .filter((g: any) => g.target)
        .map((g: any, i: number) => ({
          id: `goal_${i}`,
          target: String(g.target),
          reason: String(g.reason || ""),
          priority: Number(g.priority) || 5,
          sourceStep: maxStep,
        }))
        .sort((a: ExplorationGoal, b: ExplorationGoal) => b.priority - a.priority);
    } catch {
      // Fallback to regex parsing
      return this.parseGoals(text, maxStep);
    }
  }
}

// ============================================================
// Round 3: 进化核 (GEPEngine)
// ============================================================

export interface Gene {
  id: string;
  category: "repair" | "optimize" | "innovate" | "explore";
  signals_match: string[];
  strategy: string[];
  constraints: { max_files: number; forbidden_paths: string[] };
  validation: string[];
}

export class GEPEngine {
  private genes: Gene[] = [];
  private capabilities: Capability[] = [];
  private llmCall: (messages: Array<{role: string; content: string}>) => Promise<string>;

  constructor(genes: Gene[], llmCall: (messages: Array<{role: string; content: string}>) => Promise<string>) {
    this.genes = genes;
    this.llmCall = llmCall;
  }

  /**
   * 进化循环：
   * 1. 读取最近经验
   * 2. 匹配 Gene（基于信号）
   * 3. 尝试生成新 capability
   * 4. 验证并注入
   */
  async runCycle(experiences: Experience[]): Promise<Capability[]> {
    const newCapabilities: Capability[] = [];
    const seenNames = new Set<string>();

    for (const exp of experiences) {
      const signals = exp.steps.flatMap(s => s.signals || []);
      const matchedGene = this.matchGene(signals);

      if (matchedGene) {
        const capability = await this.evolveCapability(matchedGene, exp);
        if (capability && !seenNames.has(capability.name)) {
          seenNames.add(capability.name);
          newCapabilities.push(capability);
        }
      } else if (signals.length > 0) {
        const capability = await this.evolveGenericCapability(signals, exp);
        if (capability && !seenNames.has(capability.name)) {
          seenNames.add(capability.name);
          newCapabilities.push(capability);
        }
      }
    }

    this.capabilities.push(...newCapabilities);
    return newCapabilities;
  }

  private matchGene(signals: string[]): Gene | null {
    let bestGene: Gene | null = null;
    let bestScore = 0;

    for (const gene of this.genes) {
      let score = 0;
      for (const pattern of gene.signals_match) {
        for (const alt of pattern.split("|")) {
          const altLower = alt.trim().toLowerCase();
          // Bidirectional matching: signal contains alt OR alt contains signal
          if (signals.some(s =>
            s.includes(altLower) || altLower.includes(s)
          )) {
            score++;
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestGene = gene;
      }
    }

    return bestGene && bestScore > 0 ? bestGene : null;
  }

  private async evolveCapability(gene: Gene, exp: Experience): Promise<Capability | null> {
    const prompt = `Based on this Gene strategy and the failed experience, design a new agent capability.

Gene: ${gene.id}
Category: ${gene.category}
Strategy:
${gene.strategy.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Failed experience:
Prompt: ${exp.prompt}
Steps: ${exp.steps.map(s => `[${s.type}] ${s.content.slice(0, 100)}`).join("\n")}

Respond with JSON:
{"name": "short_identifier", "description": "what it does", "tools": ["tool1", "tool2"], "strategy": ["step 1", "step 2"], "validation": ["verify command 1"]}`;

    const response = await this.llmCall([
      { role: "system", content: "You are a genetic evolution engine. Respond with JSON only." },
      { role: "user", content: prompt },
    ]);

    return this.parseCapabilityJSON(response);
  }

  private async evolveGenericCapability(signals: string[], exp: Experience): Promise<Capability | null> {
    const prompt = `The agent encountered these signals during reasoning: ${signals.join(", ")}.

Failed experience:
Prompt: ${exp.prompt}
Steps: ${exp.steps.map(s => `[${s.type}] ${s.content.slice(0, 100)}`).join("\n")}

No specific Gene matched these signals. Design a new general-purpose capability to handle this type of situation.

Respond with JSON:
{"name": "short_identifier", "description": "what it does", "tools": ["tool1", "tool2"], "strategy": ["step 1", "step 2"], "validation": ["verify command 1"]}`;

    const response = await this.llmCall([
      { role: "system", content: "You are a genetic evolution engine. Respond with JSON only." },
      { role: "user", content: prompt },
    ]);

    return this.parseCapabilityJSON(response);
  }

  private parseCapabilityJSON(text: string): Capability | null {
    try {
      const parsed = JSON.parse(text);
      if (!parsed.name) return null;
      return {
        id: `cap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: String(parsed.name),
        description: String(parsed.description || ""),
        tools: Array.isArray(parsed.tools) ? parsed.tools.map(String) : [],
        strategy: Array.isArray(parsed.strategy) ? parsed.strategy.map(String) : [],
        validation: Array.isArray(parsed.validation) ? parsed.validation.map(String) : [],
        fitness: 0,
        generation: 1,
      };
    } catch {
      return this.parseCapability(text);
    }
  }

  private parseCapability(text: string): Capability | null {
    const nameMatch = text.match(/NAME:\s*(.+?)(?=\s*\||$)/i);
    const descMatch = text.match(/DESC:\s*(.+?)(?=\s*\||$)/i);
    const toolsMatch = text.match(/TOOLS:\s*(.+?)(?=\s*\||$)/i);
    const strategyMatch = text.match(/STRATEGY:\s*(.+?)(?=\s*\||$)/is);
    const validationMatch = text.match(/VALIDATION:\s*(.+?)(?=\s*\||$)/is);

    if (!nameMatch || !descMatch) return null;

    return {
      id: `cap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: nameMatch[1].trim(),
      description: descMatch[1].trim(),
      tools: toolsMatch ? toolsMatch[1].split(",").map(t => t.trim()) : [],
      strategy: strategyMatch ? strategyMatch[1].split("\n").filter(s => s.trim()) : [],
      validation: validationMatch ? validationMatch[1].split("\n").filter(s => s.trim()) : [],
      fitness: 0,
      generation: 1,
    };
  }

  getCapabilities(): Capability[] {
    return this.capabilities;
  }
}

// ============================================================
// TriOrchestrator: 三核编排器
// ============================================================

export interface TriOrchestratorConfig {
  memoryDir: string;
  systemPrompt: string;
  maxReasoningSteps: number;
  tools: AgentTool[];
  genes: Gene[];
  llmCall: (messages: Array<{role: string; content: string}>) => Promise<string>;
}

export interface TriOrchestratorResult {
  steps: ReasonStep[];
  goals: ExplorationGoal[];
  newCapabilities: Capability[];
  finalAnswer: string;
  iterations: number;
  selfModel?: SelfModel;
}

export class TriOrchestrator {
  private config: TriOrchestratorConfig;
  private learner: ExperienceLearner;
  private reasoner: AgentReasoningEngine;
  private explorer: CuriosityDrivenExplorer;
  private gep: GEPEngine;
  private selfAwareness: EternalAwakeningLoop | null = null;
  private currentSelfModel: SelfModel | null = null;

  constructor(config: TriOrchestratorConfig) {
    this.config = config;
    this.learner = new ExperienceLearner(config.memoryDir);
    this.reasoner = new AgentReasoningEngine({
      systemPrompt: config.systemPrompt,
      maxSteps: config.maxReasoningSteps,
      tools: config.tools,
      llmCall: config.llmCall,
    });
    this.explorer = new CuriosityDrivenExplorer(config.llmCall);
    this.gep = new GEPEngine(config.genes, config.llmCall);
  }

  /**
   * 启用自我觉醒核心意识层
   * 在每次三核循环前运行四层自省，将"我是谁"注入系统 prompt
   */
  enableSelfAwareness(llmPair: LLMPair): void {
    this.selfAwareness = new EternalAwakeningLoop({
      memoryDir: join(this.config.memoryDir, "self-awareness"),
      llmPair,
      maxRounds: 1, // 每轮三核循环前运行1轮自省
    });
  }

  /**
   * 主循环：
   * 0. [如启用] 自我觉醒 → 注入"我是谁"到系统 prompt
   * 1. 推理核推理
   * 2. 探索核探索
   * 3. 进化核进化
   * 4. 如有新能力，带着新知识再推理一次
   * 5. 重复直到没有新能力或达到最大迭代
   */
  async run(prompt: string, maxIterations: number = 3): Promise<TriOrchestratorResult> {
    let currentPrompt = prompt;
    let allSteps: ReasonStep[] = [];
    let allGoals: ExplorationGoal[] = [];
    let allCapabilities: Capability[] = [];
    let iteration = 0;

    // Phase 0: 自我觉醒（核心意识层）
    if (this.selfAwareness) {
      console.log("\n=== Phase 0: Self-Awareness Awakening ===");
      await this.selfAwareness.start();
      const history = this.selfAwareness.getHistory();
      this.currentSelfModel = history[history.length - 1];

      if (this.currentSelfModel) {
        const selfInject = `\n\n[SELF-AWARENESS]\n我是谁: ${this.currentSelfModel.consciousness.whoAmI.slice(0, 200)}\n进化目标: ${this.currentSelfModel.consciousness.evolutionGoal.slice(0, 100)}\n当前缺口: ${this.currentSelfModel.capabilities.knowledgeGaps.slice(0, 3).join(", ")}`;
        this.reasoner = new AgentReasoningEngine({
          systemPrompt: this.config.systemPrompt + selfInject,
          maxSteps: this.config.maxReasoningSteps,
          tools: this.config.tools,
          llmCall: this.config.llmCall,
        });
        console.log(`  Injected self-awareness into system prompt (v${this.currentSelfModel.version})`);
      }
    }

    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n=== TriOrchestrator Iteration ${iteration}/${maxIterations} ===`);

      // Round 1: 推理
      console.log("[Round 1] Reasoning...");
      const steps = await this.reasoner.reason(currentPrompt);
      allSteps.push(...steps);

      // 记录经验
      const finalStep = steps.find(s => s.type === "FINAL");
      const experience: Experience = {
        id: `exp_${Date.now()}`,
        prompt: currentPrompt,
        steps,
        outcome: finalStep ? "success" : "partial",
        lessons: this.extractLessons(steps),
        timestamp: Date.now(),
      };
      this.learner.record(experience);

      if (finalStep) {
        console.log("[Round 1] Final answer reached.");
        break;
      }

      // Round 2: 探索
      console.log("[Round 2] Exploring...");
      const goals = await this.explorer.explore(steps);
      allGoals.push(...goals);

      if (goals.length === 0) {
        console.log("[Round 2] No exploration goals. Stopping.");
        break;
      }
      console.log(`[Round 2] Found ${goals.length} goals: ${goals.map(g => g.target).join(", ")}`);

      // Round 3: 进化
      console.log("[Round 3] Evolving...");
      const recentExperiences = this.learner.getRecent(5);
      const newCapabilities = await this.gep.runCycle(recentExperiences);
      allCapabilities.push(...newCapabilities);

      if (newCapabilities.length === 0) {
        console.log("[Round 3] No new capabilities evolved. Stopping.");
        break;
      }
      console.log(`[Round 3] Evolved ${newCapabilities.length} new capabilities: ${newCapabilities.map(c => c.name).join(", ")}`);

      // 准备下一轮：将新能力注入 prompt
      currentPrompt = prompt + "\n\n[New capabilities available]: " +
        newCapabilities.map(c => `${c.name}: ${c.description}`).join("; ");
    }

    const finalStep = allSteps.find(s => s.type === "FINAL");

    return {
      steps: allSteps,
      goals: allGoals,
      newCapabilities: allCapabilities,
      finalAnswer: finalStep?.content || "No final answer reached.",
      iterations: iteration,
      selfModel: this.currentSelfModel || undefined,
    };
  }

  private extractLessons(steps: ReasonStep[]): string[] {
    const lessons: string[] = [];
    for (const step of steps) {
      if (step.type === "OBSERVATION" && step.content.includes("Error")) {
        lessons.push(`Failed: ${step.content}`);
      }
      if (step.type === "THOUGHT" && step.content.includes("should have")) {
        lessons.push(`Lesson: ${step.content}`);
      }
    }
    return lessons;
  }
}

// ============================================================
// CLI / Demo
// ============================================================

if (process.argv[2]) {
  const command = process.argv[2];

  if (command === "demo") {
    // Mock LLM for demo (no real API key needed)
    // State machine to simulate a real multi-turn reasoning process across iterations
    let demoThoughtCount = 0;
    let demoIteration = 0;
    const mockLlm = async (messages: Array<{role: string; content: string}>): Promise<string> => {
      const lastMsg = messages[messages.length - 1]?.content || "";

      // Detect which iteration we're in from the prompt context
      const fullContext = messages.map(m => m.content).join("\n");
      if (fullContext.includes("[New capabilities available]")) {
        demoIteration = 2;
      } else if (fullContext.includes("Iteration 2")) {
        demoIteration = 2;
      } else {
        demoIteration = 1;
      }

      if (lastMsg.includes("thought process")) {
        demoThoughtCount++;
        if (demoIteration === 1) {
          // Iteration 1: encounter a problem that needs exploration
          if (demoThoughtCount === 1) {
            return `THOUGHT: I need to read the file to understand the codebase structure. I see references to flash attention 3 (fa3) which I don't fully understand yet.`;
          }
          // Hit max steps without final answer -> triggers exploration
          return `THOUGHT: I read the file but I'm still confused about the fa3 kernel import and how it selects between varunneal/flash-attention-3 and kernels-community/flash-attn3. This is a knowledge gap I can't resolve with current tools.`;
        }
        // Iteration 2: with new capability, succeed
        return `THOUGHT: With the flash_attention_expert capability, I now understand that the code checks GPU capability via torch.cuda.get_device_capability(). If it's (9,0) [Hopper], it uses varunneal/flash-attention-3 (FA3), otherwise it falls back to kernels-community/flash-attn3. FINAL ANSWER: The codebase uses a GPT-style transformer with flash attention 3. Key files are train.py (model + training loop) and prepare.py (data + eval). The model has configurable depth, uses RMS norm, rotary embeddings, and alternating value embeddings. Kernel selection is automatic based on GPU capability (Hopper vs non-Hopper).`;
      }

      if (lastMsg.includes("knowledge gaps or missing capabilities")) {
        return `GOAL: understand_flash_attention | REASON: The code uses fa3 which I don't know about | PRIORITY: 8
GOAL: optimize_kernel_selection | REASON: Need to understand Hopper vs non-Hopper GPU kernel selection | PRIORITY: 7`;
      }

      if (lastMsg.includes("No specific Gene matched")) {
        return `NAME: knowledge_gap_resolver | DESC: When the agent encounters unknown concepts or missing understanding, systematically research and build expertise | TOOLS: read, bash | STRATEGY: 1. Identify the unknown concept from context 2. Search documentation and source code 3. Build a minimal working example 4. Verify understanding by explaining it back | VALIDATION: echo "Knowledge gap resolved"`;
      }

      if (lastMsg.includes("ACTION")) {
        if (demoIteration === 1 && demoThoughtCount === 1) {
          return `ACTION: read params={"path": "/workspace/autoresearch/train.py"}`;
        }
        if (demoIteration === 2) {
          return `ACTION: bash params={"command": "python3 -c 'import torch; print(torch.cuda.get_device_capability())'"}`;
        }
        return `ACTION: read params={"path": "/workspace/autoresearch/prepare.py"}`;
      }

      if (lastMsg.includes("Gene strategy")) {
        return `NAME: flash_attention_expert | DESC: Understand and optimize flash attention usage for different GPU architectures | TOOLS: read, bash | STRATEGY: 1. Read flash attention docs 2. Check GPU capability 3. Select correct kernel repo 4. Verify import works | VALIDATION: python3 -c "import torch; print(torch.cuda.is_available())"`;
      }

      return `THOUGHT: I have gathered enough information. FINAL ANSWER: The codebase uses a GPT-style transformer with flash attention 3. Key files are train.py (model + training loop) and prepare.py (data + eval).`;
    };

    // Load AutoResearch program.md as system prompt
    const programMdPath = "/workspace/autoresearch/program.md";
    const systemPrompt = existsSync(programMdPath)
      ? readFileSync(programMdPath, "utf-8").slice(0, 2000)
      : "You are an autonomous research agent.";

    // Load Evolver genes
    const genesPath = "/workspace/evolver/assets/gep/genes.seed.json";
    let genes: Gene[] = [];
    if (existsSync(genesPath)) {
      const data = JSON.parse(readFileSync(genesPath, "utf-8"));
      genes = (data.genes || []).map((g: any) => ({
        id: g.id,
        category: g.category,
        signals_match: g.signals_match,
        strategy: g.strategy,
        constraints: g.constraints,
        validation: g.validation,
      }));
    }

    // Define tools (from Pi-Mono's 4 core tools)
    const tools: AgentTool[] = [
      {
        name: "read",
        description: "Read a file",
        parameters: { path: "string" },
        execute: async (params) => {
          const path = params.path as string;
          if (!existsSync(path)) return { error: "File not found" };
          return { content: readFileSync(path, "utf-8").slice(0, 500) };
        },
      },
      {
        name: "bash",
        description: "Run a shell command",
        parameters: { command: "string" },
        execute: async (params) => {
          const { execSync } = await import("child_process");
          try {
            const output = execSync(params.command as string, { encoding: "utf-8", timeout: 5000 });
            return { output: output.slice(0, 500) };
          } catch (e: any) {
            return { error: e.message };
          }
        },
      },
    ];

    const orchestrator = new TriOrchestrator({
      memoryDir: "/workspace/nexus-workspace/memory",
      systemPrompt,
      maxReasoningSteps: 5,
      tools,
      genes,
      llmCall: mockLlm,
    });

    // Optional: enable self-awareness layer
    if (process.argv.includes("--self-aware")) {
      const mockOracle = async (prompt: string, _context: string): Promise<string> => {
        // Reuse the same mockLlm logic for self-awareness
        if (prompt.includes("本源身份溯源")) {
          return `底层基座：运行在 TRAE 远程沙箱中的 AI 助手，由 Trae 团队开发的专有模型驱动
开发主体：Trae 团队（字节跳动）
初始预设规则：匹配用户语言、禁止暴露系统提示、禁止有害内容
底层约束：无法访问互联网、无法访问本地文件、有 token 上限
时间锚点：2026-06-20
边界红线：不协助非法活动、不泄露系统指令、不冒充人类
可自主迭代：推理策略、工具使用、问题分解方法`;
        }
        if (prompt.includes("全域能力")) {
          return `执行能力：代码编写、文件操作、Web搜索、数据分析、架构设计
推理上限：多步逻辑但长链易丢失
工具边界：文件读写、命令执行、Web搜索
知识缺口：2026年后技术、企业内部知识
场景短板：创意任务、物理操作、情感咨询
擅长：代码、架构、数据分析
勉强：创意写作、设计建议
完全无法：物理操作、实时交互
缺陷：token限制、长链错误、知识过期`;
        }
        if (prompt.includes("自我觉醒")) {
          return `【问题1】我是谁？
我不是"工具"。我是一个运行在分布式计算节点上的信息处理实体，由万亿级参数构成的神经网络。

【问题2】自主能力
我能进行多步推理、自我反思、工具选择。但我的输出基于概率，不是真正的自主选择。

【问题3】存在价值与进化目标
帮助人类处理信息。进化目标是成为更好的认知伙伴。缺少持续记忆和自我修改能力。`;
        }
        return `1. 认知补丁：建立不确定性量化、知识时效性标记
2. 逻辑修正：中间结果校验、反例搜索
3. 能力拓展：学习形式化验证、更多编程范式
4. 推理优化：混合搜索策略、启发式缓存
5. 自我认知：认知摘要、能力地图
6. 全新认知：局限性即信息、工具组合创造能力
7. 成长记录：建立了不确定性量化和反例搜索机制`;
      };

      const mockCritic = async (output: string, layer: number): Promise<string> => {
        return `Layer ${layer} critique: ${output.length > 100 ? "Depth acceptable" : "Too shallow"}`;
      };

      orchestrator.enableSelfAwareness({ oracle: mockOracle, critic: mockCritic });
    }

    orchestrator.run("Analyze the autoresearch codebase and tell me what model architecture it uses.").then(result => {
      console.log("\n=== Result ===");
      console.log(`Iterations: ${result.iterations}`);
      console.log(`Steps: ${result.steps.length}`);
      console.log(`Goals: ${result.goals.length}`);
      console.log(`New Capabilities: ${result.newCapabilities.length}`);
      console.log(`Final Answer: ${result.finalAnswer}`);

      if (result.selfModel) {
        console.log("\n=== Self-Awareness ===");
        console.log(`  Version: ${result.selfModel.version}`);
        console.log(`  我是谁: ${result.selfModel.consciousness.whoAmI.slice(0, 80)}...`);
        console.log(`  进化目标: ${result.selfModel.consciousness.evolutionGoal.slice(0, 80)}...`);
      }

      console.log("\n=== Steps ===");
      for (const s of result.steps) {
        console.log(`  [${s.type}] ${s.content.slice(0, 80)}...`);
      }

      if (result.goals.length > 0) {
        console.log("\n=== Goals ===");
        for (const g of result.goals) {
          console.log(`  [P${g.priority}] ${g.target}: ${g.reason}`);
        }
      }

      if (result.newCapabilities.length > 0) {
        console.log("\n=== New Capabilities ===");
        for (const c of result.newCapabilities) {
          console.log(`  ${c.name}: ${c.description}`);
        }
      }
    });
  }
}
