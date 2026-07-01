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

/** @typedef {"bridge"|"browser"} Role */

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

const ROLES = Object.freeze(["bridge", "browser"]);
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
 * Verify a token's signature and expiry. Constant-time signature check via
 * `crypto.subtle.verify`. Does NOT check sid/role binding — see {@link authorizeAttach}.
 *
 * @param {unknown} token
 * @param {string} secret
 * @param {{ now?: number }} [opts] - `now` in unix seconds (defaults to wall clock)
 * @returns {Promise<{ ok: true, claims: SessionClaims } | { ok: false, reason: string }>}
 */
export async function verifyToken(token, secret, opts = {}) {
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
  if (now >= claims.exp) return { ok: false, reason: "expired" };
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    return { ok: false, reason: "missing sub" };
  }
  if (typeof claims.sid !== "string" || claims.sid.length === 0) {
    return { ok: false, reason: "missing sid" };
  }
  if (!ROLES.includes(claims.role)) return { ok: false, reason: "bad role" };

  return { ok: true, claims };
}

/**
 * Full attach authorization for a relay leg: verify signature + expiry, then bind
 * the token to THIS connection by requiring `claims.sid` and `claims.role` to match
 * the URL the leg connected on. Returns the owning `sub` for owner-binding.
 *
 * Shared by the Cloudflare relay and the Node stand-in so both enforce identically.
 *
 * @param {{ token: unknown, secret: string, session: unknown, role: unknown, now?: number }} args
 * @returns {Promise<{ ok: true, sub: string, claims: SessionClaims } | { ok: false, reason: string }>}
 */
export async function authorizeAttach({ token, secret, session, role, now }) {
  const res = await verifyToken(token, secret, { now });
  if (!res.ok) return res;
  const c = res.claims;
  if (c.sid !== session) return { ok: false, reason: "sid mismatch" };
  if (c.role !== role) return { ok: false, reason: "role mismatch" };
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
