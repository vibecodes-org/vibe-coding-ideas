// Session lifecycle limits — SLICE 6.
//
// Proves the idle + max-duration caps end a session cleanly and that BOTH legs are
// closed with the NORMAL code 1000 and a reason the browser dock classifies as
// "idle" / "max-duration" (see src/lib/terminal/connection.ts → parseEndedReason).
//
// Uses the Node stand-in relay (../test/standin-relay.mjs), which shares the exact
// pairing + lifecycle reason logic with the real Cloudflare DO. The real DO's idle
// close is additionally proven against `wrangler dev` via verify-lifecycle.mjs.
//
// Run: cd terminal/test && node --test lifecycle.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";

const SECRET = "lifecycle-test-secret";

/** Open a leg and resolve once it's connected. */
async function openLeg(relayUrl, session, role, token) {
  const ws = new WebSocket(`${relayUrl}/?session=${session}&role=${role}&token=${encodeURIComponent(token)}`);
  // Clear the loser timer on settle — an orphaned ref'd setTimeout survives the
  // race and later fires an unhandled rejection that node's runner misattributes
  // to whichever concurrent test is still open (source of the lifecycle flake).
  let timer;
  await Promise.race([
    once(ws, "open"),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${role} open timeout`)), 5000); }),
  ]).finally(() => clearTimeout(timer));
  return ws;
}

/** Wait for a close and resolve [code, reason]. */
async function closeOf(ws, label) {
  let timer;
  const [code, reasonBuf] = await Promise.race([
    once(ws, "close"),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} close timeout`)), 5000); }),
  ]).finally(() => clearTimeout(timer));
  return [code, reasonBuf ? reasonBuf.toString() : ""];
}

test("idle-timeout closes BOTH legs with code 1000 + an 'idle' reason", { timeout: 15000 }, async (t) => {
  const session = `idle-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  // Tiny idle, large max → idle wins.
  const relay = await startStandinRelay({ port: 0, secret: SECRET, idleMs: 250, maxMs: 60_000 });
  t.after(() => relay.close());

  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-L", sid: session, secret: SECRET });
  const browser = await openLeg(relay.url, session, "browser", tokens.browser);
  const bridge = await openLeg(relay.url, session, "bridge", tokens.bridge);

  // One message proves activity tracking (the idle clock starts from the LAST byte).
  bridge.send(Buffer.from("READY\n", "utf8"), { binary: true });

  // Register BOTH close waiters BEFORE awaiting either. The two legs close
  // near-simultaneously, so attaching the bridge listener only after the browser
  // close has resolved can miss an already-fired 'close' → a spurious 5s
  // "bridge close timeout" (the intermittent lifecycle flake).
  const browserClosed = closeOf(browser, "browser");
  const bridgeClosed = closeOf(bridge, "bridge");
  const [bCode, bReason] = await browserClosed;
  const [gCode, gReason] = await bridgeClosed;

  assert.equal(bCode, 1000, "browser leg must close with normal code 1000");
  assert.equal(gCode, 1000, "bridge leg must close with normal code 1000");
  assert.match(bReason, /idle/, "browser close reason classifies as idle");
  assert.match(gReason, /idle/, "bridge close reason classifies as idle");
  console.log(`[idle] both legs closed 1000 reason=${JSON.stringify(bReason)}`);
});

test("max-duration closes BOTH legs with code 1000 + a 'max' reason", { timeout: 15000 }, async (t) => {
  const session = `max-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  // Tiny max, large idle → max wins even though we keep sending traffic.
  const relay = await startStandinRelay({ port: 0, secret: SECRET, idleMs: 60_000, maxMs: 350 });
  t.after(() => relay.close());

  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-L", sid: session, secret: SECRET });
  const browser = await openLeg(relay.url, session, "browser", tokens.browser);
  const bridge = await openLeg(relay.url, session, "bridge", tokens.bridge);

  // Keep traffic flowing so ONLY the max-duration cap can end the session.
  const chatter = setInterval(() => {
    try { bridge.send(Buffer.from(".", "utf8"), { binary: true }); } catch { /* closing */ }
  }, 50);
  t.after(() => clearInterval(chatter));

  // Register BOTH close waiters before awaiting either (see idle test) — at
  // maxMs=350 both legs close together, so the late-attached bridge listener
  // was the source of the intermittent "bridge close timeout".
  const browserClosed = closeOf(browser, "browser");
  const bridgeClosed = closeOf(bridge, "bridge");
  const [bCode, bReason] = await browserClosed;
  const [gCode, gReason] = await bridgeClosed;
  clearInterval(chatter);

  assert.equal(bCode, 1000, "browser leg must close with normal code 1000");
  assert.equal(gCode, 1000, "bridge leg must close with normal code 1000");
  assert.match(bReason, /max/, "browser close reason classifies as max-duration");
  assert.match(gReason, /max/, "bridge close reason classifies as max-duration");
  console.log(`[max] both legs closed 1000 reason=${JSON.stringify(bReason)}`);
});
