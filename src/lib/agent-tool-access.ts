// What an agent can do (task 472d5672, stage 1): two settings, stored in
// bot_profiles.tool_access. Read-only is for reviewers and checkers.
//
// It reaches a session two ways:
//  - everywhere: a "## Tools" note is added to the persona at delivery (never
//    stored, so it can't go stale);
//  - in-app Claude Code: the `--agents` definition also carries
//    `disallowedTools`. A denylist (not a `tools` allowlist) so Bash and the
//    board's MCP tools, which agents need for comments, stay available.

export type ToolAccess = "full" | "read_only";

export const TOOL_ACCESS_VALUES: readonly ToolAccess[] = ["full", "read_only"];

/** Anything that isn't exactly "read_only" is full access. */
export function normalizeToolAccess(value: unknown): ToolAccess {
  return value === "read_only" ? "read_only" : "full";
}

const READ_ONLY_NOTE =
  "## Tools\nYou're read-only: don't create, edit or delete files, including through shell commands. Say what should change instead.";

/** The persona note for an access level. "" for full access. */
export function toolAccessSection(access: ToolAccess | null | undefined): string {
  return normalizeToolAccess(access) === "read_only" ? READ_ONLY_NOTE : "";
}

const FILE_WRITING_TOOLS = ["Edit", "Write", "NotebookEdit"] as const;

/** Claude Code tool names to switch off, or null for full access. */
export function disallowedToolsFor(access: ToolAccess | null | undefined): string[] | null {
  return normalizeToolAccess(access) === "read_only" ? [...FILE_WRITING_TOOLS] : null;
}

/**
 * The persona text as delivered: the stored prompt, plus the Tools note for a
 * read-only agent. Full-access agents get exactly their stored prompt, so
 * session tags that were fingerprinted before this setting existed still match.
 */
export function agentPersonaBody(systemPrompt: string, access: ToolAccess | null | undefined): string {
  const section = toolAccessSection(access);
  return section ? `${systemPrompt}\n\n${section}` : systemPrompt;
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

const FILE_TOOL_NAMES = new Set(["edit", "write", "multiedit", "notebookedit"]);

/**
 * Read a Claude Code style agent file's tool settings into our two options.
 * An explicit `metadata.tool_access` wins; a deny list naming Edit or Write
 * means read-only; a `tools` list with no file-writing tool means read-only.
 */
export function toolAccessFromFrontmatter(input: {
  tools?: unknown;
  disallowedTools?: unknown;
  metadataToolAccess?: unknown;
}): ToolAccess {
  if (input.metadataToolAccess === "read_only" || input.metadataToolAccess === "full") {
    return input.metadataToolAccess;
  }
  const denied = toList(input.disallowedTools).map((t) => t.toLowerCase());
  if (denied.some((t) => t === "edit" || t === "write")) return "read_only";
  const allowed = toList(input.tools);
  if (allowed.length > 0 && !allowed.some((t) => FILE_TOOL_NAMES.has(t.toLowerCase()))) {
    return "read_only";
  }
  return "full";
}
