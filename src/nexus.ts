#!/usr/bin/env node
/**
 * Nexus AI — Unified Entry Point
 *
 * CLI:
 *   npx tsx src/nexus.ts [flags] [prompt]
 *
 *   (default)         Run LocalReasoner → LLM tool-loop
 *   --full [prompt]   Run NexusRuntime (evolution + deconstruction, needs API key)
 *   --godel [prompt]  Run Gödel-Nexus recursive self-improvement (needs API key)
 *   --pipeline [dir]  Run format-conversion pipeline (superpowers→eve, genes→pi-mono, autoresearch→evolver)
 *   --lark            Start Feishu/Lark bot (needs LARK_APP_ID + LARK_APP_SECRET)
 *   --daemon          Long-loop mode (reruns every 75 seconds)
 *   --help / -h       Print this help
 *   --version / -v    Print version
 *
 * Environment variables:
 *   LLM_API_KEY       Optional. If set, enables LLM tool-loop; otherwise offline local-reasoning only.
 *   LLM_PROVIDER      openai | anthropic | ollama | mock (default: openai)
 *   LLM_BASE_URL      e.g. https://api.openai.com/v1 or http://localhost:11434/v1
 *   LLM_MODEL         e.g. gpt-4o-mini, claude-sonnet-4 (provider-dependent)
 *   LARK_APP_ID       For --lark mode
 *   LARK_APP_SECRET   For --lark mode
 *   SUPERPOWERS_REPO  Path to superpowers checkout (for --pipeline)
 *   EVE_REPO          Path to eve checkout (for --pipeline)
 *   EVOLVER_REPO      Path to evolver checkout (for --pipeline)
 *   PIMONO_REPO       Path to pi-mono checkout (for --pipeline)
 *   AUTORESEARCH_REPO Path to autoresearch checkout (for --pipeline)
 */

import { mkdirSync, existsSync } from "fs";
import { createLLM, LLMClient } from "./llm";
import { MemoryStore } from "./memory";
import { LocalReasoner } from "./local-reasoner";
import { runToolLoop } from "./tool-loop";
import { ToolRegistry } from "./tools";
import { NexusRuntime, NexusRuntimeConfig } from "./nexus-runtime";
import { startLarkBot } from "./lark";

const VERSION = "0.5.0";

const HELP = `Nexus AI v${VERSION} — Unified Entry Point

离线模式 (offline, 不依赖 API key):
  npx tsx src/nexus.ts "hello"              # 本地推理 → 记忆
  npx tsx src/nexus.ts "read README.md"     # 读取文件
  npx tsx src/nexus.ts "ls src"             # 列出目录
  npx tsx src/nexus.ts "grep Nexus src"     # 代码搜索
  npx tsx src/nexus.ts "run date"           # 执行 shell 命令
  npx tsx src/nexus.ts "status"             # 系统状态
  npx tsx src/nexus.ts "反省"                # 自我反省

在线模式 (online, 需要 LLM_API_KEY):
  npx tsx src/nexus.ts "请分析 src/nexus.ts"    # 本地推理 + LLM tool-loop
  npx tsx src/nexus.ts --full "你的问题"         # 突破驱动运行时 (进化 + 解构)
  npx tsx src/nexus.ts --godel "自我改进建议"    # Gödel-Nexus 递归自改进
  npx tsx src/nexus.ts --lark                    # 飞书机器人（WebSocket 长连接）
  npx tsx src/nexus.ts --daemon "你的问题"       # 后台循环模式

集成工具:
  npx tsx src/nexus.ts --pipeline [workspace-dir]  # 格式转换管道

环境变量:
  LLM_API_KEY        启用 LLM 模式时需要
  LLM_PROVIDER       openai | anthropic | ollama | mock (默认 openai)
  LLM_BASE_URL       自定义 API endpoint（比如 Ollama）
  LLM_MODEL          模型名称（provider 相关）
  LARK_APP_ID / LARK_APP_SECRET  对于 --lark 模式

示例:
  # 先本地跑一下，确认没问题
  rm -rf ./nexus-workspace
  npx tsx src/nexus.ts "read src/nexus.ts"

  # 有 API key 时，自动升级到 LLM tool-loop
  export LLM_API_KEY=sk-...
  npx tsx src/nexus.ts "分析这个代码库的架构"
`;

