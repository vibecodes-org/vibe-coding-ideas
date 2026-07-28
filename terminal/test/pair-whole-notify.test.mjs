// `peer-reattached` fires on EVERY pair-whole transition — regression proof
// (fix/relay-pair-whole-notify, board card 4f9cf03d).
//
// ROOT CAUSE (field test on the pop-out hand-off, PR #136 hand-off itself is
// fine): the attach flow only broadcast `peer-reattached` when `wasHeld &&
// pairWhole` — i.e. only when the attach ended a GRACE HOLD. Pop-out is a
// same-owner PREEMPTION: the popped window's browser leg replaces the dock's
// still-live browser socket, so `wasHeld` is false and the relay never told
// either leg the pair was whole. The client only leaves "waiting-to-pair" on an
// inbound PTY byte or a `peer-reattached` frame; an idle PTY emits neither, so
// the popped window hung on "Reattaching…" until the connect-timeout fired. The
// same gap breaks "Bring back to dock" (the dock's reattach preempts the popped
// window — also no grace hold) and any browser-leg attach to a quiet session.
//
// THE FIX under test: broadcast `peer-reattached` whenever `pairWhole` alone —
// covering initial pairing, a grace-window reattach, and a same-owner
// preemption reattach — not only the `wasHeld` case. `wasHeld` still gates
// nothing but clearing the grace deadline + its log line.
//
// The grace-window-reattach case (the old `wasHeld` behaviour) is already
// covered by reconnect-reattach.test.mjs (b, d) and expired-reattach.test.mjs
// (1); the preemption case is covered by heartbeat.test.mjs (c, browser) and
// zombie-bridge-reattach.test.mjs (bridge). This file covers the two cases
// those don't: a virgin session's INITIAL pairing, and a SOLO attach that must
// NOT get the frame (no peer yet — there is no pair to be whole).
//
// Runs against the Node stand-in relay, which mirrors the exact `pairWhole`
// broadcast condition the Cloudflare DO uses (../relay/src/index.js step 6).
//
// Run: cd terminal/test && node --test pair-whole-notify.test.mjs   (or: npm test)

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";
import { isPeerReattachedFrame } from "../shared/control-frames.mjs";

const SECRET = "pair-whole-notify-test-secret";
const HARD_TIMEOUT_MS = 10_000;

async function waitFor(pred, ms, label, pollMs = 25) {
  const started = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - started > ms) throw new Error(`timed out after ${ms}ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Open a raw ws leg and collect its TEXT control frames + binary bytes. */
async function openRawLeg(relayUrl, session, role, token) {
  const ws = new WebSocket(`${relayUrl}/?session=${session}&role=${role}&token=${encodeURIComponent(token)}`);
  const leg = { ws, texts: [], binary: "", closed: null };
  ws.on("message", (data, isBinary) => {
    if (isBinary) leg.binary += Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    else leg.texts.push(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
  });
  ws.on("close", (code, reasonBuf) => { leg.closed = [code, reasonBuf ? reasonBuf.toString() : ""]; });
  await Promise.race([
    once(ws, "open"),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${role} open timeout`)), 5000)),
  ]);
  return leg;
}

const hasFrame = (leg, pred) => leg.texts.some(pred);

// ── (1) initial pairing on a virgin session → peer-reattached to BOTH legs ────
test("(1) initial pairing (bridge attaches, then browser, no grace hold) → peer-reattached to both legs", { timeout: 15000 }, async (t) => {
  const session = `pw-1-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-PW", sid: session, secret: SECRET });

  // Bridge attaches first — solo, so it must NOT see peer-reattached yet (case 3
  // below covers this directly; here we just move straight to pairing it up).
  const bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);
  t.after(() => { try { bridge.ws.terminate(); } catch { /* */ } });

  // The browser completes the pair for the FIRST time ever on this session — no
  // grace hold was ever set, so the old `wasHeld && pairWhole` gate would have
  // sent nothing.
  const browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  t.after(() => { try { browser.ws.terminate(); } catch { /* */ } });

  await waitFor(() => hasFrame(browser, isPeerReattachedFrame), HARD_TIMEOUT_MS, "peer-reattached to the newly-attached browser leg");
  assert.ok(hasFrame(bridge, isPeerReattachedFrame), "peer-reattached to the already-attached bridge leg too");
  console.log("[pw/1] PASS — initial pairing broadcasts peer-reattached to both legs");
});

// ── (2) solo attach (only one leg present) → NO peer-reattached sent ──────────
test("(2) a solo attach with no peer present → no peer-reattached is sent", { timeout: 15000 }, async (t) => {
  const session = `pw-2-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-PW", sid: session, secret: SECRET });

  const bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);
  t.after(() => { try { bridge.ws.terminate(); } catch { /* */ } });

  // Give the relay a beat to (wrongly) broadcast, then assert it didn't — the
  // pair is not whole with only one leg attached.
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(hasFrame(bridge, isPeerReattachedFrame), false, "a solo leg must not see peer-reattached");
  console.log("[pw/2] PASS — solo attach sends no peer-reattached");
});
