// Orphaned-`claude` cleanup — regression proof for the verified-kill fix.
//
// ROOT CAUSE (Reproduce & Investigate step): teardown rested on ONE unverified
// SIGHUP (node-pty's kill()), the bridge hard-exited 200ms later, and the PTY
// child is its OWN session/group leader (spawn-helper setsid) — so a child that
// ignores SIGHUP (claude does) survived every teardown path as an orphan.
//
// THE FIX under test:
//   bridge  — shutdown() now escalates SIGHUP → SIGTERM → SIGKILL(+group) and
//             does not exit until the child is confirmed dead (shared/reap.mjs);
//   bridge  — process.on("disconnect") tears down when the forking helper dies;
//   bridge  — sends {type:"pty-pid",pid} over IPC so the helper can supervise;
//   helper  — verifies the grandchild died on bridge exit / before-quit and
//             escalates SIGHUP → SIGKILL(+group) (same shared module).
//
// Matrix rows covered here: (a) ws-close, (b) SIGTERM-to-bridge, (e) connect
// timeout, (d1) parent/helper death via IPC disconnect, (c) bridge-SIGKILL via
// the helper-side escalation logic (simulated — see the row-c test's note).
//
// Sentinels are made SIGHUP-immune (`bash -c "trap '' HUP; exec sleep <MARK>"`,
// unique MARK per test for pid discovery) so ONLY a real escalation can kill
// them — exactly the property claude exhibited.
//
// Run: cd terminal/test && node orphan-cleanup.test.mjs   (or: node --test)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";
import { pidAlive, reapPidGroupEscalated } from "../shared/reap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.resolve(__dirname, "../bridge/src/index.js");
const MINI_PARENT = path.resolve(__dirname, "./mini-parent.mjs");
const HARD_TIMEOUT_MS = 25_000;
const SECRET = "orphan-cleanup-test-secret";

// Every sentinel sleeps a unique 46xxxxxx-second mark → discoverable via
// `pgrep -f "^sleep 46…"` and sweepable at the end. The anchor matters: the
// bridge/mini-parent argv also CONTAINS the mark inside their --cmd string.
const SWEEP_PREFIX = "^sleep 46";
function newMark() {
  return String(46_000_000 + Math.floor(Math.random() * 1_000_000));
}
/** A PTY command that ignores SIGHUP (and optionally SIGTERM) — like claude. */
function immuneCmd(mark, { alsoTerm = false } = {}) {
  const traps = alsoTerm ? "trap '' HUP TERM" : "trap '' HUP";
  return `bash -c "${traps}; exec sleep ${mark}"`;
}

function pgrepPids(pattern) {
  return new Promise((resolve) => {
    execFile("pgrep", ["-f", pattern], (_err, stdout) => {
      resolve(
        String(stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(Number),
      );
    });
  });
}

async function waitFor(pred, ms, label, pollMs = 50) {
  const started = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - started > ms) throw new Error(`timed out after ${ms}ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Find the exec'd `sleep <mark>` sentinel pid (exactly one expected). */
async function findSentinel(mark) {
  return waitFor(
    async () => {
      const pids = await pgrepPids(`^sleep ${mark}$`);
      return pids.length === 1 ? pids[0] : null;
    },
    15_000,
    `sentinel "sleep ${mark}"`,
    100,
  );
}

function killHard(pid) {
  try { process.kill(-pid, "SIGKILL"); } catch { /* ignore */ }
  try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
}

/** Spawn the bridge (env-configured, like roundtrip.test.mjs) with stderr capture. */
function spawnBridge({ relayUrl, session, token, cmd, extraArgv = [], env = {} }) {
  const child = spawn(process.execPath, [BRIDGE_ENTRY, ...extraArgv, "--cmd", cmd], {
    env: {
      PATH: process.env.PATH,
      RELAY_URL: relayUrl,
      SESSION_ID: session,
      BRIDGE_TOKEN: token,
      BRIDGE_MAX_SECONDS: "60",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => process.stdout.write(d));
  child.stderr.on("data", (d) => {
    stderr += d;
    process.stderr.write(d);
  });
  return { child, getStderr: () => stderr };
}

async function waitForExit(child, ms, label) {
  const [code, signal] = await Promise.race([
    once(child, "exit"),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} exit timeout`)), ms)),
  ]);
  return { code, signal };
}

async function connectBrowserLeg(relayUrl, session, browserToken) {
  const ws = new WebSocket(
    `${relayUrl}/?session=${session}&role=browser&token=${encodeURIComponent(browserToken)}`,
  );
  await Promise.race([
    once(ws, "open"),
    new Promise((_, rej) => setTimeout(() => rej(new Error("browser ws open timeout")), 5000)),
  ]);
  return ws;
}

