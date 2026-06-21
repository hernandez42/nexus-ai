#!/usr/bin/env node
/**
 * Nexus — 统一成熟入口
 *
 * 核心流程（对齐 pi Amimo / eve）：
 *   1. 收到消息 → 立即确认
 *   2. 查记忆 → 构建 system prompt
 *   3. LLM tool loop（原生 function calling，像 pi 的 runLoop）
 *   4. 返回最终答案
 *
 * 进化/解构/觉醒只在 daemon 模式后台运行，不阻塞飞书消息处理。
 */

import { mkdirSync, readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { loadConfig, generateDefaultConfig } from "./config";
import { createLLM } from "./llm";
import { Logger } from "./logger";
import { MemoryStore } from "./memory";
import { LocalReasoner } from "./local-reasoner";
import { createDefaultSkills, SkillContext } from "./skills";
import { startLarkBot, stopLarkBot } from "./lark";
import { runToolLoop } from "./tool-loop";
import { ToolRegistry } from "./tools";

// ============================================================
// Crash Protection
// ============================================================
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
  process.exit(1);
});

// ============================================================
// Main
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const configPath = args.find((_, i) => args[i - 1] === "--config") || "./config.json";
  const initConfig = args.includes("--init");
  const daemonMode = args.includes("--daemon");
  const larkMode = args.includes("--lark");
  const prompt = args.find(a => !a.startsWith("--")) || "Perform a self-assessment: review your current memory, capabilities, and evolutionary state. Report your findings concisely.";

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
  log.info("Nexus starting", { llm: config.llm.provider, model: config.llm.model, daemon: daemonMode, lark: larkMode });

  // ============================================================
  // 0. Global Memory
  // ============================================================
  const memory = new MemoryStore(join(config.memoryDir, "persistent"));
  memory.autoSave();

  const saveInterval = setInterval(() => {
    if (memory.stats().total > 0) memory.save();
  }, 30000);

  // ============================================================
  // Lark Mode — 飞书机器人（轻量，不跑进化/解构/觉醒）
  // ============================================================
  if (larkMode) {
    const larkAppId = process.env.LARK_APP_ID || process.env.FEISHU_APP_ID || "";
    const larkAppSecret = process.env.LARK_APP_SECRET || process.env.FEISHU_APP_SECRET || "";
    const allowFromRaw = process.env.LARK_ALLOW_FROM || process.env.FEISHU_ALLOW_FROM || "";
    const allowFrom = allowFromRaw ? allowFromRaw.split(",").map(s => s.trim()).filter(Boolean) : [];

    if (!larkAppId || !larkAppSecret) {
      console.error("[Lark] LARK_APP_ID and LARK_APP_SECRET required.");
      process.exit(1);
    }

    console.log("[Lark] Starting bot...");

    await startLarkBot(
      { appId: larkAppId, appSecret: larkAppSecret, allowFrom },
      async (text, sender, onProgress) => {
        console.log(`[Lark] Processing: ${text.slice(0, 100)}`);
        try {
          // Lark mode: lightweight — only tool loop, no evolution/deconstruction/awareness
          const result = await runLightweightCycle(config, log, memory, text, onProgress);
          return result;
        } catch (e: unknown) {
          const err = e instanceof Error ? e.message : String(e);
          console.error("[Lark] Cycle failed:", err);
          return `[Error] ${err.slice(0, 500)}`;
        }
      }
    );

    process.on("SIGINT", async () => {
      await stopLarkBot();
      clearInterval(saveInterval);
      memory.save();
      process.exit(0);
    });

    return;
  }

  // ============================================================
  // Daemon Mode — 后台循环（含进化/解构/觉醒）
  // ============================================================
  if (daemonMode) {
    console.log("Daemon mode: Nexus will loop every 60s. Press Ctrl+C to stop.");
    let cycleCount = 0;
    while (true) {
      cycleCount++;
      const cycleStart = Date.now();
      try {
        await runFullCycle(config, log, memory, prompt);
        memory.add({
          layer: "episodic",
          content: `Daemon cycle ${cycleCount} completed`,
          tags: ["daemon", "cycle-success"],
          metadata: { cycle: cycleCount, durationMs: Date.now() - cycleStart },
        });
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        log.error("Daemon cycle failed", { cycle: cycleCount, error: err.message });
        memory.add({
          layer: "episodic",
          content: `Daemon cycle ${cycleCount} failed: ${err.message.slice(0, 200)}`,
          tags: ["daemon", "cycle-fail"],
          metadata: { cycle: cycleCount, error: err.message },
        });
      }
      memory.save();
      log.info("Daemon: sleeping 75s", { cycle: cycleCount });
      await sleep(75000);
    }
  } else {
    // Single run — full cycle
    await runFullCycle(config, log, memory, prompt);
  }

  clearInterval(saveInterval);
  memory.save();
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// Lightweight Cycle — for Lark messages (fast, no evolution)
// Like pi Amimo: message → tool loop → answer
// ============================================================

