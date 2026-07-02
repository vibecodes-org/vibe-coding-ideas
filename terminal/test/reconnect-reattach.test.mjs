// Reconnect / grace-window reattach — regression proof (fix/terminal-reconnect-reattach).
//
// ROOT CAUSE (Reproduce & Investigate step): the relay tore the WHOLE session down
// on ANY single-leg detach (handleDetach → survivor PEER_GONE 4004 + clearSessionState),
// so a reconnecting browser/bridge had nothing to reattach to; and the bridge reaped
// `claude` ~90s after the link froze with ZERO reconnect logic. A same-owner browser
// could NOT re-pair because owner+peer no longer existed.
//
// THE FIX under test:
//   relay  — a single-leg detach now HOLDS the session for a grace window (owner +
//            surviving socket kept, `peer-degraded` sent, no PEER_GONE); a same-sid +
//            owner reattach inside the window re-pairs both legs (`peer-reattached`);
//            only a still-incomplete grace expiry runs the old teardown.
//   bridge — a TRANSIENT relay-link drop while `claude` is alive reconnects to the
//            SAME session (no re-mint) within a budget instead of reaping; budget
//            exhausted / real shutdown still reaps the pty group (no leak).
//
// The relay-level cases (a–e) run against the Node stand-in (shares the exact grace
// logic with the Cloudflare DO). The bridge-level case (f) drives the real bridge
// process. Every wait is hard-timeout guarded; a final ps sweep proves no pty leak.
//
// Run: cd terminal/test && node --test reconnect-reattach.test.mjs   (or: npm test)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";
import { isPeerDegradedFrame, isPeerReattachedFrame } from "../shared/control-frames.mjs";
import { pidAlive } from "../shared/reap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.resolve(__dirname, "../bridge/src/index.js");
const SECRET = "reconnect-reattach-test-secret";
const HARD_TIMEOUT_MS = 25_000;

// ── generic waiters ───────────────────────────────────────────────────────────
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

// ── (a) single-leg drop → survivor gets peer-degraded, NOT closed; state retained ──
test("(a) single-leg drop holds the session: survivor gets peer-degraded, is NOT closed", { timeout: 15000 }, async (t) => {
  const session = `ra-a-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET, graceMs: 5000 });
  t.after(() => relay.close());
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-RA", sid: session, secret: SECRET });

  const browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  const bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);
  t.after(() => { try { browser.ws.terminate(); } catch { /* */ } });

  // Drop the bridge leg.
  bridge.ws.terminate();

  // The SURVIVOR (browser) receives peer-degraded and stays OPEN.
  await waitFor(() => hasFrame(browser, isPeerDegradedFrame), 5000, "peer-degraded to survivor");
  assert.equal(browser.ws.readyState, WebSocket.OPEN, "survivor must NOT be closed");
  assert.equal(browser.closed, null, "survivor received no close");
  assert.ok(relay.sessions.has(session), "session state is retained during the grace window");
  console.log("[ra/a] PASS — survivor held + notified, session retained");
});

// ── (b) reattach same sid+owner within grace → re-paired, both resume ─────────
test("(b) dropped leg reattaches (same sid+owner) within grace → both get peer-reattached and resume", { timeout: 15000 }, async (t) => {
  const session = `ra-b-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET, graceMs: 5000 });
  t.after(() => relay.close());
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-RA", sid: session, secret: SECRET });

  const browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  let bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);
  t.after(() => { try { browser.ws.terminate(); } catch { /* */ } });

  bridge.ws.terminate();
  await waitFor(() => hasFrame(browser, isPeerDegradedFrame), 5000, "degraded");

  // Reattach the bridge with the SAME sid + owner token.
  bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);
  t.after(() => { try { bridge.ws.terminate(); } catch { /* */ } });

  await waitFor(() => hasFrame(browser, isPeerReattachedFrame), 5000, "peer-reattached to browser");
  await waitFor(() => hasFrame(bridge, isPeerReattachedFrame), 5000, "peer-reattached to bridge");

  // Bytes flow again through the re-paired session.
  const tok = `RESUME-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  bridge.ws.send(Buffer.from(tok, "utf8"), { binary: true });
  await waitFor(() => browser.binary.includes(tok), 5000, "post-reattach byte flow");
  assert.equal(browser.ws.readyState, WebSocket.OPEN, "browser stayed live throughout");
  console.log("[ra/b] PASS — reattached within grace, both resumed");
});

// ── (c) grace expires with no reattach → old teardown (survivor PEER_GONE + cleared) ──
test("(c) grace expiry with no reattach → survivor closed PEER_GONE 4004 + state cleared", { timeout: 15000 }, async (t) => {
  const session = `ra-c-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET, graceMs: 250 });
  t.after(() => relay.close());
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-RA", sid: session, secret: SECRET });

  const browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  const bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);

  bridge.ws.terminate(); // no reattach — let the tiny grace window elapse

  await waitFor(() => browser.closed != null, 5000, "survivor close after grace");
  assert.equal(browser.closed[0], 4004, "survivor closed with PEER_GONE 4004 after grace expiry");
  await waitFor(() => !relay.sessions.has(session), 3000, "session state cleared");
  console.log(`[ra/c] PASS — grace expired: survivor PEER_GONE, state cleared (reason=${JSON.stringify(browser.closed[1])})`);
});

