/**
 * Glue 1: Superpowers Skills → Eve Skills Format Converter
 *
 * Reads Superpowers SKILL.md files (from /workspace/superpowers/skills/)
 * and converts them to Eve-compatible format for agent/skills/.
 *
 * Key findings from real source code analysis:
 * - Superpowers frontmatter: { name, description } — description starts with "Use when..."
 * - Eve frontmatter: { description, license?, metadata? } — name is IGNORED (derived from path)
 * - Both use gray-matter style YAML frontmatter
 * - Both use <name>/SKILL.md directory structure — naturally compatible
 * - Eve auto-discovers scripts/, references/, assets/ subdirectories
 *
 * So the conversion is nearly trivial — just copy the files.
 * The real value is in the validation and the skill-index generation.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync, statSync } from "fs";
import { join, relative, basename } from "path";

// Parse YAML frontmatter (simplified — both projects use gray-matter compatible format)
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yamlStr = match[1];
  const body = match[2];

  // Simple YAML parser for flat key-value pairs
  const frontmatter: Record<string, string> = {};
  for (const line of yamlStr.split("\n")) {
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (kvMatch) {
      // Strip quotes if present
      let value = kvMatch[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      frontmatter[kvMatch[1]] = value;
    }
  }

  return { frontmatter, body };
}

// Build Eve-compatible frontmatter
function buildEveFrontmatter(superpowersFrontmatter: Record<string, string>): string {
  const lines: string[] = ["---"];

  // Eve needs 'description' — Superpowers has it
  if (superpowersFrontmatter.description) {
    lines.push(`description: "${superpowersFrontmatter.description}"`);
  }

  // Add provenance metadata
  lines.push(`metadata:`);
  lines.push(`  source: "superpowers"`);
  if (superpowersFrontmatter.name) {
    lines.push(`  original_name: "${superpowersFrontmatter.name}"`);
  }

  lines.push("---");
  return lines.join("\n");
}

export interface SkillConversionResult {
  skillName: string;
  sourcePath: string;
  targetPath: string;
  converted: boolean;
  error?: string;
  supportingFiles: string[];
}

/**
 * Convert a single Superpowers skill to Eve format
 */
export function convertSkill(
  superpowersSkillDir: string,
  eveSkillsDir: string
): SkillConversionResult {
  const skillName = basename(superpowersSkillDir);
  const sourceSkillMd = join(superpowersSkillDir, "SKILL.md");
  const targetSkillDir = join(eveSkillsDir, skillName);
  const targetSkillMd = join(targetSkillDir, "SKILL.md");

  const result: SkillConversionResult = {
    skillName,
    sourcePath: sourceSkillMd,
    targetPath: targetSkillMd,
    converted: false,
    supportingFiles: [],
  };

  // Read source SKILL.md
  if (!existsSync(sourceSkillMd)) {
    result.error = `SKILL.md not found in ${superpowersSkillDir}`;
    return result;
  }

  const content = readFileSync(sourceSkillMd, "utf-8");
  const { frontmatter, body } = parseFrontmatter(content);

  // Build Eve-compatible content
  const eveFrontmatter = buildEveFrontmatter(frontmatter);
  const eveContent = eveFrontmatter + "\n" + body;

  // Write target
  mkdirSync(targetSkillDir, { recursive: true });
  writeFileSync(targetSkillMd, eveContent);

  // Copy supporting files (scripts/, references/, assets/, *.md)
  const entries = readdirSync(superpowersSkillDir);
  for (const entry of entries) {
    if (entry === "SKILL.md") continue;

    const srcPath = join(superpowersSkillDir, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      // Copy entire subdirectory (scripts/, references/, etc.)
      const tgtPath = join(targetSkillDir, entry);
      cpSync(srcPath, tgtPath, { recursive: true });
      result.supportingFiles.push(entry + "/");
    } else if (entry.endsWith(".md") || entry.endsWith(".sh") || entry.endsWith(".js")) {
      // Copy individual supporting files
      const tgtPath = join(targetSkillDir, entry);
      cpSync(srcPath, tgtPath);
      result.supportingFiles.push(entry);
    }
  }

  result.converted = true;
  return result;
}

/**
 * Convert ALL Superpowers skills to Eve format
 */
export function convertAllSkills(
  superpowersRoot: string,
  eveAgentDir: string
): SkillConversionResult[] {
  const skillsDir = join(superpowersRoot, "skills");
  const eveSkillsDir = join(eveAgentDir, "skills");

  if (!existsSync(skillsDir)) {
    throw new Error(`Superpowers skills directory not found: ${skillsDir}`);
  }

  mkdirSync(eveSkillsDir, { recursive: true });

  const entries = readdirSync(skillsDir);
  const results: SkillConversionResult[] = [];

  for (const entry of entries) {
    const skillDir = join(skillsDir, entry);
    const stat = statSync(skillDir);
    if (!stat.isDirectory()) continue;
    if (!existsSync(join(skillDir, "SKILL.md"))) continue;

    const result = convertSkill(skillDir, eveSkillsDir);
    results.push(result);
  }

  return results;
}

/**
 * Generate a skill-index.md that Eve can use to discover all loaded skills
 * Eve lists skills in the system prompt as "name: description (path: ...)"
 */
export function generateSkillIndex(
  results: SkillConversionResult[],
  outputPath: string
): void {
  const lines: string[] = ["# Skill Index", ""];
  lines.push("Skills loaded from Superpowers into Eve:\n");

  for (const r of results) {
    if (!r.converted) {
      lines.push(`- ~~${r.skillName}~~ (failed: ${r.error})`);
    } else {
      lines.push(`- **${r.skillName}** (${r.supportingFiles.length} supporting files)`);
    }
  }

  lines.push(`\nTotal: ${results.filter(r => r.converted).length} skills converted`);
  writeFileSync(outputPath, lines.join("\n"));
}

// CLI entry point
if (process.argv[2]) {
  const command = process.argv[2];
  const superpowersRoot = process.argv[3] || "/workspace/superpowers";
  const eveAgentDir = process.argv[4] || "/workspace/nexus-workspace/agent";

  if (command === "convert-all") {
    console.log(`Converting Superpowers skills from ${superpowersRoot}/skills/`);
    console.log(`Target: ${eveAgentDir}/skills/\n`);

    const results = convertAllSkills(superpowersRoot, eveAgentDir);

    for (const r of results) {
      const status = r.converted ? "✓" : "✗";
      const extra = r.supportingFiles.length > 0 ? ` (+${r.supportingFiles.length} files)` : "";
      console.log(`  ${status} ${r.skillName}${extra}${r.error ? ` — ${r.error}` : ""}`);
    }

    const indexPath = join(eveAgentDir, "skills", "skill-index.md");
    generateSkillIndex(results, indexPath);
    console.log(`\nSkill index written to: ${indexPath}`);
    console.log(`Total: ${results.filter(r => r.converted).length}/${results.length} skills converted`);
  }
}