async function runLightweightCycle(
  config: any,
  log: Logger,
  memory: MemoryStore,
  prompt: string,
  onProgress?: (chunk: string) => void,
): Promise<string> {
  const llm = createLLM(config.llm);

  // Query relevant memories
  const pastMemories = memory.query({ text: prompt, topK: 5, minSimilarity: 0.01 });
  const memoryContext = pastMemories.length > 0
    ? `\n\n[RELEVANT MEMORIES]\n${pastMemories.map(r => `- [${r.entry.layer}] (${r.similarity.toFixed(2)}) ${r.entry.content.slice(0, 150)}`).join("\n")}`
    : "";

  // Build system prompt
  const systemPrompt = buildSystemPrompt(config, memoryContext);

  // Build tools — use ToolRegistry's full set, not just 3 inline tools
  const tools = buildToolSet(config);

  // Simple query → LocalReasoner (instant, no LLM)
  const isSimpleQuery = /^(hi|hello|hey|greetings|yo)\b/i.test(prompt) ||
    /^(你好|嗨|哈喽|早上好|下午好|晚上好)/.test(prompt);

  if (isSimpleQuery) {
    const skillRegistry = createDefaultSkills();
    const skillContext: SkillContext = {
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      log: (msg: string) => log.info(msg),
    };
    const localReasoner = new LocalReasoner(memory, skillRegistry, skillContext);
    const localSteps = await localReasoner.reason(prompt, 3);
    const localFinal = localSteps.find(s => s.type === "FINAL");
    if (localFinal?.content) {
      return localFinal.content;
    }
    // Fall through to tool loop
  }

  // Run tool loop (pi/eve style)
  const toolDefs = tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    execute: async (params: Record<string, unknown>) => {
      try {
        const raw = await t.execute(params);
        return typeof raw === "string" ? raw : JSON.stringify(raw);
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }));

  const result = await runToolLoop({
    systemPrompt,
    userPrompt: prompt,
    tools: toolDefs,
    llm,
    maxSteps: 5,
    onStream: onProgress,
  });

  log.info("Tool loop completed", {
    steps: result.steps.length,
    toolCallsUsed: result.toolCallsUsed,
  });

  // Save to memory
  memory.add({
    layer: "episodic",
    content: `Lark: ${prompt.slice(0, 100)} → ${result.answer.slice(0, 200)}`,
    tags: ["lark", "result"],
    metadata: { steps: result.steps.length, tools: result.toolCallsUsed },
  });

  return result.answer;
}

// ============================================================
// Full Cycle — for daemon/single run (with evolution/deconstruction/awareness)
// ============================================================

async function runFullCycle(
  config: any,
  log: Logger,
  memory: MemoryStore,
  prompt: string,
): Promise<string> {
  const llm = createLLM(config.llm);

  // Query relevant memories
  const pastMemories = memory.query({ text: prompt, topK: 5, minSimilarity: 0.01 });
  const memoryContext = pastMemories.length > 0
    ? `\n\n[RELEVANT MEMORIES]\n${pastMemories.map(r => `- [${r.entry.layer}] (${r.similarity.toFixed(2)}) ${r.entry.content.slice(0, 150)}`).join("\n")}`
    : "";

  log.info(`Memory: ${memory.stats().total} entries, ${pastMemories.length} relevant`);

  // Build system prompt
  const systemPrompt = buildSystemPrompt(config, memoryContext);

  // Build tools
  const tools = buildToolSet(config);

  // Simple query → LocalReasoner
  const isSimpleQuery = /^(hi|hello|hey|greetings|yo)\b/i.test(prompt) ||
    /^(你好|嗨|哈喽|早上好|下午好|晚上好)/.test(prompt);

  if (isSimpleQuery) {
    const skillRegistry = createDefaultSkills();
    const skillContext: SkillContext = {
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      log: (msg: string) => log.info(msg),
    };
    const localReasoner = new LocalReasoner(memory, skillRegistry, skillContext);
    const localSteps = await localReasoner.reason(prompt, 3);
    const localFinal = localSteps.find(s => s.type === "FINAL");
    if (localFinal?.content) {
      return localFinal.content;
    }
  }

  // Run tool loop
  const toolDefs = tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    execute: async (params: Record<string, unknown>) => {
      try {
        const raw = await t.execute(params);
        return typeof raw === "string" ? raw : JSON.stringify(raw);
      } catch (e: unknown) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }));

  const result = await runToolLoop({
    systemPrompt,
    userPrompt: prompt,
    tools: toolDefs,
    llm,
    maxSteps: 5,
  });

  log.info("Tool loop completed", {
    steps: result.steps.length,
    toolCallsUsed: result.toolCallsUsed,
  });

  // Save to memory
  memory.add({
    layer: "episodic",
    content: `Run: ${prompt.slice(0, 100)} → ${result.answer.slice(0, 200)}`,
    tags: ["run", "result"],
    metadata: { steps: result.steps.length, tools: result.toolCallsUsed },
  });
  memory.save();

  console.log(`\nFinal Answer: ${result.answer.slice(0, 300)}...`);
  return result.answer;
}

