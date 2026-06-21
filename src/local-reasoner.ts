/**
 * LocalReasoner — 不依赖 LLM 的本地推理引擎
 *
 * 设计目标（对照 nanobot / eve 的推理循环）：
 *   1. 意图识别（中文 / 英文）- 规则匹配
 *   2. 从 memory 检索相关信息
 *   3. 真正调用工具（读文件、执行命令、搜索…）
 *   4. 综合出结构化的答复
 *
 * 关键：**即使没有 LLM API key，也能完整工作**。
 * 这意味着 read_file、bash、grep、search_files 等工具必须在本地真实调用。
 */

import { existsSync, readFileSync, statSync } from "fs";
import { spawnSync } from "child_process";
import { MemoryStore } from "./memory";
import { ToolRegistry } from "./tools";
import { IdentityManager } from "./identity";

// ============================================================
// Intent types
// ============================================================

type Intent =
  | "greeting"
  | "self_assessment"
  | "capabilities"
  | "memory_query"
  | "file_read"
  | "file_list"
  | "shell"
  | "grep"
  | "search_files"
  | "git"
  | "code_analysis"
  | "user_preference"
  | "reflection"
  | "unknown";

// ============================================================
// LocalReasoner
// ============================================================

export interface ReasonerResult {
  steps: Array<{ type: string; content: string; confidence?: number }>;
  answer: string;
  intent: Intent;
  toolsUsed: string[];
}

export class LocalReasoner {
  private memory: MemoryStore;
  private identity: IdentityManager;
  private tools: ToolRegistry;
  private cwd: string;

  constructor(memory: MemoryStore, identity: IdentityManager, cwd: string = process.cwd()) {
    this.memory = memory;
    this.identity = identity;
    this.tools = new ToolRegistry();
    this.cwd = cwd;
  }

  async reason(prompt: string): Promise<ReasonerResult> {
    const steps: ReasonerResult["steps"] = [];
    const toolsUsed: string[] = [];

    const intent = this.classifyIntent(prompt);
    steps.push({ type: "intent", content: `意图：${intent}`, confidence: 0.9 });

    // Memory retrieval for context (all queries)
    const related = this.memory.query({ text: prompt, topK: 3, minSimilarity: 0.1 });
    if (related.length > 0) {
      steps.push({
        type: "memory",
        content: `${related.length} 条相关记忆`,
      });
    }

    // --- Dispatch to handler ---
    let answer = "";

    switch (intent) {
      case "greeting":
        answer = this.handleGreeting(prompt);
        break;
      case "self_assessment":
        answer = this.handleSelfAssessment();
        break;
      case "capabilities":
        answer = this.handleCapabilities();
        break;
      case "memory_query":
        answer = this.handleMemoryQuery(prompt);
        break;
      case "file_read": {
        const r = this.handleFileRead(prompt);
        answer = r.answer;
        if (r.usedTool) toolsUsed.push("read_file");
        break;
      }
      case "file_list": {
        const r = this.handleFileList(prompt);
        answer = r.answer;
        if (r.usedTool) toolsUsed.push("list_dir");
        break;
      }
      case "shell": {
        const r = this.handleShell(prompt);
        answer = r.answer;
        if (r.usedTool) toolsUsed.push("bash");
        break;
      }
      case "grep": {
        const r = this.handleGrep(prompt);
        answer = r.answer;
        if (r.usedTool) toolsUsed.push("grep");
        break;
      }
      case "search_files": {
        const r = this.handleSearchFiles(prompt);
        answer = r.answer;
        if (r.usedTool) toolsUsed.push("search_files");
        break;
      }
      case "git":
        answer = this.handleGit(prompt);
        break;
      case "code_analysis":
        answer = this.handleCodeAnalysis();
        break;
      case "user_preference":
        answer = this.handleUserPreference(prompt);
        break;
      case "reflection":
        answer = this.handleReflection();
        break;
      case "unknown":
      default:
        answer = this.handleUnknown(prompt);
        break;
    }

    steps.push({ type: "answer", content: answer.slice(0, 200) });
    return { steps, answer, intent, toolsUsed };
  }

  // ============================================================
  // Intent classification (ZH + EN)
  // ============================================================

