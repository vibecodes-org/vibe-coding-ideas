// Shared terminal session-token module — SLICE 2 (auth + ownership).
//
// ONE implementation of the sign/verify code, imported by every party so the
// exact same bytes are produced and checked everywhere:
//   - the VibeCodes Next.js app  (src/app/api/terminal/session/route.ts) — MINTS tokens
//   - the Cloudflare relay        (relay/src/index.js)                     — VERIFIES tokens
//   - the Node stand-in relay     (test/standin-relay.mjs)                 — VERIFIES tokens
//   - the test harness            (test/*.mjs)                             — MINTS tokens
//
// Design:
//   A token is a compact, JWT-ish, two-part string:  <payloadB64url>.<sigB64url>
//   payload  = JSON { sub, sid, idea, role, iat, exp }
//   sig      = HMAC-SHA256( payloadB64url-bytes, secret )
//
// We deliberately use Web Crypto (`crypto.subtle`) and base64url helpers built on
// `btoa`/`atob` only — NO node-only APIs (Buffer, node:crypto) — so the identical
// module runs unchanged in the Cloudflare Worker runtime AND in Node. We do NOT
// pull in a JWT library: the surface here is tiny and must run in workerd.
//
// The signing secret NEVER lives in code. It is read from the environment by each
// caller (TERMINAL_SESSION_SECRET) and passed in. This module is pure crypto.
//
// Expiry semantics (fix/terminal-expired-reattach): the TTL bounds session
// ESTABLISHMENT — a first attach (no bound owner yet) always needs a live token.
// REATTACH to a session the relay is still holding is bounded by the reconnect
// grace window + the live-session owner binding instead: `authorizeAttach` waives
// expiry ONLY when the caller supplies the session's bound owner (`boundOwner`)
// and the token's `sub` matches it — signature, shape, sid and role checks are
// never waived, and a belt-and-braces cap rejects tokens older than the max
// session age. `verifyToken` itself stays strict (expired is always a failure).

/**
 * @typedef {"bridge"|"browser"|"control"} Role
 *
 * "control" (multi-session stage 3, terminal/api/session/end) is a THIRD kind
 * of leg: it never opens a WebSocket. It authorizes a single HTTP call — the
 * VibeCodes end route (POST /end?session=<sid>) telling the relay's Durable
 * Object to close both legs of a specific session. It reuses this exact
 * sign/verify machinery (same secret, same HMAC, same shape checks) so the
 * relay verifies it with the SAME code path as bridge/browser tokens —
 * `authorizeControl` below is the strict (non-waived) counterpart to
 * `authorizeAttach`: a control token is always short-lived (60s) and NEVER
 * gets the reattach expiry waiver a live session's owner gets on bridge/
 * browser tokens, because there is no "session" for a control call to be
 * live inside of — it's a one-shot admin action, not a leg that attaches.
 */

/**
 * @typedef {Object} SessionClaims
 * @property {string} sub  - Supabase user id (the owning human)
 * @property {string} sid  - relay session id
 * @property {string} idea - idea id this session belongs to
 * @property {Role}   role - which leg this token authorizes
 * @property {number} iat  - issued-at (unix seconds)
 * @property {number} exp  - expiry (unix seconds)
 */

/** Default token lifetime: short-lived (5 minutes) — enough to open both legs. */
export const DEFAULT_TTL_SECONDS = 300;

/**
 * Belt-and-braces cap on the expiry waiver: even for a same-owner reattach to a
 * live session, a token whose `iat` is older than this can never be a legitimate
 * reattach — the relay's max-duration cap (same default, see
 * relay/src/pairing.js → DEFAULT_MAX_MS) would have ended the session already.
 * Callers pass the relay's configured maxMs; this default (4h) applies if absent.
 */
export const DEFAULT_MAX_SESSION_MS = 4 * 60 * 60 * 1000;

const ROLES = Object.freeze(["bridge", "browser", "control"]);

/** Control-token lifetime (multi-session stage 3): short-lived, one-shot. */
export const CONTROL_TTL_SECONDS = 60;
const enc = new TextEncoder();
const dec = new TextDecoder();

/** @param {Uint8Array} bytes @returns {string} base64url (no padding) */
function bytesToBase64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** @param {string} s base64url @returns {Uint8Array} */
function base64urlToBytes(s) {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** @param {string} secret @returns {Promise<CryptoKey>} */
async function importKey(secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("TERMINAL_SESSION_SECRET is missing or empty");
  }
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Sign a claims payload, producing `<payloadB64url>.<sigB64url>`.
 * @param {SessionClaims} payload
 * @param {string} secret
 * @returns {Promise<string>}
 */
export async function signToken(payload, secret) {
  const payloadB64 = bytesToBase64url(enc.encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64)));
  return `${payloadB64}.${bytesToBase64url(sig)}`;
}

