// Integration tests for terminal/helper/main.js's control-connection handling
// — regression coverage for the two LIVE-CONFIRMED bugs in the desktop-Codex
// `vibecodes://open-terminal` path (Nick's Mac, 6 Sep 2026):
//
//   BUG A (CRITICAL): an open-terminal handshake used to reuse the SAME
//   connectControl() as the primary standing control connection, which
//   unconditionally closed and REPLACED the module-level `controlWs` —
//   killing any LIVE browser terminal session the primary connection was
//   keeping alive. Fixed by giving the handshake its own
//   connectOpenTerminalControl() that never reads or writes `controlWs`.
//
//   BUG B: handleOpenTerminalUrl awaited dynamic import()s AFTER opening the
//   handshake socket but BEFORE attaching the authorization-ack listener —
//   an ack arriving in that gap was silently dropped, always producing the
//   full 8s timeout and opening no window. Fixed by pre-importing those
//   modules and attaching the listener synchronously, with no await gap.
//
// main.js is Electron's own entry point and is never `require()`'d by
// production code, so it is safe to load here with `electron` and the `ws`
// package swapped for in-process fakes via require.cache — a standard
// CommonJS test-double technique. No real Electron, no real relay, no real
// `codex`/Terminal.app: `child_process.execFile` is patched BEFORE main.js is
// required so a "successful" open-terminal flow (this dev machine genuinely
// has `codex` on PATH) can never actually run `open -a Terminal`.
//
// Run: cd terminal/test && node --test control-connection.test.mjs   (or: npm test)

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import cp from "node:child_process";
import { mintHelperToken } from "../shared/session-token.mjs";
import { buildOpenTerminalDeepLink } from "../shared/deep-link.mjs";

const HELPER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "helper");
const SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vc-control-connection-test-"));
fs.mkdirSync(path.join(SCRATCH_DIR, "temp"), { recursive: true });
fs.mkdirSync(path.join(SCRATCH_DIR, "userData"), { recursive: true });

// ── patch execFile BEFORE main.js is required ────────────────────────────
// main.js destructures `{ execFile } = require("node:child_process")` at
// require-time, capturing this reference — patch it first so a "successful"
// open-terminal flow never spawns a real `open -a Terminal`.
const realExecFile = cp.execFile;
const execFileCalls = [];
cp.execFile = (...args) => {
  execFileCalls.push(args);
  const cb = args[args.length - 1];
  if (typeof cb === "function") queueMicrotask(() => cb(null));
};

// ── a minimal `ws.WebSocket`-shaped fake ─────────────────────────────────
class FakeWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.closeCalls = 0;
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.nextAutoAck) {
      FakeWebSocket.nextAutoAck = false;
      // setImmediate (a macrotask), never a microtask: guarantees this fires
      // only after every microtask-driven step in the production connect+
      // listen sequence (dynamic import resolution, promise continuations)
      // has already run — i.e. it simulates the FASTEST a real relay could
      // realistically ack, without racing ahead of a same-tick listener
      // attach the way a queueMicrotask() would.
      setImmediate(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open");
        this.emit("message", JSON.stringify({ t: "open-terminal-authorized" }), false);
      });
    }
  }

  send() {}

  close() {
    this.closeCalls += 1;
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
  }
}
FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSING = 2;
FakeWebSocket.CLOSED = 3;
FakeWebSocket.instances = [];
FakeWebSocket.nextAutoAck = false;

// ── a minimal Electron fake ──────────────────────────────────────────────
const fakeApp = {
  isPackaged: false,
  requestSingleInstanceLock: () => true,
  on: () => {},
  whenReady: () => Promise.resolve(),
  dock: { hide: () => {} },
  setAsDefaultProtocolClient: () => {},
  getPath: (name) => path.join(SCRATCH_DIR, name),
  setLoginItemSettings: () => {},
  quit: () => {},
  exit: () => {},
};
const fakeElectron = {
  app: fakeApp,
  dialog: { showMessageBoxSync: () => 0 },
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: { createFromBuffer: () => ({ setTemplateImage: () => {} }) },
  Notification: class FakeNotification {
    static isSupported() { return false; }
    show() {}
  },
  shell: { openExternal: () => {} },
  Tray: class FakeTray {
    setToolTip() {}
    setContextMenu() {}
    destroy() {}
  },
};

