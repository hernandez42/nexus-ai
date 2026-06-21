#!/usr/bin/env node
/**
 * Nexus — 统一成熟入口
 *
 * 处理流程（对齐 nanobot / pi / eve）：
 *   1. 收到消息 → 实例化 LocalReasoner
 *   2. 如果本地推理能处理 → 直接回复（快，不依赖 LLM）
 *   3. 否则走 LLM tool loop（原生 function calling）
 *   4. 写入记忆 + markdown journal + identity md
 */

import { mkdirSync, existsSync } from "fs";
import { createLLM } from "./llm";
import { MemoryStore } from "./memory";
import { IdentityManager } from "./identity";
import { Journal } from "./journal";
import { LocalReasoner } from "./local-reasoner";
import { runToolLoop } from "./tool-loop";

async function main() {
  const args = process.argv.slice(2);

  // Flags
  const daemonMode = args.includes("--daemon");
  const initConfig = args.includes("--init");

  // Init is trivial — just ensure directories
  if (initConfig) {
    mkdirSync("nexus-workspace", { recursive: true });
    console.log("Nexus initialized. Try: `npx tsx src/nexus.ts \"hello\"`");
    return;
  }

  // Prompt = remaining positional args joined
  const prompt = args.filter(a => !a.startsWith("--")).join(" ").trim() || "hello";

  // Workspace & subsystems
  const workspaceDir = "./nexus-workspace";
  mkdirSync(workspaceDir, { recursive: true });

  const memory = new MemoryStore(workspaceDir + "/memory");
  memory.autoSave();

  const identity = new IdentityManager(workspaceDir);
  const journal = new Journal(workspaceDir);

  if (daemonMode) {
    // Demo daemon — just print a notice.
    console.log("Daemon mode: for interactive use, run the bot without --daemon.");
    return;
  }

  // Route via LocalReasoner first (works without LLM API key)
  const reasoner = new LocalReasoner(memory, identity, process.cwd());
  const result = await reasoner.reason(prompt);

  // Print answer
  console.log(result.answer);

  // Write to memory + journal
  memory.add({
    layer: "episodic",
    content: `${prompt.slice(0, 120)} → ${result.answer.slice(0, 180)}`,
    tags: ["run", ...result.toolsUsed],
    metadata: { intent: result.intent, tools: result.toolsUsed },
  });

  if (result.toolsUsed.length > 0) {
    memory.add({
      layer: "procedural",
      content: `用工具 ${result.toolsUsed.join(", ")} 处理了一个 "${result.intent}" 类型的请求`,
      tags: result.toolsUsed,
      metadata: { intent: result.intent },
    });
  }

  journal.record({
    timestamp: Date.now(),
    input: prompt,
    output: result.answer,
    toolsUsed: result.toolsUsed,
    layer: "episodic",
  });

  // Save at exit (memory autoSave already handles it)
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[FATAL]", msg);
  process.exit(1);
});
