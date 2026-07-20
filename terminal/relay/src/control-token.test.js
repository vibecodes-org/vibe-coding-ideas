// Unit tests for the relay's /end control-token verdicts (multi-session stage
// 3, C3/F5). `handleEnd` in ./index.js is a thin composition over
// `authorizeControl` (../../shared/session-token.mjs) — the FULL matrix of
// valid/expired/wrong-sid/wrong-role/tampered verdicts is exercised here,
// against the same shared module the Cloudflare DO and the Node stand-in both
// import, so a verdict proven here is the verdict either relay produces.
//
// Run: cd terminal/relay && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintControlToken, mintSessionTokens, authorizeControl, CONTROL_TTL_SECONDS } from "../../shared/session-token.mjs";

const SECRET = "relay-control-token-test-secret";
const NOW = 1_700_000_000;

test("valid control token, matching sid → authorized", async () => {
  const token = await mintControlToken({ sub: "user-A", sid: "sess-1", secret: SECRET, now: NOW });
  const res = await authorizeControl({ token, secret: SECRET, session: "sess-1", now: NOW });
  assert.equal(res.ok, true);
  assert.equal(res.sub, "user-A");
});

test("expired control token → rejected (no reattach waiver for /end)", async () => {
  assert.equal(CONTROL_TTL_SECONDS, 60);
  const token = await mintControlToken({ sub: "user-A", sid: "sess-1", secret: SECRET, now: NOW });
  const res = await authorizeControl({ token, secret: SECRET, session: "sess-1", now: NOW + CONTROL_TTL_SECONDS + 1 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "expired");
});

test("wrong sid (token minted for a different session) → rejected", async () => {
  const token = await mintControlToken({ sub: "user-A", sid: "sess-1", secret: SECRET, now: NOW });
  const res = await authorizeControl({ token, secret: SECRET, session: "sess-2", now: NOW });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "sid mismatch");
});

test("wrong role (a live bridge/browser leg token) → rejected", async () => {
  const { bridge, browser } = await mintSessionTokens({ sub: "user-A", idea: "idea-1", sid: "sess-1", secret: SECRET, now: NOW });
  const bridgeRes = await authorizeControl({ token: bridge, secret: SECRET, session: "sess-1", now: NOW });
  assert.equal(bridgeRes.ok, false);
  assert.equal(bridgeRes.reason, "role mismatch");
  const browserRes = await authorizeControl({ token: browser, secret: SECRET, session: "sess-1", now: NOW });
  assert.equal(browserRes.ok, false);
  assert.equal(browserRes.reason, "role mismatch");
});

test("tampered control token (payload flipped, signature stale) → rejected", async () => {
  const token = await mintControlToken({ sub: "user-A", sid: "sess-1", secret: SECRET, now: NOW });
  const [payloadB64, sig] = token.split(".");
  const forged = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  forged.sub = "user-EVIL";
  const forgedPayload = Buffer.from(JSON.stringify(forged)).toString("base64url");
  const res = await authorizeControl({ token: `${forgedPayload}.${sig}`, secret: SECRET, session: "sess-1", now: NOW });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "bad signature");
});

test("missing token → rejected", async () => {
  const res = await authorizeControl({ token: null, secret: SECRET, session: "sess-1", now: NOW });
  assert.equal(res.ok, false);
});

test("wrong secret (a foreign relay's control token) → rejected with bad signature", async () => {
  const token = await mintControlToken({ sub: "user-A", sid: "sess-1", secret: "a-different-secret", now: NOW });
  const res = await authorizeControl({ token, secret: SECRET, session: "sess-1", now: NOW });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "bad signature");
});
