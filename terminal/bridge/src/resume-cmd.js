// Exact-conversation Resume (rework 5, card cbe60db5) — the pure decision of
// WHAT COMMAND to spawn and WHICH conversation id (if any) to announce
// upstream. Extracted out of the top-level launch-argv wiring in index.js so
// this branching is unit-testable without a real PTY/relay/claude binary.
//
// Nick's field test: a Resume click resumed a DIFFERENT, more-recent
// conversation than the one the clicked row described — because `claude
// --continue` only ever continues whatever's most recent ON DISK in a
// folder, decoupled from which row/session the click meant. The fix is to
// track the SPECIFIC claude conversation id per row and resume by id.
//
// EMPIRICAL FINDING (tested on this machine, see the implementation report):
// `claude --resume <id>` keeps appending to the SAME `<id>.jsonl` transcript
// file forever — it never forks to a new id. That means the id a session is
// FIRST minted under (via `--session-id <id>`, brand-new sessions) is the
// SAME id every future `--resume <id>` needs — no directory-watching, no
// race with claude's own file creation, and no need to mint a NEW id on
// every resume.
//
// Four launch shapes, in priority order:
//   1. `explicitCmd` (an explicit --cmd/BRIDGE_CMD override — dev/test
//      convenience) — never touched, no id minted or injected anywhere.
//      `conv` is null: this bridge has no idea what the overriding command
//      will actually run.
//   2. `resumeId` (a validated UUID — the row carries a tracked
//      `claude_session_id`) — `claude --resume <id>`, and `conv` is that
//      SAME id (per the empirical finding above).
//   3. `resume` (legacy — a row minted before this feature, no tracked id) —
//      `claude --continue`, today's best-effort behaviour. `conv` is null:
//      `--continue` doesn't accept (or report) a specific id, so there is
//      nothing honest to announce.
//   4. Neither — a brand-new session. `mintId()` mints the id (the bridge
//      itself, not the app — no directory-watching/race) and it's passed via
//      `--session-id`, so the very first mint is exact-resumable too.
//
// `resumeId` and `resume` are mutually exclusive on a real deep link (see
// terminal/shared/deep-link.mjs's build/parse precedence) — if a caller
// somehow sets both, `resumeId` wins here too, for the same reason: it is
// the verified-safe, exact path.
//
// `model` (task c4ca2d95, "Terminal starting model") is appended as
// `--model <value>` ONLY on branch 4 (a genuinely fresh session) —
// deliberately never read in branches 1-3. A resumed/continued conversation
// keeps whatever model it was already running on; appending a model flag
// there would be at best meaningless (`--continue`/`--resume` don't restart
// the model) and at worst confusing. `model` already arrived pre-validated
// (see index.js's LAUNCH_URL parse via the shared deep-link module's
// isSafeModelValue, and the config-time validateTerminalModelValue upstream
// of that) — it contains no whitespace or shell metacharacters, so it's
// safe to embed directly in this shell-split CMD string as a single token,
// identical in effect to appending it as a separate argv element.
//
// `permissionMode` (task d3de150c, "Terminal mode" auto-accept toggle) is
// appended as `--permission-mode <value>` ONLY on branch 4, same posture as
// `model` — a resumed/continued conversation keeps whatever permission mode
// it's already running under; Shift+Tab in the terminal is the live control
// for that, not this flag. UNLIKE `model`, this is re-validated here with a
// single-literal WHITELIST (only "auto" is ever appended), not just a
// shell-safety check — a hard requirement, since a wrong value here means
// Claude Code silently starts with the WRONG permission posture rather than
// merely picking the wrong model. The value already arrived parse-time
// validated by the same whitelist (see index.js's LAUNCH_URL parse via the
// shared deep-link module's isPermissionModeSafe); this is defense in depth,
// not the only gate.

/**
 * @param {{ explicitCmd?: string | null, resumeId?: string | null, resume?: boolean, model?: string | null, permissionMode?: string | null, mintId: () => string }} opts
 * @returns {{ cmd: string, conv: string | null }}
 */
export function resolveClaudeLaunch({ explicitCmd, resumeId, resume, model, permissionMode, mintId }) {
  if (explicitCmd) return { cmd: explicitCmd, conv: null };
  if (resumeId) return { cmd: `claude --resume ${resumeId}`, conv: resumeId };
  if (resume) return { cmd: "claude --continue", conv: null };
  const conv = mintId();
  const modelFlag = model ? ` --model ${model}` : "";
  // Defense-in-depth re-check: only the exact literal is ever appended, no
  // matter what arrives here — see the header comment.
  const permissionModeFlag = permissionMode === "auto" || permissionMode === "acceptEdits" ? ` --permission-mode ${permissionMode}` : "";
  return { cmd: `claude --session-id ${conv}${modelFlag}${permissionModeFlag}`, conv };
}
