// Pure pairing / single-attach state machine for the terminal relay.
//
// One relay "session" pairs exactly one `bridge` leg (the local machine running
// the PTY) with exactly one `browser` leg (the in-app terminal). The relay is
// OPAQUE: it never inspects stream bytes — it only tracks *which* legs are
// attached so it can pair them and enforce single-attach. This module is the
// decision logic, factored out so it can be unit-tested without workerd / ws.
//
// Shared by:
//   - relay/src/index.js        (Cloudflare Worker + Durable Object)
//   - test/standin-relay.mjs    (plain-ws Node stand-in used by the automated test)

export const ROLES = Object.freeze(["bridge", "browser"]);

// WebSocket close codes in the application-private range (4000-4999).
export const CLOSE = Object.freeze({
  BAD_ROLE: { code: 4000, reason: "invalid role (expected bridge|browser)" },
  BAD_SESSION: { code: 4003, reason: "missing or invalid session id" },
  DUP_BROWSER: { code: 4001, reason: "session already attached (single-attach)" },
  DUP_BRIDGE: { code: 4002, reason: "bridge already attached for this session" },
  PEER_GONE: { code: 4004, reason: "peer disconnected" },
});

/**
 * @typedef {Object} AttachState
 * @property {boolean} bridge  - a bridge leg is currently attached
 * @property {boolean} browser - a browser leg is currently attached
 */

/** @returns {AttachState} a fresh, empty session attachment state */
export function emptyState() {
  return { bridge: false, browser: false };
}

/**
 * Validate a session id. Slice-1 stub: accept any non-empty, reasonably-sized,
 * URL-safe token. No ownership / signature checks yet.
 *
 * TODO(slice 2): validate app-minted session token + owner binding — verify the
 * signed `vibecodes://` payload, bind the session to the authenticated human,
 * and reject any leg whose owner does not match (the "owner mismatch" error).
 *
 * @param {unknown} session
 * @returns {boolean}
 */
export function isValidSession(session) {
  return (
    typeof session === "string" &&
    session.length >= 1 &&
    session.length <= 128 &&
    /^[A-Za-z0-9._-]+$/.test(session)
  );
}

/**
 * Decide whether an incoming leg may attach to a session.
 *
 * Pure: does not mutate `state`. The caller applies the attachment on `ok`.
 *
 * @param {AttachState} state - current attachment state for the session
 * @param {string} role - "bridge" | "browser"
 * @returns {{ok: true} | {ok: false, code: number, reason: string}}
 */
export function decideAttach(state, role) {
  if (!ROLES.includes(role)) {
    return { ok: false, ...CLOSE.BAD_ROLE };
  }
  if (role === "browser" && state.browser) {
    return { ok: false, ...CLOSE.DUP_BROWSER };
  }
  if (role === "bridge" && state.bridge) {
    return { ok: false, ...CLOSE.DUP_BRIDGE };
  }
  return { ok: true };
}

/**
 * Apply an accepted attachment, returning a NEW state (does not mutate input).
 * @param {AttachState} state
 * @param {string} role
 * @returns {AttachState}
 */
export function attach(state, role) {
  return { ...state, [role]: true };
}

/**
 * Apply a detachment, returning a NEW state (does not mutate input).
 * @param {AttachState} state
 * @param {string} role
 * @returns {AttachState}
 */
export function detach(state, role) {
  return { ...state, [role]: false };
}

/** The opposite role — used to pick the forwarding target. */
export function peerRole(role) {
  return role === "bridge" ? "browser" : "bridge";
}
