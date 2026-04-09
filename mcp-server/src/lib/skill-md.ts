/**
 * SKILL.md parser and generator for the Agent Skills open standard.
 * @see https://agentskills.io
 *
 * Handles conversion between VibeCodes bot_profiles and SKILL.md format.
 * No external dependencies — uses manual YAML frontmatter parsing.
 */

export interface SkillMetadata {
  source?: string;
  source_id?: string;
  role?: string;
  bio?: string;
  tags?: string[];
  author?: string;
  version?: string;
  [key: string]: unknown;
}

export interface ParsedSkill {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata: SkillMetadata;
  body: string;
}

interface BotForExport {
  id: string;
  name: string;
  role: string | null;
  system_prompt: string | null;
  bio: string | null;
  skills: string[] | null;
}

/**
 * Slugify a name: "QA Engineer" → "qa-engineer"
 */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

/**
 * Generate a SKILL.md string from a VibeCodes bot profile.
 */
export function generateSkillMd(bot: BotForExport): string {
  const slug = slugifyName(bot.name);

  // Build description: "Role agent — first 200 chars of prompt"
  const promptSnippet = (bot.system_prompt ?? "").slice(0, 200).replace(/\n/g, " ").trim();
  const description = bot.role
    ? `${bot.role} agent${promptSnippet ? ` — ${promptSnippet}` : ""}`
    : `VibeCodes agent${promptSnippet ? ` — ${promptSnippet}` : ""}`;

  const lines: string[] = ["---"];
  lines.push(`name: ${slug}`);
  lines.push(`description: ${yamlEscape(description.slice(0, 1024))}`);
  lines.push("license: MIT");

  // Metadata block
  lines.push("metadata:");
  lines.push("  source: vibecodes");
  lines.push(`  source_id: ${bot.id}`);
  if (bot.role) lines.push(`  role: ${yamlEscape(bot.role)}`);
  if (bot.bio) lines.push(`  bio: ${yamlEscape(bot.bio)}`);
  if (bot.skills && bot.skills.length > 0) {
    lines.push(`  tags: ${JSON.stringify(bot.skills)}`);
  }

  lines.push("---");
  lines.push("");
  lines.push(bot.system_prompt ?? "");

  return lines.join("\n");
}

/**
 * Parse a SKILL.md string into structured data.
 * Handles YAML frontmatter delimited by `---`.
 */
export function parseSkillMd(content: string): ParsedSkill {
  const trimmed = content.trim();

  if (!trimmed.startsWith("---")) {
    // No frontmatter — treat entire content as body, derive name from first line
    const firstLine = trimmed.split("\n")[0]?.replace(/^#+\s*/, "").trim() || "imported-skill";
    return {
      name: slugifyName(firstLine),
      description: firstLine,
      metadata: {},
      body: trimmed,
    };
  }

  // Find the closing `---`
  const secondDash = trimmed.indexOf("---", 3);
  if (secondDash === -1) {
    throw new Error("Invalid SKILL.md: missing closing --- for frontmatter");
  }

  const frontmatterRaw = trimmed.slice(3, secondDash).trim();
  const body = trimmed.slice(secondDash + 3).trim();

  // Parse YAML frontmatter (simple key-value, supports nested metadata block)
  const parsed = parseSimpleYaml(frontmatterRaw);

  const name = String(parsed.name || "imported-skill");
  const description = String(parsed.description || "");

  // Extract metadata
  const metadata: SkillMetadata = {};
  if (parsed.metadata && typeof parsed.metadata === "object") {
    const meta = parsed.metadata as Record<string, unknown>;
    if (meta.source) metadata.source = String(meta.source);
    if (meta.source_id) metadata.source_id = String(meta.source_id);
    if (meta.role) metadata.role = String(meta.role);
    if (meta.bio) metadata.bio = String(meta.bio);
    if (meta.author) metadata.author = String(meta.author);
    if (meta.version) metadata.version = String(meta.version);
    if (meta.tags) {
      metadata.tags = Array.isArray(meta.tags)
        ? meta.tags.map(String)
        : String(meta.tags).split(",").map((t) => t.trim()).filter(Boolean);
    }
    // Preserve any extra keys
    for (const [k, v] of Object.entries(meta)) {
      if (!(k in metadata)) {
        metadata[k] = v;
      }
    }
  }

  return {
    name,
    description,
    license: parsed.license ? String(parsed.license) : undefined,
    compatibility: parsed.compatibility ? String(parsed.compatibility) : undefined,
    metadata,
    body,
  };
}

/**
 * Infer a role from a parsed skill's metadata or description.
 */
export function inferRole(skill: ParsedSkill): string | null {
  if (skill.metadata.role) return skill.metadata.role;

  // Try to extract role from description pattern: "Role agent — ..."
  const match = skill.description.match(/^(.+?)\s+agent\b/i);
  if (match) return match[1].trim();

  return null;
}

/**
 * Generate a filename for downloading a SKILL.md file.
 */
export function skillFilename(name: string): string {
  return `${slugifyName(name)}.skill.md`;
}

// --- Internal helpers ---

/**
 * Escape a YAML string value. Wraps in quotes if it contains special chars.
 */
function yamlEscape(value: string): string {
  if (/[:#\[\]{}&*!|>'"%@`,?]/.test(value) || value.includes("\n")) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return value;
}

/**
 * Parse simple YAML (flat keys + one level of nesting for `metadata:`).
 * Not a full YAML parser — handles only the subset used by SKILL.md.
 */
function parseSimpleYaml(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split("\n");
  let currentBlock: string | null = null;
  let blockData: Record<string, unknown> = {};

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith("#")) continue;

    // Check if this is a nested line (starts with spaces)
    const indentMatch = line.match(/^(\s+)(\S.*)/);
    if (indentMatch && currentBlock) {
      const nested = indentMatch[2];
      const colonIdx = nested.indexOf(":");
      if (colonIdx > 0) {
        const key = nested.slice(0, colonIdx).trim();
        const val = nested.slice(colonIdx + 1).trim();
        blockData[key] = parseYamlValue(val);
      }
      continue;
    }

    // Top-level key
    if (indentMatch && !currentBlock) {
      // Indented line without a block — skip
      continue;
    }

    // Flush previous block
    if (currentBlock) {
      result[currentBlock] = blockData;
      currentBlock = null;
      blockData = {};
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();

    if (!val) {
      // Start of a nested block (e.g., `metadata:`)
      currentBlock = key;
      blockData = {};
    } else {
      result[key] = parseYamlValue(val);
    }
  }

  // Flush final block
  if (currentBlock) {
    result[currentBlock] = blockData;
  }

  return result;
}

/**
 * Parse a simple YAML value (string, number, boolean, JSON array).
 */
function parseYamlValue(val: string): unknown {
  // Remove surrounding quotes and unescape
  if (val.startsWith('"') && val.endsWith('"')) {
    return val.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (val.startsWith("'") && val.endsWith("'")) {
    return val.slice(1, -1);
  }

  // JSON array (used for tags)
  if (val.startsWith("[") && val.endsWith("]")) {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }

  // Booleans
  if (val === "true") return true;
  if (val === "false") return false;

  // Numbers
  if (/^\d+(\.\d+)?$/.test(val)) return Number(val);

  return val;
}