/**
 * Internal verifier: signature + shape checks are ALWAYS enforced; expiry is
 * REPORTED (`expired`) rather than rejected, so {@link authorizeAttach} can apply
 * the reattach waiver. Never exported — external callers go through the strict
 * {@link verifyToken} or {@link authorizeAttach}.
 *
 * @param {unknown} token
 * @param {string} secret
 * @param {{ now?: number }} [opts] - `now` in unix seconds (defaults to wall clock)
 * @returns {Promise<{ ok: true, claims: SessionClaims, expired: boolean } | { ok: false, reason: string }>}
 */
async function verifyTokenInternal(token, secret, opts = {}) {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "missing token" };
  }
  if (token.length > 4096) return { ok: false, reason: "token too large" };
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed token" };
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let sigBytes;
  try {
    sigBytes = base64urlToBytes(sigB64);
  } catch {
    return { ok: false, reason: "malformed signature" };
  }

  const key = await importKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payloadB64));
  if (!valid) return { ok: false, reason: "bad signature" };

  /** @type {SessionClaims} */
  let claims;
  try {
    claims = JSON.parse(dec.decode(base64urlToBytes(payloadB64)));
  } catch {
    return { ok: false, reason: "malformed payload" };
  }

  if (typeof claims.iat !== "number" || typeof claims.exp !== "number") {
    return { ok: false, reason: "missing iat/exp" };
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    return { ok: false, reason: "missing sub" };
  }
  if (typeof claims.sid !== "string" || claims.sid.length === 0) {
    return { ok: false, reason: "missing sid" };
  }
  if (!ROLES.includes(claims.role)) return { ok: false, reason: "bad role" };

  return { ok: true, claims, expired: now >= claims.exp };
}

/**
 * Verify a token's signature and expiry. Constant-time signature check via
 * `crypto.subtle.verify`. Does NOT check sid/role binding — see {@link authorizeAttach}.
 * STRICT: an expired token always fails here (the reattach waiver lives ONLY in
 * `authorizeAttach`, gated on the live session's bound owner).
 *
 * @param {unknown} token
 * @param {string} secret
 * @param {{ now?: number }} [opts] - `now` in unix seconds (defaults to wall clock)
 * @returns {Promise<{ ok: true, claims: SessionClaims } | { ok: false, reason: string }>}
 */
export async function verifyToken(token, secret, opts = {}) {
  const res = await verifyTokenInternal(token, secret, opts);
  if (!res.ok) return res;
  if (res.expired) return { ok: false, reason: "expired" };
  return { ok: true, claims: res.claims };
}

/**
 * Full attach authorization for a relay leg: verify signature + expiry, then bind
 * the token to THIS connection by requiring `claims.sid` and `claims.role` to match
 * the URL the leg connected on. Returns the owning `sub` for owner-binding.
 *
 * Shared by the Cloudflare relay and the Node stand-in so both enforce identically.
 *
 * REATTACH EXPIRY WAIVER (fix/terminal-expired-reattach): when the relay is still
 * holding a session (owner bound), the caller passes that owner as `boundOwner`.
 * An EXPIRED token is then accepted IFF its `sub` matches `boundOwner` — i.e. the
 * waiver applies only to the session's rightful owner reattaching to a LIVE
 * session; establishment (no bound owner) always needs an unexpired token. A
 * foreign expired token fails with the SAME reason as plain expiry so a rejected
 * caller learns nothing about session liveness. Signature, shape, sid and role
 * checks are NEVER waived. Belt-and-braces: a waived token older than
 * `maxSessionMs` (the relay's max session age) is rejected — no legitimate
 * session can outlive it. Waived results carry `expired: true` for logging.
 *
 * @param {{ token: unknown, secret: string, session: unknown, role: unknown,
 *           now?: number, boundOwner?: string|null, maxSessionMs?: number }} args
 *   `boundOwner` — the live session's bound owner (`sub`), or null when the
 *   session has no owner binding (virgin / already torn down). Default null.
 *   `maxSessionMs` — the relay's max session age; bounds the waiver (default 4h).
 * @returns {Promise<{ ok: true, sub: string, claims: SessionClaims, expired?: true } | { ok: false, reason: string }>}
 */
