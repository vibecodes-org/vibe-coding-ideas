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
//
// `worktree` (concurrent-terminal isolation — the QA-flagged fix: this used
// to be an ADVISORY TEXT PROTOCOL baked into the bootstrap prompt, which an
// agent could ignore and a URL length budget could silently drop with no
// enforcement fallback. Claude Code has a REAL, enforced native flag for
// exactly this — `--worktree <name>` (https://code.claude.com/docs/en/worktrees)
// — which the launched `claude` process itself refuses to let escape (edits/
// commands against the main checkout are blocked, not just discouraged), auto-
// creates the worktree under `.claude/worktrees/<name>/`, and auto-cleans up
// on exit) is appended as `--worktree <conv>` ONLY on branch 4, same
// fresh-launch-only posture as `model`/`permissionMode` — reusing the SAME id
// just minted for `--session-id` as the worktree name, so no separate name
// needs to travel over the wire (see deep-link.mjs's `worktree` boolean —
// it's a pure "isolate or not" flag, not a name carrier).
//
// Deliberately NEVER applied on branches 2/3 (`--resume <id>` / `--continue`):
// per the docs' "Resume a worktree session", resuming a session with
// `--resume`/`--continue` automatically reopens the SAME worktree it was
// originally launched in — no `--worktree` needed, and passing it again would
// risk fighting that native tracking rather than helping it. This mirrors
// `model`/`permissionMode`'s own "a resumed conversation keeps what it
// already had" rule exactly.

/**
 * @param {{ explicitCmd?: string | null, resumeId?: string | null, resume?: boolean, model?: string | null, permissionMode?: string | null, worktree?: boolean, mintId: () => string }} opts
 * @returns {{ cmd: string, conv: string | null }}
 */
export function resolveClaudeLaunch({ explicitCmd, resumeId, resume, model, permissionMode, worktree, mintId }) {
  if (explicitCmd) return { cmd: explicitCmd, conv: null };
  if (resumeId) return { cmd: `claude --resume ${resumeId}`, conv: resumeId };
  if (resume) return { cmd: "claude --continue", conv: null };
  const conv = mintId();
  const modelFlag = model ? ` --model ${model}` : "";
  // Defense-in-depth re-check: only the exact literal is ever appended, no
  // matter what arrives here — see the header comment.
  const permissionModeFlag = permissionMode === "auto" || permissionMode === "acceptEdits" ? ` --permission-mode ${permissionMode}` : "";
  // `conv` is a bridge-minted UUID (crypto.randomUUID()) — always a safe,
  // whitespace-free single argv token, same posture as the `--session-id`
  // flag it already rides alongside.
  const worktreeFlag = worktree ? ` --worktree ${conv}` : "";
  return { cmd: `claude --session-id ${conv}${modelFlag}${permissionModeFlag}${worktreeFlag}`, conv };
}

// ── Codex support (docs/codex-terminal-requirements.md FR-2, AC-3) ──────────
//
// A second agent the bridge can spawn. Pure mirror of
// src/lib/terminal/agent-launch.ts's `resolveAgentLaunch` — that TS module
// exists so the command-shape decision is unit-testable app-side without a
// real PTY/bridge/CLI (it predates this port and documents the Codex CLI
// findings in full); THIS is the bridge's own copy, duplicated rather than
// imported for the same reason deep-link.ts/.mjs duplicate their own logic
// across the TS/JS build-graph boundary. Both are drift-tested to agree —
// see resume-cmd.test.js's "matches src/lib/terminal/agent-launch.ts" block.
//
// Codex (v0.135.0) takes the prompt positionally and inherits its cwd from
// the spawning process — identical mechanism to Claude's, so index.js's
// existing "prompt as one argv element" / "cwd via PTY spawn opts" plumbing
// needs no change for Codex. What does NOT carry over: pre-assigned session
// ids, worktree isolation, model ids, and the auto-accept flag — none of
// those are ever safe to forward to Codex (either meaningless or actively
// wrong), so the codex branch below refuses to emit them regardless of what
// the caller passes in (AC-3's hard requirement) — `model`/`permissionMode`/
// `worktree` are simply never read on that branch.

/**
 * Resolve the command to spawn for a launch, agent-aware. `agent` absent or
 * anything other than the exact literal `"codex"` delegates straight to
 * {@link resolveClaudeLaunch} (Claude's own four branches, unchanged).
 *
 * @param {{ agent?: "claude"|"codex"|string|null, explicitCmd?: string | null, resumeId?: string | null, resume?: boolean, model?: string | null, permissionMode?: string | null, worktree?: boolean, mintId: () => string }} opts
 * @returns {{ cmd: string, conv: string | null }}
 */
export function resolveAgentLaunch({ agent, explicitCmd, resumeId, resume, model, permissionMode, worktree, mintId }) {
  if (agent !== "codex") {
    return resolveClaudeLaunch({ explicitCmd, resumeId, resume, model, permissionMode, worktree, mintId });
  }
  // An explicit --cmd/BRIDGE_CMD override always wins (dev/test convenience),
  // identical posture to Claude's branch 1 — `conv` is null either way.
  if (explicitCmd) return { cmd: explicitCmd, conv: null };
  // Exact resume (deferred feature, requirements FR-2: "the resolver should
  // support it now so the deep link shape is settled" — only reachable once
  // Codex conversation ids are tracked; harmless to support today).
  if (resumeId) return { cmd: `codex resume ${resumeId}`, conv: resumeId };
  // Legacy/most-recent resume — Codex's closest analogue to `--continue`.
  if (resume) return { cmd: "codex resume --last", conv: null };
  // Fresh launch: Codex has no pre-assignable session id (§2.2), so `conv` is
  // honestly null — nothing upstream may assume it's present. `model`,
  // `permissionMode` and `worktree` are deliberately never read here.
  return { cmd: "codex", conv: null };
}
