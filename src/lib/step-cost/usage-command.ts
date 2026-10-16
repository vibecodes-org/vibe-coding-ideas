// The command a session runs after a workflow step's subagent returns, to
// total that subagent's token use for complete_step/fail_step (card ba37039b).
//
// Claude Code writes every subagent's transcript to
// ${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<project>/<session>/subagents/agent-<agentId>.jsonl.
// Each line is one content block of one model call and repeats that call's
// `message.usage`. Input, cache-write and cache-read counts there are exact.
// Output counts are not: Claude Code saves them when the call starts
// streaming, so the command estimates output from the length of what the
// agent wrote (3.5 characters a token; signatures and block metadata left
// out). Thinking the API returned empty can't be counted. Output was 3-16%
// of a step's cost on the runs this was checked against (15 Oct 2026), so
// totals land within ~10%.
//
// Plain POSIX shell + awk (macOS and Linux, bash or zsh), read-only, no
// network. Prints one JSON line, or a line starting NO_TRANSCRIPT when a
// transcript can't be found or holds no model calls. The id list is split
// with $(printf …), which zsh (a Mac's default shell) splits too.

/** The placeholder the session replaces with the Agent tool's agentId(s). */
export const USAGE_COMMAND_PLACEHOLDER = "AGENT_ID";

// Kept free of single quotes: it is passed to awk inside '…'.
const AWK_PROGRAM = String.raw`
function num(s, key,   p) { p = "\"" key "\":[0-9]+"; if (match(s, p)) return substr(s, RSTART + length(key) + 3, RLENGTH - length(key) - 3) + 0; return 0 }
/"type":"assistant"/ {
  if (!match($0, /"id":"msg_[A-Za-z0-9_]+"/)) next
  id = substr($0, RSTART + 6, RLENGTH - 7)
  rest = $0; u = ""
  while (match(rest, /"usage":[{]/)) { u = substr(rest, RSTART); rest = substr(rest, RSTART + 9) }
  if (u == "") next
  m = "unknown"; if (match($0, /"model":"[^"]+"/)) m = substr($0, RSTART + 9, RLENGTH - 10)
  i = num(u, "input_tokens"); r = num(u, "cache_read_input_tokens"); w = num(u, "cache_creation_input_tokens"); h = num(u, "ephemeral_1h_input_tokens")
  if (m ~ /haiku-5-5/ && i + r + w > 100000) m = m "+long"
  model[id] = m; inp[id] = i; rd[id] = r; w1h[id] = h; w5m[id] = w - h
  o = num(u, "output_tokens"); if (o > rep[id]) rep[id] = o
  s = index($0, "\"content\":["); e = index($0, ",\"stop_reason\":")
  if (s > 0 && e > s) { seg = substr($0, s + 11, e - s - 11); gsub(/"signature":"[^"]*"/, "", seg); gsub(/"(type|id|name|caller|container)":("[^"]*"|null|[{][^{}]*[}])/, "", seg); len[id] += length(seg) }
}
END {
  for (id in model) {
    m = model[id]; est = int(len[id] / 3.5 + 0.5); out = (rep[id] > est) ? rep[id] : est
    C[m]++; I[m] += inp[id]; O[m] += out; R[m] += rd[id]; W5[m] += w5m[id]; W1[m] += w1h[id]
  }
  n = 0; body = ""
  for (m in C) {
    if (n++) body = body ","
    body = body sprintf("{\"model\":\"%s\",\"calls\":%d,\"input_tokens\":%d,\"output_tokens\":%d,\"cache_read_tokens\":%d,\"cache_write_5m_tokens\":%d,\"cache_write_1h_tokens\":%d}", m, C[m], I[m], O[m], R[m], W5[m], W1[m])
  }
  # A subagent that died on an API error has no real model calls to report.
  if (n == 0) { print "NO_TRANSCRIPT"; exit }
  printf "{\"models\":[%s],\"output_estimated\":true}\n", body
}`;

/**
 * The usage command with AGENT_ID still in it. The session swaps in the
 * agentId the Agent tool returned (several, space-separated, when the step's
 * subagent ran more than once) and runs it.
 */
export function stepUsageCommand(agentIds: string = USAGE_COMMAND_PLACEHOLDER): string {
  return `(
ids='${agentIds}'
root="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
list=""
for id in $(printf '%s\n' "$ids"); do
  case "$id" in ''|*[!A-Za-z0-9_-]*) echo "NO_TRANSCRIPT $id"; exit 0;; esac
  f=$(find "$root" -path "*/subagents/agent-$id.jsonl" -type f 2>/dev/null | head -n 1)
  if [ -z "$f" ]; then echo "NO_TRANSCRIPT $id"; exit 0; fi
  list="$list$f
"
done
[ -n "$list" ] || { echo "NO_TRANSCRIPT"; exit 0; }
printf '%s' "$list" | while IFS= read -r f; do cat "$f"; done | LC_ALL=C awk '${AWK_PROGRAM}'
)`;
}
