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

// Card 11dc1212: a helper's cached context expires after 5 minutes without a
// call, and the next call then pays to read it all in again. This note is added
// to every Claude helper at delivery (never stored), so it covers every board
// and every future agent. Claude only: it names Claude Code's tools, and Codex
// is unmeasured. Keep every rule if the wording is tightened.
const WAITING_NOTE = [
  "## Waiting on slow work",
  "Your cached context expires after 5 minutes without a call, and the next call then pays to read all of it in again. So while you wait on anything slow (a full test run, an online check, a deploy), never let more than 4 minutes pass between your calls.",
  "- Never give one command a timeout over 240000 ms. Start anything that may take longer with run_in_background, ending with an exit marker and writing to a temporary log named for your step, so helpers running at once never share one (`<step8>` is the first 8 characters of your step id), for example `(npm run test; echo \"EXIT $?\") > /tmp/vc-wait-<step8>.log 2>&1`. That log is fine even if you're read-only. Then check it with a loop that finishes inside 4 minutes: `for i in $(seq 1 14); do grep -q '^EXIT ' /tmp/vc-wait-<step8>.log && break; sleep 15; done; tail -5 /tmp/vc-wait-<step8>.log`. Repeat until it's done. Check online runs the same way (`gh pr checks`, `gh run view`), never with `--watch` or `gh run watch`. There's no `timeout` command on these Macs.",
  "- Don't end your turn or use Monitor to wait for a background job: you'd sit idle and your context would expire.",
  "- If the wait will clearly take more than 30 minutes, don't wait. Hand back, saying what's still running and how to check it.",
].join("\n");

/** The note every Claude helper gets about slow waits. */
export const WAITING_NOTE_TEXT = WAITING_NOTE;

/**
 * The persona text as delivered: the stored prompt, then the Tools note for a
 * read-only agent, then (Claude only) the Waiting note. Every delivery route
 * and the session-tag fingerprint use this one function, so they always agree.
 */
export function agentPersonaBody(
  systemPrompt: string,
  access: ToolAccess | null | undefined,
  agent: "claude" | "codex" = "claude",
): string {
  const parts = [systemPrompt, toolAccessSection(access), agent === "claude" ? WAITING_NOTE : ""].filter(
    (p, i) => i === 0 || p,
  );
  return parts.join("\n\n");
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
