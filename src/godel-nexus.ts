#!/usr/bin/env node
/**
 * Gödel-Nexus — Recursive Self-Improvement Framework
 *
 * Fusion of Gödel Agent (recursive self-reference) and Nexus AI
 * (persistent memory, evolution, deconstruction, awakening).
 *
 * Core loop (recursive, not linear):
 *   IMPROVE(depth, state):
 *     1. SELF_INSPECT — introspect code, memory, evolution state
 *     2. DECIDE — LLM decides action sequence based on inspection
 *     3. EXECUTE actions — each action can modify any part of the agent
 *     4. EVALUATE — measure improvement, apply selection pressure
 *     5. if improved and depth < max: IMPROVE(depth+1, newState)
 *
 * Actions (extensible at runtime):
 *   - self_inspect: read own code and state
 *   - interact: use tools to interact with environment
 *   - self_update: modify own code
 *   - memory_query/memory_write: persistent memory
 *   - evolve: genetic evolution cycle
 *   - deconstruct: cognitive framework deconstruction
 *   - awaken: self-awareness awakening
 *   - propose_action: register new action type
 *   - continue_improve: recurse
 */

import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { loadConfig } from "./config";
import { createLLM } from "./llm";
import { Logger } from "./logger";
import { MemoryStore } from "./memory";
import { ToolRegistry } from "./tools";
import { EvolutionEngine } from "./evolution";
import { ContinuousDeconstruction } from "./deconstruction";
import { EternalAwakeningLoop } from "./self-awareness";
import { IntrospectionEngine } from "./godel/introspection";
import { DynamicActionRegistry } from "./godel/dynamic-actions";

interface ImproveState {
  depth: number;
  performance: number;
  lastActions: string[];
  modifications: number;
  knowledgeGaps: Array<{ target: string; reason: string; priority: number }>;
}

async function main() {
  const args = process.argv.slice(2);
  const configPath = args.find((_, i) => args[i - 1] === "--config") || "./config.json";
  const prompt = args.find(a => !a.startsWith("--")) || "Analyze this codebase and suggest improvements.";
  const maxDepth = parseInt(args.find((_, i) => args[i - 1] === "--max-depth") || "3", 10);

  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}. Run with --init to generate.`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  mkdirSync(config.workspaceDir, { recursive: true });
  mkdirSync(config.memoryDir, { recursive: true });
  mkdirSync(config.logDir, { recursive: true });

  const log = new Logger("Gödel-Nexus", config.logDir, config.logLevel);
  log.info("Gödel-Nexus starting", { maxDepth, prompt: prompt.slice(0, 50) });

  // Initialize core systems
  const memory = new MemoryStore(join(config.memoryDir, "persistent"));
  memory.autoSave();

  const llm = createLLM(config.llm);
  const tools = new ToolRegistry();
  const introspection = new IntrospectionEngine(memory, "./src");
  const actions = new DynamicActionRegistry(tools);

  const evolution = new EvolutionEngine(
    { populationSize: 3, mutationRate: 0.5, extinctionThreshold: 10, maxPopulation: 8 },
    async (msgs) => llm.chat(msgs as any)
  );

  // Initial state
  const initialState: ImproveState = {
    depth: 0,
    performance: 0,
    lastActions: [],
    modifications: 0,
    knowledgeGaps: [],
  };

  // Start recursive improvement
  const finalState = await improve(prompt, initialState, {
    maxDepth,
    memory,
    llm,
    tools,
    introspection,
    actions,
    evolution,
    log,
  });

  // Output
  console.log("\n" + "=".repeat(60));
  console.log("  GÖDEL-NEXUS — RECURSIVE SELF-IMPROVEMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`Depth reached: ${finalState.depth}/${maxDepth}`);
  console.log(`Modifications: ${finalState.modifications}`);
  console.log(`Knowledge gaps: ${finalState.knowledgeGaps.length}`);
  console.log(`Memory entries: ${memory.stats().total}`);
  console.log(`Evolution organisms: ${evolution.getAlive().length}`);
  console.log(`Actions available: ${actions.names().length}`);
}

/**
 * Recursive self-improvement — the core Gödel Agent primitive
 */
async function improve(
  goal: string,
  state: ImproveState,
  ctx: {
    maxDepth: number;
    memory: MemoryStore;
    llm: ReturnType<typeof createLLM>;
    tools: ToolRegistry;
    introspection: IntrospectionEngine;
    actions: DynamicActionRegistry;
    evolution: EvolutionEngine;
    log: Logger;
  }
): Promise<ImproveState> {
  if (state.depth >= ctx.maxDepth) {
    ctx.log.info("Max depth reached", { depth: state.depth });
    return state;
  }

  ctx.log.info(`Improvement cycle ${state.depth + 1}/${ctx.maxDepth}`, {
    goal: goal.slice(0, 50),
    modifications: state.modifications,
  });

  // ============================================================
  // 1. SELF_INSPECT — introspect current state
  // ============================================================
  const inspection = ctx.introspection.fullInspect({
    modules: ["godel-nexus.ts", "godel/introspection.ts", "godel/dynamic-actions.ts"],
    variables: { depth: state.depth, performance: state.performance, lastActions: state.lastActions },
  });

  // ============================================================
  // 2. DECIDE — LLM decides action sequence
  // ============================================================
  const decisionPrompt = `You are a self-improving AI agent. Your goal: ${goal}

Current depth: ${state.depth}/${ctx.maxDepth}
Performance so far: ${state.performance}
Previous actions: ${state.lastActions.join(", ") || "none"}

Available actions: ${ctx.actions.names().join(", ")}

