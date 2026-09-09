// Relay-side integration tests for the desktop-Codex open-terminal
// relay-authorization gate (security review Finding 1 — CRITICAL).
//
// Proves the RELAY half of the fix against the Node stand-in (shares the
// exact handler shape as the Cloudflare DO — see relay/src/index.js →
// fetchHelperLeg vs. standin-relay.mjs → handleHelperConnection, both of
// which now send `{"t":"open-terminal-authorized"}` to a `role=helper` leg
// that connects with `purpose=open-terminal`, strictly AFTER authorizeAttach
// succeeds):
//   (1) a genuinely signed, unexpired helper token + `purpose=open-terminal`
//       → the ack arrives, and the leg stays open (not closed).
//   (2) a forged/tampered token (bad signature) + `purpose=open-terminal`
//       → BAD_TOKEN (4006) close, and the ack is NEVER sent.
//   (3) an expired, never-bound token + `purpose=open-terminal` → BAD_TOKEN
//       close (establishment always needs a live token — no reattach
//       waiver applies to a virgin session), no ack.
//   (4) a helper leg WITHOUT `purpose=open-terminal` never receives the ack
//       (skew/no-regression: ordinary helper attaches are unaffected).
//
// Run: cd terminal/test && node --test open-terminal-relay-auth.test.mjs   (or: npm test)

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintHelperToken, helperSessionId, signToken } from "../shared/session-token.mjs";
import { isOpenTerminalAuthorizedFrame } from "../shared/control-frames.mjs";

const SECRET = "open-terminal-relay-auth-test-secret";

/** Open a raw helper-leg ws (optionally carrying `purpose=open-terminal`) and
 *  collect its TEXT control frames + close outcome. */
async function openHelperLeg(relayUrl, session, token, { purpose } = {}) {
  const params = new URLSearchParams({ session, role: "helper", token });
  if (purpose) params.set("purpose", purpose);
  const ws = new WebSocket(`${relayUrl}/?${params}`);
  const leg = { ws, texts: [], closed: null };
  ws.on("message", (data, isBinary) => {
    if (!isBinary) leg.texts.push(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
  });
  ws.on("close", (code, reasonBuf) => { leg.closed = [code, reasonBuf ? reasonBuf.toString() : ""]; });
  // A rejected leg is accept()ed then closed — "open" fires either way, so we
  // race it against a close/error to observe rejection without hanging.
  await Promise.race([
    once(ws, "open"),
    once(ws, "close").then(() => {}),
    new Promise((_, rej) => setTimeout(() => rej(new Error("helper leg timeout")), 5000)),
  ]);
  return leg;
}

async function waitFor(pred, ms, label, pollMs = 20) {
  const started = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - started > ms) throw new Error(`timed out after ${ms}ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

test("(1) a genuine, unexpired helper token + purpose=open-terminal receives the authorized ack and stays open", { timeout: 15000 }, async (t) => {
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const session = helperSessionId(owner);
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());

  const token = await mintHelperToken({ sub: owner, secret: SECRET });
  const leg = await openHelperLeg(relay.url, session, token, { purpose: "open-terminal" });
  t.after(() => { try { leg.ws.terminate(); } catch { /* */ } });

  await waitFor(() => leg.texts.some(isOpenTerminalAuthorizedFrame), 3000, "open-terminal-authorized frame");
  assert.equal(leg.closed, null, "the leg is not closed just for carrying purpose=open-terminal");
});

test("(2) a forged/tampered token + purpose=open-terminal is BAD_TOKEN-closed and NEVER gets the ack", { timeout: 15000 }, async (t) => {
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const session = helperSessionId(owner);
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());

  const genuine = await mintHelperToken({ sub: owner, secret: SECRET });
  // Tamper with the signature half — same shape, wrong bytes: exactly what a
  // web page forging a helperToken without the shared secret would produce
  // (it can copy the payload shape but never reproduce a valid HMAC).
  const [payloadB64] = genuine.split(".");
  const forged = `${payloadB64}.${"A".repeat(43)}`;

  const leg = await openHelperLeg(relay.url, session, forged, { purpose: "open-terminal" });
  t.after(() => { try { leg.ws.terminate(); } catch { /* */ } });

  await waitFor(() => leg.closed !== null, 3000, "close event");
  assert.equal(leg.closed[0], 4006, "BAD_TOKEN close code");
  assert.ok(!leg.texts.some(isOpenTerminalAuthorizedFrame), "a forged token must never receive the authorization ack");
});

test("(3) an expired, never-bound token + purpose=open-terminal is rejected — no waiver on a virgin session", { timeout: 15000 }, async (t) => {
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const session = helperSessionId(owner);
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());

  const now = Math.floor(Date.now() / 1000);
  const expiredToken = await signToken(
    { sub: owner, sid: session, idea: "", role: "helper", iat: now - 4000, exp: now - 3700 },
    SECRET,
  );

  const leg = await openHelperLeg(relay.url, session, expiredToken, { purpose: "open-terminal" });
  t.after(() => { try { leg.ws.terminate(); } catch { /* */ } });

  await waitFor(() => leg.closed !== null, 3000, "close event");
  assert.equal(leg.closed[0], 4006, "BAD_TOKEN close code (expired, never-bound — no reattach waiver applies)");
  assert.ok(!leg.texts.some(isOpenTerminalAuthorizedFrame), "an expired token must never receive the authorization ack");
});

test("(4) an ordinary helper attach WITHOUT purpose=open-terminal never receives the ack (no regression)", { timeout: 15000 }, async (t) => {
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const session = helperSessionId(owner);
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());

  const token = await mintHelperToken({ sub: owner, secret: SECRET });
  const leg = await openHelperLeg(relay.url, session, token);
  t.after(() => { try { leg.ws.terminate(); } catch { /* */ } });

  // Give the relay a beat to (not) send anything, then assert it never did.
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(leg.closed, null);
  assert.ok(!leg.texts.some(isOpenTerminalAuthorizedFrame), "an ordinary helper leg must not get the open-terminal ack");
});
