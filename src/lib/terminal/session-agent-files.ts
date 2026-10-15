// The board's agents as Claude Code agent files (card 7939ee17).
//
// `claude --agents` only exists for sessions VibeCodes launches. Any other
// session (a terminal started by hand, a Claude Code cloud session) gets the
// same definitions as `.claude/agents/vc-*.md` files, which Claude Code watches
// and loads without a restart. The definitions come from buildSessionAgents, so
// names, prompts and match tags are identical to the `--agents` payload; this
// module only changes the container: a markdown file with YAML frontmatter, a
// fingerprint that survives a model retyping whitespace, and the one shell
// command that writes and verifies the file. The command carries the file
// itself, so it travels through the MCP connector and needs no network (card
// b9205d04).
//
// Server-side only (node:crypto). No agent text is ever logged or committed.

import { createHash, randomBytes } from "node:crypto";
import type { ClaudeCodeAgentDefinition } from "./session-agents";

/** `vc-<slug>-<id8>[-<tier>].md`: flat, lowercase, nothing a path can escape through. */
export const AGENT_FILE_NAME_PATTERN = /^vc-[a-z0-9-]+\.md$/;

const DISALLOWED_SEPARATOR = ", ";

function assertSafeName(name: string): void {
  if (!AGENT_FILE_NAME_PATTERN.test(`${name}.md`)) {
    throw new Error(`Unsafe agent file name: ${JSON.stringify(name)}`);
  }
}

/**
 * Starts the description of every file the sync writes. A claim that finds an
 * agent offered with a different tag re-syncs only when the offered
 * description starts with this: without it the copy came from VibeCodes'
 * `--agents` launch flag, which beats files on a name clash, so a sync can't
 * replace it.
 */
export const SYNC_MARKER = "Saved by sync_board_agents.";

/**
 * One agent file. The description is a JSON string (valid double-quoted YAML,
 * so colons and quotes in it can't break the frontmatter); the body is the
 * definition's prompt followed by exactly one newline. `synced` puts the
 * marker first; the match tag stays last.
 */
export function renderAgentFile(
  name: string,
  def: ClaudeCodeAgentDefinition,
  opts: { synced?: boolean } = {},
): string {
  assertSafeName(name);
  const description = opts.synced ? `${SYNC_MARKER} ${def.description}` : def.description;
  const lines = ["---", `name: ${name}`, `description: ${JSON.stringify(description)}`];
  if (def.model) lines.push(`model: ${def.model}`);
  if (def.effort) lines.push(`effort: ${def.effort}`);
  if (def.disallowedTools?.length) lines.push(`disallowedTools: ${def.disallowedTools.join(DISALLOWED_SEPARATOR)}`);
  lines.push("---", "");
  return lines.join("\n") + def.prompt.replace(/\n+$/, "") + "\n";
}

/** Inverse of renderAgentFile, for tests and for checking what a sync wrote. */
export function parseAgentFile(file: string): { name: string; def: ClaudeCodeAgentDefinition; synced: boolean } {
  const lines = file.split("\n");
  if (lines[0] !== "---") throw new Error("Agent file has no frontmatter");
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error("Agent file frontmatter is not closed");
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    const sep = line.indexOf(": ");
    if (sep > 0) fields.set(line.slice(0, sep), line.slice(sep + 2));
  }
  const name = fields.get("name");
  const description = fields.get("description");
  if (!name || description === undefined) throw new Error("Agent file is missing name or description");
  const model = fields.get("model");
  const effort = fields.get("effort");
  const disallowed = fields.get("disallowedTools");
  const parsed = JSON.parse(description) as string;
  const synced = parsed.startsWith(`${SYNC_MARKER} `);
  const def: ClaudeCodeAgentDefinition = {
    description: synced ? parsed.slice(SYNC_MARKER.length + 1) : parsed,
    prompt: lines.slice(end + 1).join("\n").replace(/\n$/, ""),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(disallowed ? { disallowedTools: disallowed.split(DISALLOWED_SEPARATOR) } : {}),
  };
  return { name, def, synced };
}

