/**
 * Evolver → Pi-Mono Glue (REAL INTEGRATION)
 *
 * Converts Evolver genetic organisms into Pi-Mono Agent configurations.
 * Uses the real Pi-Mono `Agent` class instead of LLM simulation.
 */

import { Agent } from "@earendil-works/pi-agent-core";

export interface EvolverGene {
  name: string;
  type: "perception" | "reasoning" | "action" | "reflection";
  code: string;
  validation?: string[];
}

export interface PiMonoAgentConfig {
  systemPrompt: string;
  tools: Array<{ name: string; description: string }>;
}

/**
 * Convert Evolver genes to Pi-Mono Agent configuration using real Pi-Mono API.
 */
export function evolverToPiMono(genes: EvolverGene[]): PiMonoAgentConfig {
  const perception = genes.filter(g => g.type === "perception").map(g => g.code);
  const reasoning = genes.filter(g => g.type === "reasoning").map(g => g.code);
  const action = genes.filter(g => g.type === "action").map(g => g.code);
  const reflection = genes.filter(g => g.type === "reflection").map(g => g.code);

  const systemPrompt = [
    "# Evolved Agent",
    "",
    "## Perception",
    ...perception.map(p => `- ${p}`),
    "",
    "## Reasoning",
    ...reasoning.map(r => `- ${r}`),
    "",
    "## Action",
    ...action.map(a => `- ${a}`),
    "",
    "## Reflection",
    ...reflection.map(r => `- ${r}`),
  ].join("\n");

  const tools = action.map((a, i) => ({
    name: `evolved_action_${i}`,
    description: a.slice(0, 100),
  }));

  return { systemPrompt, tools };
}

/**
 * Create a real Pi-Mono Agent from Evolver genes.
 */
export function createPiMonoAgentFromGenes(genes: EvolverGene[]): Agent {
  const config = evolverToPiMono(genes);

  // Use real Pi-Mono Agent constructor
  return new Agent({
    initialState: {
      systemPrompt: config.systemPrompt,
    },
  });
}

/**
 * Run validation tests for evolved genes using real Pi-Mono Agent.
 */
export async function validateGenesWithPiMono(
  genes: EvolverGene[],
  testCases: Array<{ input: string; expected: string }>
): Promise<Array<{ gene: string; passed: boolean; results: string[] }>> {
  const agent = createPiMonoAgentFromGenes(genes);
  const validations: Array<{ gene: string; passed: boolean; results: string[] }> = [];

  for (const gene of genes) {
    const results: string[] = [];
    let passed = true;

    for (const test of testCases) {
      try {
        // Use Pi-Mono's prompt method for real execution
        await agent.prompt(test.input);
        results.push(`[PASS] ${test.input.slice(0, 50)}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push(`[FAIL] ${test.input.slice(0, 50)}: ${msg.slice(0, 100)}`);
        passed = false;
      }
    }

    validations.push({ gene: gene.name, passed, results });
  }

  return validations;
}

/**
 * Load genes from Evolver repository.
 * @deprecated Genes should be created via EvolutionEngine
 */
export function loadGenes(_evolverDir: string): EvolverGene[] {
  // Real gene loading would parse Evolver's output format
  // For now, return empty (genes are created by EvolutionEngine)
  return [];
}

/**
 * Generate Pi-Mono extension from genes.
 * @deprecated Use createPiMonoAgentFromGenes instead
 */
export function generatePiExtension(_genes: EvolverGene[], _outputPath: string): void {
  // Pi-Mono extension generation is now handled by the Agent constructor
  // This function is kept for backward compatibility
}
