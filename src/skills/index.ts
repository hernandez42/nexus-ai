/**
 * Nexus Skill System — 真正的技能执行框架
 *
 * 核心设计：
 * - Skill = 可注册、可执行、可验证的能力单元
 * - 不是 LLM 生成的文本，而是实际执行的代码
 * - 每个 skill 有输入验证、执行逻辑、输出验证
 * - Skill 可以组合（一个 skill 调用另一个 skill）
 *
 * 与 LLM 的关系：
 * - LLM 决定调用哪个 skill（意图识别）
 * - Skill 执行实际工作（代码执行）
 * - LLM 只处理 skill 无法覆盖的边缘情况
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";

// ============================================================
// Skill 类型定义
// ============================================================

export interface SkillParam {
  name: string;
  type: "string" | "number" | "boolean" | "path" | "url" | "json";
  required: boolean;
  description: string;
  default?: unknown;
}

export interface SkillDef {
  name: string;
  description: string;
  params: SkillParam[];
  execute: (params: Record<string, unknown>, context: SkillContext) => Promise<SkillResult>;
}

export interface SkillResult {
  success: boolean;
  output: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface SkillContext {
  cwd: string;
  env: Record<string, string>;
  log: (msg: string) => void;
}

// ============================================================
// Skill Registry
// ============================================================

export class SkillRegistry {
  private skills: Map<string, SkillDef> = new Map();

  register(skill: SkillDef): void {
    this.skills.set(skill.name, skill);
  }

  get(name: string): SkillDef | undefined {
    return this.skills.get(name);
  }

  list(): string[] {
    return Array.from(this.skills.keys());
  }

  async execute(name: string, params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const skill = this.skills.get(name);
    if (!skill) {
      return { success: false, output: "", error: `Skill not found: ${name}` };
    }

    // Validate params
    const validation = this.validateParams(skill.params, params);
    if (!validation.valid) {
      return { success: false, output: "", error: validation.error };
    }

    // Execute
    try {
      const result = await skill.execute(params, context);
      return result;
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      return { success: false, output: "", error: `Execution failed: ${err}` };
    }
  }

  private validateParams(defs: SkillParam[], params: Record<string, unknown>): { valid: boolean; error?: string } {
    for (const def of defs) {
      if (def.required && !(def.name in params)) {
        return { valid: false, error: `Missing required param: ${def.name}` };
      }
      const value = params[def.name];
      if (value !== undefined) {
        if (def.type === "path" && typeof value === "string") {
          // Path validation: prevent directory traversal
          if (value.includes("..") || value.startsWith("/")) {
            return { valid: false, error: `Invalid path (traversal attempt): ${def.name}` };
          }
        }
        if (def.type === "url" && typeof value === "string") {
          // URL validation: only allow http/https
          if (!/^https?:\/\//.test(value)) {
            return { valid: false, error: `Invalid URL (must be http/https): ${def.name}` };
          }
        }
      }
    }
    return { valid: true };
  }
}

// ============================================================
// Built-in Skills
// ============================================================

export function createDefaultSkills(): SkillRegistry {
  const registry = new SkillRegistry();

  // --- Git Skill ---
  registry.register({
    name: "git_clone",
    description: "Clone a Git repository to a local directory",
    params: [
      { name: "url", type: "url", required: true, description: "Repository URL (https only)" },
      { name: "dest", type: "path", required: false, description: "Destination directory (relative to cwd)", default: "." },
      { name: "branch", type: "string", required: false, description: "Branch to checkout", default: "main" },
    ],
    execute: async (params, ctx) => {
      const url = String(params.url);
      const dest = String(params.dest || ".");
      const branch = String(params.branch || "main");
      const targetPath = resolve(ctx.cwd, dest);

      try {
        // Check if already exists
        if (existsSync(join(targetPath, ".git"))) {
          // Pull instead
          execSync(`git -C "${targetPath}" pull origin ${branch}`, {
            encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"],
          });
          return { success: true, output: `Pulled ${url} to ${targetPath}` };
        }

        // Clone
        mkdirSync(dirname(targetPath), { recursive: true });
        execSync(`git clone --branch ${branch} --single-branch "${url}" "${targetPath}"`, {
          encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"],
        });
        return { success: true, output: `Cloned ${url} to ${targetPath}` };
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : String(e);
        return { success: false, output: "", error: `Git clone failed: ${err}` };
      }
    },
  });

  registry.register({
    name: "git_diff",
    description: "Get git diff for a repository",
    params: [
      { name: "path", type: "path", required: false, description: "Repository path", default: "." },
      { name: "staged", type: "boolean", required: false, description: "Show staged changes", default: false },
    ],
    execute: async (params, ctx) => {
      const repoPath = resolve(ctx.cwd, String(params.path || "."));
      const staged = Boolean(params.staged);
      try {
        const cmd = staged ? "git diff --cached" : "git diff";
        const out = execSync(cmd, {
          cwd: repoPath, encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"],
        });
        return { success: true, output: out.slice(0, 8000) };
      } catch (e: unknown) {
        return { success: false, output: "", error: `Git diff failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  // --- File Skill ---
  registry.register({
    name: "file_read",
    description: "Read a file's contents",
    params: [
      { name: "path", type: "path", required: true, description: "File path (relative to cwd)" },
      { name: "offset", type: "number", required: false, description: "Line offset", default: 0 },
      { name: "limit", type: "number", required: false, description: "Max lines", default: 200 },
    ],
    execute: async (params, ctx) => {
      const filePath = resolve(ctx.cwd, String(params.path));
      const offset = Number(params.offset || 0);
      const limit = Number(params.limit || 200);

      if (!existsSync(filePath)) {
        return { success: false, output: "", error: `File not found: ${params.path}` };
      }

      try {
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n");
        const slice = lines.slice(offset, offset + limit).join("\n");
        return {
          success: true,
          output: slice,
          data: { totalLines: lines.length, path: params.path },
        };
      } catch (e: unknown) {
        return { success: false, output: "", error: `Read failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registry.register({
    name: "file_write",
    description: "Write content to a file",
    params: [
      { name: "path", type: "path", required: true, description: "File path (relative to cwd)" },
      { name: "content", type: "string", required: true, description: "Content to write" },
      { name: "append", type: "boolean", required: false, description: "Append instead of overwrite", default: false },
    ],
    execute: async (params, ctx) => {
      const filePath = resolve(ctx.cwd, String(params.path));
      const content = String(params.content);
      const append = Boolean(params.append);

      try {
        mkdirSync(dirname(filePath), { recursive: true });
        if (append) {
          writeFileSync(filePath, content, { flag: "a" });
        } else {
          writeFileSync(filePath, content);
        }
        return { success: true, output: `Wrote ${content.length} chars to ${params.path}` };
      } catch (e: unknown) {
        return { success: false, output: "", error: `Write failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  registry.register({
    name: "file_list",
    description: "List files in a directory",
    params: [
      { name: "path", type: "path", required: false, description: "Directory path", default: "." },
      { name: "recursive", type: "boolean", required: false, description: "Recursive listing", default: false },
      { name: "pattern", type: "string", required: false, description: "Glob pattern filter", default: "*" },
    ],
    execute: async (params, ctx) => {
      const dirPath = resolve(ctx.cwd, String(params.path || "."));
      const recursive = Boolean(params.recursive);
      const pattern = String(params.pattern || "*");

      if (!existsSync(dirPath)) {
        return { success: false, output: "", error: `Directory not found: ${params.path}` };
      }

      try {
        const files: string[] = [];
        const walk = (dir: string, prefix: string) => {
          for (const entry of readdirSync(dir)) {
            const fullPath = join(dir, entry);
            const relPath = prefix ? join(prefix, entry) : entry;
            const stat = statSync(fullPath);
            if (stat.isDirectory() && recursive) {
              walk(fullPath, relPath);
            } else if (stat.isFile()) {
              if (pattern === "*" || entry.includes(pattern.replace(/\*/g, ""))) {
                files.push(relPath);
              }
            }
          }
        };
        walk(dirPath, "");
        return { success: true, output: files.join("\n"), data: { count: files.length } };
      } catch (e: unknown) {
        return { success: false, output: "", error: `List failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  // --- Code Analysis Skill ---
  registry.register({
    name: "code_stats",
    description: "Analyze code statistics for a directory",
    params: [
      { name: "path", type: "path", required: false, description: "Directory path", default: "." },
      { name: "extensions", type: "string", required: false, description: "File extensions (comma separated)", default: "ts,js,json,md" },
    ],
    execute: async (params, ctx) => {
      const dirPath = resolve(ctx.cwd, String(params.path || "."));
      const exts = String(params.extensions || "ts,js,json,md").split(",").map(e => e.trim());

      if (!existsSync(dirPath)) {
        return { success: false, output: "", error: `Directory not found: ${params.path}` };
      }

      const stats = { files: 0, lines: 0, byExt: {} as Record<string, { files: number; lines: number }> };

      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const fullPath = join(dir, entry);
          const stat = statSync(fullPath);
          if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
            walk(fullPath);
          } else if (stat.isFile()) {
            const ext = entry.split(".").pop() || "unknown";
            if (exts.includes(ext)) {
              stats.files++;
              const content = readFileSync(fullPath, "utf8");
              const lines = content.split("\n").length;
              stats.lines += lines;
              if (!stats.byExt[ext]) stats.byExt[ext] = { files: 0, lines: 0 };
              stats.byExt[ext].files++;
              stats.byExt[ext].lines += lines;
            }
          }
        }
      };

      try {
        walk(dirPath);
        const lines = [
          `Files: ${stats.files} | Lines: ${stats.lines}`,
          "By extension:",
          ...Object.entries(stats.byExt).map(([ext, s]) => `  .${ext}: ${s.files} files, ${s.lines} lines`),
        ];
        return { success: true, output: lines.join("\n"), data: stats };
      } catch (e: unknown) {
        return { success: false, output: "", error: `Analysis failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  // --- Bash Skill (restricted) ---
  registry.register({
    name: "bash",
    description: "Execute a bash command",
    params: [
      { name: "command", type: "string", required: true, description: "Command to execute" },
      { name: "timeout", type: "number", required: false, description: "Timeout in ms", default: 30000 },
    ],
    execute: async (params, ctx) => {
      const command = String(params.command);
      const timeout = Number(params.timeout || 30000);

      // Security: block dangerous commands
      const blocked = ["rm -rf /", "mkfs", "dd if=/dev/zero", ":(){ :|:& };:", "> /dev/sda"];
      if (blocked.some(b => command.includes(b))) {
        return { success: false, output: "", error: "Blocked dangerous command" };
      }

      try {
        const out = execSync(command, {
          cwd: ctx.cwd, encoding: "utf8", timeout,
          stdio: ["ignore", "pipe", "pipe"],
        });
        return { success: true, output: out.slice(0, 5000) };
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : String(e);
        return { success: false, output: "", error: `Command failed: ${err}` };
      }
    },
  });

  return registry;
}