// ============================================================
// CLI
// ============================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Flags
  const showHelp = args.includes("--help") || args.includes("-h");
  const showVersion = args.includes("--version") || args.includes("-v");
  const fullMode = args.includes("--full");
  const godelMode = args.includes("--godel");
  const larkMode = args.includes("--lark");
  const daemonMode = args.includes("--daemon");
  const pipelineMode = args.includes("--pipeline");

  // Prompt = first non-flag positional arg; if more than one, join with space
  const positional = args.filter((a) => !a.startsWith("--"));
  const prompt = positional.join(" ").trim() || "hello";

  if (showHelp) {
    console.log(HELP);
    return;
  }
  if (showVersion) {
    console.log(`Nexus AI v${VERSION}`);
    return;
  }

  // Workspace init
  const workspaceDir = "./nexus-workspace";
  mkdirSync(workspaceDir, { recursive: true });

  const memory = new MemoryStore(workspaceDir + "/memory");
  memory.autoSave();

  // LLM client (falls back to mock when no API key)
  const apiKey = process.env.LLM_API_KEY || "";
  const provider: "openai" | "anthropic" | "ollama" | "mock" = apiKey
    ? ((process.env.LLM_PROVIDER as any) || "openai")
    : "mock";
  const llm = createLLM({
    provider,
    apiKey,
    baseURL: process.env.LLM_BASE_URL || "",
    model: process.env.LLM_MODEL || "",
  });

  const hasLLM = !!apiKey;

  // --- Pipeline
  if (pipelineMode) {
    await runPipeline(positional[0] || workspaceDir);
    return;
  }

  // --- Lark bot (long-running)
  if (larkMode) {
    await runLark(memory, llm);
    return;
  }

  // --- Daemon mode (looping)
  if (daemonMode) {
    await runDaemon(memory, llm, prompt);
    return;
  }

  // --- Full: NexusRuntime (evolution + deconstruction)
  if (fullMode) {
    await runFull(memory, llm, prompt, hasLLM);
    return;
  }

  // --- Gödel-Nexus
  if (godelMode) {
    await runGodel(prompt);
    return;
  }

  // --- Default: LocalReasoner → (optional) LLM tool-loop
  await runDefault(memory, llm, prompt, hasLLM);
}

// ============================================================
// Default path: LocalReasoner → (maybe) LLM tool-loop
// ============================================================

