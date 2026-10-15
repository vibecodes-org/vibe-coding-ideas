// The board's agents as Claude Code agent files (card 7939ee17).
//
// `claude --agents` only exists for sessions VibeCodes launches. Any other
// session (a terminal started by hand, a Claude Code cloud session) gets the
// same definitions as `.claude/agents/vc-*.md` files, which Claude Code watches
// and loads without a restart. The definitions come from buildSessionAgents, so
// names, prompts and match tags are identical to the `--agents` payload; this
// module only changes the container: a markdown file with YAML frontmatter, a
// minimal tar to carry several of them in one download, and the shell command
// that installs the download.
//
// Server-side only (Buffer). No agent text is ever logged or committed.

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
 * One agent file. The description is a JSON string (valid double-quoted YAML,
 * so colons and quotes in it can't break the frontmatter); the body is the
 * definition's prompt, unchanged.
 */
export function renderAgentFile(name: string, def: ClaudeCodeAgentDefinition): string {
  assertSafeName(name);
  const lines = ["---", `name: ${name}`, `description: ${JSON.stringify(def.description)}`];
  if (def.model) lines.push(`model: ${def.model}`);
  if (def.effort) lines.push(`effort: ${def.effort}`);
  if (def.disallowedTools?.length) lines.push(`disallowedTools: ${def.disallowedTools.join(DISALLOWED_SEPARATOR)}`);
  lines.push("---", "");
  return lines.join("\n") + def.prompt;
}

/** Inverse of renderAgentFile, for tests and for checking what a sync wrote. */
export function parseAgentFile(file: string): { name: string; def: ClaudeCodeAgentDefinition } {
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
  const def: ClaudeCodeAgentDefinition = {
    description: JSON.parse(description) as string,
    prompt: lines.slice(end + 1).join("\n"),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(disallowed ? { disallowedTools: disallowed.split(DISALLOWED_SEPARATOR) } : {}),
  };
  return { name, def };
}

const BLOCK = 512;

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function tarEntry(fileName: string, content: Buffer): Buffer {
  if (Buffer.byteLength(fileName) > 100) throw new Error("Agent file name too long for a tar header");
  const header = Buffer.alloc(BLOCK);
  header.write(fileName, 0, "utf8");
  header.write(octal(0o644, 8), 100, "ascii");
  header.write(octal(0, 8), 108, "ascii");
  header.write(octal(0, 8), 116, "ascii");
  header.write(octal(content.length, 12), 124, "ascii");
  header.write(octal(0, 12), 136, "ascii");
  header.write("        ", 148, "ascii"); // checksum placeholder: eight spaces
  header.write("0", 156, "ascii"); // regular file
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  const padding = Buffer.alloc((BLOCK - (content.length % BLOCK)) % BLOCK);
  return Buffer.concat([header, content, padding]);
}

/** A ustar archive of flat `<name>.md` files, readable by any tar. */
export function buildAgentFilesTar(agents: Record<string, ClaudeCodeAgentDefinition>): Buffer {
  const entries = Object.entries(agents).map(([name, def]) =>
    tarEntry(`${name}.md`, Buffer.from(renderAgentFile(name, def), "utf8")),
  );
  return Buffer.concat([...entries, Buffer.alloc(BLOCK * 2)]);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The one command the session runs from the project folder. It downloads the
 * archive, swaps the old `vc-*.md` files for the new ones (other files in
 * `.claude/agents/` are never touched), and makes sure git ignores them: a
 * repo with its own ignore rule is left alone, any other repo gets a line in
 * `.git/info/exclude`, which is local and never committed. Fails with a
 * non-zero exit and a hint when the download can't be made.
 */
export function syncCommand(url: string): string {
  return `(
set -e
dir=.claude/agents
fresh=0
[ -d "$dir" ] || { mkdir -p "$dir"; fresh=1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsS --max-time 20 -o "$tmp/agents.tar" ${shellQuote(url)} || {
  echo "Could not download the board agents. If this is a Claude Code cloud session, add vibecodes.co.uk to the environment's allowed domains." >&2
  exit 1
}
if [ ! -s "$tmp/agents.tar" ]; then
  echo "VibeCodes has no agents to sync for this board."
  exit 0
fi
mkdir "$tmp/out"
tar -xf "$tmp/agents.tar" -C "$tmp/out"
rm -f "$dir"/vc-*.md
count=0
for f in "$tmp"/out/vc-*.md; do
  [ -e "$f" ] || continue
  mv "$f" "$dir/"
  count=$((count + 1))
done
if git rev-parse --git-dir >/dev/null 2>&1; then
  sample=$(ls "$dir"/vc-*.md 2>/dev/null | head -n 1)
  if [ -n "$sample" ] && ! git check-ignore -q "$sample"; then
    exclude=$(git rev-parse --git-path info/exclude)
    mkdir -p "$(dirname "$exclude")"
    echo '.claude/agents/vc-*.md' >> "$exclude"
  fi
fi
echo "Synced $count board agents into $dir."
if [ "$fresh" = 1 ]; then
  echo "The agents folder was new, so Claude Code may only load them from the next session."
fi
)`;
}
