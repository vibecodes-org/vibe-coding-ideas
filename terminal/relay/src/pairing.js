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
  // Same-owner preemption: the close a STALE leg receives when a newer same-owner
  // attach of the same role replaces it (browser: fix/terminal-dock-heartbeat;
  // bridge: fix/terminal-bridge-zombie-preemption). Reuses the DUP_BROWSER code
  // (4001) — a dock that receives it maps to the existing "duplicate" copy, and
  // the bridge treats it as terminal — with a distinct reason for logs and tests.
  PREEMPTED: { code: 4001, reason: "preempted" },
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
 * Same-owner PREEMPTION (fix/terminal-dock-heartbeat for the browser leg,
 * fix/terminal-bridge-zombie-preemption for the bridge leg): when a leg dies
 * SILENTLY (wifi off / network switch — macOS never RSTs), the dead socket still
 * counts as attached, so a legitimate same-owner reattach used to bounce off
 * DUP_BROWSER / DUP_BRIDGE forever. For an owner-verified leg (`sub` present — a
 * foreign sub was already rejected above) the NEWER attach now wins for BOTH
 * roles: `{ok: true, preempt: true}` tells the caller to close the stale leg
 * (CLOSE.PREEMPTED, 4001 "preempted") before accepting this one, keeping the
 * single-attach invariant post-swap. Sub-less callers keep the old DUP_* verdicts.
 *
 * The bridge was originally EXCLUDED from preemption on the theory that its
 * protocol-ping keepalive closes a dead link honestly, so a live duplicate must be
 * a real conflict. That theory fails after a silent death: the keepalive's
 * ws.terminate() destroys the CLIENT side, but the RST never reaches Cloudflare
 * (interface/NAT changed), so the RELAY keeps counting the zombie leg — the
 * bridge's own grace-window reattach then hit DUP_BRIDGE, a code it rightly treats
 * as terminal, and it gave up and reaped the PTY child. Net effect: a real-world
 * wifi blip ended the session even though relay, dock, and bridge each behaved.
 * A LIVE duplicate bridge (two helpers racing) now resolves latest-wins, same as
 * the browser: the preempted helper sees 4001 (terminal for the bridge too) and
 * shuts down instead of steal-back flapping.
 *
 * @param {AttachState} state - current attachment state for the session
 * @param {string} role - "bridge" | "browser"
 * @param {string} [sub] - the owner id carried by the (already token-verified) leg
 * @returns {{ok: true, preempt?: true} | {ok: false, code: number, reason: string}}
 */
export function decideAttach(state, role, sub) {
  if (!ROLES.includes(role)) {
    return { ok: false, ...CLOSE.BAD_ROLE };
  }
  if (sub !== undefined && state.owner != null && state.owner !== sub) {
    return { ok: false, ...CLOSE.OWNER_MISMATCH };
  }
  if (role === "browser" && state.browser) {
    if (sub !== undefined) return { ok: true, preempt: true };
    return { ok: false, ...CLOSE.DUP_BROWSER };
  }
  if (role === "bridge" && state.bridge) {
    if (sub !== undefined) return { ok: true, preempt: true };
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

// ── Session lifecycle limits (slice 6) ────────────────────────────────────────
//
// Two server-side caps end a forgotten session cleanly so a DO can't live (and
// bill) forever:
//   - idle:         no traffic for IDLE_MS → close both legs.
//   - max-duration: total session age ≥ MAX_MS → close both legs.
// Both close with the NORMAL code 1000 + a reason string. The reason text is the
// SINGLE SOURCE OF TRUTH the browser dock classifies on (see
// src/lib/terminal/connection.ts → parseEndedReason): it looks for the substrings
// "idle" / "max", so these builders and that classifier are in lock-step.

// ── Reconnect grace window (fix/terminal-reconnect-reattach) ──────────────────
//
// THE ONE SHARED NUMBER. When a single leg drops, the relay does NOT tear the
// session down; it holds the owner binding + the surviving socket and arms a
// grace alarm for this long, waiting for the dropped role to re-attach (same sid
// + same owner) so the pair can resume with no re-mint. The three reconnect
// budgets are deliberately equal:
//   - relay grace       → RECONNECT_GRACE_MS (here)
//   - bridge reconnect  → BRIDGE_RECONNECT_MS (bridge/src/index.js)
//   - client reconnect  → RECONNECT_GRACE_MS  (src/lib/terminal/connection.ts)
// Token expiry does NOT bound reattach (fix/terminal-expired-reattach): the token
// TTL (DEFAULT_TTL_SECONDS = 300s in ../../shared/session-token.mjs) bounds
// session ESTABLISHMENT only. For a reattach to a session the relay is still
// holding, authorizeAttach waives expiry IFF the token's sub matches the bound
// owner (belt-and-braces capped at the max session age) — so an AGED session
// (attached long ago, dropped past its TTL) reconnects inside the grace window
// with the ORIGINAL tokens, no re-mint ever. BEYOND the window the session is
// torn down honestly (survivor gets PEER_GONE, owner binding + state cleared, so
// the waiver dies with it) and the UX falls back to a clean fresh launch.
export const RECONNECT_GRACE_MS = 90_000;

/** Default idle cap: 30 minutes of no traffic. Overridable via env TERMINAL_IDLE_MS. */
export const DEFAULT_IDLE_MS = 30 * 60 * 1000;
/** Default hard cap on total session age: 4 hours. Overridable via env TERMINAL_MAX_MS. */
export const DEFAULT_MAX_MS = 4 * 60 * 60 * 1000;

/** Normal-closure reason for an idle-timeout end. MUST contain "idle". */
export function idleCloseReason(idleMs = DEFAULT_IDLE_MS) {
  const min = Math.max(1, Math.round(idleMs / 60_000));
  return `idle-timeout: ended after ${min} min idle`;
}

/** Normal-closure reason for a max-duration end. MUST contain "max". */
export function maxCloseReason(maxMs = DEFAULT_MAX_MS) {
  const hours = Math.max(1, Math.round(maxMs / 3_600_000));
  return `max-duration: session reached its ${hours} hour limit`;
}

/** Read a positive-millisecond override from an env-like bag, else the default. */
export function resolveMs(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