async function runDefault(
  memory: MemoryStore,
  llm: LLMClient,
  prompt: string,
  hasLLM: boolean
): Promise<void> {
  const reasoner = new LocalReasoner(memory);
  const result = await reasoner.reason(prompt);

  // Case 1: LocalReasoner already produced text — print it
  // Case 2: needLLM=true → try LLM tool-loop if available
  if (!result.needLLM && result.answer) {
    console.log(result.answer);
    persistMemory(memory, prompt, result.answer, result.toolsUsed, "local-reasoner");
    return;
  }

  if (!hasLLM) {
    // Offline fallback: try printing any partial LocalReasoner output
    if (result.answer) console.log(result.answer);
    const lines: string[] = [];
    lines.push(`(offline mode: 设置 LLM_API_KEY 后可启用 LLM tool-loop)`);
    lines.push("");
    lines.push(`你可以尝试:
  npx tsx src/nexus.ts "read README.md"
  npx tsx src/nexus.ts "ls src"
  npx tsx src/nexus.ts "grep Nexus src"
  npx tsx src/nexus.ts "run date"
  npx tsx src/nexus.ts "status"
  npx tsx src/nexus.ts "反省"`);
    console.log(lines.join("\n"));
    persistMemory(memory, prompt, result.answer || "(offline fallback)", result.toolsUsed, "local-reasoner-offline");
    return;
  }

  // --- LLM tool-loop path
  console.log(`[Nexus] routing to LLM tool-loop (provider: ${(llm as any)._debug_provider || "..."}) …`);
  const tools = new ToolRegistry();
  const toolDefs = tools.list().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    execute: t.execute,
  }));

  try {
    const loopResult = await runToolLoop({
      systemPrompt: `You are Nexus, an autonomous reasoning agent with persistent memory and 22 tools.
Prioritize tools over text when answering — e.g. if the user asks "what's in this file", read_file, don't guess.
After 1-3 tool calls, stop calling tools and synthesize a final answer in plain language.
Respond in the user's language. Do not mention the tools used — just give the answer.`,
      userPrompt: prompt,
      tools: toolDefs,
      llm,
      maxSteps: 5,
    });
    console.log(loopResult.answer);
    persistMemory(memory, prompt, loopResult.answer, loopResult.toolCallsUsed, "llm-tool-loop");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Nexus] LLM tool-loop 失败: ${msg}`);
    if (result.answer) console.log(result.answer);
    persistMemory(memory, prompt, result.answer || "(llm failed)", result.toolsUsed, "llm-tool-loop-failed");
  }
}

// ============================================================
// Full mode: NexusRuntime (evolution + deconstruction)
// ============================================================

async function runFull(
  memory: MemoryStore,
  llm: LLMClient,
  prompt: string,
  hasLLM: boolean
): Promise<void> {
  if (!hasLLM) {
    console.log(`[Nexus] --full 需要 LLM_API_KEY（需要进化/解构都依赖 LLM）。`);
    console.log(`无 API key 时，我用本地推理给你一个简要回答：`);
    const reasoner = new LocalReasoner(memory);
    const result = await reasoner.reason(prompt);
    console.log(result.answer);
    return;
  }

  const tools = new ToolRegistry();
  const runtime = new NexusRuntime(
    {
      maxCycles: 2,
      evolution: {
        populationSize: 3,
        mutationRate: 0.5,
        extinctionThreshold: 10,
        maxPopulation: 8,
      },
      tools: tools.list(),
    },
    llm
  );

  try {
    const result = await runtime.run(prompt);
    console.log("");
    console.log("=".repeat(60));
    console.log(`  ${result.cycles} deconstruction cycles`);
    console.log(`  ${result.stats.organisms} organisms, ${result.stats.mutations} mutations`);
    console.log(`  ${result.species.length} species emerged`);
    console.log(`  ${result.breakthroughs.length} breakthroughs detected`);
    console.log("=".repeat(60));

    if (result.species.length) {
      console.log("\nSpecies:");
      for (const s of result.species) console.log(`  · ${s}`);
    }
    if (result.breakthroughs.length) {
      console.log("\nBreakthroughs:");
      for (const b of result.breakthroughs) console.log(`  · ${b}`);
    }

    memory.add({
      layer: "procedural",
      content: `runtime-full: ${prompt.slice(0, 80)} → ${result.cycles} cycles, ${result.breakthroughs.length} breakthroughs`,
      tags: ["nexus-runtime", "breakthrough"],
      metadata: { cycles: result.cycles, breakthroughs: result.breakthroughs.length, species: result.species.length },
    });
  } catch (e: unknown) {
    console.error(`[Nexus --full] failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ============================================================
// Gödel-Nexus: recursive self-improvement
// ============================================================

