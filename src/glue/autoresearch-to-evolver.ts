/**
 * Glue 3: AutoResearch Results → Evolver Signal Bridge
 *
 * Reads AutoResearch's results.tsv and run.log, converts experiment
 * outcomes into text signals that Evolver's signal detection system
 * can scan and process.
 *
 * Key findings from real source code analysis:
 * - AutoResearch results.tsv: commit, val_bpb, memory_gb, status(keep/discard/crash), description
 * - AutoResearch run.log ends with: val_bpb: X.XXX, training_seconds: Y.Y, peak_vram_mb: Z.Z, ...
 * - Evolver signals.js extractSignals() takes: recentSessionTranscript, todayLog, memorySnippet, userSnippet
 * - Evolver Layer 1 regex matches: "error:", "exception:", "out of memory", "oom", "timeout", "slow"
 * - Evolver Layer 2 keyword scores: perf_bottleneck, capability_gap, evolution_stagnation_detected
 * - Evolver Gene signals_match uses pipe-separated patterns for matching
 * - So: we write experiment results as text containing Evolver-recognizable keywords
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";

// ============================================================
// AutoResearch result row (from results.tsv)
// ============================================================

export interface ExperimentResult {
  commit: string;
  val_bpb: number;
  memory_gb: number;
  status: "keep" | "discard" | "crash";
  description: string;
}

// ============================================================
// Parse results.tsv
// ============================================================

export function parseResultsTsv(tsvPath: string): ExperimentResult[] {
  if (!existsSync(tsvPath)) return [];

  const content = readFileSync(tsvPath, "utf-8");
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split("\t");
  const results: ExperimentResult[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    if (cols.length < header.length) continue;

    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = cols[j] || "";
    }

    results.push({
      commit: row["commit"] || "",
      val_bpb: parseFloat(row["val_bpb"]) || 0,
      memory_gb: parseFloat(row["memory_gb"]) || 0,
      status: (row["status"] as ExperimentResult["status"]) || "discard",
      description: row["description"] || "",
    });
  }

  return results;
}

// ============================================================
// Parse run.log metrics
// ============================================================

export interface RunLogMetrics {
  val_bpb: number;
  training_seconds: number;
  total_seconds: number;
  peak_vram_mb: number;
  mfu_percent: number;
  total_tokens_M: number;
  num_steps: number;
  num_params_M: number;
  depth: number;
}

export function parseRunLog(logPath: string): RunLogMetrics | null {
  if (!existsSync(logPath)) return null;

  const content = readFileSync(logPath, "utf-8");
  const metrics: Partial<RunLogMetrics> = {};

  const patterns: Record<string, keyof RunLogMetrics> = {
    "val_bpb:": "val_bpb",
    "training_seconds:": "training_seconds",
    "total_seconds:": "total_seconds",
    "peak_vram_mb:": "peak_vram_mb",
    "mfu_percent:": "mfu_percent",
    "total_tokens_M:": "total_tokens_M",
    "num_steps:": "num_steps",
    "num_params_M:": "num_params_M",
    "depth:": "depth",
  };

  for (const line of content.split("\n")) {
    for (const [prefix, key] of Object.entries(patterns)) {
      if (line.startsWith(prefix)) {
        const value = parseFloat(line.slice(prefix.length).trim());
        if (!isNaN(value)) {
          (metrics as any)[key] = value;
        }
      }
    }
  }

  if (metrics.val_bpb === undefined) return null;
  return metrics as RunLogMetrics;
}

// ============================================================
// Convert experiment results to Evolver-compatible signal text
// ============================================================

export interface SignalConversion {
  experiment: ExperimentResult;
  signals: string[];
  evolverCorpusText: string;
}

/**
 * Convert a single experiment result into Evolver-recognizable signal text.
 * The text is designed to trigger Evolver's Layer 1 regex patterns and
 * Layer 2 keyword scoring.
 */
export function experimentToSignal(result: ExperimentResult): SignalConversion {
  const signals: string[] = [];
  const parts: string[] = [];

  parts.push(`[autoresearch_experiment] commit=${result.commit}`);

  switch (result.status) {
    case "crash": {
      // Check for OOM
      const desc = result.description.toLowerCase();
      if (desc.includes("oom") || desc.includes("out of memory") || result.memory_gb > 70) {
        signals.push("perf_bottleneck");
        parts.push("experiment_crash: out of memory — perf_bottleneck detected");
      } else {
        signals.push("log_error");
        parts.push(`experiment_crash: ${result.description} — error detected`);
      }
      break;
    }

    case "discard": {
      signals.push("evolution_stagnation_detected");
      parts.push(`experiment_discard: val_bpb=${result.val_bpb} no improvement — stagnation detected`);
      break;
    }

    case "keep": {
      signals.push("user_improvement_suggestion");
      parts.push(`experiment_keep: val_bpb=${result.val_bpb} improved — ${result.description}`);
      break;
    }
  }

  // Memory pressure signal
  if (result.memory_gb > 60) {
    signals.push("perf_bottleneck");
    parts.push(`high_memory_usage: ${result.memory_gb}GB — approaching limit`);
  }

  return {
    experiment: result,
    signals,
    evolverCorpusText: parts.join("\n"),
  };
}

/**
 * Convert ALL results and write to Evolver's scannable corpus location.
 * Evolver reads from: recentSessionTranscript, todayLog, memorySnippet, userSnippet
 * We write to the memory/ directory which Evolver scans.
 */
