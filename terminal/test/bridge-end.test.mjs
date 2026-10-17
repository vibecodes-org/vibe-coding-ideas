// Card 6b2cb8ac, causes E and G, against the Node stand-in relay (the twin of
// relay/src/index.js; relay/src/bridge-end.test.js pins the real DO class).
// A bridge that closes 1000 on purpose ends the session at once: the browser
// gets the same code + reason within a second, never `peer-degraded`, and the
// app is told once (`bridge_ended`). A browser attaching afterwards (within
// the tombstone window) is closed with the reason. A real drop still holds.
//
// Run: cd terminal/test && node --test bridge-end.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";
import { isPeerDegradedFrame } from "../shared/control-frames.mjs";

const SECRET = "bridge-end-standin-secret";

async function waitFor(pred, ms, label, pollMs = 20) {
  const started = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - started > ms) throw new Error(`timed out after ${ms}ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

async function openLeg(relayUrl, session, role, token) {
  const ws = new WebSocket(`${relayUrl}/?session=${session}&role=${role}&token=${encodeURIComponent(token)}`);
  const leg = { ws, texts: [], closed: null, closedAt: null };
  ws.on("message", (data, isBinary) => {
    if (!isBinary) leg.texts.push(String(data));
  });
  ws.on("close", (code, reasonBuf) => {
    leg.closed = [code, reasonBuf ? reasonBuf.toString() : ""];
    leg.closedAt = Date.now();
  });
  await Promise.race([once(ws, "open"), new Promise((_, rej) => setTimeout(() => rej(new Error(`${role} open timeout`)), 5000))]);
  return leg;
}

async function pair(relay) {
  const tokens = await mintSessionTokens({ sub: "user-A", idea: "idea-1", secret: SECRET });
  const bridge = await openLeg(relay.url, tokens.sid, "bridge", tokens.bridge);
  const browser = await openLeg(relay.url, tokens.sid, "browser", tokens.browser);
  await waitFor(() => browser.texts.length > 0, 2000, "browser paired");
  return { tokens, bridge, browser };
}

test("bridge closes 1000 'pty-exit' → browser closed 1000 'pty-exit' within 1s, no peer-degraded, one bridge_ended callback", { timeout: 15000 }, async (t) => {
  const closedCalls = [];
  // graceMs left long (90s default) so a wrongly-opened hold would show up as a timeout here.
  const relay = await startStandinRelay({ port: 0, secret: SECRET, onSessionClosed: (sid, reason) => closedCalls.push({ sid, reason }) });
  t.after(() => relay.close());
  const { tokens, bridge, browser } = await pair(relay);

  const t0 = Date.now();
  bridge.ws.close(1000, "pty-exit");
  await waitFor(() => browser.closed, 1000, "browser closed");
  assert.deepEqual(browser.closed, [1000, "pty-exit"]);
  assert.ok(browser.closedAt - t0 < 1000);
  assert.equal(browser.texts.some(isPeerDegradedFrame), false);
  assert.deepEqual(closedCalls, [{ sid: tokens.sid, reason: "bridge_ended" }]);
});

test("the bridge's own reason passes through (agent-stopped-early:1)", { timeout: 15000 }, async (t) => {
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());
  const { bridge, browser } = await pair(relay);
  bridge.ws.close(1000, "agent-stopped-early:1");
  await waitFor(() => browser.closed, 1000, "browser closed");
  assert.deepEqual(browser.closed, [1000, "agent-stopped-early:1"]);
});

test("a real drop (1006) still gets peer-degraded and the grace hold; the browser stays open", { timeout: 15000 }, async (t) => {
  const closedCalls = [];
  const relay = await startStandinRelay({ port: 0, secret: SECRET, onSessionClosed: (sid, reason) => closedCalls.push(reason) });
  t.after(() => relay.close());
  const { bridge, browser } = await pair(relay);
  t.after(() => { try { browser.ws.terminate(); } catch { /* */ } });
  bridge.ws.terminate();
  await waitFor(() => browser.texts.some(isPeerDegradedFrame), 2000, "peer-degraded");
  assert.equal(browser.closed, null);
  assert.deepEqual(closedCalls, []);
});

test("a browser attaching to the ended sid within the tombstone window is closed 1000 with the reason; after expiry it pairs normally", { timeout: 15000 }, async (t) => {
  const relay = await startStandinRelay({ port: 0, secret: SECRET, tombstoneMs: 400 });
  t.after(() => relay.close());
  const { tokens, bridge, browser } = await pair(relay);
  bridge.ws.close(1000, "folder-missing");
  await waitFor(() => browser.closed, 1000, "browser closed");

  const late = await openLeg(relay.url, tokens.sid, "browser", tokens.browser);
  await waitFor(() => late.closed, 1000, "late browser closed");
  assert.deepEqual(late.closed, [1000, "folder-missing"]);

  await new Promise((r) => setTimeout(r, 500));
  const after = await openLeg(relay.url, tokens.sid, "browser", tokens.browser);
  t.after(() => { try { after.ws.terminate(); } catch { /* */ } });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(after.closed, null, "past the tombstone the attach is ordinary");
});

test("a bridge relaunching on the tombstoned sid clears it and proceeds", { timeout: 15000 }, async (t) => {
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());
  const { tokens, bridge, browser } = await pair(relay);
  bridge.ws.close(1000, "pty-exit");
  await waitFor(() => browser.closed, 1000, "browser closed");

  const bridge2 = await openLeg(relay.url, tokens.sid, "bridge", tokens.bridge);
  t.after(() => { try { bridge2.ws.terminate(); } catch { /* */ } });
  const browser2 = await openLeg(relay.url, tokens.sid, "browser", tokens.browser);
  t.after(() => { try { browser2.ws.terminate(); } catch { /* */ } });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(bridge2.closed, null);
  assert.equal(browser2.closed, null);
});
