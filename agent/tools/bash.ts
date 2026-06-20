import { defineTool } from "eve/tools";
import { z } from "zod";
import { spawnSync } from "child_process";

const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/\s*$/,
  /sudo\b/,
  /mkfs\b/,
  /\bdd\b.*of=\/dev/,
  />\s*\/dev\/sd/,
];

export default defineTool({
  description: "Execute a shell command safely. Blocks destructive commands.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute"),
    cwd: z.string().optional().describe("Working directory"),
    timeout: z.number().min(1000).max(60000).optional().describe("Timeout in milliseconds"),
  }),
  async execute(input) {
    // Security check
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(input.command)) {
        return { error: "Command blocked by security policy", exitCode: 126 };
      }
    }

    const result = spawnSync("sh", ["-c", input.command], {
      encoding: "utf-8",
      timeout: input.timeout || 30000,
      cwd: input.cwd || process.cwd(),
      maxBuffer: 5 * 1024 * 1024,
    });

    return {
      output: (result.stdout || "").slice(0, 5000),
      exitCode: result.status || 0,
      stderr: (result.stderr || "").slice(0, 1000),
    };
  },
});
