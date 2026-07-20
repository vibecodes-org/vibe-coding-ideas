// Multi-session stage 3 — POST /end (My-sessions "End" / "End all", C3/F5).
//
// Proves the relay's lifecycle-only HTTP endpoint end-to-end against the Node
// stand-in (shares the exact handler shape the Cloudflare DO uses — see
// terminal/relay/src/index.js → TerminalRelay.handleEnd / standin-relay.mjs →
// handleHttpRequest): a valid, sid-bound control token closes BOTH legs with
// code 1000 "ended-by-user" and forgets the session; an invalid/foreign token
// is rejected without touching a live session; a sid with nothing live gets an
// honest `{ ended: false, reason: "no-session" }` without ever probing whether
// a session with that id ever existed for someone else.
//
// Run: cd terminal/test && node --test session-end.test.mjs   (or: npm test)

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens, mintControlToken } from "../shared/session-token.mjs";

const SECRET = "session-end-test-secret";

async function waitFor(pred, ms, label, pollMs = 25) {
  const started = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - started > ms) throw new Error(`timed out after ${ms}ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Open a raw ws leg and record its eventual close code/reason. */
async function openRawLeg(relayUrl, session, role, token) {
  const ws = new WebSocket(`${relayUrl}/?session=${session}&role=${role}&token=${encodeURIComponent(token)}`);
  const leg = { ws, closed: null };
  ws.on("close", (code, reasonBuf) => {
    leg.closed = [code, reasonBuf ? reasonBuf.toString() : ""];
  });
  await Promise.race([
    once(ws, "open"),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${role} open timeout`)), 5000)),
  ]);
  return leg;
}

test("POST /end with a valid control token closes both legs 1000 'ended-by-user' and forgets the session", { timeout: 15000 }, async (t) => {
  const session = `end-a-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-END", sid: session, secret: SECRET });

  const browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  const bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);
  await waitFor(() => relay.sessions.get(session)?.bridge && relay.sessions.get(session)?.browser, 5000, "pair live");

  const control = await mintControlToken({ sub: owner, sid: session, secret: SECRET });
  const res = await fetch(`${relay.httpUrl}/end?session=${session}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${control}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ended: true });

  await waitFor(() => browser.closed != null && bridge.closed != null, 5000, "both legs closed");
  assert.deepEqual(browser.closed, [1000, "ended-by-user"]);
  assert.deepEqual(bridge.closed, [1000, "ended-by-user"]);
  assert.equal(relay.sessions.has(session), false, "the stand-in's own registry forgets the session (mirrors clearSessionState)");
  console.log("[end/a] PASS — valid control token ends both legs, session forgotten");
});

test("POST /end with a missing/foreign token is rejected 401 and the live session is untouched", { timeout: 15000 }, async (t) => {
  const session = `end-b-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-END", sid: session, secret: SECRET });

  const browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  t.after(() => { try { browser.ws.terminate(); } catch { /* */ } });
  const bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);
  t.after(() => { try { bridge.ws.terminate(); } catch { /* */ } });
  await waitFor(() => relay.sessions.get(session)?.bridge && relay.sessions.get(session)?.browser, 5000, "pair live");

  // No Authorization header at all.
  const noAuth = await fetch(`${relay.httpUrl}/end?session=${session}`, { method: "POST" });
  assert.equal(noAuth.status, 401);
  assert.deepEqual(await noAuth.json(), { ended: false, reason: "unauthorized" });

  // A control token minted for a DIFFERENT sid.
  const foreignSid = await mintControlToken({ sub: owner, sid: `${session}-other`, secret: SECRET });
  const wrongSid = await fetch(`${relay.httpUrl}/end?session=${session}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${foreignSid}` },
  });
  assert.equal(wrongSid.status, 401);

  // A bridge/browser leg token is not a control token.
  const wrongRole = await fetch(`${relay.httpUrl}/end?session=${session}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokens.browser}` },
  });
  assert.equal(wrongRole.status, 401);

  await new Promise((r) => setTimeout(r, 150));
  assert.equal(browser.ws.readyState, WebSocket.OPEN, "session untouched by every rejected /end call");
  assert.ok(relay.sessions.has(session));
  console.log("[end/b] PASS — unauthorized /end calls never touch a live session");
});

test("POST /end for a sid with nothing live returns an honest 200 { ended: false, reason: 'no-session' }", { timeout: 15000 }, async (t) => {
  const session = `end-c-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());

  const control = await mintControlToken({ sub: owner, sid: session, secret: SECRET });
  const res = await fetch(`${relay.httpUrl}/end?session=${session}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${control}` },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ended: false, reason: "no-session" });
  console.log("[end/c] PASS — no-session sid gets an honest 200, no liveness leak given a valid token");
});
