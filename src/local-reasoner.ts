/**
 * LocalReasoner — 不依赖 LLM API key 的本地推理引擎
 *
 * 设计原则（对标 nanobot / pi-mono / eve 的本地模式）：
 *   1. 意图识别：用规则匹配中英文（可扩展）
 *   2. 工具执行：调用 ToolRegistry（22 个工具）
 *   3. 记忆整合：从 MemoryStore 检索并写入历史
 *
 * 返回格式
 *   { steps, answer, intent, toolsUsed, needLLM }
 *   — needLLM=true 表示「这个问题超出本地能力，交给上层走 tool-loop」
 */

import { spawnSync } from "child_process";
import { MemoryStore } from "./memory";
import { ToolRegistry } from "./tools";

export type Intent =
  | "greeting"
  | "self_assessment"
  | "capabilities"
  | "memory_query"
  | "file_read"
  | "file_write"
  | "file_list"
  | "file_info"
  | "shell"
  | "grep"
  | "search_files"
  | "git"
  | "code_stats"
  | "json_parse"
  | "json_format"
  | "http_fetch"
  | "http_post"
  | "user_preference"
  | "reflection"
  | "identity"
  | "unknown";

export interface ReasonerResult {
  steps: Array<{ type: string; content: string }>;
  answer: string;
  intent: Intent;
  toolsUsed: string[];
  needLLM: boolean;
}

export class LocalReasoner {
  private memory: MemoryStore;
  private tools: ToolRegistry;

  constructor(memory: MemoryStore) {
    this.memory = memory;
    this.tools = new ToolRegistry();
  }

  async reason(prompt: string): Promise<ReasonerResult> {
    const trimmed = prompt.trim();
    const steps: ReasonerResult["steps"] = [];
    const toolsUsed: string[] = [];

    const intent = this.classifyIntent(trimmed);
    steps.push({ type: "intent", content: `${intent}` });

    let answer = "";
    let needLLM = false;

    switch (intent) {
      case "greeting":
        answer = this.handleGreeting(trimmed);
        break;
      case "self_assessment":
      case "identity":
        answer = this.handleSelfAssessment();
        break;
      case "capabilities":
        answer = this.handleCapabilities();
        break;
      case "memory_query":
        answer = this.handleMemoryQuery(trimmed);
        break;
      case "reflection":
        answer = this.handleReflection();
        break;
      case "user_preference":
        answer = this.handleUserPreference(trimmed);
        break;
      case "file_read": {
        const r = await this.execTool("read_file", this.extractFileParams(trimmed));
        answer = this.formatFileResult(r);
        if (r?.success) toolsUsed.push("read_file");
        break;
      }
      case "file_list": {
        const r = await this.execTool("list_dir", this.extractDirParams(trimmed));
        answer = this.formatDirResult(r);
        if (r?.success) toolsUsed.push("list_dir");
        break;
      }
      case "file_write": {
        const r = await this.execTool("write_file", this.extractWriteParams(trimmed));
        answer = this.formatWriteResult(r);
        if (r?.success) toolsUsed.push("write_file");
        break;
      }
      case "file_info": {
        const r = await this.execTool("file_info", this.extractFileParams(trimmed));
        answer = this.formatInfoResult(r);
        if (r?.success) toolsUsed.push("file_info");
        break;
      }
      case "shell": {
        const cmd = this.extractShellCommand(trimmed);
        const r = await this.execTool("bash", { command: cmd });
        answer = this.formatShellResult(r);
        if (r?.success) toolsUsed.push("bash");
        break;
      }
      case "grep": {
        const { pattern, path } = this.extractGrepParams(trimmed);
        const r = await this.execTool("grep", { pattern, path: path || "." });
        answer = this.formatGrepResult(r);
        if (r?.success) toolsUsed.push("grep");
        break;
      }
      case "search_files": {
        const { pattern, path } = this.extractSearchFilesParams(trimmed);
        const r = await this.execTool("find", { pattern, path: path || "." });
        answer = this.formatFindResult(r);
        if (r?.success) toolsUsed.push("find");
        break;
      }
      case "git":
        answer = this.handleGit(trimmed);
        break;
      case "code_stats":
        answer = this.handleCodeStats(trimmed);
        break;
      case "json_parse":
      case "json_format":
      case "http_fetch":
      case "http_post":
        // 交给 LLM 处理更稳妥
        needLLM = true;
        answer = "";
        break;
      case "unknown":
      default:
        const fromMemory = this.tryMemoryAnswer(trimmed);
        if (fromMemory) {
          answer = fromMemory;
        } else {
          needLLM = true;
        }
        break;
    }

    steps.push({ type: "answer", content: answer.slice(0, 300) });
    return { steps, answer, intent, toolsUsed, needLLM };
  }

