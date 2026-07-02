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
}

/**
 * Build a `vibecodes://launch?relay=…&session=…&token=…[&cwd=…][&prompt=…]`
 * deep link. Throws when a required field is missing so a malformed link is
 * never fired. `prompt` is always the LAST param so the base-link length (and
 * therefore the prompt budget) is stable.
 */
export function buildLaunchDeepLink({ relay, session, token, cwd, prompt }: LaunchDeepLinkParams): string {
  if (!relay || !session || !token) {
    throw new Error("buildLaunchDeepLink requires relay, session and token");
  }
  const parts = [
    `relay=${encodeURIComponent(relay)}`,
    `session=${encodeURIComponent(session)}`,
    `token=${encodeURIComponent(token)}`,
  ];
  if (cwd) parts.push(`cwd=${encodeURIComponent(cwd)}`);
  if (prompt) parts.push(`prompt=${encodeURIComponent(prompt)}`);
  return `${LAUNCH_SCHEME}://${LAUNCH_HOST}?${parts.join("&")}`;
}

/**
 * Redact the secret/user-content params from a launch link so it is safe to
 * log: the `token` (a credential) and the `prompt` (user task/idea content —
 * log only its length via a separate field if needed) both become `***` while
 * relay/session survive for debugging.
 */
export function redactDeepLinkToken(url: string): string {
  return url
    .replace(/([?&]token=)[^&]*/g, "$1***")
    .replace(/([?&]prompt=)[^&]*/g, "$1***");
}