  private classifyIntent(prompt: string): Intent {
    const text = prompt.toLowerCase().trim();
    const zh = /[\u4e00-\u9fa5]/.test(prompt);

    // --- Greeting ---
    if (/^(hi|hello|hey|greetings|yo|sup|你好|嗨|哈喽|早上好|下午好|晚上好|您好|早|问候)\b|^(你好|嗨|哈喽)/.test(text)) {
      return "greeting";
    }

    // --- Self assessment / status ---
    if (/(自我?评估|状态|汇报|介绍自己|自我?介绍|运行状态|你是谁|你是什么|你现在|你的情况|诊断|反省|自省)/.test(text)) return "self_assessment";
    if (/(who are you|introduce yourself|your state|status report|self.assessment|how are you doing|about yourself)/.test(text)) return "self_assessment";

    // --- Capabilities ---
    if (/(你会什么|你能做什么|有什么功能|有哪些能力|能帮我做什么|你的工具)/.test(text)) return "capabilities";
    if (/(what can you do|your capabilities|what tools|your features|what do you support)/.test(text)) return "capabilities";

    // --- Memory query ---
    if (/(你记得|你知道|回忆|上次|之前我们|我们之前|记忆\b|记录\b)/.test(text)) return "memory_query";
    if (/\b(remember|memory|do you recall|what did we|last time|previous conversation)\b/i.test(text)) return "memory_query";

    // --- Reflection ---
    if (/(反省|自省|反思|自我检查|总结)/.test(text)) return "reflection";
    if (/(reflect|self.reflection|review yourself|take stock)/.test(text)) return "reflection";

    // --- File READ ---
    if (zh && /(读取|查看|看|显示|打开|读).*[文件]?/.test(text) && /\.[a-zA-Z0-9]{1,6}/.test(text)) return "file_read";
    if (/^read\s+(?:the\s+)?(?:file\s+)?[\w\-.~\/]+|show\s+(?:me\s+)?(?:the\s+)?(?:file\s+)?[\w\-.~\/]+|what['’]?s\s+in\s+[\w\-.~\/]+/i.test(text)) return "file_read";
    if (/\.(json|ts|js|md|txt|yml|yaml|toml|ini|csv|log|py|go|rs|java|c|cpp|h|html|css)$/i.test(text) && text.length > 3) return "file_read";

    // --- File LIST ---
    if (/(列出目录|列出|有什么文件|目录|列出文件|ls\b|显示目录)/.test(text)) return "file_list";
    if (/(list (?:files|directory|dir)|ls\b|what files|what is in (?:the )?(?:current )?(?:directory|folder)|show me (?:files|directory))/i.test(text)) return "file_list";

    // --- GREP / content search ---
    if (zh && /(搜索|查找|检索|搜|找).*(内容|代码|字符串|文字|在)?/.test(text)) return "grep";
    if (/(grep\b|search\s+for|search\s+code|find\s+(?:the\s+)?(?:string|content)|look\s+for\s+(?:the\s+)?string|contain\s+text)/i.test(text)) return "grep";
    if (/^grep\b/i.test(text)) return "grep";
    if (/^(查找|搜索|搜)\s+/i.test(text)) return "grep";

    // --- Search FILES by name ---
    if (/(查找文件|找文件|搜索文件|file\s+search|find.*file|locate\s)/i.test(text)) return "search_files";

    // --- Shell / Bash ---
    if (/^(运行|执行|跑|shell\s*[:：]?|bash\s*[:：]?|命令[:：]?)\s*/.test(text)) return "shell";
    if (/^(run|execute|bash:|shell:)\s+/i.test(text)) return "shell";
    if (/(运行命令|执行命令|run the command|execute)/i.test(text)) return "shell";

    // --- Git ---
    if (/(git\s+(clone|pull|status|diff|log)|克隆\s*仓库|git\s*[:：]?)/i.test(text)) return "git";

    // --- Code analysis ---
    if (/(代码分析|分析代码|代码结构|review code|analyze code)/i.test(text)) return "code_analysis";

    // --- User preference ---
    if (zh && /(我(喜欢|偏好|想要)|你应该|记得我|我的习惯)/.test(text)) return "user_preference";
    if (/(i prefer|i like|i want you to|remember that i|my habit)/i.test(text)) return "user_preference";

    return "unknown";
  }

  // ============================================================
  // Handlers
  // ============================================================

  private handleGreeting(prompt: string): string {
    const zh = /[\u4e00-\u9fa5]/.test(prompt);
    const stats = this.memory.stats();
    if (zh) {
      return `你好。我是 ${this.identity.get().name} — ${this.identity.get().role}。\n目前有 ${stats.total} 条记忆（${stats.episodic} 事件 / ${stats.semantic} 语义 / ${stats.procedural} 能力）。\n你想聊什么？`;
    }
    return `Hi. I'm ${this.identity.get().name} — ${this.identity.get().role}.\nI have ${stats.total} memory entries (${stats.episodic} episodic / ${stats.semantic} semantic / ${stats.procedural} procedural).\nWhat would you like to explore?`;
  }

  private handleSelfAssessment(): string {
    const stats = this.memory.stats();
    const id = this.identity.summary();
    const learned = this.identity.get().learnedFromUser;

    const lines: string[] = [];
    lines.push(id);
    lines.push("");
    lines.push("---");
    lines.push(`记忆统计：${stats.total} 条`);
    lines.push(`  * 事件（episodic）：${stats.episodic}`);
    lines.push(`  * 语义（semantic）：${stats.semantic}`);
    lines.push(`  * 能力（procedural）：${stats.procedural}`);

    // Recent memories
    const recent = this.memory.query({ text: "recent", layer: "episodic", topK: 5, minSimilarity: 0.0 }).slice(0, 5);
    if (recent.length > 0) {
      lines.push("");
      lines.push("最近的 5 条记忆：");
      for (const m of recent) {
        lines.push(`  - [${m.entry.layer}] ${m.entry.content.slice(0, 120)}`);
      }
    }

    if (learned.length > 0) {
      lines.push("");
      lines.push("关于你学到的：");
      for (const l of learned.slice(0, 5)) lines.push(`  - ${l}`);
    }

    lines.push("");
    lines.push("---");
    lines.push("你可以直接问我文件、代码、shell 命令等问题 — 即使没有 LLM API key，我也能用本地工具帮你做实际工作。");

    return lines.join("\n");
  }

  private handleCapabilities(): string {
    const caps = this.identity.get().capabilities;
    const lines = ["我可以：", ""];
    for (const c of caps) lines.push(`  - ${c}`);
    lines.push("");
    lines.push("常用命令举例：");
    lines.push("  - 读取 <路径>          → 读取文件内容");
    lines.push("  - 列出目录                  → 列出当前目录文件");
    lines.push("  - grep <关键词> [路径]  → 搜索内容");
    lines.push("  - run <shell 命令>          → 执行 shell 命令");
    lines.push("  - 状态 / 自我评估           → 查看我的状态");
    return lines.join("\n");
  }

  private handleMemoryQuery(prompt: string): string {
    const memories = this.memory.query({ text: prompt, topK: 8, minSimilarity: 0.05 });
    if (memories.length === 0) {
      return "没有找到相关记忆。";
    }
    const lines = [`找到 ${memories.length} 条相关记忆：`, ""];
    for (const m of memories) {
      const ts = m.entry.createdAt ? new Date(m.entry.createdAt).toLocaleString() : "";
      lines.push(`  [${m.entry.layer}] ${m.entry.content.slice(0, 140)}  (相似度=${m.similarity.toFixed(2)}${ts ? ", " + ts : ""})`);
    }
    return lines.join("\n");
  }

  private handleFileRead(prompt: string): { answer: string; usedTool: boolean } {
    // Extract a file path from the prompt
    const path = this.extractFilePath(prompt);
    if (!path) {
      return { answer: "没有识别出文件路径。你可以直接给我文件名，例如：`读取 package.json`。", usedTool: false };
    }

    // Use tools.ts read_file for consistency
    const result = this.tools.get("read_file")?.execute({ path }) as any;
    const resolved = Promise.resolve(result);

    // Handle sync/async — actually ToolRegistry execute is async so we need to await,
    // but for simplicity we use synchronous read here too.
    // Let's use sync fallback.
    try {
      if (!existsSync(path)) return { answer: `✗ 文件不存在：${path}`, usedTool: false };
      const st = statSync(path);
      if (st.isDirectory()) return { answer: `✗ 路径是目录：${path}。用「列出目录」可以查看里面的文件。`, usedTool: false };
      const content = readFileSync(path, "utf-8");
      const preview = content.slice(0, 2000);
      const lines: string[] = [];
      lines.push(`文件：${path}`);
      lines.push(`大小：${content.length} 字符（显示前 ${preview.length}）`);
      lines.push("");
      lines.push("```");
      lines.push(preview);
      lines.push("```");
      return { answer: lines.join("\n"), usedTool: true };
    } catch (e: any) {
      return { answer: `读取失败：${e.message || e}`, usedTool: false };
    }
  }

  private handleFileList(prompt: string): { answer: string; usedTool: boolean } {
    // Try to extract a directory path
    let dir = ".";
    const match = prompt.match(/([./~\w\-]+\/[\w\-.\/]*|(?:current|this|the)\s*(?:directory|folder|目录))/i);
    if (match) {
      dir = match[1].replace(/^(current|this|the)\s*(?:directory|folder|目录)$/i, ".");
    }

    try {
      if (!existsSync(dir)) return { answer: `✗ 目录不存在：${dir}`, usedTool: false };
      const st = statSync(dir);
      if (!st.isDirectory()) return { answer: `✗ 不是目录：${dir}`, usedTool: false };

      const result = spawnSync("ls", ["-lah", dir], { encoding: "utf-8", timeout: 5000 });
      const output = (result.stdout || "").slice(0, 2500);
      return {
        answer: `目录：${dir}\n\`\`\`\n${output || "(空)"}\n\`\`\``,
        usedTool: true,
      };
    } catch (e: any) {
      return { answer: `列出目录失败：${e.message || e}`, usedTool: false };
    }
  }

  private handleShell(prompt: string): { answer: string; usedTool: boolean } {
    // Strip leading trigger word
    let cmd = prompt
      .replace(/^(运行|执行|跑|run\s+|execute\s+|bash[:：]?\s*|shell[:：]?\s*|命令[:：]?\s*)/i, "")
      .trim();

    if (!cmd) return { answer: "请告诉我要运行什么命令，例如：`run ls -la`", usedTool: false };

    // Security check
    const dangerous = [
      /rm\s+-rf\s+(\/\s*|~|\*)$/,
      /\bsudo\b/,
      /\bmkfs\b/,
      /\bdd\b.*of=\/dev/,
      />\s*\/dev\/sd/,
    ];
    for (const re of dangerous) {
      if (re.test(cmd)) return { answer: `✗ 这个命令太危险了，我不会执行：\`${cmd}\``, usedTool: false };
    }

    try {
      const result = spawnSync("sh", ["-c", cmd], {
        encoding: "utf-8",
        timeout: 15000,
        maxBuffer: 5 * 1024 * 1024,
      });
      const stdout = (result.stdout || "").slice(0, 3000);
      const stderr = (result.stderr || "").slice(0, 1000);
      const parts: string[] = [];
      parts.push(`命令：\`${cmd}\``);
      if (result.status !== 0) parts.push(`退出码：${result.status}`);
      if (stdout) {
        parts.push("");
        parts.push("stdout:");
        parts.push("```");
        parts.push(stdout);
        parts.push("```");
      }
      if (stderr) {
        parts.push("");
        parts.push("stderr:");
        parts.push("```");
        parts.push(stderr);
        parts.push("```");
      }
      return { answer: parts.join("\n"), usedTool: true };
    } catch (e: any) {
      return { answer: `执行失败：${e.message || e}`, usedTool: false };
    }
  }

  private handleGrep(prompt: string): { answer: string; usedTool: boolean } {
    // Try to extract keyword and optional path
    const zh = /[\u4e00-\u9fa5]/.test(prompt);
    let keyword = "";
    let searchPath = ".";

    // English: "grep KEYWORD in PATH" or "search for KEYWORD"
    const grepMatch = prompt.match(/grep\s+(?:for\s+)?["'`]?([^"'\s]+)["'`]?(?:\s+(?:in|at|in\s+directory)\s+["'`]?([\w.\-/~]+))?/i);
    if (grepMatch) {
      keyword = grepMatch[1];
      if (grepMatch[2]) searchPath = grepMatch[2];
    }

    // Chinese: try "搜索 <关键词> [在 <路径>]"
    if (!keyword) {
      const zhMatch = prompt.match(/(?:搜索|查找|搜索内容|找|查找内容)\s*["'`]?([^"'\s,，。]+)/);
      if (zhMatch) keyword = zhMatch[1];
      const pathMatch = prompt.match(/(?:在|于|从)\s*["'`]?([\w.\-/~]+)/);
      if (pathMatch) searchPath = pathMatch[1];
    }

    // Fallback: quoted string
    if (!keyword) {
      const q = prompt.match(/["'`]([^"'`]{1,40})["'`]/);
      if (q) keyword = q[1];
    }

    if (!keyword) {
      return { answer: zh ? "请提供关键词。用法：`搜索 <关键词> [在 <路径>]`" : "Tell me what to search for. Usage: `grep <keyword> [in <path>]`", usedTool: false };
    }

    try {
      if (!existsSync(searchPath)) return { answer: `✗ 路径不存在：${searchPath}`, usedTool: false };
      const result = spawnSync("grep", ["-rn", "--include=*.ts", "--include=*.js", "--include=*.md", "--include=*.json", keyword, searchPath], {
        encoding: "utf-8",
        timeout: 10000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const lines = (result.stdout || "").trim().split("\n").filter(Boolean).slice(0, 30);
      if (lines.length === 0) {
        return { answer: `在 \`${searchPath}\` 中没有找到 "${keyword}"。`, usedTool: true };
      }
      const out: string[] = [];
      out.push(`找到 ${lines.length} 处匹配（关键词：\`${keyword}\`，路径：\`${searchPath}\`）：`);
      out.push("");
      out.push("```");
      out.push(...lines);
      out.push("```");
      return { answer: out.join("\n"), usedTool: true };
    } catch (e: any) {
      return { answer: `搜索失败：${e.message || e}`, usedTool: false };
    }
  }

  private handleSearchFiles(prompt: string): { answer: string; usedTool: boolean } {
    const zh = /[\u4e00-\u9fa5]/.test(prompt);
    // Extract pattern: quoted or last word-ish
    const q = prompt.match(/["'`]([^"'`]{1,80})["'`]/) || prompt.match(/(?:find|search\s+for|search|找|查找文件)\s+["'`]?([\w.\-*]{2,80})/i);
    const pattern = q ? q[1] : "";

    if (!pattern) return { answer: zh ? "告诉我要找什么文件名。用法：`找文件 <pattern>`" : "Tell me what filename to look for.", usedTool: false };

    try {
      const result = spawnSync("find", [".", "-name", pattern, "-type", "f"], {
        encoding: "utf-8",
        timeout: 10000,
      });
      const files = (result.stdout || "").trim().split("\n").filter(Boolean).slice(0, 50);
      if (files.length === 0) return { answer: `没有找到匹配 "${pattern}" 的文件。`, usedTool: true };
      const out: string[] = [`找到 ${files.length} 个文件：`, ""];
      for (const f of files) out.push(`  - ${f}`);
      return { answer: out.join("\n"), usedTool: true };
    } catch (e: any) {
      return { answer: `查找文件失败：${e.message || e}`, usedTool: false };
    }
  }

  private handleGit(prompt: string): string {
    const match = prompt.match(/git\s+(clone|pull|status|diff|log)(?:\s+["'`]?([^\s"'`]+))?/i);
    if (!match) return "无法识别 git 命令。用法：`git clone <url>` / `git status`";
    const cmd = match[1].toLowerCase();
    const arg = match[2] || "";

    if (cmd === "clone" && arg) {
      try {
        const result = spawnSync("git", ["clone", arg], { encoding: "utf-8", timeout: 60000 });
        return `\`git clone ${arg}\`\n\`\`\`\n${(result.stdout || "") + (result.stderr || "")}\n\`\`\``;
      } catch (e: any) {
        return `git clone 失败：${e.message || e}`;
      }
    }
    if (cmd === "status") {
      const result = spawnSync("git", ["status"], { encoding: "utf-8", timeout: 10000 });
      return `\`git status\`\n\`\`\`\n${result.stdout || result.stderr || "(no output)"}\n\`\`\``;
    }
    if (cmd === "diff") {
      const result = spawnSync("git", ["diff"], { encoding: "utf-8", timeout: 10000 });
      return `\`git diff\`\n\`\`\`\n${(result.stdout || "").slice(0, 3000) || result.stderr || "(clean)"}\n\`\`\``;
    }
    if (cmd === "pull") {
      const result = spawnSync("git", ["pull"], { encoding: "utf-8", timeout: 30000 });
      return `\`git pull\`\n\`\`\`\n${(result.stdout || "") + (result.stderr || "")}\n\`\`\``;
    }
    if (cmd === "log") {
      const result = spawnSync("git", ["log", "--oneline", "-n", "10"], { encoding: "utf-8", timeout: 10000 });
      return `\`git log\`\n\`\`\`\n${result.stdout || result.stderr || "(no output)"}\n\`\`\``;
    }
    return `支持的 git 命令：clone / pull / status / diff / log`;
  }

  private handleCodeAnalysis(): string {
    // Scan src directory and summarize
    try {
      const result = spawnSync("find", ["src", "-type", "f", "-name", "*.ts"], { encoding: "utf-8", timeout: 5000 });
      const files = (result.stdout || "").trim().split("\n").filter(Boolean);
      if (files.length === 0) return "没有在 src/ 下找到 .ts 文件。";

      let totalLines = 0;
      const byFile: Array<{ file: string; lines: number }> = [];
      for (const f of files.slice(0, 20)) {
        try {
          const content = readFileSync(f, "utf-8");
          const lines = content.split("\n").length;
          totalLines += lines;
          byFile.push({ file: f, lines });
        } catch { /* skip */ }
      }
      const out: string[] = [];
      out.push(`代码分析（src/ 下 ${files.length} 个 ts 文件，共约 ${totalLines} 行）：`);
      out.push("");
      for (const { file, lines } of byFile.sort((a, b) => b.lines - a.lines).slice(0, 15)) {
        out.push(`  - ${file} (${lines} 行)`);
      }
      return out.join("\n");
    } catch (e: any) {
      return `代码分析失败：${e.message || e}`;
    }
  }

  private handleUserPreference(prompt: string): string {
    // Store as observation in identity
    const zh = /[\u4e00-\u9fa5]/.test(prompt);
    this.identity.recordObservation(prompt.slice(0, 180));
    if (zh) {
      return `好的，我记下来了：「${prompt.slice(0, 80)}…」`;
    }
    return `Got it, I'll remember: "${prompt.slice(0, 80)}…"`;
  }

  private handleReflection(): string {
    const stats = this.memory.stats();
    const caps = this.memory.query({ text: "capability", layer: "procedural", topK: 5, minSimilarity: 0.01 });
    const recent = this.memory.query({ text: "result", layer: "episodic", topK: 5, minSimilarity: 0.01 });

    const lines: string[] = [];
    lines.push("## 自省");
    lines.push(`记忆总量：${stats.total}`);
    if (caps.length > 0) {
      lines.push("提炼到的能力：");
      for (const c of caps) lines.push(`  - ${c.entry.content.slice(0, 100)}`);
    }
    if (recent.length > 0) {
      lines.push("");
      lines.push("最近的交互：");
      for (const r of recent) lines.push(`  - ${r.entry.content.slice(0, 120)}`);
    }
    lines.push("");
    lines.push("改进方向：");
    lines.push("  * 更多真实交互 → 更丰富的记忆/能力数据");
    lines.push("  * 配置真实 LLM API key → 启用更智能的推理链");
    return lines.join("\n");
  }

  private handleUnknown(prompt: string): string {
    const zh = /[\u4e00-\u9fa5]/.test(prompt);
    // Fuzzy hint
    const hint = zh
      ? `我暂时没有完全理解：「${prompt.slice(0, 60)}…」。\n\n可以试试：\n  - 读取 <文件名>  → 看文件内容\n  - 列出目录 / ls .\n  - 搜索 <关键词>\n  - run <shell 命令>\n  - 状态 / 自省\n  - 或者告诉我你想做什么，我会尽力。`
      : `I didn't fully understand: "${prompt.slice(0, 60)}…".\n\nTry:\n  - read <file>\n  - list files in this directory\n  - grep <keyword>\n  - run <shell command>\n  - ask about my status / capabilities`;
    return hint;
  }

  // ============================================================
  // Helpers
  // ============================================================

  private extractFilePath(prompt: string): string | null {
    // Strip common prefixes
    const cleaned = prompt
      .replace(/^(读取|查看|读|看|打开|显示|read(?:\s+the)?(?:\s+file)?|show(?:\s+me)?(?:\s+file)?|what(?:'?s| is) in)\s+/i, "")
      .trim();

    // Quoted path
    const quoted = cleaned.match(/^["'`“”]([^"'`“”]+)["'`“”]/);
    if (quoted) return quoted[1].trim();

    // A token that looks like a file path
    const candidates = cleaned.split(/\s+/).filter(
      t => /(\.[a-z0-9]{1,6}|[\/\\~]|^\.{1,2}\/)/i.test(t) || /^[\w.\-~\/]+\.[a-z0-9]{1,6}$/i.test(t)
    );
    if (candidates.length > 0) {
      // Prefer an existing path
      for (const c of candidates) {
        if (existsSync(c)) return c;
      }
      return candidates[0];
    }

    // Fallback: whole trimmed prompt
    if (cleaned.length < 300 && cleaned.length > 2) {
      const single = cleaned.split(/\s+/)[0];
      if (existsSync(single)) return single;
    }
    return null;
  }
}
