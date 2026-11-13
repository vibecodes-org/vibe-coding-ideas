// Long-gap reattach (card f4be2981): a bridge that attached with hold=1 is held
// with no grace limit and no idle cap, so BOTH legs can vanish for far longer than
// the old 90 s grace (shortened here) and the token lifetime, then come back with
// the ORIGINAL tokens to the same session. Old bridges (no hold) are unchanged.
//
// Run: cd terminal/test && node --test long-gap-reattach.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";
import { isPeerReattachedFrame, isPeerDegradedFrame } from "../shared/control-frames.mjs";

const SECRET = "long-gap-test-secret";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred, ms, label) {
  const started = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - started > ms) throw new Error(`timed out after ${ms}ms waiting for ${label}`);
    await sleep(25);
  }
}

async function openLeg(relayUrl, session, role, token, extra = "") {
  const ws = new WebSocket(`${relayUrl}/?session=${session}&role=${role}&token=${encodeURIComponent(token)}${extra}`);
  const leg = { ws, texts: [], closed: null };
  ws.on("message", (data, isBinary) => {
    if (!isBinary) leg.texts.push(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
  });
  ws.on("close", (code, reason) => { leg.closed = [code, reason ? reason.toString() : ""]; });
  await Promise.race([
    once(ws, "open"),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${role} open timeout`)), 5000)),
  ]);
  return leg;
}

const has = (leg, pred) => leg.texts.some(pred);

async function setup(t, opts) {
  const relay = await startStandinRelay({ port: 0, secret: SECRET, ...opts });
  t.after(() => relay.close());
  const session = `lg-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-LG", sid: session, secret: SECRET, ttlSeconds: 1 });
  return { relay, session, owner, tokens };
}

test("long-hold bridge: both legs gone past grace AND token TTL, then reattach with the original tokens", { timeout: 20000 }, async (t) => {
  const { relay, session, tokens } = await setup(t, { graceMs: 300, idleMs: 400, maxMs: 60000 });
  const bridge = await openLeg(relay.url, session, "bridge", tokens.bridge, "&hold=1");
  const browser = await openLeg(relay.url, session, "browser", tokens.browser);
  bridge.ws.terminate();
  browser.ws.terminate();
  // Far longer than the grace (300ms), the idle cap (400ms) and the token TTL (1s).
  await sleep(1800);
  const bridge2 = await openLeg(relay.url, session, "bridge", tokens.bridge, "&hold=1");
  const browser2 = await openLeg(relay.url, session, "browser", tokens.browser);
  await waitFor(() => has(bridge2, isPeerReattachedFrame) && has(browser2, isPeerReattachedFrame), 3000, "peer-reattached on both legs");
  assert.equal(bridge2.closed, null);
  assert.equal(browser2.closed, null);
});

test("long-hold bridge: the surviving browser sees peer-degraded and is NOT closed while the Mac is away", { timeout: 20000 }, async (t) => {
  const { relay, session, tokens } = await setup(t, { graceMs: 200, idleMs: 300, maxMs: 60000 });
  const bridge = await openLeg(relay.url, session, "bridge", tokens.bridge, "&hold=1");
  const browser = await openLeg(relay.url, session, "browser", tokens.browser);
  bridge.ws.terminate();
  await waitFor(() => has(browser, isPeerDegradedFrame), 3000, "peer-degraded");
  await sleep(1200);
  assert.equal(browser.closed, null, "browser must not be closed by a grace or idle timer");
});

test("long-hold bridge: a foreign owner is refused on a long-held session", { timeout: 20000 }, async (t) => {
  const { relay, session, tokens } = await setup(t, { graceMs: 200, idleMs: 300, maxMs: 60000 });
  const bridge = await openLeg(relay.url, session, "bridge", tokens.bridge, "&hold=1");
  bridge.ws.terminate();
  await sleep(1500);
  const foreign = await mintSessionTokens({ sub: "someone-else", idea: "idea-LG", sid: session, secret: SECRET, ttlSeconds: 1 });
  const leg = await openLeg(relay.url, session, "browser", foreign.browser);
  await waitFor(() => leg.closed, 3000, "foreign leg closed");
  assert.equal(leg.closed[0], 4005); // owner mismatch
});

test("long-hold bridge: the max-age backstop still ends the session", { timeout: 20000 }, async (t) => {
  const { relay, session, tokens } = await setup(t, { graceMs: 200, idleMs: 300, maxMs: 700 });
  const bridge = await openLeg(relay.url, session, "bridge", tokens.bridge, "&hold=1");
  const browser = await openLeg(relay.url, session, "browser", tokens.browser);
  await waitFor(() => browser.closed && bridge.closed, 4000, "both legs closed by the backstop");
  assert.equal(browser.closed[0], 1000);
  assert.match(browser.closed[1], /max/);
});

test("old bridge (no hold): still torn down after the grace window", { timeout: 20000 }, async (t) => {
  const { relay, session, tokens } = await setup(t, { graceMs: 250, idleMs: 60000, maxMs: 60000 });
  const bridge = await openLeg(relay.url, session, "bridge", tokens.bridge);
  const browser = await openLeg(relay.url, session, "browser", tokens.browser);
  bridge.ws.terminate();
  await waitFor(() => browser.closed, 15000, "browser closed after the grace window");
  assert.equal(browser.closed[0], 4004);
});
