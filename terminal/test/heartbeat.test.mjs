// Browser-leg liveness heartbeat + same-owner preemption — regression proof
// (fix/terminal-dock-heartbeat).
//
// ROOT CAUSE (Reproduce & Investigate step): the dock only leaves "connected" on
// SOCKET events, and macOS never RSTs a socket when the network silently dies
// (wifi off / network switch) — so a silent link death froze the pill on
// "Connected" forever. The bridge leg detects via protocol-level pings; browser
// JS can't see those, so the dock needs an APP-level echo.
//
// THE FIX under test (relay side; the dock's watchdog is unit-tested in
// src/lib/terminal/connection.test.ts):
//   heartbeat   — the browser leg sends `{"t":"hb"}`; the relay echoes
//                 `{"t":"hb-ack"}` to the PROBING leg only. Never forwarded to
//                 the peer, and never counted as activity — an open-but-idle dock
//                 must still idle-close on schedule.
//   preemption  — a same-owner browser attach while a (possibly silently dead)
//                 browser leg is still registered now WINS: the stale leg is
//                 closed 4001 "preempted", the new leg goes live, and NO grace
//                 window opens (the pair never stopped being whole).
//
// Runs against the Node stand-in relay, which shares the exact decision logic
// (pairing.js) and mirrors the DO's hb intercept. Every wait is hard-timeout
// guarded.
//
// Run: cd terminal/test && node --test heartbeat.test.mjs   (or: npm test)

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";
import {
  encodeHeartbeatFrame,
  isHeartbeatFrame,
  isHeartbeatAckFrame,
  isAttachedFrame,
  isPeerDegradedFrame,
} from "../shared/control-frames.mjs";

const SECRET = "heartbeat-test-secret";
const HARD_TIMEOUT_MS = 10_000;

// ── generic waiters (same idioms as reconnect-reattach.test.mjs) ──────────────
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

// ── (a) hb → hb-ack to the probing leg only; the peer sees NOTHING ────────────
test("(a) browser hb is acked to the browser only — never forwarded to the bridge", { timeout: 15000 }, async (t) => {
  const session = `hb-a-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-HB", sid: session, secret: SECRET });

  const browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  const bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);
  t.after(() => { try { browser.ws.terminate(); } catch { /* */ } });
  t.after(() => { try { bridge.ws.terminate(); } catch { /* */ } });

  browser.ws.send(encodeHeartbeatFrame());
  await waitFor(() => hasFrame(browser, isHeartbeatAckFrame), HARD_TIMEOUT_MS, "hb-ack to the probing browser leg");

  // Let anything wrongly forwarded arrive, then assert the bridge saw NOTHING but
  // its own R1 `attached` confirmation — no hb, no hb-ack, no bytes.
  await new Promise((r) => setTimeout(r, 200));
  const unexpected = bridge.texts.filter((f) => !isAttachedFrame(f));
  assert.deepEqual(unexpected, [], "the bridge leg received no heartbeat traffic");
  assert.equal(bridge.binary, "", "no bytes reached the bridge leg");
  console.log("[hb/a] PASS — hb acked to sender only, peer untouched");
});

// ── (b) heartbeats do NOT extend the idle clock ───────────────────────────────
test("(b) a session with ONLY heartbeat traffic still idle-closes on schedule", { timeout: 15000 }, async (t) => {
  const session = `hb-b-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const idleMs = 500;
  const relay = await startStandinRelay({ port: 0, secret: SECRET, idleMs });
  t.after(() => relay.close());
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-HB", sid: session, secret: SECRET });

  const browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  const bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);

  // Probe far faster than the idle cap. If heartbeats counted as activity the
  // session would live forever; the fix requires it to end at ~idleMs regardless.
  const probe = setInterval(() => {
    if (browser.ws.readyState === WebSocket.OPEN) browser.ws.send(encodeHeartbeatFrame());
  }, 100);
  t.after(() => clearInterval(probe));

  await waitFor(() => browser.closed != null && bridge.closed != null, HARD_TIMEOUT_MS, "idle close of both legs");
  clearInterval(probe);
  assert.equal(browser.closed[0], 1000, "idle end closes with the normal code");
  assert.match(browser.closed[1], /idle/, "reason classifies as idle for the dock copy");
  assert.match(bridge.closed[1], /idle/, "the bridge leg idle-closes too");
  console.log(`[hb/b] PASS — hb-only session idle-closed (reason=${JSON.stringify(browser.closed[1])})`);
});

