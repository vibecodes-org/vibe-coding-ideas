// In-app terminal — `vibecodes://launch?…` deep-link builder (SLICE 4, app side).
//
// The TYPED mirror of terminal/shared/deep-link.mjs. The app picks "In the browser",
// mints a session, and fires this link; the OS routes it to the installed helper
// (slice 7) which parses the IDENTICAL string back via the shared .mjs and attaches
// as the bridge leg. The two implementations are kept in lock-step by a drift test
// (deep-link.test.ts) that builds with THIS module and parses with the shared one —
// mirroring how connection.ts duplicates the relay close codes for the same reason
// (the .mjs is outside the app's TS build graph).
//
// `token` here is the app-minted, HMAC-signed BRIDGE-role token — the launch's only
// credential (the relay verifies it). It is a SECRET: never log a raw link, always
// redactDeepLinkToken() first.

/** Custom URL scheme the packaged helper registers (slice 7 OS bit). */
export const LAUNCH_SCHEME = "vibecodes";
/** The single action this scheme exposes today: `vibecodes://launch?…`. */
export const LAUNCH_HOST = "launch";

/**
 * Hard ceiling on the FULL `vibecodes://launch` URL. Custom-scheme URLs past an
 * OS limit can silently fail to launch (Windows ShellExecute ≈ 2083; macOS is
 * higher but finite — same failure mode as MAX_DEEP_LINK_URL_LENGTH in
 * launch-claude-code.ts). The dock budgets the optional `prompt` param against
 * this: budget = ceiling − (base link) − "&prompt=", enforced with the shared
 * enforcePromptLength (MCP head always survives; tail gets the …(truncated)
 * marker).
 */
export const MAX_LAUNCH_URL_LENGTH = 2048;

export interface LaunchDeepLinkParams {
  /** Relay base ws URL the helper should dial out to. */
  relay: string;
  /** Relay session id (sid) both legs pair on. */
  session: string;
  /** App-minted, HMAC-signed BRIDGE-role token (secret — keep out of logs). */
  token: string;
  /**
   * Optional app-minted HELPER-role token (card cc74a067), carried alongside
   * the bridge token on every launch so the same click (re)establishes the
   * helper's persistent control connection to the relay — see
   * terminal/helper/main.js. A helper that's already connected treats a
   * redundant one as a no-op. Secret — elided by redactDeepLinkToken.
   */
  helperToken?: string;
  /** Optional working directory for the spawned `claude`. */
  cwd?: string;
  /**
   * Optional compact bootstrap prompt for the spawned `claude`. Rides the link
   * as an INERT string: the bridge passes it to claude as ONE argv element and
   * NEVER executes, shell-splits, or logs it — and only spawns at all after the
   * relay has accepted the owner-bound token (R1). Elided from logs by
   * redactDeepLinkToken (it can contain user task/idea content).
   */
  prompt?: string;
  /**
   * Session entry chooser — Resume (card cbe60db5, design item 7/F4), LEGACY
   * path for a row with no tracked conversation id: when true, the bridge
   * spawns `claude --continue` in `cwd` instead of `claude "<prompt>"` —
   * continuing whatever's most recent ON DISK in that folder, not
   * necessarily the row the user clicked. `prompt` is ignored (and normally
   * absent) on a resume link. Superseded by `resumeId` when present — see
   * that field's doc.
   */
  resume?: boolean;
  /**
   * EXACT-CONVERSATION Resume (rework 5, card cbe60db5 — the proper fix for
   * Nick's field test: a `resume` link resumed the wrong conversation
   * because `--continue` doesn't know which row was clicked). A validated
   * UUID naming the SPECIFIC claude conversation to resume
   * (`terminal_sessions.claude_session_id`) — the bridge runs
   * `claude --resume <id>` instead of `--continue`. Wins over `resume` when
   * both are somehow set (see buildLaunchDeepLink).
   */
  resumeId?: string;
  /**
   * Bug B (card cbe60db5, Nick's field test 2026-08-15): the browser's real
   * panel size, computed via the SAME fit-addon call `sendResize()` already
   * uses (see use-terminal-session.ts's `currentLaunchDims`). Carrying it on
   * the launch link lets the bridge spawn the PTY at the correct size
   * instead of a hardcoded default — a promptless (Resume) launch spawns its
   * PTY synchronously, before the browser's own resize can ever reach a
   * not-yet-existent process (resize send is gated on status "connected",
   * which itself can't flip before something spawns and streams a byte).
   * Only meaningful as a pair; a caller that hasn't mounted xterm yet (an
   * unlikely fast-click race) omits both and the bridge falls back to its
   * pre-existing hardcoded default, exactly like before this field existed.
   */
  cols?: number;
  rows?: number;
}

/**
 * Build a `vibecodes://launch?relay=…&session=…&token=…[&helperToken=…]
 * [&cwd=…][&resume=1][&cols=…&rows=…][&prompt=…]` deep link. Throws when a
 * required field is missing so a malformed link is never fired. `prompt` is
 * always the LAST param so the base-link length (and therefore the prompt
 * budget) is stable — every other optional param, including `cols`/`rows`,
 * is inserted before it, alongside the other credentials.
 */
export function buildLaunchDeepLink({
  relay,
  session,
  token,
  helperToken,
  cwd,
  prompt,
  resume,
  resumeId,
  cols,
  rows,
}: LaunchDeepLinkParams): string {
  if (!relay || !session || !token) {
    throw new Error("buildLaunchDeepLink requires relay, session and token");
  }
  const parts = [
    `relay=${encodeURIComponent(relay)}`,
    `session=${encodeURIComponent(session)}`,
    `token=${encodeURIComponent(token)}`,
  ];
  if (helperToken) parts.push(`helperToken=${encodeURIComponent(helperToken)}`);
  if (cwd) parts.push(`cwd=${encodeURIComponent(cwd)}`);
  // resumeId (exact-conversation) wins over the legacy resume=1 flag — mirrors
  // terminal/shared/deep-link.mjs's precedence exactly (drift-tested).
  if (resumeId) {
    parts.push(`resume_id=${encodeURIComponent(resumeId)}`);
  } else if (resume) {
    parts.push(`resume=1`);
  }
  // Only ever sent as a pair — a lone dimension is useless to the bridge's
  // pty.spawn call. Mirrors terminal/shared/deep-link.mjs's `isValidLaunchDim`
  // guard exactly (drift-tested).
  if (isValidLaunchDim(cols) && isValidLaunchDim(rows)) {
    parts.push(`cols=${cols}`, `rows=${rows}`);
  }
  if (prompt) parts.push(`prompt=${encodeURIComponent(prompt)}`);
  return `${LAUNCH_SCHEME}://${LAUNCH_HOST}?${parts.join("&")}`;
}

/** A terminal dimension must be a positive, finite, sane integer — mirrors
 * connection.ts's `isValidDim` (duplicated, not imported, to keep this
 * builder dependency-free — same posture as its shared .mjs counterpart). */
function isValidLaunchDim(n: number | undefined): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 1000;
}

/**
 * Redact the secret/user-content params from a launch link so it is safe to
 * log: the `token` and `helperToken` (both credentials) and the `prompt`
 * (user task/idea content — log only its length via a separate field if
 * needed) all become `***` while relay/session survive for debugging.
 */
export function redactDeepLinkToken(url: string): string {
  return url
    .replace(/([?&]token=)[^&]*/g, "$1***")
    .replace(/([?&]helperToken=)[^&]*/g, "$1***")
    .replace(/([?&]prompt=)[^&]*/g, "$1***");
}