/**
 * Fingerprint of an agent file: trailing spaces, tabs and carriage returns
 * removed from every line, trailing newlines removed from the end, sha256 hex.
 * The shell side computes the same thing (`LC_ALL=C sed`, `$(...)`), so a
 * session that retypes the file with whitespace slips still verifies, and any
 * real edit does not.
 */
export function agentFileFingerprint(content: string): string {
  // Split on \n only (never JS's wider line terminators) to match sed.
  const normalised = content
    .split("\n")
    .map((line) => line.replace(/[ \t\r\v\f]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
  return createHash("sha256").update(normalised, "utf8").digest("hex");
}

/** The command (inline, one `bash -c`) must stay far under Linux's 128 KB argument limit. */
export const AGENT_FILE_MAX_BYTES = 90_000;

function heredocDelimiter(content: string): string {
  for (;;) {
    const delimiter = `VC_AGENT_${randomBytes(6).toString("hex").toUpperCase()}`;
    if (!content.includes(delimiter)) return delimiter;
  }
}

/**
 * The one command that writes a synced agent file and checks it. Run from the
 * project folder (the repo root). It:
 *  - picks the folder: `.claude/agents/` when it exists, else the user-level
 *    `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agents` when that exists, else it
 *    creates `.claude/agents/` (Claude Code never loads a folder created
 *    mid-session, so it prints NEW_FOLDER);
 *  - writes the file to a temp file in that folder, fingerprints it and, on a
 *    mismatch, deletes it and prints MISMATCH (exit 3), so an altered persona
 *    never lands;
 *  - moves it into place, and in the project folder of a git repo adds a
 *    `.gitignore` (`vc-*.md`) unless git already ignores the file;
 *  - pauses `settleSeconds` (Claude Code's folder watcher can lag the command's
 *    completion) and prints READY.
 * The file is a quoted heredoc, so nothing in it is expanded. No network.
 * Last line of output: READY, NEW_FOLDER or MISMATCH.
 */
export function agentFileSyncCommand(opts: {
  name: string;
  content: string;
  sha256: string;
  settleSeconds?: number;
}): string {
  const { name, content, sha256 } = opts;
  assertSafeName(name);
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("sha256 must be 64 lowercase hex characters");
  const settle = Math.max(0, Math.min(30, Math.floor(opts.settleSeconds ?? 5)));
  const body = content.endsWith("\n") ? content : `${content}\n`;
  const delimiter = heredocDelimiter(body);
  return `(
name='${name}'
want='${sha256}'
user_dir="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agents"
new=0
project=0
if [ -d .claude/agents ]; then dir=.claude/agents; project=1
elif [ -d "$user_dir" ]; then dir="$user_dir"
else dir=.claude/agents; project=1; new=1; mkdir -p "$dir" || exit 1
fi
tmp=$(mktemp "$dir/.$name.XXXXXX") || exit 1
trap 'rm -f "$tmp"' EXIT
cat > "$tmp" <<'${delimiter}'
${body}${delimiter}
if command -v sha256sum >/dev/null 2>&1; then hasher="sha256sum"; else hasher="shasum -a 256"; fi
norm=$(LC_ALL=C sed 's/[[:space:]]*$//' "$tmp")
got=$(printf '%s' "$norm" | $hasher | cut -d' ' -f1)
if [ "$got" != "$want" ]; then
  echo "MISMATCH: the saved file did not match its fingerprint, so it was deleted."
  exit 3
fi
mv -f "$tmp" "$dir/$name.md" || exit 1
trap - EXIT
if [ "$project" = 1 ] && git rev-parse --git-dir >/dev/null 2>&1 && ! git check-ignore -q "$dir/$name.md"; then
  if [ ! -e "$dir/.gitignore" ]; then printf 'vc-*.md\\n' > "$dir/.gitignore"
  elif ! grep -qxF 'vc-*.md' "$dir/.gitignore"; then printf 'vc-*.md\\n' >> "$dir/.gitignore"
  fi
fi
echo "Saved $name.md into $dir."
if [ "$new" = 1 ]; then
  echo "NEW_FOLDER"
else
  sleep ${settle}
  echo "READY"
fi
)`;
}
