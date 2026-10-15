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

export interface AgentSyncFile {
  name: string;
  content: string;
  sha256: string;
  /** The match tag (`[vc …]`), printed next to the name so the session can compare it with its claim. */
  tag?: string;
}

/**
 * Wait limits. The defaults are the real ones; tests pass short ones. Claude
 * Code's watcher polls every 30 s once a session has been idle for a minute
 * (card 0b5656a5), so the confirmed wait covers one full poll plus a re-touch.
 */
export interface AgentSyncOptions {
  /** Seconds to wait for the first read before re-touching the files. Default 5. */
  firstWaitSeconds?: number;
  /** Seconds per later round (each ends in a re-touch). Default 35. */
  laterWaitSeconds?: number;
  /** Re-touch rounds after the first wait. Default 2 (about 75 s in all). */
  retouchRounds?: number;
  /** Pause after the last read, so Claude Code finishes registering the agents. Default 1. */
  afterReadSeconds?: number;
  /** Without access times (noatime mounts): seconds before the re-touch, and after it. Default 4 and 34. */
  noAtimeFirstSeconds?: number;
  noAtimeSecondSeconds?: number;
  /** Tests only: take the no-atime branch even where access times work. */
  skipAtimeProbe?: boolean;
}

/** A wait or count from the options, kept to 0..max. */
const clamp = (value: number | undefined, fallback: number, max: number) =>
  Math.max(0, Math.min(max, Number.isFinite(value) ? (value as number) : fallback));

/** 2000-01-01 00:00: older than any real file, so "atime moved" means "someone read it". */
const OLD_ATIME = "200001010000";

/**
 * The one command that writes a run's synced agent files and waits until
 * Claude Code has loaded them. Run from the project folder (the repo root). It:
 *  - picks the folder: `.claude/agents/` when it exists, else the user-level
 *    `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agents` when that exists, else it
 *    creates `.claude/agents/` (Claude Code never loads a folder created
 *    mid-session, so it prints NEW_FOLDER and does not wait);
 *  - writes every file to a temp file in that folder and fingerprints each; on
 *    any mismatch it deletes them all and prints MISMATCH (exit 3), so an
 *    altered persona never lands and a half-written set never exists;
 *  - checks whether reads move a file's access time on this filesystem, sets
 *    each file's access time to the year 2000 and moves the files into place;
 *  - in the project folder of a git repo adds a `.gitignore` (`vc-*.md`)
 *    unless git already ignores the files;
 *  - waits until every file's access time has moved, which only happens when
 *    Claude Code reads the file to load it, then one more second, and prints
 *    READY. If nothing has been read after `firstWaitSeconds` it re-touches the
 *    files (a new modification time and a reset access time), which makes the
 *    watcher emit a file it lost when it switched poll rate; two more rounds
 *    of `laterWaitSeconds` each end the same way. After that: NOT_LOADED;
 *  - without access-time support it cannot confirm, so it waits a fixed
 *    `noAtimeFirstSeconds`, re-touches, waits `noAtimeSecondSeconds` and says
 *    READY (unconfirmed, sized to the 30 s poll).
 * Files are quoted heredocs, so nothing in them is expanded. No network.
 * Last line of output: READY, NEW_FOLDER, MISMATCH or NOT_LOADED.
 */
