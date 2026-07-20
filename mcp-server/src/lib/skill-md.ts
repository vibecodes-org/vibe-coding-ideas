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

  // Top-level fallback: authors routinely write `role:` / `source:` /
  // `source_id:` at the top level of the frontmatter rather than nested under
  // `metadata:`. Silently dropping them caused duplicate agents on re-import
  // (round-trip dedup never fired) and regex-inferred roles. The nested block
  // still wins so genuine VibeCodes exports are unaffected.
  if (!metadata.source && parsed.source) metadata.source = String(parsed.source);
  if (!metadata.source_id && parsed.source_id) metadata.source_id = String(parsed.source_id);
  if (!metadata.role && parsed.role) metadata.role = String(parsed.role);
  if (!metadata.bio && parsed.bio) metadata.bio = String(parsed.bio);
  if (!metadata.author && parsed.author) metadata.author = String(parsed.author);
  if (!metadata.version && parsed.version) metadata.version = String(parsed.version);
  if (!metadata.tags && parsed.tags) {
    metadata.tags = Array.isArray(parsed.tags)
      ? parsed.tags.map(String)
      : String(parsed.tags).split(",").map((t) => t.trim()).filter(Boolean);
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

// --- Internal helpers ---

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
