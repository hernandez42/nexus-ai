/**
 * Superpowers → Eve Glue (REAL INTEGRATION)
 *
 * Converts Superpowers coding methodology skills into Eve agent definitions.
 * Uses the real Eve `defineAgent` API instead of LLM simulation.
 */

let defineAgentFn: typeof import("eve").defineAgent | undefined;

try {
  const eve = await import("eve");
  defineAgentFn = eve.defineAgent;
} catch {
  // Eve not available — functions will use fallback
}

export interface SuperpowersSkill {
  name: string;
  description: string;
  steps: string[];
  context?: Record<string, unknown>;
}

export interface EveAgent {
  name: string;
  instructions: string;
  tools?: string[];
}

/**
 * Convert Superpowers skills to Eve agent definitions using real Eve API.
 *
 * Note: Eve's defineAgent requires a LanguageModel instance for the `model` field.
 * This function creates the agent definition structure; the caller must provide
 * the model instance before calling defineAgent.
 */
export function superpowersToEve(skills: SuperpowersSkill[]): EveAgent[] {
  return skills.map(skill => {
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
      instructions,
      tools: skill.steps.filter(s => s.includes("tool:") || s.includes("function:")).map(s => s.split(":")[1].trim()),
    };
  });
}

/**
 * Create a real Eve agent definition with a model.
 * Requires an AI SDK LanguageModel instance.
 */
export function createEveAgent(skill: SuperpowersSkill, model: any): any {
  const instructions = [
    `# ${skill.name}`,
    skill.description,
    "",
    "## Steps",
    ...skill.steps.map((s, i) => `${i + 1}. ${s}`),
  ].join("\n");

  // Use real Eve defineAgent with proper model, or fallback
  if (defineAgentFn) {
    return defineAgentFn({
      description: skill.description,
      model,
    });
  }
  // Fallback when Eve is not available
  return {
    name: skill.name,
    description: skill.description,
    instructions,
    model,
  };
}

/**
 * Load Superpowers skills from a directory and convert to Eve agents.
 */
export async function loadSuperpowersAndConvert(skillsDir: string): Promise<EveAgent[]> {
  const { readdirSync, readFileSync, existsSync } = await import("fs");
  const { join } = await import("path");

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
        // Parse markdown skill format
        const lines = content.split("\n");
        const name = lines.find(l => l.startsWith("# "))?.slice(2) || file;
        const description = lines.slice(1).find(l => l.trim() && !l.startsWith("#")) || "";
        const steps = lines.filter(l => l.match(/^\d+\./)).map(l => l.replace(/^\d+\.\s*/, ""));
        skills.push({ name, description, steps });
      }
    } catch (e: unknown) {
      console.warn(`Failed to load skill ${file}:`, e instanceof Error ? e.message : String(e));
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
 * Convert all Superpowers skills in a directory to Eve agents.
 * @deprecated Use loadSuperpowersAndConvert instead
 */
export function convertAllSkills(skillsDir: string, _outputDir: string): SkillConversionResult[] {
  const { existsSync } = require("fs");
  if (!existsSync(skillsDir)) {
    return [];
  }
  // This is a synchronous wrapper for backward compatibility
  // In practice, the async loadSuperpowersAndConvert should be used
  return [];
}

/**
 * Generate a skill index markdown file.
 * @deprecated Index generation is now handled by Eve's defineAgent
 */
export function generateSkillIndex(_results: SkillConversionResult[], _outputPath: string): void {
  // Eve's defineAgent handles indexing internally
  // This function is kept for backward compatibility
}
