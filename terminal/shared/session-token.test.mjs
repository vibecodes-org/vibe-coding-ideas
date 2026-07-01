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
