// Unit tests for the relay's session-closed callback token verdicts (card
// 9fb9fced, Fix 2). `notifyAppSessionClosed` in ./index.js is a thin
// composition over `mintNotifyToken`/`authorizeNotify`
// (../../shared/session-token.mjs) — the full valid/expired/wrong-sid/
// wrong-role/tampered matrix is exercised here, against the SAME shared
// module the Cloudflare DO signs with and the app's
// `POST /api/terminal/session/closed` webhook verifies with, so a verdict
// proven here is the verdict either side produces.
//
// Run: cd terminal/relay && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mintNotifyToken,
  mintControlToken,
  mintSessionTokens,
  authorizeNotify,
  NOTIFY_TTL_SECONDS,
} from "../../shared/session-token.mjs";

const SECRET = "relay-notify-token-test-secret";
const NOW = 1_700_000_000;

test("valid notify token, matching sid → authorized", async () => {
  const token = await mintNotifyToken({ sid: "sess-1", secret: SECRET, now: NOW });
  const res = await authorizeNotify({ token, secret: SECRET, session: "sess-1", now: NOW });
  assert.equal(res.ok, true);
  assert.equal(res.claims.role, "notify");
});

test("expired notify token → rejected (no reattach waiver for a callback)", async () => {
  assert.equal(NOTIFY_TTL_SECONDS, 60);
  const token = await mintNotifyToken({ sid: "sess-1", secret: SECRET, now: NOW });
  const res = await authorizeNotify({ token, secret: SECRET, session: "sess-1", now: NOW + NOTIFY_TTL_SECONDS + 1 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "expired");
});

test("wrong sid (token minted for a different session) → rejected", async () => {
  const token = await mintNotifyToken({ sid: "sess-1", secret: SECRET, now: NOW });
  const res = await authorizeNotify({ token, secret: SECRET, session: "sess-2", now: NOW });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "sid mismatch");
});

test("wrong role (a control token, or a live bridge/browser leg token) → rejected", async () => {
  const control = await mintControlToken({ sub: "user-A", sid: "sess-1", secret: SECRET, now: NOW });
  const controlRes = await authorizeNotify({ token: control, secret: SECRET, session: "sess-1", now: NOW });
  assert.equal(controlRes.ok, false);
  assert.equal(controlRes.reason, "role mismatch");

  const { bridge } = await mintSessionTokens({ sub: "user-A", idea: "idea-1", sid: "sess-1", secret: SECRET, now: NOW });
  const bridgeRes = await authorizeNotify({ token: bridge, secret: SECRET, session: "sess-1", now: NOW });
  assert.equal(bridgeRes.ok, false);
  assert.equal(bridgeRes.reason, "role mismatch");
});

test("wrong secret (a forged relay) → rejected", async () => {
  const token = await mintNotifyToken({ sid: "sess-1", secret: SECRET, now: NOW });
  const res = await authorizeNotify({ token, secret: "some-other-secret", session: "sess-1", now: NOW });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "bad signature");
});