export function agentFilesSyncCommand(opts: { files: AgentSyncFile[]; confirm?: AgentSyncOptions }): string {
  const { files } = opts;
  if (files.length === 0) throw new Error("No agent files to sync");
  if (new Set(files.map((f) => f.name)).size !== files.length) throw new Error("Duplicate agent file name");
  for (const f of files) {
    assertSafeName(f.name);
    if (!/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error("sha256 must be 64 lowercase hex characters");
  }
  const c = opts.confirm ?? {};
  const tick = 0.5;
  const ticks = (seconds: number) => Math.max(1, Math.round(seconds / tick));
  const first = ticks(clamp(c.firstWaitSeconds, 5, 60));
  const later = ticks(clamp(c.laterWaitSeconds, 35, 60));
  const rounds = 1 + Math.floor(clamp(c.retouchRounds, 2, 4));
  const after = clamp(c.afterReadSeconds, 1, 10);
  const noAtime1 = clamp(c.noAtimeFirstSeconds, 4, 60);
  const noAtime2 = clamp(c.noAtimeSecondSeconds, 34, 60);

  const bodies = files.map((f) => (f.content.endsWith("\n") ? f.content : `${f.content}\n`));
  const delimiters = bodies.map((b) => heredocDelimiter(b));
  const tmpVars = files.map((_, i) => `"$t${i + 1}"`).join(" ");
  const finals = files.map((f) => `"$dir/${f.name}.md"`).join(" ");
  const names = files
    .map((f) => `${f.name}${f.tag && /^\[vc [^\]'\n]+\]$/.test(f.tag) ? ` ${f.tag}` : ""}`)
    .join("\n  ");

  return `(
user_dir="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agents"
new=0
project=0
if [ -d .claude/agents ]; then dir=.claude/agents; project=1
elif [ -d "$user_dir" ]; then dir="$user_dir"
else dir=.claude/agents; project=1; new=1; mkdir -p "$dir" || exit 1
fi
vc_sum() {
  norm=$(LC_ALL=C sed 's/[[:space:]]*$//' "$1")
  if command -v sha256sum >/dev/null 2>&1; then printf '%s' "$norm" | sha256sum | cut -d' ' -f1
  else printf '%s' "$norm" | shasum -a 256 | cut -d' ' -f1
  fi
}
vc_atime() { stat -c %X "$1" 2>/dev/null || stat -f %a "$1" 2>/dev/null || echo 0; }
trap 'rm -f ${tmpVars}' EXIT
${files.map((f, i) => `t${i + 1}=$(mktemp "$dir/.${f.name}.XXXXXX") || exit 1`).join("\n")}
${files.map((_, i) => `cat > "$t${i + 1}" <<'${delimiters[i]}'\n${bodies[i]}${delimiters[i]}`).join("\n")}
${files
  .map(
    (f, i) =>
      `if [ "$(vc_sum "$t${i + 1}")" != '${f.sha256}' ]; then echo "MISMATCH: ${f.name} did not match its fingerprint, so nothing was saved."; exit 3; fi`,
  )
  .join("\n")}
touch -a -t ${OLD_ATIME} "$t1"; cat "$t1" >/dev/null
${c.skipAtimeProbe ? "watch_reads=0" : `if [ "$(vc_atime "$t1")" -gt 1000000000 ]; then watch_reads=1; else watch_reads=0; fi`}
${files.map((f, i) => `touch -a -t ${OLD_ATIME} "$t${i + 1}"; mv -f "$t${i + 1}" "$dir/${f.name}.md" || exit 1`).join("\n")}
trap - EXIT
set -- ${finals}
if [ "$project" = 1 ] && git rev-parse --git-dir >/dev/null 2>&1; then
  for f in "$@"; do
    if ! git check-ignore -q "$f"; then
      if [ ! -e "$dir/.gitignore" ]; then printf 'vc-*.md\\n' > "$dir/.gitignore"
      elif ! grep -qxF 'vc-*.md' "$dir/.gitignore"; then
        if [ -s "$dir/.gitignore" ] && [ -n "$(tail -c 1 "$dir/.gitignore")" ]; then printf '\\n' >> "$dir/.gitignore"; fi
        printf 'vc-*.md\\n' >> "$dir/.gitignore"
      fi
      if ! git check-ignore -q "$f"; then echo "WARNING: $f is not git-ignored; do not commit it."; fi
    fi
  done
fi
echo "Saved ${files.length} agent file(s) into $dir:"
echo '  ${names}'
if [ "$new" = 1 ]; then echo "NEW_FOLDER"; exit 0; fi
if [ "$watch_reads" = 1 ]; then
  round=0
  while [ $round -lt ${rounds} ]; do
    i=0
    limit=${later}; if [ $round = 0 ]; then limit=${first}; fi
    while [ $i -lt $limit ]; do
      ok=1
      for f in "$@"; do if [ "$(vc_atime "$f")" -le 1000000000 ]; then ok=0; break; fi; done
      if [ $ok = 1 ]; then sleep ${after}; echo "Claude Code has read the saved agent file(s)."; echo "READY"; exit 0; fi
      sleep ${tick}
      i=$((i+1))
    done
    for f in "$@"; do touch "$f"; touch -a -t ${OLD_ATIME} "$f"; done
    round=$((round+1))
  done
  echo "NOT_LOADED"
else
  sleep ${noAtime1}
  for f in "$@"; do touch "$f"; done
  sleep ${noAtime2}
  echo "READY"
fi
)`;
}
