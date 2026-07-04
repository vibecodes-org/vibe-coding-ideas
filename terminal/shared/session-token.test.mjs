// Unit tests for the shared terminal session-token module.
// Run: cd terminal/shared && node --test   (or from terminal/test via npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signToken,
  verifyToken,
  authorizeAttach,
  mintSessionTokens,
  newSessionId,
  DEFAULT_TTL_SECONDS,
} from "./session-token.mjs";

const SECRET = "test-secret-do-not-ship";
const NOW = 1_700_000_000; // fixed clock (unix seconds)

function baseClaims(overrides = {}) {
  return {
    sub: "user-A",
    sid: "sess-1",
    idea: "idea-1",
    role: "browser",
    iat: NOW,
    exp: NOW + DEFAULT_TTL_SECONDS,
    ...overrides,
  };
}

test("mint → verify happy path returns the original claims", async () => {
  const token = await signToken(baseClaims(), SECRET);
  const res = await verifyToken(token, SECRET, { now: NOW });
  assert.equal(res.ok, true);
  assert.deepEqual(res.claims, baseClaims());
});

test("expired token is rejected", async () => {
  const token = await signToken(baseClaims({ exp: NOW + 60 }), SECRET);
  // happy at NOW, expired one second after exp
  assert.equal((await verifyToken(token, SECRET, { now: NOW })).ok, true);
  const res = await verifyToken(token, SECRET, { now: NOW + 61 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "expired");
});

test("tampered payload is rejected (bad signature)", async () => {
  const token = await signToken(baseClaims(), SECRET);
  const [payloadB64, sig] = token.split(".");
  // Flip the payload to a different user but keep the original signature.
  const forgedClaims = baseClaims({ sub: "user-EVIL" });
  const forgedPayload = Buffer.from(JSON.stringify(forgedClaims))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assert.notEqual(forgedPayload, payloadB64);
  const res = await verifyToken(`${forgedPayload}.${sig}`, SECRET, { now: NOW });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "bad signature");
});

test("wrong secret is rejected (bad signature)", async () => {
  const token = await signToken(baseClaims(), SECRET);
  const res = await verifyToken(token, "a-different-secret", { now: NOW });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "bad signature");
});