export function convertResultsToEvolverSignals(
  resultsTsvPath: string,
  runLogPath: string | null,
  evolverMemoryDir: string
): {
  converted: number;
  signalsGenerated: string[];
  outputPath: string;
} {
  const results = parseResultsTsv(resultsTsvPath);
  if (results.length === 0) {
    return { converted: 0, signalsGenerated: [], outputPath: "" };
  }

  // Parse latest run.log if available
  const metrics = runLogPath ? parseRunLog(runLogPath) : null;

  // Build signal corpus
  const allSignals: string[] = [];
  const corpusLines: string[] = [];

  corpusLines.push(`# AutoResearch Experiment Results → Evolver Signal Feed`);
  corpusLines.push(`# Generated at: ${new Date().toISOString()}`);
  corpusLines.push(`# Total experiments: ${results.length}`);
  if (metrics) {
    corpusLines.push(`# Latest run: val_bpb=${metrics.val_bpb}, vram=${metrics.peak_vram_mb}MB, steps=${metrics.num_steps}`);
  }
  corpusLines.push("");

  // Track best val_bpb for plateau detection
  let bestBpb = Infinity;
  let consecutiveDiscards = 0;

  for (const result of results) {
    const conversion = experimentToSignal(result);
    allSignals.push(...conversion.signals);
    corpusLines.push(conversion.evolverCorpusText);

    // Track plateau
    if (result.status === "keep" && result.val_bpb < bestBpb) {
      bestBpb = result.val_bpb;
      consecutiveDiscards = 0;
    } else if (result.status === "discard") {
      consecutiveDiscards++;
    } else {
      consecutiveDiscards = 0;
    }
  }

  // Plateau detection
  if (consecutiveDiscards >= 5) {
    allSignals.push("plateau_pivot_required");
    corpusLines.push("");
    corpusLines.push("[plateau_detection] ${consecutiveDiscards} consecutive discards — plateau_pivot_required");
  }

  // Write to Evolver's memory directory
  const outputPath = join(evolverMemoryDir, "autoresearch-signals.md");
  mkdirSync(evolverMemoryDir, { recursive: true });
  writeFileSync(outputPath, corpusLines.join("\n"));

  return {
    converted: results.length,
    signalsGenerated: [...new Set(allSignals)],
    outputPath,
  };
}

/**
 * Generate an AutoResearch-specific Evolver Gene
 * that tells Evolver how to respond to experiment signals.
 */
export function generateAutoResearchGene(outputPath: string, autoresearchDir?: string): void {
  // Build validation command relative to autoresearch dir (not hardcoded)
  const validationCmd = autoresearchDir
    ? `cd ${autoresearchDir} && python -c "import torch; print(torch.cuda.is_available())"`
    : `python -c "import torch; print(torch.cuda.is_available())"`;

  const gene = {
    type: "Gene",
    id: "gene_autoresearch_experiment",
    category: "optimize",
    signals_match: [
      "autoresearch_experiment",
      "val_bpb_improved",
      "val_bpb_regressed",
      "experiment_crash",
      "experiment_oom",
      "experiment_discard",
      "experiment_keep",
      "experiment_plateau",
      "high_memory_usage",
      "plateau_pivot_required",
    ],
    preconditions: [
      "AutoResearch experiment results are available in results.tsv",
    ],
    strategy: [
      "Read the latest results.tsv to get experiment outcomes",
      "If experiment_crash with OOM: reduce batch size or model depth",
      "If experiment_crash without OOM: inspect error and fix the code",
      "If experiment_keep: record the successful change, update best config",
      "If experiment_discard: analyze what didn't work, try alternative direction",
      "If plateau_pivot_required: suggest fundamentally different approach",
      "Update program.md with new research direction if needed",
    ],
    constraints: {
      max_files: 5,
      forbidden_paths: [".git", "node_modules", ".evolver"],
    },
    validation: [
      validationCmd,
    ],
    summary: "Responds to AutoResearch ML experiment outcomes with appropriate repair or optimization strategies",
    anti_patterns: [
      "modifying prepare.py",
      "changing the 5-minute time budget",
    ],
    schema_version: "1.6.0",
    epigenetic_marks: [],
    learning_history: [],
  };

  mkdirSync(outputPath.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(gene, null, 2));
}

// CLI entry point
if (process.argv[2]) {
  const command = process.argv[2];
  const autoresearchDir = process.argv[3] || "/workspace/autoresearch";
  const evolverDir = process.argv[4] || "/workspace/evolver";

  if (command === "convert") {
    const tsvPath = join(autoresearchDir, "results.tsv");
    const logPath = join(autoresearchDir, "run.log");
    const memoryDir = join(evolverDir, "memory");

    console.log(`Reading experiments from ${tsvPath}`);
    const result = convertResultsToEvolverSignals(
      tsvPath,
      existsSync(logPath) ? logPath : null,
      memoryDir
    );

    console.log(`Converted ${result.converted} experiments`);
    console.log(`Signals generated: ${result.signalsGenerated.join(", ")}`);
    console.log(`Written to: ${result.outputPath}`);

    // Also generate the AutoResearch Gene
    const genePath = join(evolverDir, "assets", "gep", "gene_autoresearch.json");
    generateAutoResearchGene(genePath, autoresearchDir);
    console.log(`Gene written to: ${genePath}`);
  }
}