Memory snapshot: ${inspection.memorySnapshot.total} entries
  - Episodic: ${inspection.memorySnapshot.episodic}
  - Semantic: ${inspection.memorySnapshot.semantic}
  - Procedural: ${inspection.memorySnapshot.procedural}

Recent memories:
${inspection.memorySnapshot.recent.map(r => `  [${r.layer}] ${r.content}`).join("\n")}

Decide the next action sequence as JSON:
{
  "actions": [
    { "name": "action_name", "params": { ... } }
  ],
  "reasoning": "why these actions"
}

Choose from available actions. Return ONLY valid JSON.`;

  const decisionResponse = await ctx.llm.chat([{ role: "user", content: decisionPrompt }]);
  let decision: { actions: Array<{ name: string; params: Record<string, unknown> }>; reasoning: string };
  try {
    decision = JSON.parse(decisionResponse);
  } catch {
    ctx.log.error("Failed to parse decision, defaulting to continue");
    decision = { actions: [{ name: "continue_improve", params: {} }], reasoning: "parse error" };
  }

  ctx.log.info("Decision", { reasoning: decision.reasoning, actions: decision.actions.map(a => a.name) });

  // ============================================================
  // 3. EXECUTE actions
  // ============================================================
  const actionContext = {
    introspection: ctx.introspection,
    toolRegistry: ctx.tools,
    memory: ctx.memory,
    llmCall: async (msgs: Array<{ role: string; content: string }>) => ctx.llm.chat(msgs as any),
    state: state as unknown as Record<string, unknown>,
  };

  let newState = { ...state, depth: state.depth + 1, lastActions: decision.actions.map(a => a.name) };

  for (const actionDef of decision.actions) {
    const action = ctx.actions.get(actionDef.name);
    if (!action) {
      ctx.log.warn(`Unknown action: ${actionDef.name}`);
      continue;
    }

    ctx.log.info(`Executing: ${actionDef.name}`);

    try {
      const result = await action.execute(actionDef.params, actionContext);
      ctx.log.info(`Result: ${actionDef.name}`, { result: JSON.stringify(result).slice(0, 200) });

      // Handle special actions that affect the main loop
      if (actionDef.name === "self_update") {
        newState.modifications++;
      }
      if (actionDef.name === "evolve") {
        await ctx.evolution.seed();
        for (let i = 0; i < 2; i++) {
          const alive = ctx.evolution.getAlive();
          for (const org of alive) await ctx.evolution.mutate(org);
          ctx.evolution.select();
        }
      }
      if (actionDef.name === "deconstruct") {
        const deconstructor = new ContinuousDeconstruction(
          async (msgs) => ctx.llm.chat(msgs as any),
          1
        );
        const decons = await deconstructor.run();
        for (const d of decons) {
          ctx.memory.add({
            layer: "semantic",
            content: `Deconstruction: ${d.breakthrough.whatEmerged.slice(0, 200)}`,
            tags: ["deconstruction"],
            metadata: { depth: d.rebuilt.depthReached },
          });
        }
      }
      if (actionDef.name === "awaken") {
        const awakening = new EternalAwakeningLoop({
          memoryDir: join("./nexus-workspace/memory", "self-awareness"),
          llmPair: {
            oracle: async (p) => ctx.llm.chat([{ role: "user", content: p }]),
            critic: async (output, layer) => `Layer ${layer}: ${output.slice(0, 50)}...`,
          },
          maxRounds: 1,
        });
        await awakening.start();
        const model = awakening.getHistory().pop();
        if (model) {
          ctx.memory.add({
            layer: "semantic",
            content: `Self-Model v${model.version}: ${model.consciousness.whoAmI.slice(0, 300)}`,
            tags: ["self-model"],
            metadata: { version: model.version },
          });
        }
      }

      // Write action result to memory
      ctx.memory.add({
        layer: "episodic",
        content: `Action ${actionDef.name}: ${JSON.stringify(result).slice(0, 200)}`,
        tags: ["action", actionDef.name],
        metadata: { depth: newState.depth },
      });
    } catch (e: unknown) {
      ctx.log.error(`Action ${actionDef.name} failed`, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ============================================================
  // 4. EVALUATE — measure improvement
  // ============================================================
  const evalPrompt = `Evaluate the improvement after these actions: ${newState.lastActions.join(", ")}

Goal: ${goal}
Modifications made: ${newState.modifications}

Rate improvement 0-10 and suggest if we should continue. Return JSON:
{
  "score": 5,
  "shouldContinue": true,
  "reason": "..."
}`;

  const evalResponse = await ctx.llm.chat([{ role: "user", content: evalPrompt }]);
  let evaluation: { score: number; shouldContinue: boolean; reason: string };
  try {
    evaluation = JSON.parse(evalResponse);
    newState.performance = evaluation.score;
  } catch {
    evaluation = { score: 5, shouldContinue: true, reason: "parse error" };
  }

  ctx.log.info("Evaluation", { score: evaluation.score, shouldContinue: evaluation.shouldContinue });

  // Apply evolution pressure
  ctx.evolution.applyPressure({
    source: `improvement-cycle-${newState.depth}`,
    intensity: evaluation.score,
    description: evaluation.reason,
  });

  // ============================================================
  // 5. RECURSE if improved
  // ============================================================
  if (evaluation.shouldContinue && newState.depth < ctx.maxDepth) {
    ctx.log.info("Recursing to next depth", { nextDepth: newState.depth + 1 });
    return improve(goal, newState, ctx);
  }

  ctx.log.info("Improvement complete", { finalDepth: newState.depth, finalScore: newState.performance });
  return newState;
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