/** Shared scaffolding: relay + tokens + attached browser leg. */
async function startSession(t, relayOpts = {}) {
  const session = `oc-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-OC-${Math.random().toString(36).slice(2, 8)}`;
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-OC", sid: session, secret: SECRET });
  const relay = await startStandinRelay({ port: 0, secret: SECRET, ...relayOpts });
  t.after(() => relay.close());
  const browser = await connectBrowserLeg(relay.url, session, tokens.browser);
  t.after(() => { try { browser.terminate(); } catch { /* ignore */ } });
  return { session, tokens, relay, browser };
}

// ── (a) ws-close teardown must reap even a HUP+TERM-immune child ──────────────
test("(a) ws-close: escalation reaches SIGKILL(+group) and the bridge exits only after the child is confirmed dead", { timeout: 40_000 }, async (t) => {
  // Grace-window reattach (fix/terminal-reconnect-reattach): a single-leg drop no
  // longer tears the session down immediately — the relay HOLDS it for the grace
  // window, then (no reattach) closes the survivor with PEER_GONE. A tiny graceMs
  // keeps this fast; the bridge treats that deliberate PEER_GONE as a session end and
  // runs the SAME verified-kill teardown under test here.
  const { session, tokens, relay, browser } = await startSession(t, { graceMs: 300 });
  const mark = newMark();
  const spawned = spawnBridge({
    relayUrl: relay.url,
    session,
    token: tokens.bridge,
    cmd: immuneCmd(mark, { alsoTerm: true }), // ignores HUP *and* TERM → only SIGKILL works
  });
  t.after(() => { if (spawned.child.exitCode === null) spawned.child.kill("SIGKILL"); });

  const sentinelPid = await findSentinel(mark);
  t.after(() => killHard(sentinelPid));
  console.log(`[oc/a] sentinel pid=${sentinelPid}`);

  // Browser leg leaves → relay holds, then (grace expiry) closes the bridge leg with
  // PEER_GONE → the bridge's verified-kill teardown reaps the child.
  browser.close();
  const { code } = await waitForExit(spawned.child, HARD_TIMEOUT_MS, "bridge (ws-close)");

  // The bridge may exit ONLY once the child is dead — assert both, and that
  // the full escalation actually ran (HUP ignored → TERM ignored → KILL).
  assert.equal(pidAlive(sentinelPid), false, "sentinel must be dead when the bridge has exited");
  const logs = spawned.getStderr();
  assert.match(logs, /"msg":"pty kill escalated".*"stage":"SIGTERM"/, "escalated to SIGTERM");
  assert.match(logs, /"msg":"pty kill escalated".*"stage":"SIGKILL"/, "escalated to SIGKILL");
  assert.match(logs, /"msg":"pty child confirmed dead"/, "death was VERIFIED before exit");
  assert.equal(code, 0, "ws-close teardown exits 0");
  console.log("[oc/a] PASS — HUP+TERM-immune child reaped via SIGKILL escalation");
});

// ── (b) SIGTERM to the bridge ─────────────────────────────────────────────────
test("(b) SIGTERM to the bridge: HUP-immune child dies at the SIGTERM stage, verified", { timeout: 40_000 }, async (t) => {
  const { session, tokens, relay } = await startSession(t);
  const mark = newMark();
  const spawned = spawnBridge({
    relayUrl: relay.url,
    session,
    token: tokens.bridge,
    cmd: immuneCmd(mark), // ignores HUP only → SIGTERM stage kills it
  });
  t.after(() => { if (spawned.child.exitCode === null) spawned.child.kill("SIGKILL"); });

  const sentinelPid = await findSentinel(mark);
  t.after(() => killHard(sentinelPid));

  spawned.child.kill("SIGTERM");
  const { code } = await waitForExit(spawned.child, HARD_TIMEOUT_MS, "bridge (SIGTERM)");

  assert.equal(pidAlive(sentinelPid), false, "sentinel must be dead when the bridge has exited");
  const logs = spawned.getStderr();
  assert.match(logs, /"msg":"pty kill escalated".*"stage":"SIGTERM"/, "escalated to SIGTERM");
  assert.doesNotMatch(logs, /"stage":"SIGKILL"/, "SIGTERM sufficed — no SIGKILL stage");
  assert.match(logs, /"msg":"pty child confirmed dead"/, "death was VERIFIED before exit");
  assert.equal(code, 0, "signal teardown exits 0");
  console.log("[oc/b] PASS — SIGTERM teardown verified-kills a HUP-immune child");
});

