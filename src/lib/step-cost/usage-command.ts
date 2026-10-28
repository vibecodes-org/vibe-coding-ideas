// The command a session runs when a workflow step's work is done, to total
// that step's token use for complete_step/fail_step (card ba37039b).
//
// A step's cost is every model call made for it: the session's own calls
// from the claim onward (all of the work when the session did the step
// itself, the hand-off and wrap-up when a subagent did it) plus the calls of
// each subagent that did the work.
//
// Steps run side by side (card 5e654dd1, stage 16): one session can hold
// several claims at once, and its own calls then serve all of them. Each of
// the session's calls is split equally across the steps open at that moment,
// so the coordinator's work is counted once in total rather than once per
// open step (26 Oct 2026: five bugs at once showed Opus $21, about $16 real).
// A step is open from its claim to the first of: a Bash call holding its
// marker (the session running that step's usage command), or the accepted
// result (no is_error) of a complete_step/fail_step call carrying its claim
// token (card 1117ac6b, stage 5: a step finished without its usage run used
// to stay open for ever and shrink every later step's share). Only a real
// claim opens a step: the line where a marker first appears must also hold a
// claim token (ct_ + 48 hex), or the marker is this command's own. Stray
// copies of a marker (a search of old transcripts, say) never join. The
// step's own count stops at its own usage run. Subagent calls count in full,
// from the claim's time onward: a subagent resumed for rework keeps its
// earlier rounds in its file, and those belong to the earlier claim. A claim
// line with no timestamp counts every subagent call. The script's file name
// carries its hash, so a machine keeps running its older saved copy until the
// helper next starts a session and saves this one.
//
// Claude Code writes the session's transcript to
// ${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<project>/<session>.jsonl and each
// subagent's to <project>/<session>/subagents/agent-<agentId>.jsonl. The
// claim response carries a random marker inside this command, so the first
// line of the session transcript holding the marker is the claim: the
// command counts the session's calls after it. Each line is one content block
// of one model call and repeats that call's `message.usage`. Input,
// cache-write and cache-read counts there are exact. Output counts are not:
// Claude Code saves them when the call starts streaming, so the command
// estimates output from the length of what the model wrote (3.5 characters a
// token; signatures and block metadata left out). Thinking the API returned
// empty can't be counted. Output was 3-16% of a step's cost on the runs this
// was checked against (15 Oct 2026), so totals land within ~10%.
//
// Plain POSIX shell + awk (macOS and Linux, bash or zsh), read-only, no
// network. Prints one JSON line, or a line starting NO_TRANSCRIPT when a
// transcript can't be found or holds no model calls. The id list is split
// with $(printf …), which zsh (a Mac's default shell) splits too.
//
// scripts/lib/step-usage-backfill.mjs applies the same rules to past runs;
// keep the two in step.

import { createHash, randomBytes } from "crypto";

/** The placeholder the session replaces with the Agent tool's agentId(s). */
export const USAGE_COMMAND_PLACEHOLDER = "AGENT_ID";

