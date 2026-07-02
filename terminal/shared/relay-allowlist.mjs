// Shared relay-host allowlist — the SINGLE source of truth for "may the bridge
// dial this relay?".
//
// THREAT (see the Reproduce & Investigate step): `vibecodes://launch?relay=<HOST>`
// can be fired by ANY web page. Before this gate the bridge dialled WHATEVER host
// `relay=` named, with zero validation — an attacker-controlled relay verifies its
// OWN attacker-minted token against its OWN secret, passes the R1 `{"t":"attached"}`
// gate, and then streams keystrokes into the spawned `claude` PTY (+ the one-shot
// argv prompt). That is RCE-adjacent. This module pins the dial target so a hostile
// `relay=` value can never reach `new WebSocket()` or `pty.spawn()`.
//
// Pure + dependency-free (only the global WHATWG `URL`), so it runs unchanged in
// Node (bridge), Electron-as-Node (helper) and is trivially unit-testable.

/**
 * The ONE production relay host, matched EXACTLY (never substring/endsWith —
 * `…workers.dev.evil.com` and `evil-…workers.dev` must both fail).
 */
export const PROD_RELAY_HOST = "vibecodes-terminal-relay.nicholasmball.workers.dev";

/** Loopback hostnames permitted only when `allowLoopback` is set (dev/tests). */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Normalise a WHATWG-URL hostname for comparison: IPv6 hostnames arrive wrapped
 * in brackets (`[::1]`), so strip them so `::1` compares cleanly.
 *
 * @param {string} hostname
 * @returns {string}
 */
function bareHost(hostname) {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/**
 * Whether the bridge is allowed to dial `relayUrl`.
 *
 * Rules:
 *   - Not a parseable URL → false.
 *   - Allowed iff EXACT `hostname === PROD_RELAY_HOST` AND `protocol === "wss:"`.
 *     Exact-match also defeats userinfo tricks: `wss://real-host@evil.com` parses
 *     to `hostname === "evil.com"`, so it is rejected here.
 *   - When `allowLoopback` (dev + automated tests dial the Node stand-in relay on
 *     `ws://127.0.0.1:<port>`): ALSO allow loopback hostnames with `ws:`|`wss:`
 *     on any port. When NOT set (packaged helper), loopback is rejected.
 *
 * @param {unknown} relayUrl
 * @param {{ allowLoopback?: boolean }} [opts]
 * @returns {boolean}
 */
export function isRelayHostAllowed(relayUrl, { allowLoopback = false } = {}) {
  if (typeof relayUrl !== "string" || relayUrl.length === 0) return false;
  let url;
  try {
    url = new URL(relayUrl);
  } catch {
    return false;
  }

  const host = bareHost(url.hostname);

  // Production relay: exact host + secure (wss) only.
  if (host === PROD_RELAY_HOST && url.protocol === "wss:") return true;

  // Dev/test loopback: any port, ws or wss.
  if (
    allowLoopback &&
    LOOPBACK_HOSTS.has(host) &&
    (url.protocol === "ws:" || url.protocol === "wss:")
  ) {
    return true;
  }

  return false;
}

/**
 * Throwing convenience wrapper for call sites that want fail-closed semantics.
 * The thrown message carries the HOST ONLY — never the token/query string.
 *
 * @param {unknown} relayUrl
 * @param {{ allowLoopback?: boolean }} [opts]
 * @returns {string} the validated relay URL
 */
export function assertRelayAllowed(relayUrl, opts) {
  if (!isRelayHostAllowed(relayUrl, opts)) {
    let host = "unparseable";
    try {
      host = new URL(String(relayUrl)).host;
    } catch {
      /* keep "unparseable" — never echo the raw string (may carry a token) */
    }
    throw new Error(`relay host not allowed: ${host}`);
  }
  return String(relayUrl);
}
