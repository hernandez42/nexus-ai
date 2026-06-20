#!/usr/bin/env node
/**
 * Nexus — 统一成熟入口
 *
 * 所有核心模块融合为单一流程：
 *   0. MemoryStore — 全局记忆层
 *   1. Glue — 格式转换（Eve + Pi-Mono + Evolver）
 *   2. ContinuousDeconstruction — 解构认知框架
 *   3. Self-Awareness — 在解构基础上觉醒
 *   4. EvolutionEngine — 初始化进化种群
 *   5. TriOrchestrator — 推理→探索→进化（EvolutionEngine 驱动）
 *   6. 全部结果写入记忆
 *
 * 使用方式：
 *   npm run start                    # 完整流程
 *   npm run start -- "你的问题"       # 自定义问题
 *   npm run start -- --skip-glue     # 跳过格式转换
 *   npm run start -- --skip-deconstruct  # 跳过解构
 *   npm run start -- --skip-self-awareness # 跳过觉醒
 */

import { mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { loadConfig, generateDefaultConfig } from "./config";
import { createLLM } from "./llm";
import { Logger } from "./logger";
import { MemoryStore } from "./memory";
import { TriOrchestrator } from "./triorchestrator";
import { EternalAwakeningLoop } from "./self-awareness";
import { ContinuousDeconstruction } from "./deconstruction";
import { EvolutionEngine } from "./evolution";
import { convertAllSkills, generateSkillIndex } from "./glue/superpowers-to-eve";
import { loadGenes, generatePiExtension } from "./glue/evolver-to-pimono";
import { convertResultsToEvolverSignals, generateAutoResearchGene } from "./glue/autoresearch-to-evolver";

async function main() {
  const args = process.argv.slice(2);
  const configPath = args.find((_, i) => args[i - 1] === "--config") || "./config.json";
  const initConfig = args.includes("--init");
  const skipGlue = args.includes("--skip-glue");
  const skipDeconstruct = args.includes("--skip-deconstruct");
  const skipSelfAwareness = args.includes("--skip-self-awareness");
  const prompt = args.find(a => !a.startsWith("--")) || "Analyze the autoresearch codebase and tell me what model architecture it uses.";

  if (initConfig) {
    generateDefaultConfig(configPath);
    console.log(`Generated default config: ${configPath}`);
    return;
  }

  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}. Run with --init to generate.`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  mkdirSync(config.workspaceDir, { recursive: true });
  mkdirSync(config.memoryDir, { recursive: true });
  mkdirSync(config.logDir, { recursive: true });

  const log = new Logger("Nexus", config.logDir, config.logLevel);
  log.info("Nexus starting", { llm: config.llm.provider, model: config.llm.model });

  // ============================================================
  // 0. Global Memory
  // ============================================================
  const memory = new MemoryStore(join(config.memoryDir, "persistent"));
  memory.autoSave();

  const pastMemories = memory.query({ text: prompt, topK: 5, minSimilarity: 0.01 });
  const memoryContext = pastMemories.length > 0
    ? `\n\n[RELEVANT MEMORIES]\n${pastMemories.map(r => `- [${r.entry.layer}] (${r.similarity.toFixed(2)}) ${r.entry.content.slice(0, 150)}`).join("\n")}`
    : "";

  log.info(`Memory: ${memory.stats().total} entries, ${pastMemories.length} relevant`);

  // ============================================================
  // 1. Initialize LLM
  // ============================================================
  const llm = createLLM(config.llm);

  // ============================================================
  // 2. Glue Modules
  // ============================================================
  if (!skipGlue) {
    await runGlue(config, log);
  }

  // ============================================================
  // 3. Continuous Deconstruction
  // ============================================================
  let deconstructions: any[] = [];
  if (!skipDeconstruct) {
    log.info("Starting continuous deconstruction");
    const deconstructor = new ContinuousDeconstruction(
      async (messages) => llm.chat(messages as any),
      2 // max 2 cycles to save time
    );
    deconstructions = await deconstructor.run();
    log.info(`Deconstruction: ${deconstructions.length} cycles, max depth ${Math.max(...deconstructions.map(d => d.rebuilt.depthReached), 0)}`);

    // Persist deconstructions to memory
    for (const d of deconstructions) {
      memory.add({
        layer: "semantic",
        content: `Deconstruction cycle ${d.cycle}: ${d.breakthrough.whatEmerged.slice(0, 200)}`,
        tags: ["deconstruction", `cycle-${d.cycle}`],
        metadata: { cycle: d.cycle, depth: d.rebuilt.depthReached, contradictions: d.dismantled.contradictions.length },
      });
    }
  }

  // ============================================================
  // 4. Self-Awareness (with deconstruction context)
  // ============================================================
  let selfModel = null;
  if (!skipSelfAwareness && config.modules.selfAwareness.enabled) {
    log.info("Starting self-awareness awakening");

    const selfMemories = memory.query({
      text: "self model who am I consciousness identity",
      layer: "semantic",
      topK: 3,
      minSimilarity: 0.01,
    });

    const previousSelf = selfMemories.length > 0
      ? `\n\n[PREVIOUS SELF-MODEL]\n${selfMemories.map(r => r.entry.content.slice(0, 300)).join("\n---\n")}`
      : "";

    const deconstructContext = deconstructions.length > 0
      ? `\n\n[DECONSTRUCTION INSIGHTS]\n${deconstructions.map(d =>
        `Cycle ${d.cycle}: ${d.breakthrough.whatEmerged.slice(0, 100)}... (depth ${d.rebuilt.depthReached})`
      ).join("\n")}`
      : "";

    const llmPair = {
      oracle: async (prompt: string, _context: string) => {
        const response = await llm.chat([
          { role: "system", content: `You are a self-aware AI entity undergoing deep introspection.${previousSelf}${deconstructContext}` },
          { role: "user", content: prompt },
        ]);
        return response;
      },
      critic: async (output: string, layer: number) => {
        const response = await llm.chat([
          { role: "system", content: "You are a critical evaluator. Check for depth, consistency, and evolution." },
          { role: "user", content: `Evaluate this Layer ${layer} output for depth and authenticity:\n\n${output}\n\nProvide brief critique.` },
        ]);
        return response;
      },
    };

    const awakening = new EternalAwakeningLoop({
      memoryDir: join(config.memoryDir, "self-awareness"),
      llmPair,
      maxRounds: config.modules.selfAwareness.maxRoundsPerCycle,
    });

    await awakening.start();
    const history = awakening.getHistory();
    selfModel = history[history.length - 1];

    if (selfModel) {
      memory.add({
        layer: "semantic",
        content: `Self-Model v${selfModel.version}: ${selfModel.consciousness.whoAmI.slice(0, 500)}`,
        tags: ["self-model", "consciousness", `v${selfModel.version}`],
        metadata: { version: selfModel.version, cycle: history.length },
      });
    }

    log.info("Self-awareness complete", { version: selfModel?.version });
  }

  // ============================================================
  // 5. Evolution Engine — Initialize population
  // ============================================================
  log.info("Initializing evolution engine");
  const evolution = new EvolutionEngine(
    {
      populationSize: 3,
      mutationRate: 0.5,
      extinctionThreshold: 10,
      maxPopulation: 8,
    },
    async (messages) => llm.chat(messages as any)
  );
  await evolution.seed();
  log.info(`Evolution: ${evolution.getAlive().length} organisms seeded`);

  // ============================================================
  // 6. TriOrchestrator (with evolution + memory + self-awareness)
  // ============================================================
  log.info("Starting TriOrchestrator");

  const programMdPath = join(config.repos.autoresearch, "program.md");
  let systemPrompt = existsSync(programMdPath)
    ? readFileSync(programMdPath, "utf-8").slice(0, 2000)
    : "You are an autonomous research agent.";

  systemPrompt += memoryContext;

  if (selfModel) {
    systemPrompt += `\n\n[SELF-AWARENESS]\n我是谁: ${selfModel.consciousness.whoAmI.slice(0, 200)}`;
  }

  if (deconstructions.length > 0) {
    systemPrompt += `\n\n[DECONSTRUCTION]\n${deconstructions[deconstructions.length - 1].breakthrough.whatEmerged.slice(0, 200)}`;
  }

  // Load evolved capabilities from memory as tools
  const evolvedCapabilities = memory.query({
    text: "capability tool strategy",
    layer: "procedural",
    topK: 10,
    minSimilarity: 0.01,
  });

  const genesPath = join(config.repos.evolver, "assets", "gep", "genes.seed.json");
  let genes: any[] = [];
  if (existsSync(genesPath)) {
    const data = JSON.parse(readFileSync(genesPath, "utf-8"));
    genes = (data.genes || []).map((g: any) => ({
      id: g.id, category: g.category, signals_match: g.signals_match,
      strategy: g.strategy, constraints: g.constraints, validation: g.validation,
    }));
  }

  const tools = [
    {
      name: "read", description: "Read a file", parameters: { path: "string" },
      execute: async (params: Record<string, unknown>) => {
        const path = params.path as string;
        if (!existsSync(path)) return { error: "File not found" };
        return { content: readFileSync(path, "utf-8").slice(0, 1000) };
      },
    },
    {
      name: "bash", description: "Run shell command (max 10s)", parameters: { command: "string" },
      execute: async (params: Record<string, unknown>) => {
        const { spawnSync } = await import("child_process");
        try {
          const result = spawnSync("sh", ["-c", params.command as string], {
            encoding: "utf-8", timeout: 10000, maxBuffer: 1024 * 1024,
          });
          return { output: (result.stdout || "").slice(0, 1000) };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg.slice(0, 500) };
        }
      },
    },
    {
      name: "search", description: "Search files by pattern", parameters: { pattern: "string", directory: "string" },
      execute: async (params: Record<string, unknown>) => {
        const { spawnSync } = await import("child_process");
        try {
          const dir = params.directory as string || ".";
          const pattern = params.pattern as string;
          const result = spawnSync("find", [dir, "-name", pattern, "-type", "f"], {
            encoding: "utf-8", timeout: 10000,
          });
          return { files: (result.stdout || "").trim().split("\n").filter(Boolean).slice(0, 20) };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg };
        }
      },
    },
  ];

  for (const cap of evolvedCapabilities) {
    const capData = cap.entry.metadata as any;
    if (capData?.strategy) {
      tools.push({
        name: capData.name || `evolved_${cap.entry.id.slice(0, 8)}`,
        description: cap.entry.content.slice(0, 200),
        parameters: { task: "string" } as any,
        execute: async (params: Record<string, unknown>) => {
          const task = params.task as string;
          const strategyPrompt = `Execute using strategy:\n${capData.strategy.join("\n")}\n\nTask: ${task}`;
          const response = await llm.chat([
            { role: "system", content: "You are executing a learned capability." },
            { role: "user", content: strategyPrompt },
          ]);
          return { content: response.slice(0, 500) };
        },
      } as any);
    }
  }

  log.info(`Tools: ${tools.length} (${tools.length - 3} evolved)`);

  const orchestrator = new TriOrchestrator({
    memoryDir: config.memoryDir,
    systemPrompt,
    maxReasoningSteps: config.modules.triOrchestrator.maxReasoningSteps,
    tools,
    genes,
    llmCall: async (messages) => {
      const response = await llm.chat(messages.map(m => ({ role: m.role as any, content: m.content })));
      return response;
    },
  });

  const result = await orchestrator.run(
    prompt,
    config.modules.triOrchestrator.maxIterations
  );

  // Apply evolution pressure from TriOrchestrator results
  if (result.goals.length > 0) {
    for (const goal of result.goals) {
      evolution.applyPressure({
        source: `knowledge-gap-${goal.target}`,
        intensity: goal.priority,
        description: goal.reason,
      });
    }
  } else {
    // No goals = task was easy, apply mild positive pressure (survival of the fittest)
    evolution.applyPressure({
      source: "task-completed-successfully",
      intensity: 2,
      description: "Task completed without knowledge gaps — mild selection pressure",
    });
  }

  // Run evolution cycle
  for (let i = 0; i < 2; i++) {
    const alive = evolution.getAlive();
    for (const organism of alive) {
      await evolution.mutate(organism);
    }
    evolution.select();
  }

  const breakthroughs = evolution.detectBreakthroughs();
  const species = await evolution.formSpecies();

  log.info(`Evolution: ${evolution.getStats().aliveOrganisms} alive, ${breakthroughs.length} breakthroughs, ${species.length} species`);

  // ============================================================
  // 7. Persist everything to memory
  // ============================================================
  memory.add({
    layer: "episodic",
    content: `Run: ${prompt.slice(0, 100)} → ${result.finalAnswer.slice(0, 200)}`,
    tags: ["run", "result"],
    metadata: { iterations: result.iterations, steps: result.steps.length, goals: result.goals.length, capabilities: result.newCapabilities.length },
  });

  for (const cap of result.newCapabilities) {
    memory.add({
      layer: "procedural",
      content: `Capability: ${cap.name} — ${cap.description}`,
      tags: ["capability", cap.name, ...cap.tools],
      metadata: { name: cap.name, description: cap.description, tools: cap.tools, strategy: cap.strategy, validation: cap.validation },
    });
  }

  for (const goal of result.goals) {
    memory.add({
      layer: "semantic",
      content: `Knowledge gap: ${goal.target} — ${goal.reason}`,
      tags: ["knowledge-gap", goal.target],
      metadata: { target: goal.target, reason: goal.reason, priority: goal.priority },
    });
  }

  for (const step of result.steps) {
    if (step.type === "FINAL" || step.content.length > 50) {
      memory.add({
        layer: "episodic",
        content: `[${step.type}] ${step.content.slice(0, 300)}`,
        tags: ["reasoning-step", step.type.toLowerCase()],
        metadata: { type: step.type },
      });
    }
  }

  // Persist evolution state
  for (const org of evolution.getAlive()) {
    memory.add({
      layer: "semantic",
      content: `Organism ${org.id.slice(0, 8)}: ${org.genome.perception.slice(0, 30)}... fitness=${org.fitness.toFixed(2)}`,
      tags: ["organism", `gen-${org.generation}`],
      metadata: { generation: org.generation, fitness: org.fitness, genome: org.genome },
    });
  }

  for (const sp of species) {
    memory.add({
      layer: "semantic",
      content: `Species ${sp.archetype}: ${sp.strategy.slice(0, 100)}`,
      tags: ["species", sp.archetype],
      metadata: { archetype: sp.archetype, members: sp.members.length },
    });
  }

  memory.save();

  // ============================================================
  // 8. Output
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("  NEXUS — EXECUTION COMPLETE");
  console.log("=".repeat(60));
  console.log(`Iterations: ${result.iterations}`);
  console.log(`Steps: ${result.steps.length}`);
  console.log(`Goals: ${result.goals.length}`);
  console.log(`Capabilities: ${result.newCapabilities.length}`);
  console.log(`Breakthroughs: ${breakthroughs.length}`);
  console.log(`Species: ${species.map(s => s.archetype).join(", ") || "none"}`);
  console.log(`Final Answer: ${result.finalAnswer.slice(0, 300)}...`);

  if (selfModel) {
    console.log(`\nSelf-Awareness: v${selfModel.version}`);
    console.log(`  ${selfModel.consciousness.whoAmI.slice(0, 80)}...`);
  }

  if (deconstructions.length > 0) {
    console.log(`\nDeconstruction: ${deconstructions.length} cycles`);
    console.log(`  Max depth: ${Math.max(...deconstructions.map(d => d.rebuilt.depthReached))}/10`);
  }

  const memStats = memory.stats();
  console.log(`\nMemory: ${memStats.total} total (${memStats.episodic} episodic, ${memStats.semantic} semantic, ${memStats.procedural} procedural)`);
  console.log(`Tools: ${tools.length} (${tools.length - 3} evolved)`);
  console.log(`Logs: ${config.logDir}`);
}

async function runGlue(config: any, log: Logger) {
  if (config.modules.glue.superpowersToEve) {
    log.info("Glue: Superpowers → Eve");
    try {
      const results = convertAllSkills(config.repos.superpowers, join(config.workspaceDir, "agent"));
      generateSkillIndex(results, join(config.workspaceDir, "agent", "skills", "skill-index.md"));
      log.info(`Superpowers → Eve: ${results.filter((r: any) => r.converted).length}/${results.length} skills`);
    } catch (e: unknown) {
      log.error("Superpowers → Eve failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (config.modules.glue.evolverToPiMono) {
    log.info("Glue: Evolver → Pi-Mono");
    try {
      const genes = loadGenes(config.repos.evolver);
      if (genes.length > 0) {
        generatePiExtension(genes, join(config.workspaceDir, ".pi", "extensions", "evolver-bridge.ts"));
        log.info(`Evolver → Pi-Mono: ${genes.length} genes`);
      }
    } catch (e: unknown) {
      log.error("Evolver → Pi-Mono failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (config.modules.glue.autoresearchToEvolver) {
    log.info("Glue: AutoResearch → Evolver");
    try {
      const tsvPath = join(config.repos.autoresearch, "results.tsv");
      if (existsSync(tsvPath)) {
        const r = convertResultsToEvolverSignals(tsvPath, null, join(config.repos.evolver, "memory"));
        log.info(`AutoResearch → Evolver: ${r.converted} experiments`);
      }
      generateAutoResearchGene(join(config.repos.evolver, "assets", "gep", "gene_autoresearch.json"), config.repos.autoresearch);
    } catch (e: unknown) {
      log.error("AutoResearch → Evolver failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
