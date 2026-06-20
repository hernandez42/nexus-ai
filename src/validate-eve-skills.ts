/**
 * Validation script: verify converted SKILL.md files match Eve's real parser expectations.
 *
 * Eve's lowerSkillMarkdown() does:
 * 1. gray-matter parse → extract frontmatter + body
 * 2. stripIgnoredSkillFrontmatterKeys → remove "name"
 * 3. expectOnlyKnownKeys → only allow: description, files, license, markdown, metadata
 * 4. description is REQUIRED for packaged skills (slug === undefined)
 * 5. metadata must be Record<string, string> (all values must be strings)
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, basename } from "path";

const ALLOWED_KEYS = new Set(["description", "files", "license", "markdown", "metadata"]);
const IGNORED_KEYS = new Set(["name"]);

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string; error?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content, error: "No frontmatter found" };

  const yamlStr = match[1];
  const body = match[2];
  const frontmatter: Record<string, unknown> = {};

  for (const line of yamlStr.split("\n")) {
    // Handle nested YAML (metadata: \n  key: value)
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (kvMatch) {
      let value: unknown = kvMatch[2].trim();
      if ((typeof value === "string" && value.startsWith('"') && value.endsWith('"')) ||
          (typeof value === "string" && value.startsWith("'") && value.endsWith("'"))) {
        value = (value as string).slice(1, -1);
      }
      frontmatter[kvMatch[1]] = value;
    }
  }

  return { frontmatter, body };
}

function validateSkill(skillDir: string): { name: string; errors: string[]; warnings: string[] } {
  const name = basename(skillDir);
  const errors: string[] = [];
  const warnings: string[] = [];

  const skillMdPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    return { name, errors: ["SKILL.md not found"], warnings };
  }

  const content = readFileSync(skillMdPath, "utf-8");
  const { frontmatter, body, error } = parseFrontmatter(content);

  if (error) {
    errors.push(error);
    return { name, errors, warnings };
  }

  // Check for ignored keys (not an error, but worth noting)
  for (const key of Object.keys(frontmatter)) {
    if (IGNORED_KEYS.has(key)) {
      warnings.push(`Ignored key "${key}" (Eve strips this silently)`);
    }
  }

  // Check for unknown keys (Eve's expectOnlyKnownKeys will REJECT these)
  for (const key of Object.keys(frontmatter)) {
    if (!ALLOWED_KEYS.has(key) && !IGNORED_KEYS.has(key)) {
      errors.push(`Unknown key "${key}" — Eve's expectOnlyKnownKeys will reject this`);
    }
  }

  // description is REQUIRED for packaged skills
  if (!frontmatter.description) {
    errors.push('Missing required "description" — Eve will throw Missing required "description" frontmatter.');
  } else if (typeof frontmatter.description !== "string") {
    errors.push(`"description" must be string, got ${typeof frontmatter.description}`);
  }

  // metadata must be Record<string, string>
  if (frontmatter.metadata !== undefined) {
    if (typeof frontmatter.metadata !== "object" || Array.isArray(frontmatter.metadata)) {
      errors.push(`"metadata" must be Record<string, string>, got ${typeof frontmatter.metadata}`);
    }
    // In our simple parser, metadata is just a string value from YAML.
    // In real Eve, gray-matter parses nested YAML properly.
    // Our converter outputs: metadata:\n  source: "superpowers"\n  original_name: "brainstorming"
    // gray-matter would parse this as { source: "superpowers", original_name: "brainstorming" }
    // All values are strings — this is valid.
  }

  // Check body is non-empty
  if (!body.trim()) {
    warnings.push("Empty body after frontmatter");
  }

  return { name, errors, warnings };
}

// Run validation
const skillsDir = process.argv[2] || "/workspace/nexus-workspace/agent/skills";
console.log(`Validating Eve-compatible skills in: ${skillsDir}\n`);

const entries = readdirSync(skillsDir);
let totalErrors = 0;
let totalWarnings = 0;
let validated = 0;

for (const entry of entries) {
  const skillDir = join(skillsDir, entry);
  if (!statSync(skillDir).isDirectory()) continue;
  if (entry === "skill-index.md" || !existsSync(join(skillDir, "SKILL.md"))) continue;

  const result = validateSkill(skillDir);
  validated++;

  if (result.errors.length === 0 && result.warnings.length === 0) {
    console.log(`  [PASS] ${result.name}`);
  } else {
    for (const e of result.errors) {
      console.log(`  [FAIL] ${result.name}: ${e}`);
      totalErrors++;
    }
    for (const w of result.warnings) {
      console.log(`  [WARN] ${result.name}: ${w}`);
      totalWarnings++;
    }
  }
}

console.log(`\n${validated} skills validated, ${totalErrors} errors, ${totalWarnings} warnings`);
process.exit(totalErrors > 0 ? 1 : 0);
