// Shared terminal launch deep-link module — SLICE 4 (vibecodes:// auto-launch).
//
// ONE implementation of the `vibecodes://launch?…` URL scheme, imported by every
// party that has to AGREE on its shape:
//   - the VibeCodes app (src/lib/terminal/deep-link.ts)  — BUILDS the link (typed
//     mirror; the app is TS and can't import this .mjs into its component tree
//     cleanly, so it re-implements build/redact and a drift test pins the two).
//   - the bridge (terminal/bridge/src/index.js)          — PARSES the link it is
//     handed via `--launch-url` (exactly what a packaged helper's URL-scheme
//     handler will call in slice 7).
//   - the test harness (terminal/test/*.mjs)             — BUILDS + PARSES.
//
// The link carries everything the local helper needs to attach as the BRIDGE leg:
//   relay   — relay base ws URL
//   session — relay session id (sid)
//   token   — the app-minted, HMAC-signed BRIDGE-role token (this IS the launch's
//             credential; the relay verifies it, so no extra signature is needed)
//   cwd     — optional working directory
//
// The `token` is a secret. NEVER log a raw link — use redactDeepLinkToken first.
//
// Pure + dependency-free (only the global WHATWG `URL`), so it runs unchanged in
// Node (bridge) and is trivially unit-testable.

/** Custom URL scheme the packaged helper registers (slice 7 OS bit). */
export const LAUNCH_SCHEME = "vibecodes";
/** The single action this scheme exposes today: `vibecodes://launch?…`. */
export const LAUNCH_HOST = "launch";

/**
 * Build a `vibecodes://launch?relay=…&session=…&token=…[&cwd=…]` deep link.
 *
 * Uses encodeURIComponent so reserved characters in the relay URL / token survive
 * the round-trip. `cwd` is omitted entirely when absent (no empty param). Throws
 * when a required field is missing so a malformed link is never fired.
 *
 * @param {{ relay: string, session: string, token: string, cwd?: string }} params
 * @returns {string}
 */
export function buildLaunchDeepLink({ relay, session, token, cwd } = {}) {
  if (!relay || !session || !token) {
    throw new Error("buildLaunchDeepLink requires relay, session and token");
  }
  const parts = [
    `relay=${encodeURIComponent(relay)}`,
    `session=${encodeURIComponent(session)}`,
    `token=${encodeURIComponent(token)}`,
  ];
  if (cwd) parts.push(`cwd=${encodeURIComponent(cwd)}`);
  return `${LAUNCH_SCHEME}://${LAUNCH_HOST}?${parts.join("&")}`;
}

/**
 * Parse a `vibecodes://launch?…` deep link into `{ relay, session, token, cwd }`,
 * or null when it is not a well-formed launch link (wrong scheme/action, or any
 * required field missing). This is exactly the logic a packaged helper's
 * URL-scheme handler will run before connecting as the bridge leg.
 *
 * @param {unknown} url
 * @returns {{ relay: string, session: string, token: string, cwd?: string } | null}
 */
export function parseLaunchDeepLink(url) {
  if (typeof url !== "string" || url.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${LAUNCH_SCHEME}:`) return null;
  // For `scheme://launch?…` the action lands in `host`; tolerate `scheme:launch?…`
  // (no authority) where it lands in `pathname` instead.
  const action = parsed.host || parsed.pathname.replace(/^\/+/, "");
  if (action !== LAUNCH_HOST) return null;

  const relay = parsed.searchParams.get("relay");
  const session = parsed.searchParams.get("session");
  const token = parsed.searchParams.get("token");
  const cwd = parsed.searchParams.get("cwd") || undefined;
  if (!relay || !session || !token) return null;

  return cwd ? { relay, session, token, cwd } : { relay, session, token };
}

/**
 * Redact the `token` value from a launch link so it is safe to log. Replaces the
 * value with `***` while keeping the rest intact for debugging.
 *
 * @param {unknown} url
 * @returns {string}
 */
export function redactDeepLinkToken(url) {
  return String(url).replace(/([?&]token=)[^&]*/g, "$1***");
}
