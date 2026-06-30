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
  // SLICE 2 — auth + ownership:
  OWNER_MISMATCH: { code: 4005, reason: "owner mismatch — token is for a different user" },
  BAD_TOKEN: { code: 4006, reason: "invalid, tampered, or expired session token" },
});

/**
 * @typedef {Object} AttachState
 * @property {boolean} bridge       - a bridge leg is currently attached
 * @property {boolean} browser      - a browser leg is currently attached
 * @property {string|null} [owner]  - the `sub` this session is bound to (slice 2)
 */

/** @returns {AttachState} a fresh, empty session attachment state */
export function emptyState() {
  return { bridge: false, browser: false, owner: null };
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
 * Owner-binding (slice 2): when `sub` is supplied AND the session is already bound
 * to a different owner, the leg is rejected with OWNER_MISMATCH — this is what stops
 * user B from attaching to user A's session even with an otherwise-valid token. The
 * owner check runs BEFORE single-attach so a cross-user attempt is reported as an
 * ownership failure, not a duplicate. When `sub` is omitted (e.g. slice-1 callers /
 * unit tests of the bare state machine) owner-binding is skipped.
 *
 * @param {AttachState} state - current attachment state for the session
 * @param {string} role - "bridge" | "browser"
 * @param {string} [sub] - the owner id carried by the (already token-verified) leg
 * @returns {{ok: true} | {ok: false, code: number, reason: string}}
 */
export function decideAttach(state, role, sub) {
  if (!ROLES.includes(role)) {
    return { ok: false, ...CLOSE.BAD_ROLE };
  }
  if (sub !== undefined && state.owner != null && state.owner !== sub) {
    return { ok: false, ...CLOSE.OWNER_MISMATCH };
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
 * Binds the session owner on the FIRST leg; later legs keep the established owner.
 * @param {AttachState} state
 * @param {string} role
 * @param {string} [sub] - owner id to bind on the first leg
 * @returns {AttachState}
 */
export function attach(state, role, sub) {
  const owner = state.owner != null ? state.owner : sub ?? null;
  return { ...state, [role]: true, owner };
}

/**
 * Apply a detachment, returning a NEW state (does not mutate input). When the last
 * leg detaches, the owner binding is released so the session id can be cleanly
 * re-established (by the same or a new authorized owner).
 * @param {AttachState} state
 * @param {string} role
 * @returns {AttachState}
 */
export function detach(state, role) {
  const next = { ...state, [role]: false };
  if (!next.bridge && !next.browser) next.owner = null;
  return next;
}

/** The opposite role — used to pick the forwarding target. */
export function peerRole(role) {
  return role === "bridge" ? "browser" : "bridge";
}
