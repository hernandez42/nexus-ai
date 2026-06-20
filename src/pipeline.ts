#!/usr/bin/env node
/**
 * Nexus Pipeline — End-to-end orchestration of all 3 glue modules
 *
 * Data flow:
 *   1. Superpowers skills → Eve agent/skills/ (format conversion)
 *   2. Evolver genes.json → Pi-Mono .pi/extensions/ (Gene → Extension bridge)
 *   3. AutoResearch results → Evolver signals (experiment outcomes → Gene signals)
 *
 * Usage:
 *   npx tsx src/pipeline.ts [workspace-dir]
 *   Default workspace: /workspace/nexus-workspace
 */

import { join } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";

// Import glue modules
import { convertAllSkills, generateSkillIndex, type SkillConversionResult } from "./glue/superpowers-to-eve";
import { loadGenes, generatePiExtension, type EvolverGene } from "./glue/evolver-to-pimono";
import {
  parseResultsTsv,
  convertResultsToEvolverSignals,
  generateAutoResearchGene,
  type ExperimentResult,
} from "./glue/autoresearch-to-evolver";

interface PipelineResult {
  phase: string;
  status: "ok" | "skip" | "error";
  detail: string;
}

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

export async function runPipeline(options: {
  superpowersDir: string;
  eveDir: string;
  evolverDir: string;
  piDir: string;
  autoresearchDir: string;
  workspaceDir: string;
}): Promise<PipelineResult[]> {
  const results: PipelineResult[] = [];

  // ================================================================
  // Phase 1: Superpowers → Eve Skills
  // ================================================================
  log("=== Phase 1: Superpowers Skills → Eve Agent Skills ===");
  try {
    const eveAgentDir = join(options.workspaceDir, "agent");
    const skillResults = convertAllSkills(options.superpowersDir, eveAgentDir);
    const converted = skillResults.filter(r => r.converted).length;
    const indexPath = join(eveAgentDir, "skills", "skill-index.md");
    generateSkillIndex(skillResults, indexPath);

    results.push({
      phase: "superpowers-to-eve",
      status: "ok",
      detail: `${converted}/${skillResults.length} skills converted, index at ${indexPath}`,
    });
    log(`  -> ${converted} skills converted to Eve format`);
  } catch (e: any) {
    results.push({
      phase: "superpowers-to-eve",
      status: "error",
      detail: e.message,
    });
    log(`  ERROR: ${e.message}`);
  }

  // ================================================================
  // Phase 2: Evolver Genes → Pi-Mono Extension
  // ================================================================
  log("=== Phase 2: Evolver GEP Genes → Pi-Mono Extension ===");
  try {
    const genes = loadGenes(options.evolverDir);
    if (genes.length === 0) {
      results.push({
        phase: "evolver-to-pimono",
        status: "skip",
        detail: "No genes found in Evolver directory",
      });
      log("  -> SKIP: No genes found");
    } else {
      const piExtensionsDir = join(options.workspaceDir, ".pi", "extensions");
      const outputPath = join(piExtensionsDir, "evolver-bridge.ts");
      generatePiExtension(genes, outputPath);

      results.push({
        phase: "evolver-to-pimono",
        status: "ok",
        detail: `${genes.length} genes → ${outputPath}`,
      });
      log(`  -> ${genes.length} Genes embedded into Pi-Mono extension`);
    }
  } catch (e: any) {
    results.push({
      phase: "evolver-to-pimono",
      status: "error",
      detail: e.message,
    });
    log(`  ERROR: ${e.message}`);
  }

  // ================================================================
  // Phase 3: AutoResearch Results → Evolver Signals
  // ================================================================
  log("=== Phase 3: AutoResearch Results → Evolver Signals ===");
  try {
    const tsvPath = join(options.autoresearchDir, "results.tsv");
    const logPath = join(options.autoresearchDir, "run.log");
    const memoryDir = join(options.evolverDir, "memory");

    if (!existsSync(tsvPath)) {
      results.push({
        phase: "autoresearch-to-evolver",
        status: "skip",
        detail: "No results.tsv found (no experiments run yet)",
      });
      log("  -> SKIP: No results.tsv (run experiments first)");
    } else {
      const signalResult = convertResultsToEvolverSignals(
        tsvPath,
        existsSync(logPath) ? logPath : null,
        memoryDir
      );

      results.push({
        phase: "autoresearch-to-evolver",
        status: "ok",
        detail: `${signalResult.converted} experiments → ${signalResult.signalsGenerated.length} signals`,
      });
      log(`  -> ${signalResult.converted} experiments converted, ${signalResult.signalsGenerated.length} signal types`);
    }

    // Always generate the AutoResearch Gene (even without experiment data)
    const genePath = join(options.evolverDir, "assets", "gep", "gene_autoresearch.json");
    generateAutoResearchGene(genePath);
    log(`  -> AutoResearch Gene written to ${genePath}`);
  } catch (e: any) {
    results.push({
      phase: "autoresearch-to-evolver",
      status: "error",
      detail: e.message,
    });
    log(`  ERROR: ${e.message}`);
  }

  return results;
}

// ================================================================
// CLI
// ================================================================

if (process.argv[2]) {
  const workspaceDir = process.argv[2] || "/workspace/nexus-workspace";
  mkdirSync(workspaceDir, { recursive: true });

  log(`Nexus Pipeline — workspace: ${workspaceDir}`);
  log(`Source repos: eve, pi-mono, evolver, superpowers, autoresearch`);
  log("");

  const results = await runPipeline({
    superpowersDir: "/workspace/superpowers",
    eveDir: "/workspace/eve",
    evolverDir: "/workspace/evolver",
    piDir: "/workspace/pi-mono",
    autoresearchDir: "/workspace/autoresearch",
    workspaceDir,
  });

  console.log("\n=== Pipeline Summary ===");
  for (const r of results) {
    const icon = r.status === "ok" ? "OK" : r.status === "skip" ? "SKIP" : "FAIL";
    console.log(`  [${icon}] ${r.phase}: ${r.detail}`);
  }

  const ok = results.filter(r => r.status === "ok").length;
  const total = results.length;
  console.log(`\nResult: ${ok}/${total} phases succeeded`);
}
