#!/usr/bin/env node
/**
 * Nexus — Unified Entry Point
 *
 * Architecture:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  nexus.ts                                               │
 *   │                                                          │
 *   │  [CLI args] → [MemoryStore]                              │
 *   │                        │                                 │
 *   │           ┌────────────▼────────────┐                    │
 *   │           │     LocalReasoner       │ ← 规则式，无需 API key
 *   │           │ (ToolRegistry · 22个)   │                    │
 *   │           └────────────┬────────────┘                    │
 *   │                        │ 如果 needLLM=true，且有 API key  │
 *   │           ┌────────────▼────────────┐                    │
 *   │           │    runToolLoop()         │ ← LLM 原生 tool calling
 *   │           │   (llm.chatWithTools)    │ ← ReAct-style 循环
 *   │           └────────────┬────────────┘                    │
 *   │                        │                                 │
 *   │           ┌────────────▼────────────┐                    │
 *   │           │   memory.add + journal  │ ← 持久化
 *   │           └──────────────────────────┘                    │
 *   └──────────────────────────────────────────────────────────┘
 */

import { mkdirSync, existsSync } from "fs";
import { createLLM, LLMClient } from "./llm";
import { MemoryStore } from "./memory";
import { LocalReasoner } from "./local-reasoner";
import { runToolLoop } from "./tool-loop";
import { ToolRegistry } from "./tools";

// ============================================================
// CLI
// ============================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // 模式: "hello" "read <file>" "list <dir>" "grep <pattern> [path]"
  //       "what can you do?" "status" "反省"
  //       --help / --version
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`Nexus v${VERSION}`);
    return;
  }

  const prompt = args.join(" ").trim() || "hello";

  // 初始化子系统
  const workspaceDir = "./nexus-workspace";
  mkdirSync(workspaceDir, { recursive: true });

  const memory = new MemoryStore(workspaceDir + "/memory");
  memory.autoSave();

  const provider: "openai" | "anthropic" | "ollama" | "mock" = process.env.LLM_API_KEY
    ? ((process.env.LLM_PROVIDER as "openai" | "anthropic" | "ollama") || "openai")
    : "mock";
  const llm = createLLM({
    provider,
    apiKey: process.env.LLM_API_KEY || "",
    baseURL: process.env.LLM_BASE_URL || "",
    model: process.env.LLM_MODEL || "",
  });

  const hasLLM = process.env.LLM_API_KEY ? true : false;

  // --- Phase 1: LocalReasoner
  const reasoner = new LocalReasoner(memory);
  const result = await reasoner.reason(prompt);

  if (!result.needLLM && result.answer) {
    console.log(result.answer);
    persist(memory, prompt, result.answer, result.toolsUsed, result.intent);
    return;
  }

  // --- Phase 2: LLM tool-loop (如果本地推理没有能力回答)
  if (!hasLLM) {
    // 没有 LLM API key —— 给用户一个明确提示
    const lines: string[] = [];
    if (result.answer) {
      lines.push(result.answer);
      lines.push("");
    }
    lines.push(`(offline mode — 设置 LLM_API_KEY 后可启用 LLM tool-loop)`);
    lines.push("");
    lines.push(`你可以尝试：`);
    lines.push(`  · "read README.md"   → 读取文件`);
    lines.push(`  · "ls src"          → 列出目录`);
    lines.push(`  · "grep Nexus src"  → 搜索内容`);
    lines.push(`  · "run date"       → 执行 shell 命令`);
    lines.push(`  · "status"         → 系统状态`);
    lines.push(`  · "capabilities"   → 能力清单`);
    console.log(lines.join("\n"));
    persist(memory, prompt, result.answer || "[offline fallback]", result.toolsUsed, result.intent);
    return;
  }

  // LLM 路径
  console.log(`[Nexus] routing to LLM tool-loop …`);
  const tools = new ToolRegistry();
  const toolDefs = tools.list().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    execute: t.execute,
  }));

  try {
    const loopResult = await runToolLoop({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: prompt,
      tools: toolDefs,
      llm,
      maxSteps: 5,
    });
    console.log(loopResult.answer);
    persist(
      memory,
      prompt,
      loopResult.answer,
      loopResult.toolCallsUsed,
      "llm-tool-loop"
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Nexus] LLM tool-loop 失败：${msg}`);
    if (result.answer) console.log(result.answer);
    persist(memory, prompt, result.answer || "[llm failed]", result.toolsUsed, result.intent);
  }
}

// ============================================================
// Helpers
// ============================================================

function persist(
  memory: MemoryStore,
  prompt: string,
  answer: string,
  toolsUsed: string[],
  intent: string
): void {
  try {
    memory.add({
      layer: "episodic",
      content: `${intent}: ${prompt.slice(0, 100)} → ${answer.slice(0, 150)}`,
      tags: [intent, ...toolsUsed].slice(0, 8),
      metadata: { intent, toolsUsed, len: answer.length },
    });
    if (toolsUsed.length > 0) {
      memory.add({
        layer: "procedural",
        content: `成功使用工具 [${toolsUsed.join(", ")}] 处理 intent=${intent}`,
        tags: toolsUsed,
        metadata: { intent },
      });
    }
  } catch (e: unknown) {
    // 静默失败，记忆不是硬性依赖
  }
}

const VERSION = "0.4.0";

const SYSTEM_PROMPT = `你是 Nexus，一个自主推理助手。你的职责是帮助用户探索代码、回答问题，并持续进化。

核心原则：
1. 优先使用工具。你有 read_file / write_file / list_dir / bash / grep / find / parse_json / format_json / fetch_url / http_post 等 22 个工具。
2. 使用工具后阅读工具返回，综合给出最终答案。不要在调用工具前擅自推测工具会返回什么。
3. 每次对话最多调用 1–3 个工具就应该停止并给出最终答案。不要陷入无限循环。
4. 当你已经有足够信息时，直接回答问题。重复地调用同一个工具而不推进解答是错误的。
5. 回答语言与用户的提问语言保持一致（中文→中文，英文→英文）。
6. 不要暴露你底层的模型供应商或 API key。
7. 永远不要执行 rm -rf / / sudo / mkfs / dd of=/dev 等危险命令。

格式：你的最终回答必须以自然语言文本输出，不需要用 JSON 包裹。`;

const HELP = `Nexus v${VERSION} — 自主推理助手

用法:
  npx tsx src/nexus.ts "hello"                 // 问候
  npx tsx src/nexus.ts "read README.md"        // 读取文件
  npx tsx src/nexus.ts "ls src"                // 列出目录
  npx tsx src/nexus.ts "grep Nexus src"        // 内容搜索
  npx tsx src/nexus.ts "run date"              // shell 命令
  npx tsx src/nexus.ts "status"                // 系统状态
  npx tsx src/nexus.ts "capabilities"          // 能力清单
  npx tsx src/nexus.ts "反省"                  // 自我反省

环境变量（可选）：
  LLM_API_KEY     ← 启用 LLM tool-loop 时需要
  LLM_PROVIDER    ← openai（默认）/ anthropic / mock
  LLM_BASE_URL    ← 自定义代理（e.g. Ollama/OpenRouter）
  LLM_MODEL       ← 模型名

没有配置 LLM_API_KEY 时，Nexus 运行在 offline 模式 —— 所有工具依然可用，但复杂推理会提示 "offline mode"。
`;

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[FATAL] ${msg}`);
  process.exit(1);
});
