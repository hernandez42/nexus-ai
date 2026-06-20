/**
 * Glue 2: Evolver GEP Genes → Pi-Mono Extension Bridge
 *
 * Reads Evolver's genes.json and generates a Pi-Mono extension
 * that dynamically loads Gene strategies as system prompt injections
 * and enforces Gene constraints as tool-call interceptors.
 *
 * Key findings from real source code analysis:
 * - Evolver Gene: { type, id, category, signals_match[], strategy[], constraints, validation[], anti_patterns[], routing_hint, tool_policy }
 * - Pi-Mono Extension: exports default function(pi: ExtensionAPI) with pi.on(), pi.registerTool(), etc.
 * - signals_match uses pipe-separated multi-language patterns: "error|错误|异常"
 * - strategy[] is ordered steps for LLM to interpret
 * - Gene is "soft control" (LLM interprets), Extension is "hard control" (code executes)
 * - We bridge by: signals_match → before_agent_start event matching, strategy → systemPrompt injection
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// ============================================================
// Evolver Gene type (from /workspace/evolver/src/gep/schemas/gene.js)
// ============================================================

export interface EvolverGene {
  type: "Gene";
  id: string;
  category: "repair" | "optimize" | "innovate" | "explore";
  signals_match: string[];
  preconditions?: string[];
  strategy: string[];
  constraints: {
    max_files: number;
    forbidden_paths: string[];
    [key: string]: unknown;
  };
  validation: string[];
  summary?: string;
  schema_version?: string;
  epigenetic_marks?: unknown[];
  learning_history?: unknown[];
  anti_patterns?: string[];
  routing_hint?: {
    tier: "cheap" | "mid" | "expensive";
    reasoning_level: "off" | "low" | "medium" | "high";
  } | null;
  tool_policy?: {
    allow_only?: string[];
    deny?: string[];
    severity: "warn" | "block";
  } | null;
  asset_id?: string;
}

// ============================================================
// Gene Loader — reads from Evolver's genes.json
// ============================================================

export function loadGenes(evolverDir: string): EvolverGene[] {
  // Try multiple possible paths
  const possiblePaths = [
    join(evolverDir, ".evolver", "gep", "genes.json"),
    join(evolverDir, "assets", "gep", "genes.seed.json"),
    join(evolverDir, "memory", "evolution", "genes.json"),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      const content = readFileSync(path, "utf-8");
      const data = JSON.parse(content);
      // genes.seed.json wraps in an object
      return data.genes || data || [];
    }
  }

  return [];
}

// ============================================================
// Signal Matcher — checks if text matches a Gene's signals_match patterns
// ============================================================

function matchesSignals(text: string, signalsMatch: string[]): boolean {
  const lower = text.toLowerCase();
  for (const pattern of signalsMatch) {
    const alternatives = pattern.split("|");
    for (const alt of alternatives) {
      const trimmed = alt.trim().toLowerCase();
      if (trimmed && lower.includes(trimmed)) {
        return true;
      }
    }
  }
  return false;
}

// ============================================================
// Gene → Pi Extension Generator
// ============================================================

/**
 * Generate a Pi-Mono extension file that bridges ALL loaded Genes.
 * The extension:
 * 1. On before_agent_start: scans prompt for signal matches, injects best Gene's strategy
 * 2. On tool_call: enforces tool_policy (allow_only / deny)
 * 3. Registers a validation tool for each Gene that has validation commands
 * 4. Records evolution events in session entries
 */