  // ============================================================
  // Intent classifier（中英双语 + 更鲁棒）
  // ============================================================
  private classifyIntent(p: string): Intent {
    const lower = p.toLowerCase().trim();

    // --- 1. 元命令 --help / --version 由 CLI 层处理

    // --- 2. Greeting
    if (/^(hi|hello|hey|yo|sup|嗨|你好|早上好|下午好|晚上好|您好|早)(\s|$)/.test(lower)) return "greeting";
    if (lower === "你好" || lower === "hello" || lower === "hi" || lower === "嗨") return "greeting";

    // --- 3. 自我评估 / 身份
    if (/^(status|状态|汇报|自省|反思|自我评估|自我介绍|报告|你的状态|self status|tell me about yourself)$/.test(lower)) return "self_assessment";
    if (/^(你是谁|who are you|what are you)(\s|$)/.test(lower)) return "self_assessment";
    if (/^(反省|reflect|reflection|内省|review yourself|self review)(\s|$)/.test(lower)) return "reflection";

    // --- 4. 能力查询
    if (/^(你能做什么|你会什么|有什么功能|有什么工具|有哪些能力|能帮我做什么|你的能力|capabilities|what can you do|what tools|features|你的工具)(\s|$)/.test(lower)) return "capabilities";
    if (/(capabilities|what can you do|你的能力|有什么工具)/.test(lower) && lower.length < 80) return "capabilities";

    // --- 5. 文件读取（优先级最高）
    // "read FILE" / "读取 FILE" / "cat FILE"
    if (/^(read|读取|读|查看|显示|cat)\s+(file\s+)?['"]?([^\s'"]+)['"]?/i.test(lower)) return "file_read";
    if (/^show\s+(me\s+)?(the\s+)?contents?\s+of\s+['"]?([^\s'"]+)/i.test(lower)) return "file_read";
    // 纯文件名（带扩展名）
    if (/^[\w\-./]+\.(md|ts|js|tsx|jsx|json|txt|yaml|yml|csv|log|py|go|rs|java|c|cpp|h|html|css|sh)$/i.test(p)) return "file_read";

    // --- 6. 文件写入
    if (/^(write|写|写入|write file|write to)\s+['"]?([^\s'"]+)['"]?/i.test(lower)) return "file_write";
    if (/^write_file\s+/i.test(lower)) return "file_write";

    // --- 7. 列出目录
    if (/^(ls|list|列出|列|dir|有什么文件|显示文件)(\s|$)/i.test(lower)) return "file_list";
    if (/^list\s+(files?\s+in\s+|the\s+)?(dir(ector)?y\s+)?['"]?([\w\-./]+)/i.test(lower)) return "file_list";
    if (/^(ls|list)\s+['"]?([\w\-./]+)/i.test(lower)) return "file_list";

    // --- 8. 文件信息
    if (/^(file info|info about|stat|文件信息|文件大小|file size)\s+['"]?([^\s'"]+)/i.test(lower)) return "file_info";

    // --- 9. grep / 内容搜索
    if (/^(grep|search for|搜索|查找内容|在.*?中搜索|查找)\s+/i.test(lower)) return "grep";
    if (/^grep\s+['"]?([^\s'"]+)['"]?/i.test(lower)) return "grep";

    // --- 10. 搜索文件名
    if (/^(find\s+files?|search\s+files?|find\s+files?\s+named|查找文件|搜文件|find)\s+/i.test(lower)) return "search_files";
    if (/^find\s+['"]?([^\s'"]+)['"]?$/i.test(lower)) return "search_files";

    // --- 11. Shell / 命令
    if (/^(run|execute|bash[:：]?\s*|shell[:：]?\s*|运行|执行|跑|命令[:：])\s+/i.test(lower)) return "shell";
    // 典型 shell 命令开头（不作为 grep 等的首匹配）
    const shellLike = /^(echo|pwd|cat\s|head\s|tail\s|wc\s|ls\s+-|date|uname|whoami|which|npm\s|node\s|tsx\s|npx\s|curl\s|wget\s)/i;
    if (shellLike.test(lower)) return "shell";

    // --- 12. Git
    if (/^(git\s+(status|diff|log|clone|pull|push)|git[:：]|git操作)/i.test(lower)) return "git";

    // --- 13. 代码统计
    if (/^(code stats|代码统计|line count|行数|统计代码|analyze code|代码分析)/i.test(lower)) return "code_stats";

    // --- 14. JSON
    if (/^(parse json|json parse|解析 json)/i.test(lower)) return "json_parse";
    if (/^(format json|json format|格式化 json)/i.test(lower)) return "json_format";

    // --- 15. HTTP
    if (/^(fetch|get|curl|请求|访问)\s+(https?:\/\/|\/)/i.test(lower)) return "http_fetch";
    if (/^http post\s+/i.test(lower)) return "http_post";

    // --- 16. 记忆查询
    if (/^(remember|memory recall|回忆|记得|你的记忆|历史记录|what do you remember)(\s|$)/i.test(lower)) return "memory_query";
    if (lower.includes("记忆") || lower.includes("remember") || lower.includes("recall")) return "memory_query";

    // --- 17. 用户偏好
    if (lower.includes("i prefer") || lower.includes("我喜欢") || lower.includes("remember that i") || lower.includes("请记住")) return "user_preference";

    // --- default：交给 LLM
    return "unknown";
  }

  // ============================================================
  // Tool execution（统一通过 ToolRegistry）
  // ============================================================
  private async execTool(
    name: string,
    params: Record<string, unknown>
  ): Promise<{ success: boolean; raw: Record<string, unknown> | null; error?: string }> {
    const tool = this.tools.get(name);
    if (!tool) return { success: false, raw: null, error: `Tool not found: ${name}` };
    try {
      const raw = await tool.execute(params);
      if (raw.error) return { success: false, raw, error: String(raw.error) };
      return { success: true, raw };
    } catch (e: unknown) {
      return {
        success: false,
        raw: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  // --- Handlers：纯文本（不需要工具）
  private handleGreeting(p: string): string {
    const zh = /[\u4e00-\u9fa5]/.test(p);
    const stats = this.memory.stats();
    if (zh) {
      return (
        `你好 👋 我是 Nexus。\n` +
        `当前有 ${stats.total} 条记忆（${stats.episodic} 事件 / ${stats.semantic} 语义 / ${stats.procedural} 能力）。\n` +
        `可以帮你：读取文件 / 列出目录 / grep 搜索 / 运行 shell 命令 / 代码统计。`
      );
    }
    return (
      `Hi 👋 I'm Nexus.\n` +
      `Memory: ${stats.total} entries (${stats.episodic} episodic / ${stats.semantic} semantic / ${stats.procedural} procedural).\n` +
      `Try: "read README.md" · "list files in src" · "grep Nexus README.md" · "run date" · "what can you do?"`
    );
  }

  private handleSelfAssessment(): string {
    const stats = this.memory.stats();
    const toolNames = this.tools.names();
    return [
      `# Nexus · 状态报告`,
      ``,
      `## 记忆`,
      `- 总数: ${stats.total}`,
      `- 事件 episodic: ${stats.episodic}`,
      `- 语义 semantic: ${stats.semantic}`,
      `- 能力 procedural: ${stats.procedural}`,
      ``,
      `## 可用工具（${toolNames.length}）`,
      `- 文件系统: read_file · write_file · list_dir · file_info`,
      `- Shell: bash · grep · find · env`,
      `- Code: parse_json · format_json · diff · count_lines · self_modify · self_read`,
      `- Memory: memory_query · memory_write · dreamer_tick · temporal_index`,
      `- Network: fetch_url · http_post`,
      `- Utility: sleep · timestamp`,
      ``,
      `## 运行模式`,
      `- 离线（offline）: 本地规则 + ToolRegistry，无需 API key`,
      `- 在线（online）: 需要 LLM_API_KEY，启用原生 tool calling + ReAct 循环`,
      ``,
      `## 下一步`,
      `- "list files in src" → 仓库结构`,
      `- "grep TODO src" → 待办`,
      `- "run wc -l src/*.ts" → 代码规模`,
    ].join("\n");
  }

  private handleCapabilities(): string {
    const toolNames = this.tools.names();
    return [
      `我能做这些事：`,
      ``,
      `1. 文件读写 & 目录遍历（read_file / write_file / list_dir / file_info）`,
      `2. Shell 命令（bash / grep / find / env）`,
      `3. JSON 解析与格式化（parse_json / format_json）`,
      `4. Git 基础操作（git status / diff / log / clone / pull）`,
      `5. HTTP GET / POST（fetch_url / http_post）`,
      `6. 持久化记忆（三层 memory）`,
      `7. 自我评估 & 自省（"状态" / "反省"）`,
      `8. 有 LLM API key 时可启用 LLM tool-loop（原生 function calling）`,
      ``,
      `当前已注册 ${toolNames.length} 个工具：`,
      toolNames.map((n) => `  · ${n}`).join("\n"),
    ].join("\n");
  }

  private handleMemoryQuery(p: string): string {
    const results = this.memory.query({ text: p, topK: 5, minSimilarity: 0.1 });
    if (results.length === 0) return `没有找到与 "${p}" 相关的记忆。`;
    const lines = [`找到 ${results.length} 条相关记忆：`, ""];
    for (const r of results) {
      const ts = (r.entry as any).createdAt ? new Date((r.entry as any).createdAt).toLocaleString() : "";
      lines.push(`  [${r.entry.layer}] ${r.entry.content.slice(0, 120)}  (相似度 ${r.similarity.toFixed(2)}${ts ? ", " + ts : ""})`);
    }
    return lines.join("\n");
  }

  private handleReflection(): string {
    const stats = this.memory.stats();
    const lines: string[] = [];
    lines.push(`# Nexus · 自省`);
    lines.push(``);
    lines.push(`- 记忆条目: ${stats.total}`);
    lines.push(`- 工具总数: ${this.tools.names().length}`);
    const recent = this.memory.query({ text: "run", topK: 3, minSimilarity: 0 }).slice(0, 3);
    if (recent.length) {
      lines.push(`- 最近记忆 (前 3 条):`);
      for (const m of recent) lines.push(`    · ${m.entry.content.slice(0, 100)}`);
    }
    lines.push(``);
    lines.push(`## 下一步`);
    lines.push(`- 配置 LLM_API_KEY → 启用原生 tool calling`);
    lines.push(`- "grep TODO src" → 找到代码中的 TODO`);
    lines.push(`- "read src/nexus.ts" → 主入口`);
    return lines.join("\n");
  }

  private handleUserPreference(p: string): string {
    this.memory.add({
      layer: "semantic",
      content: `user_preference: ${p.slice(0, 200)}`,
      tags: ["user_preference"],
      metadata: { source: "local-reasoner" },
    });
    return `已记录：「${p.slice(0, 120)}…」（存进 semantic memory）`;
  }

  // ============================================================
  // 参数提取
  // ============================================================
  private extractFileParams(p: string): Record<string, unknown> {
    const tokens = p.trim().split(/\s+/);
    const last = tokens[tokens.length - 1] || "";
    let path = last.replace(/[。？！!?.,;:]$/, "");
    if (!/[./]/.test(path)) {
      const match = p.match(/[\w\-./]+\.[a-z0-9]{2,6}/i);
      if (match) path = match[0];
    }
    return { path };
  }

  private extractDirParams(p: string): Record<string, unknown> {
    // "list <path>" / "ls <path>" / "list files in <path>"
    const lower = p.toLowerCase();
    const tokens = p.trim().split(/\s+/);

    const inIdx = lower.indexOf(" in ");
    if (inIdx >= 0) {
      const rest = p.slice(inIdx + 4).trim();
      if (rest) return { path: rest.split(/\s+/)[0] };
    }
    const chineseIdx = lower.indexOf(" 在 ");
    if (chineseIdx >= 0) {
      const rest = p.slice(chineseIdx + 3).trim();
      if (rest) return { path: rest.split(/\s+/)[0] };
    }
    // 末尾 token 如果是目录路径
    const last = tokens[tokens.length - 1];
    if (last && (/^\./.test(last) || /[\\/]$/.test(last) || /^(src|docs|example|tests|lib|bin|dist|build)$/.test(last))) {
      return { path: last };
    }
    return { path: "." };
  }

  private extractWriteParams(p: string): Record<string, unknown> {
    const rest = p.replace(/^(write\s+file\s+|write\s+|写入\s+)/i, "");
    const spaceIdx = rest.search(/\s/);
    if (spaceIdx < 0) return { path: rest, content: "" };
    const path = rest.slice(0, spaceIdx);
    const content = rest.slice(spaceIdx + 1);
    return { path, content };
  }

  private extractShellCommand(p: string): string {
    return p
      .replace(/^(run\s+|execute\s+|bash[:：]?\s*|shell[:：]?\s*|运行\s+|执行\s+|跑\s+|命令[:：]?\s*)/i, "")
      .trim();
  }

  private extractGrepParams(p: string): { pattern: string; path: string | null } {
    const t = p.trim();
    const rest = t.replace(/^(grep\s+(for\s+)?|search\s+for\s+|搜索\s+|查找内容\s+|查找\s+)/i, "");
    const inMatch = rest.match(/^(.*?)\s+(?:in|在)\s+(\S+)$/i);
    if (inMatch) {
      return {
        pattern: inMatch[1].trim().replace(/^['"]|['"]$/g, ""),
        path: inMatch[2],
      };
    }
    const tokens = rest.split(/\s+/);
    const pattern = tokens[0].replace(/^['"]|['"]$/g, "");
    const last = tokens[tokens.length - 1];
    if (tokens.length > 1 && /^(\.|src|\/|\.\.|tests|docs|example|\w+\.\w+)/.test(last)) {
      return { pattern, path: last };
    }
    return { pattern, path: null };
  }

  private extractSearchFilesParams(p: string): { pattern: string; path: string } {
    const t = p.trim();
    const m = t.match(/(?:find(?:\s+files?)?(?:\s+named)?|search(?:\s+for)?(?:\s+files?)?(?:\s+named)?|查找文件?)\s+['"]?([^\s'"]+)['"]?(?:\s+in\s+['"]?([^\s'"]+))?/i);
    if (m) return { pattern: m[1], path: m[2] || "." };
    return { pattern: "*", path: "." };
  }

  // ============================================================
  // 结果格式化
  // ============================================================
  private formatFileResult(r: { success: boolean; raw: Record<string, unknown> | null; error?: string }): string {
    if (!r.success) return `✗ ${r.error || "读取失败"}`;
    const { content, totalLength } = r.raw || {};
    const len = String(content ?? "").length;
    const head = totalLength ? `文件内容（${len} / ${totalLength} 字符）` : `文件内容（${len} 字符）`;
    return `\`${head}\`\n\n\`\`\`\n${String(content ?? "")}\n\`\`\``;
  }

  private formatDirResult(r: { success: boolean; raw: Record<string, unknown> | null; error?: string }): string {
    if (!r.success) return `✗ ${r.error || "列出目录失败"}`;
    const { files, dirs } = r.raw || {};
    const f = Array.isArray(files) ? (files as string[]) : [];
    const d = Array.isArray(dirs) ? (dirs as string[]) : [];
    const lines: string[] = [`目录内容（${f.length} 个文件 / ${d.length} 个子目录）：`, ""];
    if (d.length) lines.push(`[dirs]  ${d.slice(0, 50).join("  ")}`);
    if (f.length) lines.push(`[files] ${f.slice(0, 100).join("\n       ")}`);
    return lines.join("\n");
  }

  private formatWriteResult(r: { success: boolean; raw: Record<string, unknown> | null; error?: string }): string {
    if (!r.success) return `✗ ${r.error || "写入失败"}`;
    const { bytes, path } = r.raw || {};
    return `✓ 已写入 ${path}（${bytes} 字节）`;
  }

  private formatInfoResult(r: { success: boolean; raw: Record<string, unknown> | null; error?: string }): string {
    if (!r.success) return `✗ ${r.error || "无法读取文件信息"}`;
    return JSON.stringify(r.raw, null, 2);
  }

  private formatShellResult(r: { success: boolean; raw: Record<string, unknown> | null; error?: string }): string {
    if (!r.success) return `✗ ${r.error || "命令执行失败"}`;
    const { output, exitCode, stderr } = (r.raw || {}) as Record<string, unknown>;
    const parts: string[] = [];
    if (exitCode != null) parts.push(`exit: ${String(exitCode)}`);
    if (output != null && String(output).trim()) {
      parts.push("stdout:");
      parts.push("```");
      parts.push(String(output).slice(0, 4000));
      parts.push("```");
    }
    if (stderr != null && String(stderr).trim()) {
      parts.push("stderr:");
      parts.push("```");
      parts.push(String(stderr).slice(0, 1500));
      parts.push("```");
    }
    return parts.join("\n");
  }

  private formatGrepResult(r: { success: boolean; raw: Record<string, unknown> | null; error?: string }): string {
    if (!r.success) return `✗ ${r.error || "搜索失败"}`;
    const matches = (r.raw as any)?.matches as string[] | undefined;
    const clean = Array.isArray(matches) ? matches.filter(Boolean) : [];
    if (clean.length === 0) return `没有找到匹配。`;
    const lines = [`找到 ${clean.length} 处匹配：`, "```"];
    for (const m of clean.slice(0, 50)) lines.push(String(m).slice(0, 200));
    lines.push("```");
    return lines.join("\n");
  }

  private formatFindResult(r: { success: boolean; raw: Record<string, unknown> | null; error?: string }): string {
    if (!r.success) return `✗ ${r.error || "搜索文件失败"}`;
    const files = (r.raw as any)?.files as string[] | undefined;
    const clean = Array.isArray(files) ? files.filter(Boolean) : [];
    if (clean.length === 0) return `没有找到匹配的文件。`;
    const lines = [`找到 ${clean.length} 个文件：`, ""];
    for (const f of clean.slice(0, 50)) lines.push(`  · ${f}`);
    return lines.join("\n");
  }

  // --- Git / CodeStats（直接 spawnSync — 不依赖 ToolRegistry 的 bash 异步路径）
  private handleGit(p: string): string {
    const t = p.trim();
    try {
      if (/git\s+status/i.test(t)) return this.runSync("git", ["status"]);
      if (/git\s+diff/i.test(t)) return this.runSync("git", ["diff"]);
      if (/git\s+pull/i.test(t)) return this.runSync("git", ["pull"]);
      if (/git\s+log/i.test(t)) return this.runSync("git", ["log", "--oneline", "-n", "10"]);
      const cloneM = t.match(/git\s+clone\s+['"]?(\S+?)['"]?(\s+(\S+))?$/i);
      if (cloneM) {
        const args = ["clone", cloneM[1]];
        if (cloneM[3]) args.push(cloneM[3]);
        return this.runSync("git", args);
      }
      return `支持的 git 命令: status / diff / log / pull / clone <url> [dest]`;
    } catch (e: unknown) {
      return `✗ ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private handleCodeStats(p: string): string {
    const tokens = p.trim().split(/\s+/);
    const dir = tokens[tokens.length - 1]?.replace(/[。！？!?]$/, "") || "src";
    return this.runSync("bash", [
      "-c",
      `find "${dir}" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.md" \\) | xargs wc -l | tail -20`,
    ]);
  }

  private runSync(bin: string, args: string[]): string {
    const cmd = [bin, ...args].join(" ");
    const dangerous = /(rm\s+-rf\s+\/\s*$|\bsudo\b|\bmkfs\b|\bdd\b.*of=\/dev)/;
    if (dangerous.test(cmd)) return `✗ 拦截危险命令：${cmd}`;
    try {
      const r = spawnSync("sh", ["-c", cmd], { encoding: "utf-8", timeout: 15000, maxBuffer: 5 * 1024 * 1024 });
      const out = (r.stdout || "").slice(0, 4000);
      const err = (r.stderr || "").slice(0, 1500);
      return `\`${cmd}\`\n\`\`\`\n${out}${err ? "\n[stderr]\n" + err : ""}\n\`\`\``;
    } catch (e: unknown) {
      return `✗ ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private tryMemoryAnswer(p: string): string | null {
    const r = this.memory.query({ text: p, topK: 3, minSimilarity: 0.25 });
    if (r.length === 0) return null;
    const lines = [`（基于记忆给出的回答，不一定完整）`, ""];
    for (const item of r) lines.push(`· ${item.entry.content.slice(0, 140)}`);
    return lines.join("\n");
  }
}