// ── (d) both legs drop, then one returns within grace → held, waits for the other ──
test("(d) both legs drop then one returns within grace → session held, waits; whole again on the second", { timeout: 15000 }, async (t) => {
  const session = `ra-d-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET, graceMs: 5000 });
  t.after(() => relay.close());
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-RA", sid: session, secret: SECRET });

  let browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  let bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);

  // Sleep drops BOTH legs (1006).
  browser.ws.terminate();
  bridge.ws.terminate();
  await waitFor(() => relay.sessions.get(session)?.bridge == null && relay.sessions.get(session)?.browser == null, 5000, "both legs dropped");
  assert.ok(relay.sessions.has(session), "session held after BOTH legs dropped");

  // One leg returns → still held, NOT whole, no reattached broadcast yet.
  browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  t.after(() => { try { browser.ws.terminate(); } catch { /* */ } });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(browser.ws.readyState, WebSocket.OPEN, "returning leg stays open, waiting for its peer");
  assert.equal(hasFrame(browser, isPeerReattachedFrame), false, "no reattach until the pair is whole");

  // Second leg returns → whole again → peer-reattached to both.
  bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);
  t.after(() => { try { bridge.ws.terminate(); } catch { /* */ } });
  await waitFor(() => hasFrame(browser, isPeerReattachedFrame) && hasFrame(bridge, isPeerReattachedFrame), 5000, "reattached once whole");
  console.log("[ra/d] PASS — held through both-legs-drop, resumed once the pair was whole");
});

// ── (e) reattach with a DIFFERENT owner sub → rejected (owner binding preserved) ──
test("(e) reattach with a different owner sub is rejected OWNER_MISMATCH; the held survivor is untouched", { timeout: 15000 }, async (t) => {
  const session = `ra-e-${Math.random().toString(36).slice(2, 8)}`;
  const ownerA = `user-A-${Math.random().toString(36).slice(2, 8)}`;
  const ownerB = `user-B-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET, graceMs: 5000 });
  t.after(() => relay.close());
  const a = await mintSessionTokens({ sub: ownerA, idea: "idea-RA", sid: session, secret: SECRET });
  const b = await mintSessionTokens({ sub: ownerB, idea: "idea-RA", sid: session, secret: SECRET });

  const browser = await openRawLeg(relay.url, session, "browser", a.browser);
  const bridge = await openRawLeg(relay.url, session, "bridge", a.bridge);
  t.after(() => { try { browser.ws.terminate(); } catch { /* */ } });

  bridge.ws.terminate();
  await waitFor(() => hasFrame(browser, isPeerDegradedFrame), 5000, "degraded");

  // A DIFFERENT user tries to steal the held bridge slot with the SAME sid.
  const intruder = new WebSocket(`${relay.url}/?session=${session}&role=bridge&token=${encodeURIComponent(b.bridge)}`);
  const [code] = await Promise.race([
    once(intruder, "close"),
    new Promise((_, rej) => setTimeout(() => rej(new Error("intruder close timeout")), 5000)),
  ]);
  assert.equal(code, 4005, "cross-owner reattach must be rejected OWNER_MISMATCH 4005");
  assert.equal(browser.ws.readyState, WebSocket.OPEN, "the held owner-A survivor is untouched");
  assert.ok(relay.sessions.has(session), "session still held for the rightful owner");
  console.log("[ra/e] PASS — foreign-owner reattach rejected, owner binding preserved");
});

// ── (f) bridge-level: transient drop with claude alive → reconnect (no reap); budget exhausted → reap ──