// ── inject the fakes into the CJS module cache BEFORE requiring main.js ──
const helperRequire = createRequire(path.join(HELPER_DIR, "main.js"));
const electronPath = helperRequire.resolve("electron");
const wsPath = helperRequire.resolve(path.resolve(HELPER_DIR, "..", "bridge", "node_modules", "ws"));

function fakeCjsModule(resolvedPath, exportsValue) {
  return { id: resolvedPath, filename: resolvedPath, loaded: true, exports: exportsValue, children: [], paths: [] };
}
helperRequire.cache[electronPath] = fakeCjsModule(electronPath, fakeElectron);
helperRequire.cache[wsPath] = fakeCjsModule(wsPath, FakeWebSocket);

const main = helperRequire(path.join(HELPER_DIR, "main.js"));

// Flush the `app.whenReady().then(...)` microtask/macrotask chain (module
// init) before any test runs.
await new Promise((r) => setTimeout(r, 20));

const SECRET = "control-connection-test-secret";
async function freshHelperToken(sub = `owner-${Math.random().toString(36).slice(2, 8)}`) {
  return mintHelperToken({ sub, secret: SECRET });
}

async function waitForNewInstance(baselineCount, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    if (FakeWebSocket.instances.length > baselineCount) {
      return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    }
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for a new FakeWebSocket instance");
    await new Promise((r) => setTimeout(r, 5));
  }
}