test("malformed tokens are rejected, never throw", async () => {
  for (const bad of ["", "noseparator", ".", "a.", ".b", null, undefined, 42]) {
    const res = await verifyToken(bad, SECRET, { now: NOW });
    assert.equal(res.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test("authorizeAttach binds sid + role to the connection", async () => {
  const token = await signToken(baseClaims({ role: "bridge" }), SECRET);
  // correct sid + role
  const ok = await authorizeAttach({ token, secret: SECRET, session: "sess-1", role: "bridge", now: NOW });
  assert.equal(ok.ok, true);
  assert.equal(ok.sub, "user-A");
  // sid mismatch
  const sidBad = await authorizeAttach({ token, secret: SECRET, session: "sess-OTHER", role: "bridge", now: NOW });
  assert.equal(sidBad.ok, false);
  assert.equal(sidBad.reason, "sid mismatch");
  // role mismatch (bridge token presented on the browser leg)
  const roleBad = await authorizeAttach({ token, secret: SECRET, session: "sess-1", role: "browser", now: NOW });
  assert.equal(roleBad.ok, false);
  assert.equal(roleBad.reason, "role mismatch");
});

// ── reattach expiry waiver (fix/terminal-expired-reattach) ─────────────────────
// authorizeAttach accepts an EXPIRED token IFF the caller passes the live session's
// bound owner and the token's sub matches it. Everything else about an expired
// token fails exactly like plain expiry, and no other check is ever waived.

const AFTER_EXP = NOW + DEFAULT_TTL_SECONDS + 60; // 60s past the token's expiry

test("expired token + matching boundOwner is accepted with expired:true (reattach waiver)", async () => {
  const token = await signToken(baseClaims(), SECRET);
  const res = await authorizeAttach({
    token, secret: SECRET, session: "sess-1", role: "browser", now: AFTER_EXP, boundOwner: "user-A",
  });
  assert.equal(res.ok, true);
  assert.equal(res.sub, "user-A");
  assert.equal(res.expired, true, "waived attaches must be flagged expired for logging");
});

test("an unexpired attach never carries the expired flag", async () => {
  const token = await signToken(baseClaims(), SECRET);
  const res = await authorizeAttach({
    token, secret: SECRET, session: "sess-1", role: "browser", now: NOW, boundOwner: "user-A",
  });
  assert.equal(res.ok, true);
  assert.equal(res.expired, undefined);
});

test("expired token with NO bound owner (establishment / torn-down session) is rejected", async () => {
  const token = await signToken(baseClaims(), SECRET);
  // boundOwner omitted (defaults to null) and explicit null both reject.
  const omitted = await authorizeAttach({ token, secret: SECRET, session: "sess-1", role: "browser", now: AFTER_EXP });
  assert.equal(omitted.ok, false);
  assert.equal(omitted.reason, "expired");
  const explicit = await authorizeAttach({
    token, secret: SECRET, session: "sess-1", role: "browser", now: AFTER_EXP, boundOwner: null,
  });
  assert.equal(explicit.ok, false);
  assert.equal(explicit.reason, "expired");
});

test("expired token whose sub is NOT the bound owner fails with the SAME reason as plain expiry", async () => {
  // No session-liveness signal leak: a foreign expired token must be indistinguishable
  // from an expired token against a dead session.
  const token = await signToken(baseClaims({ sub: "user-EVIL" }), SECRET);
  const res = await authorizeAttach({
    token, secret: SECRET, session: "sess-1", role: "browser", now: AFTER_EXP, boundOwner: "user-A",
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "expired");
});

test("tampered signature is rejected even with a matching boundOwner (never waived)", async () => {
  const token = await signToken(baseClaims(), SECRET);
  const [payloadB64] = token.split(".");
  const forged = `${payloadB64}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  const res = await authorizeAttach({
    token: forged, secret: SECRET, session: "sess-1", role: "browser", now: AFTER_EXP, boundOwner: "user-A",
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "bad signature");
});

test("sid / role binding is enforced on a waived (expired, owner-matching) token", async () => {
  const token = await signToken(baseClaims(), SECRET); // sid sess-1, role browser
  const sidBad = await authorizeAttach({
    token, secret: SECRET, session: "sess-OTHER", role: "browser", now: AFTER_EXP, boundOwner: "user-A",
  });
  assert.equal(sidBad.ok, false);
  assert.equal(sidBad.reason, "sid mismatch");
  const roleBad = await authorizeAttach({
    token, secret: SECRET, session: "sess-1", role: "bridge", now: AFTER_EXP, boundOwner: "user-A",
  });
  assert.equal(roleBad.ok, false);
  assert.equal(roleBad.reason, "role mismatch");
});

test("waiver belt-and-braces: a token older than maxSessionMs is rejected despite an owner match", async () => {
  const token = await signToken(baseClaims(), SECRET); // iat = NOW
  const maxSessionMs = 60 * 60 * 1000; // 1h cap for the test
  // 1h + 1s after iat → past the cap → rejected like plain expiry.
  const tooOld = await authorizeAttach({
    token, secret: SECRET, session: "sess-1", role: "browser",
    now: NOW + 3601, boundOwner: "user-A", maxSessionMs,
  });
  assert.equal(tooOld.ok, false);
  assert.equal(tooOld.reason, "expired");
  // Expired but still inside the cap → waived.
  const inside = await authorizeAttach({
    token, secret: SECRET, session: "sess-1", role: "browser",
    now: NOW + 3599, boundOwner: "user-A", maxSessionMs,
  });
  assert.equal(inside.ok, true);
  assert.equal(inside.expired, true);
});

test("verifyToken stays strict: expired is a failure regardless of any waiver in authorizeAttach", async () => {
  const token = await signToken(baseClaims(), SECRET);
  const res = await verifyToken(token, SECRET, { now: AFTER_EXP });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "expired");
});

test("mintSessionTokens mints both legs sharing one sid + sub", async () => {
  const out = await mintSessionTokens({ sub: "user-A", idea: "idea-1", secret: SECRET, now: NOW });
  assert.match(out.sid, /[0-9a-f-]{36}/);
  assert.equal(out.exp, NOW + DEFAULT_TTL_SECONDS);
  const b = await verifyToken(out.browser, SECRET, { now: NOW });
  const g = await verifyToken(out.bridge, SECRET, { now: NOW });
  assert.equal(b.ok, true);
  assert.equal(g.ok, true);
  assert.equal(b.claims.role, "browser");
  assert.equal(g.claims.role, "bridge");
  assert.equal(b.claims.sub, g.claims.sub);
  assert.equal(b.claims.sid, g.claims.sid);
});

test("newSessionId produces a relay-safe id", () => {
  const id = newSessionId();
  assert.match(id, /^[A-Za-z0-9._-]+$/);
});