export function generatePiExtension(genes: EvolverGene[], outputPath: string): void {
  // Serialize Gene data as JSON
  const genesJson = JSON.stringify(
    genes.map(g => ({
      id: g.id,
      category: g.category,
      signals_match: g.signals_match,
      strategy: g.strategy,
      constraints: g.constraints,
      validation: g.validation,
      anti_patterns: g.anti_patterns,
      summary: g.summary,
      tool_policy: g.tool_policy,
    })),
    null, 2
  );

  // Build the extension source using string concatenation (no template literals
  // to avoid ${} conflicts with generated code's own template literals)
  //
  // Real Pi-Mono ExtensionAPI signatures (from packages/coding-agent/src/core/extensions/types.ts):
  //   pi.on("before_agent_start", (event: BeforeAgentStartEvent) => BeforeAgentStartEventResult)
  //     event.prompt: string, event.systemPrompt: string
  //     return: { systemPrompt?: string }
  //   pi.on("tool_call", (event: ToolCallEvent) => ToolCallEventResult)
  //     ToolCallEvent is union of BashToolCallEvent | ReadToolCallEvent | ... | CustomToolCallEvent
  //     Each has: type, toolCallId, toolName (string literal for builtins, string for custom)
  //     return: { block?: boolean; reason?: string }
  //   pi.registerTool(tool: ToolDefinition)
  //     execute(toolCallId, params, signal, onUpdate, ctx) => Promise<AgentToolResult<TDetails>>
  //     AgentToolResult = { content: (TextContent|ImageContent)[], details: T, terminate?: boolean }
  //     NO isError field — errors are returned as normal content
  //   pi.registerCommand(name, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> })
  //     handler returns void, not string — use ctx.sendMessage to output
  //   pi.appendEntry(customType, data) — persists to session, NOT sent to LLM
  const code = `/**
 * Auto-generated Evolver GEP → Pi-Mono Bridge Extension
 * Generated from ${genes.length} Genes
 *
 * Source: Evolver GEP Protocol (github.com/EvoMap/evolver)
 * Target: Pi-Mono Extension API (github.com/badlogic/pi-mono)
 *
 * Verified against: packages/coding-agent/src/core/extensions/types.ts
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execSync } from "child_process";

// Embedded Gene data (from Evolver's genes.json)
const GENES: Array<{
  id: string;
  category: string;
  signals_match: string[];
  strategy: string[];
  constraints: { max_files: number; forbidden_paths: string[] };
  validation: string[];
  anti_patterns?: string[];
  summary?: string;
  tool_policy?: { allow_only?: string[]; deny?: string[]; severity: string } | null;
}> = ${genesJson};

export default function (pi: ExtensionAPI) {
  console.log("[evolver-bridge] Loaded " + GENES.length + " Genes from Evolver GEP");

  // --- Signal Matching: inject best-matching Gene strategy into system prompt ---
  // before_agent_start fires after user submits prompt, before agent loop.
  // event.prompt = raw user prompt, event.systemPrompt = current system prompt
  // Return { systemPrompt } to override for this turn.
  pi.on("before_agent_start", async (event) => {
    const prompt = (event.prompt || "").toLowerCase();
    let bestGene: typeof GENES[0] | null = null;
    let bestScore = 0;

    for (const gene of GENES) {
      let score = 0;
      for (const pattern of gene.signals_match) {
        for (const alt of pattern.split("|")) {
          if (prompt.includes(alt.trim().toLowerCase())) score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestGene = gene;
      }
    }

    if (bestGene && bestScore > 0) {
      const strategyText = bestGene.strategy
        .map((s: string, i: number) => (i + 1) + ". " + s)
        .join("\\n");
      const constraintsText = [
        "Max files: " + bestGene.constraints.max_files,
        "Forbidden: " + bestGene.constraints.forbidden_paths.join(", "),
      ].join("\\n");
      const antiPatternsText = bestGene.anti_patterns?.length
        ? "\\nAnti-patterns: " + bestGene.anti_patterns.join(", ")
        : "";

      // appendEntry persists to session but does NOT send to LLM
      pi.appendEntry("evolver-gene-activation", {
        geneId: bestGene.id,
        category: bestGene.category,
        score: bestScore,
      });

      return {
        systemPrompt: event.systemPrompt
          + "\\n\\n## Active Evolver Gene: " + bestGene.id
          + "\\nCategory: " + bestGene.category
          + (bestGene.summary ? "\\n" + bestGene.summary : "")
          + "\\n### Strategy\\n" + strategyText
          + "\\n### Constraints\\n" + constraintsText
          + antiPatternsText,
      };
    }
  });

  // --- Tool Policy: enforce Gene's allow_only / deny rules ---
  // tool_call fires before tool execution. event has toolCallId and toolName.
  // Return { block: true, reason } to prevent execution.
  pi.on("tool_call", async (event) => {
    // toolName is on each variant of the ToolCallEvent union
    const toolName = "toolName" in event ? (event as any).toolName as string : "";
    for (const gene of GENES) {
      if (!gene.tool_policy) continue;
      const { allow_only, deny, severity } = gene.tool_policy;
      if (deny?.includes(toolName)) {
        if (severity === "block") {
          return { block: true, reason: "Gene " + gene.id + " denies tool: " + toolName };
        }
      }
      if (allow_only && !allow_only.includes(toolName)) {
        if (severity === "block") {
          return { block: true, reason: "Gene " + gene.id + " allows only: " + allow_only.join(", ") };
        }
      }
    }
  });

  // --- Validation Tools: run Gene's validation commands ---
  // AgentToolResult = { content: Content[], details: T, terminate?: boolean }
  // No isError field — errors are returned as normal text content.
  for (const gene of GENES) {
    if (gene.validation.length === 0) continue;
    const safeId = gene.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    pi.registerTool({
      name: "gep_validate_" + safeId,
      label: "GEP Validate: " + gene.id,
      description: "Run " + gene.validation.length + " validation commands for Gene " + gene.id,
      parameters: Type.Object({}),
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        const results: string[] = [];
        for (const cmd of gene.validation) {
          try {
            execSync(cmd, { cwd: ctx.cwd, timeout: 30000, stdio: "pipe" });
            results.push("[PASS] " + cmd);
          } catch (e: any) {
            results.push("[FAIL] " + cmd + ": " + e.message.slice(0, 100));
            // Return error as text content (AgentToolResult has no isError field)
            return {
              content: [{ type: "text" as const, text: results.join("\\n") }],
              details: { passed: false, failedAt: cmd },
            };
          }
        }
        return {
          content: [{ type: "text" as const, text: results.join("\\n") + "\\nAll validations passed." }],
          details: { passed: true },
        };
      },
    });
  }

  console.log("[evolver-bridge] Registered Gene validation tools");

  // --- /genes command ---
  // handler signature: (args: string, ctx: ExtensionCommandContext) => Promise<void>
  // Use ctx.sendMessage to output — handler does NOT return a string.
  pi.registerCommand("genes", {
    description: "List all loaded Evolver Genes and their signal patterns",
    async handler(_args, ctx) {
      const text = GENES.map(g =>
        "[" + g.category + "] " + g.id + (g.summary ? ": " + g.summary : "")
        + "\\n  Signals: " + g.signals_match.join(", ")
        + "\\n  Steps: " + g.strategy.length
      ).join("\\n\\n");
      ctx.sendMessage({ customType: "evolver-genes-list", content: text, display: text });
    },
  });
}
`;

  mkdirSync(outputPath.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(outputPath, code);
}

// CLI entry point
if (process.argv[2]) {
  const command = process.argv[2];
  const evolverDir = process.argv[3] || "/workspace/evolver";
  const outputDir = process.argv[4] || "/workspace/nexus-workspace/.pi/extensions";

  if (command === "generate") {
    console.log(`Loading Genes from ${evolverDir}...`);
    const genes = loadGenes(evolverDir);
    console.log(`Found ${genes.length} Genes`);

    if (genes.length === 0) {
      console.log("No genes found. Checked:");
      console.log("  - .evolver/gep/genes.json");
      console.log("  - assets/gep/genes.seed.json");
      console.log("  - memory/evolution/genes.json");
      process.exit(1);
    }

    const outputPath = join(outputDir, "evolver-bridge.ts");
    generatePiExtension(genes, outputPath);
    console.log(`Generated Pi-Mono extension: ${outputPath}`);
    console.log(`\nGene summary:`);
    for (const g of genes) {
      console.log(`  [${g.category}] ${g.id} — ${g.signals_match.length} signals, ${g.strategy.length} steps${g.summary ? ": " + g.summary : ""}`);
    }
  }
}
