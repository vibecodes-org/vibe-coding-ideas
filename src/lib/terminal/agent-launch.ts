// In-app terminal — agent-aware launch command resolver (Codex support,
// docs/codex-terminal-requirements.md FR-2/AC-3, implementation slice 1).
//
// Pure mirror of the bridge's resolveClaudeLaunch (terminal/bridge/src/
// resume-cmd.js), extended with a SECOND agent. Lives on the TS side (like
// deep-link.ts mirrors deep-link.mjs) so the command-shape decision is
// unit-testable without a real PTY/bridge/CLI. This slice does NOT touch the
// bridge itself — a future change ports this same branching into
// resume-cmd.js (or has it call out to a shared module), kept in lock-step
// the same way deep-link.ts/.mjs are, once the bridge grows a real spawn path
// for Codex.
//
// Codex (v0.135.0, requirements doc §2.2, checked against the real CLI) takes
// the prompt positionally and inherits its cwd from the spawning process —
// identical mechanism to Claude's, which is why the bridge's existing
// "prompt as one argv element" / "cwd via PTY spawn opts" plumbing needs no
// change. What does NOT carry over: pre-assigned session ids, worktree
// isolation, model ids, and the auto-accept flag — none of those are ever
// safe to forward to Codex (they're either meaningless or actively wrong), so
// this resolver refuses to emit them regardless of what the caller passes in
// (AC-3's hard requirement).

/** The two agents VibeCodes can launch. */
export type LaunchAgent = "claude" | "codex";

/**
 * Whitelist: anything other than the exact literal "codex" (absent, "claude",
 * "chatgpt", a typo, garbage) resolves to "claude" — the FR-1 default.
 * Mirrors the deep-link parser's own posture: an unrecognised value is never
 * forwarded, it just silently falls back rather than erroring.
 */
export function normalizeAgent(value: unknown): LaunchAgent {
  return value === "codex" ? "codex" : "claude";
}

export interface AgentLaunchOptions {
  /** Absent or anything other than "codex" resolves to "claude" (FR-1). */
  agent?: LaunchAgent | string | null;
  /**
   * Explicit --cmd/BRIDGE_CMD override (dev/test seam) — wins over
   * everything, for either agent. `conv` is null: the resolver has no idea
   * what the override actually runs. Mirrors resolveClaudeLaunch's branch 1.
   */
  explicitCmd?: string | null;
  /**
   * EXACT-CONVERSATION resume — a tracked conversation id for this row.
   * Claude: `claude --resume <id>`. Codex: `codex resume <id>` (FR-2; the
   * deferred exact-resume work has to land before a real link ever carries
   * this for Codex, but the resolver supports the shape now so the deep-link
   * contract is settled — requirements doc FR-2).
   */
  resumeId?: string | null;
  /**
   * LEGACY resume — no tracked id for this row. Claude: `claude --continue`.
   * Codex: `codex resume --last` (FR-2) — the closest analogue Codex has;
   * whether it's actually folder-filtered like Claude's continue is an open
   * spike (S-2), not this resolver's concern.
   */
  resume?: boolean;
  /** Claude-only. Ignored outright for Codex — never reaches the command
   *  (AC-3), even if a caller passes one through by mistake. */
  model?: string | null;
  /** Claude-only. Same posture as `model`. */
  permissionMode?: string | null;
  /**
   * Claude-only (native `--worktree`). Same posture as `model`. Codex has no
   * isolation flag (FR-9) — a second concurrent session just shares the
   * folder, warned about elsewhere, never enforced here.
   */
  worktree?: boolean;
  /**
   * Mints a fresh conversation id for a brand-new CLAUDE session (branch 4 of
   * resolveClaudeLaunch). Codex never calls this: it has no pre-assignable
   * session id (§2.2), so a fresh Codex launch's `conv` is always null.
   */
  mintId: () => string;
}

export interface ResolvedAgentLaunch {
  /**
   * The shell-split command line the bridge spawns (mirrors
   * resolveClaudeLaunch's `cmd`) — the prompt itself is NEVER part of this
   * string; it rides as one separate, never-shell-split argv element, exactly
   * as today for Claude, and identically for Codex (§2.2: positional prompt,
   * same mechanism).
   */
  cmd: string;
  /** The conversation id to announce upstream, or null when none is known. */
  conv: string | null;
}

/**
 * Resolve the command to spawn for a launch, agent-aware. See the file header
 * for what does and doesn't carry over to Codex. Claude's own branching is
 * unchanged from resolveClaudeLaunch (terminal/bridge/src/resume-cmd.js) —
 * duplicated here (not imported) because that module lives outside the app's
 * TS build graph, same posture as deep-link.ts/.mjs.
 */
export function resolveAgentLaunch(opts: AgentLaunchOptions): ResolvedAgentLaunch {
  const { explicitCmd, resumeId, resume, model, permissionMode, worktree, mintId } = opts;
  const agent = normalizeAgent(opts.agent);

  if (explicitCmd) return { cmd: explicitCmd, conv: null };

  if (agent === "codex") {
    // Never emit --model / --permission-mode / --session-id / --worktree for
    // Codex, no matter what the caller passed in above — AC-3's hard
    // requirement. Those options simply aren't read past this point.
    if (resumeId) return { cmd: `codex resume ${resumeId}`, conv: resumeId };
    if (resume) return { cmd: "codex resume --last", conv: null };
    // Fresh Codex launch: no pre-assignable session id (§2.2) — conv is
    // honestly null, same posture as Claude's legacy `--continue` branch.
    return { cmd: "codex", conv: null };
  }

  // Claude — unchanged from resolveClaudeLaunch's four branches.
  if (resumeId) return { cmd: `claude --resume ${resumeId}`, conv: resumeId };
  if (resume) return { cmd: "claude --continue", conv: null };
  const conv = mintId();
  const modelFlag = model ? ` --model ${model}` : "";
  const permissionModeFlag =
    permissionMode === "auto" || permissionMode === "acceptEdits"
      ? ` --permission-mode ${permissionMode}`
      : "";
  const worktreeFlag = worktree ? ` --worktree ${conv}` : "";
  return {
    cmd: `claude --session-id ${conv}${modelFlag}${permissionModeFlag}${worktreeFlag}`,
    conv,
  };
}