export async function authorizeAttach({
  token,
  secret,
  session,
  role,
  now,
  boundOwner = null,
  maxSessionMs = DEFAULT_MAX_SESSION_MS,
}) {
  const res = await verifyTokenInternal(token, secret, { now });
  if (!res.ok) return res;
  const c = res.claims;
  if (c.sid !== session) return { ok: false, reason: "sid mismatch" };
  if (c.role !== role) return { ok: false, reason: "role mismatch" };
  if (res.expired) {
    // The waiver: only the LIVE session's bound owner may attach on an expired
    // token. Everything else fails exactly like plain expiry (no liveness leak).
    if (boundOwner == null || c.sub !== boundOwner) {
      return { ok: false, reason: "expired" };
    }
    const nowSec = now ?? Math.floor(Date.now() / 1000);
    if ((nowSec - c.iat) * 1000 > maxSessionMs) {
      return { ok: false, reason: "expired" };
    }
    return { ok: true, sub: c.sub, claims: c, expired: true };
  }
  return { ok: true, sub: c.sub, claims: c };
}

/**
 * Generate a fresh, URL-safe relay session id (matches the relay's isValidSession).
 * @returns {string}
 */
export function newSessionId() {
  return crypto.randomUUID();
}

/**
 * Mint BOTH leg tokens (browser + bridge) for the same session/owner/idea. The app
 * hands the `browser` token to the in-app panel and the `bridge` token to the local
 * helper; both share one `sid` + `sub` so the relay can owner-bind the pair.
 *
 * @param {{ sub: string, idea: string, sid?: string, secret: string, ttlSeconds?: number, now?: number }} args
 * @returns {Promise<{ sid: string, idea: string, sub: string, exp: number, browser: string, bridge: string }>}
 */
export async function mintSessionTokens({
  sub,
  idea,
  sid = newSessionId(),
  secret,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  now = Math.floor(Date.now() / 1000),
}) {
  const exp = now + ttlSeconds;
  /** @type {Omit<SessionClaims, "role">} */
  const base = { sub, sid, idea, iat: now, exp };
  const [browser, bridge] = await Promise.all([
    signToken({ ...base, role: "browser" }, secret),
    signToken({ ...base, role: "bridge" }, secret),
  ]);
  return { sid, idea, sub, exp, browser, bridge };
}

/**
 * Mint a short-lived "control" token authorizing ONE HTTP call to the relay's
 * `POST /end?session=<sid>` endpoint (multi-session stage 3, terminal/api/
 * session/end). Minted SERVER-SIDE by the VibeCodes end route — never handed
 * to the browser — immediately before that server-to-server fetch, so its 60s
 * TTL only ever needs to cover one outbound request. `idea` is carried for
 * parity with the other mint helper and for relay-side logging; it is not
 * checked by `authorizeControl`.
 *
 * @param {{ sub: string, sid: string, idea?: string, secret: string, ttlSeconds?: number, now?: number }} args
 * @returns {Promise<string>} the signed control token
 */
export async function mintControlToken({
  sub,
  sid,
  idea = "",
  secret,
  ttlSeconds = CONTROL_TTL_SECONDS,
  now = Math.floor(Date.now() / 1000),
}) {
  const exp = now + ttlSeconds;
  return signToken({ sub, sid, idea, role: "control", iat: now, exp }, secret);
}

/**
 * Verify a control token for the relay's `/end` HTTP endpoint. Deliberately
 * STRICT — unlike {@link authorizeAttach}, there is no reattach waiver: a
 * control call is a one-shot admin action, never a leg of a live session, so
 * an expired token is always rejected outright. Checks signature, shape,
 * `role === "control"`, and `sid` match; does NOT check `sub` against
 * anything — the caller (the end route) already verified the sid belongs to
 * the requesting user via the `terminal_sessions` registry BEFORE minting
 * this token, so by the time the relay sees it, authorization already
 * happened upstream. This function exists so the relay never has to trust an
 * unsigned `session` query param alone — the control token proves the call
 * came from VibeCodes' own server, not an arbitrary client guessing a sid.
 *
 * @param {{ token: unknown, secret: string, session: unknown, now?: number }} args
 * @returns {Promise<{ ok: true, sub: string, claims: SessionClaims } | { ok: false, reason: string }>}
 */
export async function authorizeControl({ token, secret, session, now }) {
  const res = await verifyToken(token, secret, { now });
  if (!res.ok) return res;
  const c = res.claims;
  if (c.role !== "control") return { ok: false, reason: "role mismatch" };
  if (c.sid !== session) return { ok: false, reason: "sid mismatch" };
  return { ok: true, sub: c.sub, claims: c };
}