async function runGodel(prompt: string): Promise<void> {
  // godel-nexus.ts has its own main() that we can invoke via dynamic import
  // To keep things simple & reliable, we just exec it via spawnSync on the same file
  try {
    const { execSync } = await import("node:child_process");
    const cmd = `npx tsx src/godel-nexus.ts ${quote(prompt)}`;
    console.log(`[Nexus] launching Gödel-Nexus: ${cmd}`);
    execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
  } catch (e: unknown) {
    console.error(`[Nexus --godel] failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

// ============================================================
// Pipeline (glue modules)
// ============================================================

async function runPipeline(workspaceDir: string): Promise<void> {
  // Pipeline.ts exports runPipeline
  const { runPipeline: run } = await import("./pipeline");
  const superpowersDir = process.env.SUPERPOWERS_REPO || "../superpowers";
  const eveDir = process.env.EVE_REPO || "../eve";
  const evolverDir = process.env.EVOLVER_REPO || "../evolver";
  const piDir = process.env.PIMONO_REPO || "../pi-mono";
  const autoresearchDir = process.env.AUTORESEARCH_REPO || "../autoresearch";

  const missing: string[] = [];
  for (const [name, p] of [
    ["superpowers", superpowersDir],
    ["eve", eveDir],
    ["evolver", evolverDir],
    ["pi-mono", piDir],
    ["autoresearch", autoresearchDir],
  ]) {
    if (!existsSync(p)) missing.push(`${name} (path: ${p})`);
  }
  if (missing.length) {
    console.log(`[Nexus --pipeline] 缺少以下目录:`);
    for (const m of missing) console.log(`  · ${m}`);
    console.log(`请克隆这些仓库或设置对应环境变量再重试。`);
    process.exit(1);
  }

  mkdirSync(workspaceDir, { recursive: true });
  const results = await run({
    superpowersDir,
    eveDir,
    evolverDir,
    piDir,
    autoresearchDir,
    workspaceDir,
  });

  console.log("\n=== Pipeline Summary ===");
  for (const r of results) {
    const icon = r.status === "ok" ? "OK" : r.status === "skip" ? "SKIP" : "FAIL";
    console.log(`  [${icon}] ${r.phase}: ${r.detail}`);
  }
  const ok = results.filter((r) => r.status === "ok").length;
  console.log(`\nResult: ${ok}/${results.length} phases succeeded`);
}

// ============================================================
// Lark / Feishu bot
// ============================================================

async function runLark(memory: MemoryStore, llm: LLMClient): Promise<void> {
  const larkAppId = process.env.LARK_APP_ID || "";
  const larkAppSecret = process.env.LARK_APP_SECRET || "";
  if (!larkAppId || !larkAppSecret) {
    console.error("[Lark] 需要 LARK_APP_ID 与 LARK_APP_SECRET 环境变量。");
    process.exit(1);
  }

  console.log("[Lark] Starting Feishu bot...");

  await startLarkBot(
    { appId: larkAppId, appSecret: larkAppSecret },
    async (text, _sender, onProgress) => {
      try {
        // Phase 1: local reasoning
        const reasoner = new LocalReasoner(memory);
        const result = await reasoner.reason(text);

        if (!result.needLLM && result.answer) {
          persistMemory(memory, text, result.answer, result.toolsUsed, "lark-local");
          return result.answer;
        }

        // Phase 2: LLM tool-loop
        const tools = new ToolRegistry();
        const toolDefs = tools.list().map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          execute: t.execute,
        }));

        try {
          const loop = await runToolLoop({
            systemPrompt: `You are Nexus, a Feishu bot with persistent memory, tools, and autonomous reasoning.
- Use tools to answer when relevant; otherwise reply directly.
- After at most 2 tool calls, synthesize a final answer in plain text.
- Do not reveal your tools or provider.
- Match the user's language.`,
            userPrompt: text,
            tools: toolDefs,
            llm,
            maxSteps: 4,
            onStream: onProgress,
          });
          persistMemory(memory, text, loop.answer, loop.toolCallsUsed, "lark-llm");
          return loop.answer;
        } catch (e: unknown) {
          // Fallback to local
          if (result.answer) return result.answer;
          return `[Error] ${e instanceof Error ? e.message : String(e)}`;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[Lark] handler error:", msg);
        return `[Error] ${msg.slice(0, 500)}`;
      }
    }
  );

  // Note: startLarkBot keeps the process alive; we never return normally
  // Provide SIGINT handling at process level (nexus.ts top)
  process.on("SIGINT", () => {
    console.log("\n[Nexus] SIGINT received, exiting.");
    memory.save();
    process.exit(0);
  });
}

// ============================================================
// Daemon mode — periodic loop
// ============================================================

async function runDaemon(memory: MemoryStore, llm: LLMClient, prompt: string): Promise<void> {
  console.log("[Nexus] daemon mode: looping every 75s. Press Ctrl+C to stop.");
  while (true) {
    try {
      await runDefault(memory, llm, prompt, !!process.env.LLM_API_KEY);
    } catch (e: unknown) {
      console.error(`[Nexus daemon] error: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(75000);
  }
}

// ============================================================
// Helpers
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function quote(s: string): string {
  if (!s) return '""';
  if (/[ \t\n"']/.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  return s;
}

function persistMemory(
  memory: MemoryStore,
  prompt: string,
  answer: string,
  toolsUsed: string[],
  route: string
): void {
  try {
    memory.add({
      layer: "episodic",
      content: `${route}: ${prompt.slice(0, 100)} → ${answer.slice(0, 150)}`,
      tags: [route, ...toolsUsed].slice(0, 8),
      metadata: { route, toolsUsed, len: answer.length },
    });
    if (toolsUsed.length > 0) {
      memory.add({
        layer: "procedural",
        content: `used tools [${toolsUsed.join(", ")}] via route=${route}`,
        tags: toolsUsed,
        metadata: { route },
      });
    }
  } catch {
    // Memory should never crash the main loop
  }
}

// ============================================================
// Entry
// ============================================================

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[FATAL] ${msg}`);
  process.exit(1);
});