// ── (e) connect-timeout path ──────────────────────────────────────────────────
test("(e) connect-timeout: a bridge that never reaches the relay still reaps its child", { timeout: 40_000 }, async (t) => {
  // A TCP server that accepts and then says NOTHING → the ws handshake hangs
  // and the bridge's own connect timeout is what fires (not an ECONNREFUSED).
  // Track accepted sockets so teardown can destroy them — server.close() only
  // calls back once every connection is gone.
  const held = new Set();
  const hang = net.createServer((s) => {
    held.add(s);
    s.on("close", () => held.delete(s));
  });
  await new Promise((res) => hang.listen(0, "127.0.0.1", res));
  t.after(() => {
    for (const s of held) s.destroy();
    return new Promise((res) => hang.close(() => res()));
  });
  const port = hang.address().port;

  const mark = newMark();
  const spawned = spawnBridge({
    relayUrl: `ws://127.0.0.1:${port}`,
    session: "oc-timeout",
    token: "irrelevant-never-verified",
    cmd: immuneCmd(mark),
    extraArgv: ["--connect-timeout-ms", "700"],
  });
  t.after(() => { if (spawned.child.exitCode === null) spawned.child.kill("SIGKILL"); });

  const sentinelPid = await findSentinel(mark); // promptless → PTY spawns first
  t.after(() => killHard(sentinelPid));

  const { code } = await waitForExit(spawned.child, HARD_TIMEOUT_MS, "bridge (connect-timeout)");
  assert.equal(pidAlive(sentinelPid), false, "sentinel must be dead when the bridge has exited");
  const logs = spawned.getStderr();
  assert.match(logs, /connect timeout/, "the connect-timeout path fired");
  assert.match(logs, /"msg":"pty child confirmed dead"/, "death was VERIFIED before exit");
  assert.equal(code, 1, "connect-timeout exits 1");
  console.log("[oc/e] PASS — connect-timeout teardown reaps the child");
});

