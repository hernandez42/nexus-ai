/**
 * Superpowers → Eve Glue
 *
 * Converts Superpowers coding methodology skills into Eve agent definitions.
 * Uses ESM-native imports. No CJS require(), no top-level await at module scope.
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

// Attempt to load real Eve defineAgent lazily (runtime optional)
let defineAgentFn: ((opts: { description: string; model?: unknown }) => unknown) | undefined = undefined;
let eveTried = false;

async function getDefineAgent(): Promise<typeof defineAgentFn> {
  if (eveTried) return defineAgentFn;
  eveTried = true;
  try {
    // Dynamic import — only runs if the caller actually needs it
    const eve = await import("eve");
    defineAgentFn = (eve as { defineAgent?: typeof defineAgentFn }).defineAgent;
  } catch {
    // Eve not installed — we just produce data structures
    defineAgentFn = undefined;
  }
  return defineAgentFn;
}

export interface SuperpowersSkill {
  name: string;
  description: string;
  steps: string[];
  context?: Record<string, unknown>;
}

export interface EveAgent {
  name: string;
  description: string;
  instructions: string;
  tools: string[];
}

/**
 * Convert Superpowers skills to Eve agent definitions (pure data transform).
 */
export function superpowersToEve(skills: SuperpowersSkill[]): EveAgent[] {
  return skills.map(skill => {
    const toolHints: string[] = [];
    for (const s of skill.steps) {
      const m = s.match(/(?:tool|function):\s*([A-Za-z0-9_-]+)/);
      if (m) toolHints.push(m[1]);
    }
    const instructions = [
      `# ${skill.name}`,
      skill.description,
      "",
      "## Steps",
      ...skill.steps.map((s, i) => `${i + 1}. ${s}`),
      skill.context ? "\n## Context\n" + JSON.stringify(skill.context, null, 2) : "",
    ].join("\n");

    return {
      name: skill.name,
      description: skill.description,
      instructions,
      tools: toolHints,
    };
  });
}

/**
 * Create an Eve agent using the real Eve defineAgent (if available).
 */
export async function createEveAgent(
  skill: SuperpowersSkill,
  model?: unknown
): Promise<unknown> {
  const def = await getDefineAgent();
  if (def) {
    return def({ description: skill.description, model });
  }
  // Fallback: return structured agent data
  return superpowersToEve([skill])[0];
}

/**
 * Load Superpowers skills from a directory and convert to Eve agents.
 */
export async function loadSuperpowersAndConvert(skillsDir: string): Promise<EveAgent[]> {
  if (!existsSync(skillsDir)) {
    return [];
  }
  const skills: SuperpowersSkill[] = [];
  const files = readdirSync(skillsDir).filter(f => f.endsWith(".json") || f.endsWith(".md"));
  for (const file of files) {
    try {
      const content = readFileSync(join(skillsDir, file), "utf-8");
      if (file.endsWith(".json")) {
        skills.push(JSON.parse(content));
      } else {
        const lines = content.split("\n");
        const name = lines.find(l => l.startsWith("# "))?.slice(2) || file;
        const description = lines.slice(1).find(l => l.trim() && !l.startsWith("#")) || "";
        const steps = lines
          .filter(l => /^\d+\./.test(l))
          .map(l => l.replace(/^\d+\.\s*/, ""));
        skills.push({ name, description, steps });
      }
    } catch (e: unknown) {
      console.warn(
        `[superpowers-to-eve] Failed to load skill ${file}:`,
        e instanceof Error ? e.message : String(e)
      );
    }
  }
  return superpowersToEve(skills);
}

export interface SkillConversionResult {
  skillName: string;
  converted: boolean;
  agentName: string;
  instructions: string;
}

/**
 * Backward-compatible synchronous entry point — returns [] when nothing found.
 * @deprecated Use loadSuperpowersAndConvert instead (async).
 */
export function convertAllSkills(skillsDir: string, _outputDir: string): SkillConversionResult[] {
  if (!existsSync(skillsDir)) return [];
  return []; // Intentionally a stub — use async version for real conversion.
}

/**
 * Backward-compatible stub.
 * @deprecated Indexing handled by Eve if available.
 */
export function generateSkillIndex(_results: SkillConversionResult[], _outputPath: string): void {
  // Intentionally a no-op.
}
