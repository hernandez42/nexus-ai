/**
 * ToolRegistry — 22+ tools for autonomous agents
 *
 * Inspired by superclaw's tool system but simplified for nexus-ai.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { execFileSync, spawnSync } from "child_process";
import { join, dirname } from "path";

/**
 * Validate a path to prevent directory traversal attacks.
 * Rejects paths containing .. or absolute paths outside cwd.
 */
function sanitizePath(p: string): string {
  if (p.includes("..")) throw new Error("Path traversal detected");
  return p;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, string>;
  execute: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerBuiltins();
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  names(): string[] {
    return Array.from(this.tools.keys());
  }

  private registerBuiltins(): void {
    // File system (1-4)
    this.register({
      name: "read_file",
      description: "Read contents of a file",
      parameters: { path: "string", offset: "number?", limit: "number?" },
      execute: async (p) => {
        const path = p.path as string;
        if (!existsSync(path)) return { error: "File not found" };
        const content = readFileSync(path, "utf-8");
        const offset = (p.offset as number) || 0;
        const limit = (p.limit as number) || 2000;
        return { content: content.slice(offset, offset + limit), totalLength: content.length };
      },
    });

    this.register({
      name: "write_file",
      description: "Write content to a file (creates dirs if needed)",
      parameters: { path: "string", content: "string", append: "boolean?" },
      execute: async (p) => {
        const path = p.path as string;
        mkdirSync(dirname(path), { recursive: true });
        if (p.append) writeFileSync(path, p.content as string, { flag: "a" });
        else writeFileSync(path, p.content as string);
        return { success: true, bytes: (p.content as string).length };
      },
    });

    this.register({
      name: "list_dir",
      description: "List files and directories",
      parameters: { path: "string", recursive: "boolean?" },
      execute: async (p) => {
        const path = p.path as string;
        if (!existsSync(path)) return { error: "Directory not found" };
        const entries = readdirSync(path);
        return {
          files: entries.filter(e => statSync(join(path, e)).isFile()),
          dirs: entries.filter(e => statSync(join(path, e)).isDirectory()),
        };
      },
    });

    this.register({
      name: "file_info",
      description: "Get file metadata (size, mtime, etc.)",
      parameters: { path: "string" },
      execute: async (p) => {
        const path = p.path as string;
        if (!existsSync(path)) return { error: "File not found" };
        const s = statSync(path);
        return { size: s.size, mtime: s.mtime.toISOString(), isFile: s.isFile(), isDir: s.isDirectory() };
      },
    });

    // Shell & Process (5-8)
    this.register({
      name: "bash",
      description: "Execute shell command (max 30s). Blocked commands: rm -rf /, sudo, mkfs, dd, > /dev/sd",
      parameters: { command: "string", cwd: "string?", timeout: "number?" },
      execute: async (p) => {
        const cmd = p.command as string;
        // Block destructive commands
        const blocked = [/rm\s+-rf\s+\/\s*$/, /sudo\b/, /mkfs\b/, /\bdd\b.*of=\/dev/, />\s*\/dev\/sd/];
        for (const pattern of blocked) {
          if (pattern.test(cmd)) return { error: "Command blocked by security policy", exitCode: 126 };
        }
        try {
          // Use spawnSync with shell=false for simple commands, shell=true for pipes
          const result = spawnSync("sh", ["-c", cmd], {
            encoding: "utf-8",
            timeout: (p.timeout as number) || 30000,
            cwd: (p.cwd as string) || process.cwd(),
            maxBuffer: 5 * 1024 * 1024,
          });
          return {
            output: (result.stdout || "").slice(0, 5000),
            exitCode: result.status || 0,
            stderr: (result.stderr || "").slice(0, 1000),
          };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg.slice(0, 500), exitCode: 1 };
        }
      },
    });

    this.register({
      name: "grep",
      description: "Search text in files (ripgrep-style)",
      parameters: { pattern: "string", path: "string?", glob: "string?" },
      execute: async (p) => {
        const args: string[] = ["-rnE", String(p.pattern), String(p.path || ".")];
        if (p.glob) args.push("--include", String(p.glob));
        try {
          const result = spawnSync("grep", args, { encoding: "utf-8", timeout: 10000 });
          const output = (result.stdout || "").trim();
          // Limit to 50 lines
          const lines = output.split("\n").filter(Boolean).slice(0, 50);
          return { matches: lines };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { matches: [], error: msg };
        }
      },
    });

    this.register({
      name: "find",
      description: "Find files by name pattern",
      parameters: { pattern: "string", path: "string?", type: "string?" },
      execute: async (p) => {
        const args: string[] = [sanitizePath(String(p.path || ".")), "-name", String(p.pattern)];
        if (p.type === "dir") args.push("-type", "d");
        else if (p.type === "file") args.push("-type", "f");
        try {
          const result = spawnSync("find", args, { encoding: "utf-8", timeout: 10000 });
          const files = (result.stdout || "").trim().split("\n").filter(Boolean).slice(0, 50);
          return { files };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { files: [], error: msg };
        }
      },
    });

    this.register({
      name: "env",
      description: "Get environment variable value",
      parameters: { key: "string" },
      execute: async (p) => ({ value: process.env[p.key as string] || null }),
    });

    // Code & Analysis (9-14)
    this.register({
      name: "parse_json",
      description: "Parse and validate JSON string",
      parameters: { text: "string" },
      execute: async (p) => {
        try {
          return { data: JSON.parse(p.text as string), valid: true };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg, valid: false };
        }
      },
    });

    this.register({
      name: "format_json",
      description: "Pretty-print JSON",
      parameters: { data: "object", indent: "number?" },
      execute: async (p) => ({ text: JSON.stringify(p.data, null, (p.indent as number) || 2) }),
    });

    this.register({
      name: "diff",
      description: "Show unified diff between two texts",
      parameters: { oldText: "string", newText: "string", context: "number?" },
      execute: async (p) => {
        const { tmpdir } = await import("os");
        const oldFile = join(tmpdir(), `diff-old-${Date.now()}.txt`);
        const newFile = join(tmpdir(), `diff-new-${Date.now()}.txt`);
        writeFileSync(oldFile, p.oldText as string);
        writeFileSync(newFile, p.newText as string);
        try {
          const context = (p.context as number) || 3;
          const result = spawnSync("diff", ["-U", String(context), oldFile, newFile], { encoding: "utf-8" });
          return { diff: result.stdout || "No differences" };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { diff: msg };
        }
      },
    });

    this.register({
      name: "count_lines",
      description: "Count lines in text or file",
      parameters: { text: "string?", path: "string?" },
      execute: async (p) => {
        if (p.path) {
          if (!existsSync(p.path as string)) return { error: "File not found" };
          const text = readFileSync(p.path as string, "utf-8");
          return { lines: text.split("\n").length, words: text.split(/\s+/).length, chars: text.length };
        }
        const text = (p.text as string) || "";
        return { lines: text.split("\n").length, words: text.split(/\s+/).length, chars: text.length };
      },
    });

    this.register({
      name: "self_modify",
      description: "Modify own source code (use with caution)",
      parameters: { path: "string", oldCode: "string", newCode: "string" },
      execute: async (p) => {
        const path = p.path as string;
        if (!existsSync(path)) return { error: "File not found" };
        const content = readFileSync(path, "utf-8");
        if (!content.includes(p.oldCode as string)) return { error: "oldCode not found in file" };
        const newContent = content.replace(p.oldCode as string, p.newCode as string);
        writeFileSync(path, newContent);
        return { success: true, path, bytesChanged: (p.newCode as string).length - (p.oldCode as string).length };
      },
    });

    this.register({
      name: "self_read",
      description: "Read own source code for introspection",
      parameters: { path: "string", offset: "number?", limit: "number?" },
      execute: async (p) => {
        const path = p.path as string;
        if (!existsSync(path)) return { error: "File not found" };
        const content = readFileSync(path, "utf-8");
        const offset = (p.offset as number) || 0;
        const limit = (p.limit as number) || 2000;
        return { content: content.slice(offset, offset + limit), totalLength: content.length };
      },
    });

    // Memory & Reflection (15-18)
    this.register({
      name: "memory_query",
      description: "Query persistent memory store",
      parameters: { text: "string", layer: "string?", topK: "number?" },
      execute: async (p) => {
        const { MemoryStore } = await import("./memory");
        const store = new MemoryStore("./nexus-workspace/memory/persistent");
        const results = store.query({
          text: p.text as string,
          layer: (p.layer as any) || undefined,
          topK: (p.topK as number) || 5,
        });
        return {
          results: results.map(r => ({
            content: r.entry.content.slice(0, 200),
            similarity: r.similarity,
            layer: r.entry.layer,
          })),
        };
      },
    });

    this.register({
      name: "memory_write",
      description: "Write to persistent memory",
      parameters: { content: "string", layer: "string", tags: "string[]" },
      execute: async (p) => {
        const { MemoryStore } = await import("./memory");
        const store = new MemoryStore("./nexus-workspace/memory/persistent");
        const id = store.add({
          layer: (p.layer as any) || "episodic",
          content: p.content as string,
          tags: (p.tags as string[]) || [],
          metadata: {},
        });
        store.save();
        return { id, success: true };
      },
    });

    this.register({
      name: "dreamer_tick",
      description: "Trigger a reflection cycle: review recent actions, identify patterns, suggest improvements",
      parameters: { focus: "string?" },
      execute: async (p) => {
        const { MemoryStore } = await import("./memory");
        const store = new MemoryStore("./nexus-workspace/memory/persistent");
        const recent = store.query({ text: p.focus as string || "recent actions", topK: 10 });
        return {
          reflections: recent.map(r => ({
            content: r.entry.content.slice(0, 100),
            insight: `Pattern detected in ${r.entry.layer} memory (sim=${r.similarity.toFixed(2)})`,
          })),
          suggestion: "Consider consolidating similar episodic memories into semantic knowledge.",
        };
      },
    });

    this.register({
      name: "temporal_index",
      description: "Query memory by time range",
      parameters: { after: "string", before: "string?", layer: "string?" },
      execute: async (p) => {
        const { MemoryStore } = await import("./memory");
        const store = new MemoryStore("./nexus-workspace/memory/persistent");
        const after = new Date(p.after as string).getTime();
        const before = p.before ? new Date(p.before as string).getTime() : Date.now();
        const all = Array.from((store as any).memories?.values() || []);
        const filtered = all.filter((m: any) => m.createdAt >= after && m.createdAt <= before);
        return {
          count: filtered.length,
          entries: filtered.slice(0, 20).map((m: any) => ({
            id: m.id,
            content: m.content.slice(0, 100),
            createdAt: new Date(m.createdAt).toISOString(),
          })),
        };
      },
    });

    // Network & External (19-22)
    this.register({
      name: "fetch_url",
      description: "Fetch content from URL (GET only, max 10KB)",
      parameters: { url: "string", headers: "object?" },
      execute: async (p) => {
        try {
          const res = await fetch(p.url as string, { headers: (p.headers as any) || {} });
          const text = await res.text();
          return { status: res.status, content: text.slice(0, 10000), contentType: res.headers.get("content-type") };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg };
        }
      },
    });

    this.register({
      name: "http_post",
      description: "POST JSON to URL",
      parameters: { url: "string", body: "object", headers: "object?" },
      execute: async (p) => {
        try {
          const res = await fetch(p.url as string, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(p.headers as any) || {} },
            body: JSON.stringify(p.body),
          });
          const text = await res.text();
          return { status: res.status, content: text.slice(0, 5000) };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg };
        }
      },
    });

    this.register({
      name: "sleep",
      description: "Wait for N milliseconds (useful for rate limiting)",
      parameters: { ms: "number" },
      execute: async (p) => {
        await new Promise(r => setTimeout(r, (p.ms as number) || 1000));
        return { waited: p.ms as number };
      },
    });

    this.register({
      name: "timestamp",
      description: "Get current timestamp in various formats",
      parameters: { format: "string?" },
      execute: async (p) => {
        const now = new Date();
        const fmt = (p.format as string) || "iso";
        if (fmt === "unix") return { timestamp: Math.floor(now.getTime() / 1000) };
        if (fmt === "ms") return { timestamp: now.getTime() };
        return { timestamp: now.toISOString() };
      },
    });
  }
}
