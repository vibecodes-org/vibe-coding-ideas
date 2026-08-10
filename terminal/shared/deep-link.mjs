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
//   helperToken — OPTIONAL: an app-minted HELPER-role token (session-token.mjs →
//             mintHelperToken), carried alongside the bridge token on every
//             launch (card cc74a067) so the SAME click that starts a bridge also
//             (re)establishes the helper's own persistent control connection to
//             the relay — see terminal/helper/main.js. A helper that's already
//             connected treats a redundant one as a no-op.
//   cwd     — optional working directory
//   prompt  — optional compact bootstrap prompt for the spawned `claude`. INERT
//             DATA: the bridge passes it as ONE argv element (never through
//             shellSplit / a shell) and only spawns AFTER the relay has accepted
//             the owner-bound token (R1 — see bridge/src/index.js).
//
// `token` and `helperToken` are secrets and `prompt` is user content. NEVER log
// a raw link — use redactDeepLinkToken first (it elides all three). `prompt` is
// always the LAST param (the dock's URL-length budgeting relies on this — see
// src/lib/terminal/deep-link.ts's doc comment) — `helperToken` is inserted
// BEFORE it, alongside the other credentials, so that invariant holds.
//
// Pure + dependency-free (only the global WHATWG `URL`), so it runs unchanged in
// Node (bridge) and is trivially unit-testable.

/** Custom URL scheme the packaged helper registers (slice 7 OS bit). */
export const LAUNCH_SCHEME = "vibecodes";
/** The single action this scheme exposes today: `vibecodes://launch?…`. */
export const LAUNCH_HOST = "launch";

/**
 * Build a `vibecodes://launch?relay=…&session=…&token=…[&cwd=…][&prompt=…]`
 * deep link.
 *
 * Uses encodeURIComponent so reserved characters in the relay URL / token /
 * prompt survive the round-trip. `cwd` / `prompt` are omitted entirely when
 * absent (no empty params); `prompt` is always LAST so the base-link length
 * (and therefore the app-side prompt budget) is stable. Throws when a required
 * field is missing so a malformed link is never fired.
 *
 * @param {{ relay: string, session: string, token: string, helperToken?: string, cwd?: string, prompt?: string }} params
 * @returns {string}
 */
export function buildLaunchDeepLink({ relay, session, token, helperToken, cwd, prompt } = {}) {
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
  if (prompt) parts.push(`prompt=${encodeURIComponent(prompt)}`);
  return `${LAUNCH_SCHEME}://${LAUNCH_HOST}?${parts.join("&")}`;
}

/**
 * Parse a `vibecodes://launch?…` deep link into `{ relay, session, token, cwd?,
 * prompt? }`, or null when it is not a well-formed launch link (wrong
 * scheme/action, or any required field missing). This is exactly the logic a
 * packaged helper's URL-scheme handler will run before connecting as the bridge
 * leg. `cwd` / `prompt` keys are only present when the link carried them, so a
 * promptless link parses to exactly the same object shape as before the prompt
 * param existed (version-skew safe both ways).
 *
 * @param {unknown} url
 * @returns {{ relay: string, session: string, token: string, helperToken?: string, cwd?: string, prompt?: string } | null}
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
  const helperToken = parsed.searchParams.get("helperToken") || undefined;
  const cwd = parsed.searchParams.get("cwd") || undefined;
  const prompt = parsed.searchParams.get("prompt") || undefined;
  if (!relay || !session || !token) return null;

  const out = { relay, session, token };
  if (helperToken) out.helperToken = helperToken;
  if (cwd) out.cwd = cwd;
  if (prompt) out.prompt = prompt;
  return out;
}

/**
 * Redact the secret/user-content params from a launch link so it is safe to
 * log: the `token` and `helperToken` (both credentials) and the `prompt`
 * (user task/idea content) all become `***` while relay/session survive for
 * debugging. Callers that want to debug prompt delivery log the prompt
 * LENGTH as a separate field.
 *
 * @param {unknown} url
 * @returns {string}
 */
export function redactDeepLinkToken(url) {
  return String(url)
    .replace(/([?&]token=)[^&]*/g, "$1***")
    .replace(/([?&]helperToken=)[^&]*/g, "$1***")
    .replace(/([?&]prompt=)[^&]*/g, "$1***");
}