// Kept free of single quotes: it is passed to awk inside '…'. In the
// session transcript (FILENAME == main) nothing counts until the marker line.
const AWK_PROGRAM = String.raw`
FILENAME == main {
  if (done) next
  sk = !on; if (!on && index($0, mark)) { on = 1; if (match($0, /"timestamp":"[^"]+"/)) t0 = substr($0, RSTART + 13, RLENGTH - 14) }
  if (/"isSidechain":true/) next
  cl = /"type":"assistant"/ && /"name":"Bash"/; r = $0; nk = 0; split("", ln); ct = ctok($0)
  while (match(r, /vcu_[0-9a-f]+/)) {
    k = substr(r, RSTART, RLENGTH); r = substr(r, RSTART + RLENGTH); if (k in ln) continue; ln[k] = 1
    if (!(k in sn)) { sn[k] = 1; if (ct != "" || k == mark) { lv[k] = 1; nl++; if (ct != "") tk[ct] = tk[ct] " " k } }
    else { if (cl && (k in lv)) sh[++nk] = k; if (cl && k == mark && !sk) done = 1 }
  }
  if (/"type":"assistant"/ && /"name":"[^"]*__(complete|fail)_step"/ && ct != "" && match($0, /"id":"toolu_[A-Za-z0-9_]+"/)) pc[substr($0, RSTART + 6, RLENGTH - 7)] = ct
  if (match($0, /"tool_use_id":"[A-Za-z0-9_]+"/)) {
    tid = substr($0, RSTART + 15, RLENGTH - 16)
    if (tid in pc) { if (!/"is_error":true/) { nn = split(tk[pc[tid]], cm, " "); for (j = 1; j <= nn; j++) if (cm[j] in lv) sh[++nk] = cm[j] } delete pc[tid] }
  }
  lw = 1 / (nl ? nl : 1)
  for (j = 1; j <= nk; j++) if (sh[j] in lv) { delete lv[sh[j]]; nl-- }
  if (sk) next
}
function ctok(s) { while (match(s, /ct_[0-9a-f]+/)) { if (RLENGTH == 51) return substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH) } return "" }
function q(x) { return int(x + 0.5) }
function num(s, key,   p) { p = "\"" key "\":[0-9]+"; if (match(s, p)) return substr(s, RSTART + length(key) + 3, RLENGTH - length(key) - 3) + 0; return 0 }
/"type":"assistant"/ {
  if (FILENAME != main && t0 != "" && match($0, /"timestamp":"[^"]+"/) && substr($0, RSTART + 13, RLENGTH - 14) < t0) next
  if (!match($0, /"id":"msg_[A-Za-z0-9_]+"/)) next
  id = substr($0, RSTART + 6, RLENGTH - 7)
  rest = $0; u = ""
  while (match(rest, /"usage":[{]/)) { u = substr(rest, RSTART); rest = substr(rest, RSTART + 9) }
  if (u == "") next
  m = "unknown"; if (match($0, /"model":"[^"]+"/)) m = substr($0, RSTART + 9, RLENGTH - 10)
  i = num(u, "input_tokens"); r = num(u, "cache_read_input_tokens"); w = num(u, "cache_creation_input_tokens"); h = num(u, "ephemeral_1h_input_tokens")
  if (m ~ /haiku-5-5/ && i + r + w > 100000) m = m "+long"
  model[id] = m; inp[id] = i; rd[id] = r; w1h[id] = h; w5m[id] = (w > h) ? w - h : 0
  if (!(id in wt)) wt[id] = (FILENAME == main) ? lw : 1
  o = num(u, "output_tokens"); if (o > rep[id]) rep[id] = o
  s = index($0, "\"content\":["); e = index($0, ",\"stop_reason\":")
  if (s > 0 && e > s) { seg = substr($0, s + 11, e - s - 11); gsub(/"signature":"[^"]*"/, "", seg); gsub(/"(type|id|name|caller|container)":("[^"]*"|null|[{][^{}]*[}])/, "", seg); len[id] += length(seg) }
}
END {
  for (id in model) {
    m = model[id]; est = int(len[id] / 3.5 + 0.5); out = (rep[id] > est) ? rep[id] : est; f = wt[id]
    C[m] += f; I[m] += inp[id] * f; O[m] += out * f; R[m] += rd[id] * f; W5[m] += w5m[id] * f; W1[m] += w1h[id] * f
  }
  n = 0; body = ""
  for (m in C) {
    if (n++) body = body ","
    body = body sprintf("{\"model\":\"%s\",\"calls\":%d,\"input_tokens\":%d,\"output_tokens\":%d,\"cache_read_tokens\":%d,\"cache_write_5m_tokens\":%d,\"cache_write_1h_tokens\":%d}", m, q(C[m]), q(I[m]), q(O[m]), q(R[m]), q(W5[m]), q(W1[m]))
  }
  # A subagent that died on an API error has no real model calls to report.
  if (n == 0) { print "NO_TRANSCRIPT"; exit }
  printf "{\"models\":[%s],\"output_estimated\":true}\n", body
}`;

/** A fresh marker for one claim: lets the command find the claim in the session transcript. */
export function newUsageMarker(): string {
  return `vcu_${randomBytes(12).toString("hex")}`;
}

/**
 * The usage command with AGENT_ID still in it. The session swaps in the
 * agentId of each subagent that did the step's work (space-separated) and
 * runs it, or runs it unchanged when it did the work itself.
 */
// Everything after the marker and ids are known. Shared by the long command
// below and by the script file the helper saves (stepUsageScript), so the two
// can't drift.
const USAGE_BODY = `root="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
main=$(find "$root" -type f -name '*.jsonl' ! -path '*/subagents/*' -mmin -720 -exec grep -lF "$mark" {} + 2>/dev/null |
  { m=''; while IFS= read -r f; do if [ -z "$m" ] || [ "$f" -nt "$m" ]; then m=$f; fi; done; printf '%s' "$m"; })
set --
[ -n "$main" ] && set -- "$main"
for id in $(printf '%s\n' "$ids"); do
  case "$id" in *[!A-Za-z0-9_-]*) echo "NO_TRANSCRIPT $id"; exit 0;; esac
  f=$(find "$root" -path "*/subagents/agent-$id.jsonl" -type f 2>/dev/null | head -n 1)
  if [ -z "$f" ]; then echo "NO_TRANSCRIPT $id"; exit 0; fi
  set -- "$@" "$f"
done
[ $# -gt 0 ] || { echo "NO_TRANSCRIPT"; exit 0; }
LC_ALL=C awk -v mark="$mark" -v main="$main" '${AWK_PROGRAM}' "$@"`;