// ============================================================
// Build system prompt (shared between lightweight and full cycle)
// ============================================================

function buildSystemPrompt(config: any, memoryContext: string): string {
  const programMdPath = join(config.repos?.autoresearch || ".", "program.md");
  let systemPrompt = existsSync(programMdPath)
    ? readFileSync(programMdPath, "utf-8").slice(0, 2000)
    : "You are Nexus, an autonomous reasoning agent. You do not reveal your underlying model or provider. You answer questions directly without introducing yourself.";

  systemPrompt += memoryContext;

  systemPrompt += `

IMPORTANT INSTRUCTIONS:
- You have tools available. Use them ONLY when needed to answer the user's question.
- After using tools and getting results, STOP calling tools and reply directly to the user with your answer.
- Do NOT keep calling tools endlessly. After 1-3 tool calls, you MUST reply with your final answer.
- If you already have enough information to answer, reply with text instead of calling more tools.
- Reply in the same language as the user's question (Chinese → Chinese, English → English).
- Be concise. Answer directly without unnecessary preamble.`;

  return systemPrompt;
}

// ============================================================
// Build tool set — use tools from tools.ts ToolRegistry
// ============================================================

function buildToolSet(config: any): Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}> {
  const registry = new ToolRegistry();
  const registered = registry.list();

  // Convert ToolRegistry tools to tool-loop format
  const tools = registered.map((t: any) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    execute: t.execute,
  }));

  // Add core tools if not already present
  const toolNames = new Set(tools.map((t: any) => t.name));

  if (!toolNames.has("read_file")) {
    tools.push({
      name: "read_file",
      description: "Read contents of a file. Only works on files — use list_dir for directories. Returns first 2000 characters.",
      parameters: { path: "string" },
      execute: async (params: Record<string, unknown>) => {
        try {
          const path = params.path as string;
          if (!path) return { error: "Parameter 'path' is required" };
          if (!existsSync(path)) return { error: `File not found: ${path}` };
          const stats = statSync(path);
          if (stats.isDirectory()) return { error: `Path is a directory, not a file: ${path}. Use list_dir instead.` };
          return { content: readFileSync(path, "utf-8").slice(0, 2000) };
        } catch (e: unknown) {
          return { error: `read_file failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    });
  }

  if (!toolNames.has("bash")) {
    tools.push({
      name: "bash",
      description: "Run a shell command. Returns stdout (max 2000 chars). Timeout: 15s.",
      parameters: { command: "string" },
      execute: async (params: Record<string, unknown>) => {
        try {
          const cmd = params.command as string;
          if (!cmd) return { error: "Parameter 'command' is required" };
          const blocked = [/rm\s+-rf\s+\/\s*$/, /sudo\b/, /mkfs\b/, /\bdd\b.*of=\/dev/];
          for (const pattern of blocked) {
            if (pattern.test(cmd)) return { error: "Command blocked by security policy" };
          }
          const result = spawnSync("sh", ["-c", cmd], {
            encoding: "utf-8", timeout: 15000, maxBuffer: 2 * 1024 * 1024,
          });
          return { output: (result.stdout || "").slice(0, 2000) + (result.stderr ? "\n" + (result.stderr as string).slice(0, 500) : "") };
        } catch (e: unknown) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    });
  }

  if (!toolNames.has("search_files")) {
    tools.push({
      name: "search_files",
      description: "Search files by name pattern using find. Returns file paths.",
      parameters: { pattern: "string", directory: "string?" },
      execute: async (params: Record<string, unknown>) => {
        try {
          const dir = (params.directory as string) || ".";
          if (!existsSync(dir) || !statSync(dir).isDirectory()) return { error: `Directory not found or not a directory: ${dir}` };
          const result = spawnSync("find", [dir, "-name", params.pattern as string, "-type", "f"], {
            encoding: "utf-8", timeout: 10000,
          });
          const files = (result.stdout || "").trim().split("\n").filter(Boolean).slice(0, 30);
          return { files };
        } catch (e: unknown) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    });
  }

  if (!toolNames.has("grep")) {
    tools.push({
      name: "grep",
      description: "Search file contents by regex pattern. Returns matching lines.",
      parameters: { pattern: "string", path: "string?" },
      execute: async (params: Record<string, unknown>) => {
        try {
          const args = ["-rn", params.pattern as string];
          const searchPath = (params.path as string) || ".";
          if (!existsSync(searchPath)) return { error: `Path not found: ${searchPath}` };
          args.push(searchPath);
          const result = spawnSync("grep", args, {
            encoding: "utf-8", timeout: 10000, maxBuffer: 1024 * 1024,
          });
          const lines = (result.stdout || "").trim().split("\n").filter(Boolean).slice(0, 30);
          return { matches: lines };
        } catch (e: unknown) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    });
  }

  return tools;
}

main().catch((e) => {
  console.error("[FATAL] Main failed:", e);
  process.exit(1);
});