test.after(() => {
  cp.execFile = realExecFile;
  try { fs.rmSync(SCRATCH_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ── BUG A: primary controlWs must be untouched by an open-terminal handshake ──

test("connectOpenTerminalControl never touches the primary controlWs (direct function-level check)", async () => {
  const relay = "wss://relay.example.com";
  const primaryToken = await freshHelperToken();
  const primary = await main.__test.connectControl(relay, primaryToken);
  assert.ok(primary, "primary connection should have been established");
  primary.readyState = FakeWebSocket.OPEN; // simulate a live, open primary connection
  assert.equal(main.__test.getControlWs(), primary);

  const handshakeToken = await freshHelperToken();
  const dedicated = await main.__test.connectOpenTerminalControl(relay, handshakeToken);
  assert.ok(dedicated, "a dedicated handshake socket should have been created");
  assert.notEqual(dedicated, primary, "the handshake socket must be a DIFFERENT object from the primary");

  // The regression: this used to be null / a different object entirely.
  assert.equal(main.__test.getControlWs(), primary, "primary controlWs must be UNCHANGED");
  assert.equal(primary.readyState, FakeWebSocket.OPEN, "primary socket must still be open");
  assert.equal(primary.closeCalls, 0, "primary socket must never have had .close() called on it");

  main.__test.closeControlConnection();
});

test("a full open-terminal deep-link flow leaves an existing live primary session's socket untouched", async (t) => {
  const relay = "ws://127.0.0.1:9"; // loopback — allowed in dev (app.isPackaged === false)
  const owner = `owner-${Math.random().toString(36).slice(2, 8)}`;
  const primaryToken = await freshHelperToken(owner);
  const primary = await main.__test.connectControl(relay, primaryToken);
  primary.readyState = FakeWebSocket.OPEN;
  t.after(() => main.__test.closeControlConnection());

  const baseline = FakeWebSocket.instances.length;
  const rawUrl = buildOpenTerminalDeepLink({
    relay,
    helperToken: await freshHelperToken(owner),
    cwd: os.tmpdir(),
    agent: "codex",
    prompt: "hello",
  });

  main.__test.resetOpenTerminalCooldown();
  const flow = main.__test.handleOpenTerminalUrl(rawUrl);
  const handshakeSocket = await waitForNewInstance(baseline);
  assert.notEqual(handshakeSocket, primary, "the open-terminal handshake must use a DIFFERENT socket than the primary");

  // Simulate the relay REJECTING this handshake (BAD_TOKEN-style close) —
  // this also keeps the flow from ever reaching the codex/Terminal step.
  handshakeSocket.emit("close", 4006, Buffer.from("bad token"));
  await flow;

  assert.equal(main.__test.getControlWs(), primary, "primary controlWs must be UNCHANGED after the open-terminal flow");
  assert.equal(primary.readyState, FakeWebSocket.OPEN, "primary socket must still be open");
  assert.equal(primary.closeCalls, 0, "primary socket must never have been closed by the open-terminal flow");
  assert.equal(execFileCalls.length, 0, "a rejected handshake must never reach `open -a Terminal`");
});

// ── the dedicated socket is closed by the caller once the handshake settles ──

test("handleOpenTerminalUrl closes the dedicated socket after a REJECTED handshake", async () => {
  const relay = "ws://127.0.0.1:9";
  const baseline = FakeWebSocket.instances.length;
  const rawUrl = buildOpenTerminalDeepLink({
    relay,
    helperToken: await freshHelperToken(),
    cwd: os.tmpdir(),
    agent: "codex",
  });

  main.__test.resetOpenTerminalCooldown();
  const flow = main.__test.handleOpenTerminalUrl(rawUrl);
  const handshakeSocket = await waitForNewInstance(baseline);
  handshakeSocket.emit("close", 4006, Buffer.from("bad token"));
  await flow;

  assert.ok(handshakeSocket.closeCalls >= 1, "the dedicated socket must be closed once the handshake rejects");
});

test("handleOpenTerminalUrl closes the dedicated socket after a TIMED-OUT handshake", { timeout: 15000 }, async () => {
  const relay = "ws://127.0.0.1:9";
  const baseline = FakeWebSocket.instances.length;
  const rawUrl = buildOpenTerminalDeepLink({
    relay,
    helperToken: await freshHelperToken(),
    cwd: os.tmpdir(),
    agent: "codex",
  });

  main.__test.resetOpenTerminalCooldown();
  const flow = main.__test.handleOpenTerminalUrl(rawUrl);
  const handshakeSocket = await waitForNewInstance(baseline);
  // Never emit anything — let the gate's own 8s timeout fire.
  await flow;

  assert.ok(handshakeSocket.closeCalls >= 1, "the dedicated socket must be closed once the handshake times out");
  assert.equal(execFileCalls.length, 0, "a timed-out handshake must never reach `open -a Terminal`");
}, 15000);

// ── BUG B: an ack delivered immediately must not be missed ──────────────

test("an authorization ack delivered the instant the socket is available is NOT missed (no timeout)", async (t) => {
  const relay = "ws://127.0.0.1:9";
  const primaryToken = await freshHelperToken();
  const primary = await main.__test.connectControl(relay, primaryToken);
  primary.readyState = FakeWebSocket.OPEN;
  t.after(() => main.__test.closeControlConnection());

  FakeWebSocket.nextAutoAck = true;
  const started = Date.now();
  const rawUrl = buildOpenTerminalDeepLink({
    relay,
    helperToken: await freshHelperToken(),
    cwd: os.tmpdir(),
    agent: "codex",
  });

  main.__test.resetOpenTerminalCooldown();
  await main.__test.handleOpenTerminalUrl(rawUrl);
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 5000, `should resolve almost immediately, not via the 8s timeout (took ${elapsed}ms)`);
  assert.equal(main.__test.getControlWs(), primary, "primary controlWs must still be unchanged");
  assert.equal(primary.closeCalls, 0, "primary socket must never have been touched");
  // Success path: this DOES proceed to a (patched, harmless) execFile call
  // since this dev machine has `codex` on PATH — proving the ack-not-missed
  // fix actually reaches the authorized branch, not just "didn't throw".
  assert.ok(execFileCalls.length >= 1, "a successful handshake should proceed to the (patched) `open -a Terminal` call");
});