/**
 * The usage command with AGENT_ID still in it. The session swaps in the
 * agentId of each subagent that did the step's work (space-separated) and
 * runs it, or runs it unchanged when it did the work itself.
 */
export function stepUsageCommand(marker: string, agentIds: string = USAGE_COMMAND_PLACEHOLDER): string {
  if (!/^vcu_[0-9a-f]+$/.test(marker)) throw new Error("bad usage marker");
  // AGENT_I[D] keeps the placeholder's text out of the test, so swapping
  // AGENT_ID for real ids can't rewrite it too. A forked session's transcript
  // repeats the claim, so the newest file holding the marker is this session's.
  return `(
ids='${agentIds}'
mark='${marker}'
case "$ids" in AGENT_I[D]) ids='';; esac
${USAGE_BODY}
)`;
}

// ---- The saved-script form (card 5e654dd1, stage 2b) -----------------------
// The long command is about 3,000 characters and rides in every hand-off. The
// helper app can save it once as a file instead, and the hand-off then carries
// a command of about 200 characters that runs the file. The file is the same
// logic, taking the marker and the agent ids as arguments, so it never changes
// per claim: its name carries the first 8 hex digits of its own SHA-256, so a
// changed script gets a new name and an old copy is never run by mistake.

/** The file name the helper accepts: step-usage-<8 hex>.sh, nothing else. */
export const STEP_USAGE_SCRIPT_NAME = /^step-usage-[0-9a-f]{8}$/;
export const STEP_USAGE_SCRIPT_FILE = /^step-usage-[0-9a-f]{8}\.sh$/;

const STEP_USAGE_SCRIPT_BODY = `#!/bin/sh
# VibeCodes: totals one workflow step's token use. Args: <marker> <agent ids>.
mark=$1
ids=$2
case "$mark" in vcu_*[!0-9a-f]*|vcu_) echo "NO_TRANSCRIPT"; exit 0;; vcu_*) ;; *) echo "NO_TRANSCRIPT"; exit 0;; esac
case "$ids" in AGENT_I[D]) ids='';; esac
${USAGE_BODY}
`;

/** The script the helper saves: its file name and its text. */
export function stepUsageScript(): { file: string; body: string } {
  const sha8 = createHash("sha256").update(STEP_USAGE_SCRIPT_BODY).digest("hex").slice(0, 8);
  return { file: `step-usage-${sha8}.sh`, body: STEP_USAGE_SCRIPT_BODY };
}

/**
 * The short command: runs the saved script, or prints NO_TRANSCRIPT no-script
 * when it isn't there (a session the helper didn't launch, or an older
 * helper). A session launched before the script last changed only has the
 * older copy, so it falls back to the newest saved one (same arguments) rather
 * than losing the step's cost until a relaunch. When there is no file at all
 * the line carries the marker ("NO_TRANSCRIPT no-script <marker>"), so the
 * server can answer it with the full command to run once (card 1117ac6b,
 * stage 4). The site never asks a session to save a file; only the helper does.
 */
export function stepUsageShortCommand(
  marker: string,
  file: string = stepUsageScript().file,
  agentIds: string = USAGE_COMMAND_PLACEHOLDER,
): string {
  if (!/^vcu_[0-9a-f]+$/.test(marker)) throw new Error("bad usage marker");
  if (!STEP_USAGE_SCRIPT_FILE.test(file)) throw new Error("bad usage script name");
  return `m=${marker}; d="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/vibecodes"; f="$d/${file}"; [ -s "$f" ] || f=$(ls -t "$d"/step-usage-*.sh 2>/dev/null | head -n 1); if [ -s "$f" ]; then sh "$f" $m '${agentIds}'; else echo "NO_TRANSCRIPT no-script $m"; fi`;
}

/** The line the short command prints when the saved script is missing; the capture is the claim's marker. */
export const NO_SCRIPT_LINE = /^NO_TRANSCRIPT no-script (vcu_[0-9a-f]+)$/;

/** The marker from a no-script line, or null for anything else (including the older marker-less line). */
export function noScriptMarker(usage: unknown): string | null {
  if (typeof usage !== "string") return null;
  const m = NO_SCRIPT_LINE.exec(usage.trim());
  return m ? m[1] : null;
}