// ── (d1) parent (helper) death: IPC disconnect ────────────────────────────────
test("(d1) helper death: the IPC disconnect shuts the bridge down and the child dies; pty-pid was reported", { timeout: 40_000 }, async (t) => {
  const { session, tokens, relay } = await startSession(t);
  const mark = newMark();

  // Fork the bridge from a mini-parent EXACTLY like the helper does (IPC on fd 3).
  const mini = spawn(
    process.execPath,
    [MINI_PARENT, BRIDGE_ENTRY, "--cmd", immuneCmd(mark)],
    {
      env: {
        PATH: process.env.PATH,
        RELAY_URL: relay.url,
        SESSION_ID: session,
        BRIDGE_TOKEN: tokens.bridge,
        BRIDGE_MAX_SECONDS: "60",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let out = "";
  let err = "";
  mini.stdout.setEncoding("utf8");
  mini.stderr.setEncoding("utf8");
  mini.stdout.on("data", (d) => { out += d; });
  mini.stderr.on("data", (d) => { err += d; process.stderr.write(d); });
  t.after(() => { if (mini.exitCode === null) mini.kill("SIGKILL"); });

  const lines = () => out.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const bridgePid = (await waitFor(() => lines().find((m) => m.type === "bridge-pid"), 10_000, "bridge-pid line")).pid;
  t.after(() => { try { process.kill(bridgePid, "SIGKILL"); } catch { /* ignore */ } });

  // The helper-protocol message: the bridge reports its PTY child's pid over IPC.
  const ptyPidMsg = await waitFor(() => lines().find((m) => m.type === "pty-pid"), 15_000, "relayed pty-pid message");
  const sentinelPid = await findSentinel(mark);
  t.after(() => killHard(sentinelPid));
  assert.equal(ptyPidMsg.pid, sentinelPid, "the IPC-reported pty pid IS the sentinel's pid");

  // Kill the parent the un-cleanest way possible. The bridge must notice the
  // dropped channel and tear itself (and its child) down.
  process.kill(mini.pid, "SIGKILL");
  await waitFor(() => !pidAlive(bridgePid), 15_000, "bridge exit after parent death", 100);
  await waitFor(() => !pidAlive(sentinelPid), 5_000, "sentinel death after parent death", 100);

  // The bridge's stderr stayed bound to our pipe (inherited) — check the reason.
  assert.match(err, /helper-gone|IPC channel to parent dropped/, "bridge logged the parent-death teardown");
  console.log("[oc/d1] PASS — parent SIGKILL ⇒ bridge disconnect teardown ⇒ child reaped");
});

// ── (c) bridge SIGKILL: the ONLY survivor row — covered by the helper's reap ──
// A SIGKILL'd bridge can run no cleanup, so this row is covered by the HELPER
// verifying the pty-pid it recorded and escalating. Electron itself is not
// bootable in this suite, so we prove (1) the orphan really happens (the bug),
// and (2) the EXACT escalation call the helper makes (reapGrandchild →
// reapPidGroupEscalated with the HUP→KILL profile) cleans it. What only the
// packaged helper can prove end-to-end: Electron's fork/IPC delivery of
// {type:"pty-pid"} (asserted in d1 via the identical Node fork API) and the
// before-quit hold — flagged for QA in the step report.
test("(c) SIGKILL'd bridge orphans the child; the helper-side escalation reaps it (+ verified already-dead path)", { timeout: 40_000 }, async (t) => {
  const { session, tokens, relay } = await startSession(t);
  const mark = newMark();
  const spawned = spawnBridge({
    relayUrl: relay.url,
    session,
    token: tokens.bridge,
    cmd: immuneCmd(mark),
  });
  t.after(() => { if (spawned.child.exitCode === null) spawned.child.kill("SIGKILL"); });

  const sentinelPid = await findSentinel(mark);
  t.after(() => killHard(sentinelPid));

  spawned.child.kill("SIGKILL");
  await waitForExit(spawned.child, HARD_TIMEOUT_MS, "bridge (SIGKILL)");

  // (1) The orphan is real: nothing bridge-side can help after SIGKILL.
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(pidAlive(sentinelPid), true, "row c reproduced: SIGKILL'd bridge leaves the child running");

  // (2) The helper's escalation profile (SIGHUP → wait → SIGKILL+group) reaps it.
  const res = await reapPidGroupEscalated(sentinelPid, { hupWaitMs: 500, termWaitMs: 0 });
  assert.equal(res.stage, "SIGKILL", "HUP-immune orphan requires the SIGKILL stage");
  assert.equal(res.confirmedDead, true, "the helper profile VERIFIES death");
  assert.equal(pidAlive(sentinelPid), false, "orphan reaped");

  // Error/no-op path: reaping an already-dead pid short-circuits.
  const again = await reapPidGroupEscalated(sentinelPid, { hupWaitMs: 100, termWaitMs: 0 });
  assert.equal(again.stage, "already-dead", "verification of a dead grandchild is a no-op");
  console.log("[oc/c] PASS — orphan reproduced, then reaped by the helper-side escalation");
});

// ── reap module happy path: an obedient child needs NO escalation ─────────────
test("reap module: a SIGHUP-obedient child dies at the SIGHUP stage — no escalation", { timeout: 15_000 }, async (t) => {
  const mark = newMark();
  const child = spawn("sleep", [mark], { detached: true, stdio: "ignore" }); // own group, like spawn-helper's setsid
  child.unref();
  t.after(() => killHard(child.pid));
  await waitFor(() => pidAlive(child.pid), 5_000, "obedient sentinel up");

  const stages = [];
  const res = await reapPidGroupEscalated(child.pid, {
    hupWaitMs: 1000,
    termWaitMs: 500,
    onStage: (s) => stages.push(s),
  });
  assert.equal(res.stage, "SIGHUP", "plain SIGHUP suffices for an obedient child");
  assert.equal(res.confirmedDead, true);
  assert.deepEqual(stages, [], "no escalation stages were needed");
  console.log("[oc/reap] PASS — obedient child: SIGHUP only, verified");
});

// ── reap module group sweep: children of the PTY child die too ────────────────
test("reap module: the SIGKILL stage sweeps the child's OWN children via the process group", { timeout: 15_000 }, async (t) => {
  const mark = newMark();
  const subMark = newMark();
  // detached:true → setsid, exactly how spawn-helper isolates the PTY child.
  // The leader ignores HUP+TERM and carries a background child in its group —
  // the shape of `claude` having spawned an MCP server.
  const child = spawn(
    "bash",
    ["-c", `trap '' HUP TERM; sleep ${subMark} & exec sleep ${mark}`],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  t.after(() => killHard(child.pid));

  const leaderPid = await findSentinel(mark);
  assert.equal(leaderPid, child.pid, "the exec'd leader keeps its pid");
  const subPid = await waitFor(
    async () => (await pgrepPids(`^sleep ${subMark}$`))[0] ?? null,
    5_000,
    "background group member",
    100,
  );
  t.after(() => { try { process.kill(subPid, "SIGKILL"); } catch { /* ignore */ } });

  const res = await reapPidGroupEscalated(leaderPid, { hupWaitMs: 300, termWaitMs: 300 });
  assert.equal(res.stage, "SIGKILL", "immune leader forces the SIGKILL stage");
  assert.equal(res.confirmedDead, true);
  await waitFor(() => !pidAlive(subPid), 3_000, "group member death", 50);
  assert.equal(pidAlive(leaderPid), false, "leader dead");
  console.log("[oc/group] PASS — group SIGKILL swept the child's own children");
});

// ── final sweep: NOTHING may survive this suite ───────────────────────────────
after(async () => {
  const strays = await pgrepPids(SWEEP_PREFIX);
  for (const pid of strays) killHard(pid); // clean up before failing loudly
  assert.deepEqual(strays, [], `stray sentinel processes leaked: ${strays.join(", ")}`);
  console.log("[oc/sweep] PASS — final ps sweep clean");
});