/** Spawn the real bridge (env-configured) with stderr capture, like orphan-cleanup. */
function spawnBridge({ relayUrl, session, token, cmd, env = {} }) {
  const child = spawn(process.execPath, [BRIDGE_ENTRY, "--cmd", cmd], {
    env: { PATH: process.env.PATH, RELAY_URL: relayUrl, SESSION_ID: session, BRIDGE_TOKEN: token, BRIDGE_MAX_SECONDS: "60", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => { stderr += d; process.stderr.write(d); });
  return { child, getStderr: () => stderr };
}

function pgrepPids(pattern) {
  return new Promise((resolve) => {
    execFile("pgrep", ["-f", pattern], (_err, stdout) =>
      resolve(String(stdout || "").trim().split("\n").filter(Boolean).map(Number)));
  });
}
function killHard(pid) {
  try { process.kill(-pid, "SIGKILL"); } catch { /* */ }
  try { process.kill(pid, "SIGKILL"); } catch { /* */ }
}
function newMark() { return String(47_000_000 + Math.floor(Math.random() * 1_000_000)); }
/** A PTY command that ignores SIGHUP (like claude) so only a real reap escalation kills it. */
const immuneCmd = (mark) => `bash -c "trap '' HUP; exec sleep ${mark}"`;
async function findSentinel(mark) {
  return waitFor(async () => {
    const pids = await pgrepPids(`^sleep ${mark}$`);
    return pids.length === 1 ? pids[0] : null;
  }, 15_000, `sentinel "sleep ${mark}"`, 100);
}

test("(f1) transient relay drop with claude alive → bridge RECONNECTS to the same session, does NOT reap", { timeout: 40_000 }, async (t) => {
  const session = `ra-f1-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET, graceMs: 30_000 });
  t.after(() => relay.close());
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-RA", sid: session, secret: SECRET });

  // Browser leg attaches first (relay has no buffering).
  const browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  t.after(() => { try { browser.ws.terminate(); } catch { /* */ } });

  // Real bridge running the echoing sentinel (stands in for a live `claude`).
  const SENTINEL = path.resolve(__dirname, "./sentinel-cmd.mjs");
  const spawned = spawnBridge({ relayUrl: relay.url, session, token: tokens.bridge, cmd: `${process.execPath} ${SENTINEL}` });
  t.after(() => { if (spawned.child.exitCode === null) spawned.child.kill("SIGKILL"); });

  await waitFor(() => browser.binary.includes("READY"), HARD_TIMEOUT_MS, "sentinel READY via relay");
  const firstBridgeWs = await waitFor(() => relay.sessions.get(session)?.bridge ?? null, 5000, "bridge attached server-side");

  // Force a TRANSIENT drop of the bridge's link (server-side terminate → client sees 1006).
  firstBridgeWs.terminate();

  // The bridge must RECONNECT (not reap): the relay re-pairs and broadcasts peer-reattached.
  await waitFor(() => hasFrame(browser, isPeerReattachedFrame), 20_000, "bridge reconnected → peer-reattached");
  assert.equal(spawned.child.exitCode, null, "bridge process did NOT exit across the drop");

  // The pipe resumed: browser → relay → PTY → echo → browser (claude survived).
  const tok = `AFTER-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  browser.binary = "";
  browser.ws.send(Buffer.from(tok + "\n", "utf8"), { binary: true });
  await waitFor(() => browser.binary.includes(tok), HARD_TIMEOUT_MS, "round-trip after reconnect");
  assert.doesNotMatch(spawned.getStderr(), /pty child confirmed dead|reconnect-exhausted/, "no reap happened on a transient drop");
  console.log("[ra/f1] PASS — transient drop → bridge reconnected same session, claude survived, pipe resumed");
});

test("(f2) reconnect budget exhausted (relay stays down) → bridge reaps its child (no leak)", { timeout: 40_000 }, async (t) => {
  const session = `ra-f2-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET, graceMs: 30_000 });
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-RA", sid: session, secret: SECRET });

  const browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  t.after(() => { try { browser.ws.terminate(); } catch { /* */ } });

  const mark = newMark();
  // Tiny reconnect budget → a couple of failed attempts against a dead relay, then reap.
  const spawned = spawnBridge({
    relayUrl: relay.url, session, token: tokens.bridge, cmd: immuneCmd(mark),
    env: { BRIDGE_RECONNECT_MS: "1500" },
  });
  t.after(() => { if (spawned.child.exitCode === null) spawned.child.kill("SIGKILL"); });

  const sentinelPid = await findSentinel(mark);
  t.after(() => killHard(sentinelPid));

  // Bring the WHOLE relay down so every reconnect attempt fails → budget exhausts.
  await relay.close();

  const [code] = await Promise.race([
    once(spawned.child, "exit"),
    new Promise((_, rej) => setTimeout(() => rej(new Error("bridge exit timeout")), HARD_TIMEOUT_MS)),
  ]);
  assert.equal(pidAlive(sentinelPid), false, "the HUP-immune child was reaped (no leak) after the budget exhausted");
  assert.match(spawned.getStderr(), /reconnect-exhausted|reconnect budget exhausted/, "the reconnect budget bounded the retries");
  assert.equal(code, 0, "budget-exhausted teardown exits cleanly");
  console.log("[ra/f2] PASS — reconnect budget bounded the retries, child reaped, no leak");
});

// ── final sweep: NOTHING may survive this suite ───────────────────────────────
after(async () => {
  const strays = await pgrepPids("^sleep 47");
  for (const pid of strays) killHard(pid);
  assert.deepEqual(strays, [], `stray sentinel processes leaked: ${strays.join(", ")}`);
  console.log("[ra/sweep] PASS — final ps sweep clean");
});
