// Same-owner BRIDGE preemption — regression proof
// (fix/terminal-bridge-zombie-preemption).
//
// ROOT CAUSE (Reproduce & Investigate step): after a SILENT link death (wifi
// blip / network switch) the bridge's keepalive eventually ws.terminate()s its
// dead socket, but the RST never reaches Cloudflare (interface/NAT changed), so
// the RELAY still counts the zombie bridge leg. The bridge's own grace-window
// reattach — same sid, same owner-bound token — then bounced off DUP_BRIDGE
// (4002), a code the bridge rightly treats as TERMINAL, so it gave up and reaped
// the PTY child. Proven against the PROD relay: browser reattach over a zombie
// preempts (fix/terminal-dock-heartbeat), bridge reattach closed 4002 — the
// asymmetry that made every real-world silent drop end the session.
//
// THE FIX under test: decideAttach now grants an owner-verified bridge the same
// preempt verdict as the browser — the stale leg is closed 4001 "preempted", the
// new leg takes its slot, and no grace hold opens (the pair never stopped being
// whole). 4001 joins the bridge's TERMINAL_CLOSE_CODES so a genuinely duplicated
// LIVE helper shuts down instead of steal-back flapping.
//
// Runs against the Node stand-in relay, which shares the exact decision logic
// (pairing.js) and the DO's preemption block. Every wait is hard-timeout guarded.
//
// Run: cd terminal/test && node --test zombie-bridge-reattach.test.mjs   (or: npm test)

import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";
import { isPeerDegradedFrame, isAttachedFrame } from "../shared/control-frames.mjs";

const SECRET = "zombie-bridge-test-secret";
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
  ws.on("close", (code, reason) => {
    leg.closed = [code, String(reason)];
  });
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`${role} leg open timeout`)), HARD_TIMEOUT_MS);
    ws.once("open", () => { clearTimeout(to); resolve(); });
    ws.once("error", (e) => { clearTimeout(to); reject(e); });
  });
  return leg;
}

const hasFrame = (leg, pred) => leg.texts.some(pred);

test("same-owner 2nd bridge preempts the zombie leg (4001 preempted) and goes live; no grace hold opens", { timeout: 15000 }, async (t) => {
  const session = `zb-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-ZB", sid: session, secret: SECRET });

  // A "silently dead" bridge leg: still registered server-side — exactly what a
  // wifi-off helper looks like to the relay (no FIN/RST ever delivered).
  const stale = await openRawLeg(relay.url, session, "bridge", tokens.bridge);
  const browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  t.after(() => { try { browser.ws.terminate(); } catch { /* */ } });

  // The bridge's keepalive fired and its reconnect loop opens a NEW bridge leg
  // with the SAME owner-bound token (no re-mint) — this used to bounce off
  // DUP_BRIDGE (terminal for the bridge → PTY child reaped, session dead).
  const fresh = await openRawLeg(relay.url, session, "bridge", tokens.bridge);
  t.after(() => { try { fresh.ws.terminate(); } catch { /* */ } });

  // The zombie leg is closed 4001 "preempted"; the fresh one stays open and gets
  // its own attach confirmation (it is now THE bridge leg).
  await waitFor(() => stale.closed != null, HARD_TIMEOUT_MS, "stale bridge leg closed");
  assert.equal(stale.closed[0], 4001, "stale leg closed with the PREEMPTED code");
  assert.match(stale.closed[1], /preempted/, "with the distinct preempted reason");
  assert.equal(fresh.ws.readyState, WebSocket.OPEN, "the fresh leg is the live bridge leg");
  await waitFor(() => hasFrame(fresh, isAttachedFrame), HARD_TIMEOUT_MS, "attach confirmation to the fresh bridge leg");

  // Single-attach held post-swap AND the pair never stopped being whole: the
  // browser must NOT have been told its peer dropped (no grace hold for a swap).
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(hasFrame(browser, isPeerDegradedFrame), false, "no peer-degraded to the browser on a preemption swap");
  assert.ok(relay.sessions.has(session), "session retained across the swap");

  // Live end-to-end both ways through the new leg.
  const down = `DOWN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  fresh.ws.send(Buffer.from(down, "utf8"), { binary: true });
  await waitFor(() => browser.binary.includes(down), HARD_TIMEOUT_MS, "fresh bridge → browser bytes");
  const up = `UP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  browser.ws.send(Buffer.from(up, "utf8"), { binary: true });
  await waitFor(() => fresh.binary.includes(up), HARD_TIMEOUT_MS, "browser → fresh bridge bytes");
  assert.equal(stale.binary.includes(up), false, "the zombie leg received none of the post-swap bytes");
  console.log("[zb] PASS — same-owner bridge preemption swapped legs cleanly, pipe live end-to-end");
});

test("a foreign-owner bridge still cannot preempt a live session", { timeout: 15000 }, async (t) => {
  const session = `zb-f-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const tokensA = await mintSessionTokens({ sub: owner, idea: "idea-ZB", sid: session, secret: SECRET });
  const tokensB = await mintSessionTokens({ sub: `${owner}-evil`, idea: "idea-ZB", sid: session, secret: SECRET });

  const bridgeA = await openRawLeg(relay.url, session, "bridge", tokensA.bridge);
  t.after(() => { try { bridgeA.ws.terminate(); } catch { /* */ } });

  const bridgeB = await openRawLeg(relay.url, session, "bridge", tokensB.bridge);
  await waitFor(() => bridgeB.closed != null, HARD_TIMEOUT_MS, "foreign bridge rejected");
  assert.equal(bridgeB.closed[0], 4005, "foreign owner rejected OWNER_MISMATCH, never preempts");
  assert.equal(bridgeA.ws.readyState, WebSocket.OPEN, "the bound owner's leg is untouched");
  console.log("[zb/f] PASS — owner binding still gates bridge preemption");
});