// ── (c) same-owner browser preemption: the newer leg wins, end-to-end ─────────
test("(c) same-owner 2nd browser preempts the stale leg (4001 preempted) and goes live; no grace hold opens", { timeout: 15000 }, async (t) => {
  const session = `hb-c-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-HB", sid: session, secret: SECRET });

  // A "silently dead" browser leg: the socket is still registered server-side —
  // exactly what a wifi-off dock looks like to the relay (no FIN/RST ever).
  const stale = await openRawLeg(relay.url, session, "browser", tokens.browser);
  const bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);
  t.after(() => { try { bridge.ws.terminate(); } catch { /* */ } });

  // The dock's watchdog fired and the reattach loop opens a NEW browser leg with
  // the SAME owner-bound token (no re-mint) — this used to bounce off DUP_BROWSER.
  const fresh = await openRawLeg(relay.url, session, "browser", tokens.browser);
  t.after(() => { try { fresh.ws.terminate(); } catch { /* */ } });

  // The stale leg is closed 4001 "preempted"; the fresh one stays open.
  await waitFor(() => stale.closed != null, HARD_TIMEOUT_MS, "stale browser leg closed");
  assert.equal(stale.closed[0], 4001, "stale leg closed with the DUP_BROWSER/preempted code");
  assert.match(stale.closed[1], /preempted/, "with the distinct preempted reason");
  assert.equal(fresh.ws.readyState, WebSocket.OPEN, "the fresh leg is the live browser leg");

  // Single-attach held post-swap AND the pair never stopped being whole: the
  // bridge must NOT have been told its peer dropped (no grace hold for a swap).
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(hasFrame(bridge, isPeerDegradedFrame), false, "no peer-degraded to the bridge on a preemption swap");
  assert.ok(relay.sessions.has(session), "session retained across the swap");

  // Live end-to-end both ways through the new leg.
  const down = `DOWN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  bridge.ws.send(Buffer.from(down, "utf8"), { binary: true });
  await waitFor(() => fresh.binary.includes(down), HARD_TIMEOUT_MS, "bridge → fresh browser bytes");
  const up = `UP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  fresh.ws.send(Buffer.from(up, "utf8"), { binary: true });
  await waitFor(() => bridge.binary.includes(up), HARD_TIMEOUT_MS, "fresh browser → bridge bytes");
  assert.equal(stale.binary.includes(down), false, "the stale leg received none of the post-swap bytes");
  console.log("[hb/c] PASS — same-owner preemption swapped legs cleanly, pipe live end-to-end");
});

// ── (d) skew safety: hb frames are inert outside the heartbeat protocol ───────
test("(d) an hb frame is not a resize/attached/grace frame — an old peer logs-and-ignores it", { timeout: 5000 }, async () => {
  // A NON-intercepting (old) relay would forward the hb to the bridge, which
  // treats unknown TEXT control frames as a logged no-op (see bridge framing +
  // control-frames tests). Pin the disjointness here so that skew story holds.
  const { parseControlMessage } = await import("../bridge/src/framing.js");
  assert.equal(parseControlMessage(encodeHeartbeatFrame()), null, "hb is not a bridge control frame");
  assert.equal(isHeartbeatFrame('{"type":"resize","cols":80,"rows":24}'), false);
  assert.equal(isAttachedFrame(encodeHeartbeatFrame()), false);
  console.log("[hb/d] PASS — hb frame inert to an old bridge (logged no-op, zero PTY bytes)");
});
