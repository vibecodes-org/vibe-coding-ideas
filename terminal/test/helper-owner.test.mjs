// Regression tests for the "helper opens sessions for ANY account's launch
// link" hole (card 9efc01c3). The helper must remember which VibeCodes
// account it belongs to and refuse launch / open-terminal links minted for
// any other account: no bridge fork, no change to the saved control
// credentials, no change to the live control connection.
//
// main.js is loaded with `electron`, `ws` and child_process.fork swapped for
// fakes (same technique as control-connection.test.mjs). No real bridge, no
// real relay, nothing on the host is touched.
//
// Run: cd terminal/test && node --test helper-owner.test.mjs

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import cp from "node:child_process";
import { mintHelperToken, mintSessionTokens } from "../shared/session-token.mjs";
import { buildLaunchDeepLink, buildOpenTerminalDeepLink } from "../shared/deep-link.mjs";

const HELPER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "helper");
const SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vc-helper-owner-test-"));
const USER_DATA = path.join(SCRATCH_DIR, "userData");
fs.mkdirSync(path.join(SCRATCH_DIR, "temp"), { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });

const forkCalls = [];
const realFork = cp.fork;
const realExecFile = cp.execFile;
cp.fork = (...args) => {
  forkCalls.push(args);
  const child = new EventEmitter();
  child.stdout = null;
  child.stderr = null;
  child.kill = () => {};
  return child;
};
cp.execFile = (...args) => {
  const cb = args[args.length - 1];
  if (typeof cb === "function") queueMicrotask(() => cb(null));
};

class FakeWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.closeCalls = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  send(frame) { this.sent.push(String(frame)); }
  close() { this.closeCalls += 1; this.readyState = 3; }
}
FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSING = 2;
FakeWebSocket.CLOSED = 3;
FakeWebSocket.instances = [];

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
const notices = [];
const fakeElectron = {
  app: fakeApp,
  dialog: { showMessageBoxSync: () => 0 },
  Menu: { buildFromTemplate: (t) => t },
  nativeImage: { createFromBuffer: () => ({ setTemplateImage: () => {} }) },
  Notification: class FakeNotification {
    constructor(opts) { this.opts = opts; }
    static isSupported() { return true; }
    show() { notices.push(this.opts); }
  },
  shell: { openExternal: () => {} },
  Tray: class FakeTray {
    setToolTip() {}
    setContextMenu() {}
    destroy() {}
  },
};

const helperRequire = createRequire(path.join(HELPER_DIR, "main.js"));
const electronPath = helperRequire.resolve("electron");
const wsPath = helperRequire.resolve(path.resolve(HELPER_DIR, "..", "bridge", "node_modules", "ws"));
const fakeCjs = (p, exp) => ({ id: p, filename: p, loaded: true, exports: exp, children: [], paths: [] });
helperRequire.cache[electronPath] = fakeCjs(electronPath, fakeElectron);
helperRequire.cache[wsPath] = fakeCjs(wsPath, FakeWebSocket);
const main = helperRequire(path.join(HELPER_DIR, "main.js"));
await new Promise((r) => setTimeout(r, 20));

const SECRET = "helper-owner-test-secret";
const RELAY = "ws://127.0.0.1:9"; // loopback, allowed in dev
const CREDS = path.join(USER_DATA, "helper-control-credentials.json");
const OWNER = path.join(USER_DATA, "helper-owner.json");

async function launchLink(sub, { withHelperToken = true, secret = SECRET, now } = {}) {
  const { bridge } = await mintSessionTokens({ sub, idea: "idea-1", secret, now });
  const claims = JSON.parse(Buffer.from(bridge.split(".")[0], "base64url").toString());
  return buildLaunchDeepLink({
    relay: RELAY,
    session: claims.sid,
    token: bridge,
    helperToken: withHelperToken ? await mintHelperToken({ sub, secret, now }) : undefined,
    cwd: os.tmpdir(),
  });
}
// The relay's two answers to a new control connection. It accepts a good
// token, and the helper's heartbeat then gets its ack. It accept()s a bad one
// too, then closes it with 4006 at once (BAD_TOKEN).
const settle = () => new Promise((r) => setTimeout(r, 50));
async function relayAccepts(ws) {
  ws.readyState = FakeWebSocket.OPEN;
  ws.emit("open");
  await settle();
  ws.emit("message", Buffer.from(JSON.stringify({ t: "hb-ack" })), false);
  await settle();
}
async function relayRejects(ws) {
  ws.readyState = FakeWebSocket.OPEN;
  ws.emit("open");
  ws.readyState = FakeWebSocket.CLOSED;
  ws.emit("close", 4006, Buffer.from("bad token"));
  await settle();
}
const lastSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
/** Hand the helper a link, then return the control socket it opens for it (made asynchronously). */
async function launchAndGetSocket(rawUrl) {
  const n = FakeWebSocket.instances.length;
  await main.__test.handleLaunchUrl(rawUrl);
  for (let i = 0; i < 100 && FakeWebSocket.instances.length === n; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(FakeWebSocket.instances.length > n, "a control connection was opened for the link");
  return lastSocket();
}
const readCreds = () => { try { return JSON.parse(fs.readFileSync(CREDS, "utf8")); } catch { return null; } };
const subOf = (tok) => JSON.parse(Buffer.from(tok.split(".")[0], "base64url").toString()).sub;

beforeEach(() => {
  main.__test.closeControlConnection();
  for (const f of [CREDS, OWNER]) fs.rmSync(f, { force: true });
  forkCalls.length = 0;
  notices.length = 0;
  FakeWebSocket.instances.length = 0;
  main.__test.resetOpenTerminalCooldown();
});

test.after(() => {
  cp.fork = realFork;
  cp.execFile = realExecFile;
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
});

test("a link for the helper's own account still launches and saves its credentials", async () => {
  await relayAccepts(await launchAndGetSocket(await launchLink("owner-A"))); // first pairing pins owner-A
  assert.equal(forkCalls.length, 1);
  assert.equal(subOf(readCreds().token), "owner-A");

  await main.__test.handleLaunchUrl(await launchLink("owner-A"));
  assert.equal(forkCalls.length, 2, "the owner's later links keep working");
});

test("a launch link minted for a different account starts no bridge and keeps the saved credentials", async () => {
  await relayAccepts(await launchAndGetSocket(await launchLink("owner-A")));
  const before = readCreds();
  const sockets = FakeWebSocket.instances.length;
  forkCalls.length = 0;

  await main.__test.handleLaunchUrl(await launchLink("attacker-B"));

  assert.equal(forkCalls.length, 0, "no bridge may be forked for another account's link");
  assert.deepEqual(readCreds(), before, "saved control credentials must not be overwritten");
  assert.equal(FakeWebSocket.instances.length, sockets, "no control connection may be opened for the other account");
  assert.ok(notices.length >= 1, "the refusal must show a notice");
});

test("an existing helper with only saved credentials (no owner file yet) treats their account as the owner", async () => {
  const tok = await mintHelperToken({ sub: "owner-A", secret: SECRET });
  fs.writeFileSync(CREDS, JSON.stringify({ token: tok, relay: RELAY }));

  await main.__test.handleLaunchUrl(await launchLink("attacker-B"));
  assert.equal(forkCalls.length, 0);
  assert.equal(subOf(readCreds().token), "owner-A");

  await main.__test.handleLaunchUrl(await launchLink("owner-A"));
  assert.equal(forkCalls.length, 1);
});

test("a link whose session token and helper token name different accounts is refused", async () => {
  await relayAccepts(await launchAndGetSocket(await launchLink("owner-A")));
  forkCalls.length = 0;
  const { bridge } = await mintSessionTokens({ sub: "owner-A", idea: "i", secret: SECRET });
  const rawUrl = buildLaunchDeepLink({
    relay: RELAY,
    session: JSON.parse(Buffer.from(bridge.split(".")[0], "base64url").toString()).sid,
    token: bridge,
    helperToken: await mintHelperToken({ sub: "attacker-B", secret: SECRET }),
    cwd: os.tmpdir(),
  });
  await main.__test.handleLaunchUrl(rawUrl);
  assert.equal(forkCalls.length, 0);
  assert.equal(subOf(readCreds().token), "owner-A");
});

test("an open-terminal link for a different account is refused before anything is saved or opened", async () => {
  await relayAccepts(await launchAndGetSocket(await launchLink("owner-A")));
  const before = readCreds();
  const sockets = FakeWebSocket.instances.length;

  await main.__test.handleOpenTerminalUrl(
    buildOpenTerminalDeepLink({
      relay: RELAY,
      helperToken: await mintHelperToken({ sub: "attacker-B", secret: SECRET }),
      cwd: os.tmpdir(),
      agent: "codex",
    }),
  );

  assert.deepEqual(readCreds(), before);
  assert.equal(FakeWebSocket.instances.length, sockets, "no handshake socket for another account");
});

test("forgetOwner clears the pinned account so a different account can pair", async () => {
  await main.__test.handleLaunchUrl(await launchLink("owner-A"));
  main.__test.forgetOwner();
  forkCalls.length = 0;
  await relayAccepts(await launchAndGetSocket(await launchLink("owner-C")));
  assert.equal(forkCalls.length, 1);
  assert.equal(subOf(readCreds().token), "owner-C");
});

// ── stage 2, point A: a helper token is saved only once the relay accepts it ──
// The helper cannot check signatures, so a hand-made link can carry the
// owner's own account id and pass the owner check. Its helperToken must not
// replace the saved credentials or drop the live control connection unless
// the relay accepts it.

test("a forged helper token with the owner's own account id is never saved and leaves the live connection up", async () => {
  const live = await launchAndGetSocket(await launchLink("owner-A"));
  await relayAccepts(live);
  const before = readCreds();
  assert.equal(subOf(before.token), "owner-A");

  const probe = await launchAndGetSocket(await launchLink("owner-A", { secret: "not-the-relay-secret" }));
  assert.notEqual(probe, live, "the new token is tried on its own connection");
  assert.deepEqual(readCreds(), before, "nothing is saved before the relay has answered");
  assert.equal(live.closeCalls, 0, "the live connection stays up while the new token is checked");

  await relayRejects(probe);
  assert.deepEqual(readCreds(), before, "a rejected token is never saved");
  assert.equal(main.__test.getControlWs(), live, "the live connection is still the one in use");
  assert.equal(live.closeCalls, 0, "the live connection was never closed");
});

test("the owner's genuine new helper token replaces the old one once the relay accepts it", async () => {
  const t0 = Math.floor(Date.now() / 1000);
  const first = await launchAndGetSocket(await launchLink("owner-A", { now: t0 }));
  await relayAccepts(first);
  const before = readCreds();

  const second = await launchAndGetSocket(await launchLink("owner-A", { now: t0 + 5 }));
  assert.notEqual(second, first);
  assert.deepEqual(readCreds(), before, "not saved until the relay accepts it");

  await relayAccepts(second);
  assert.notDeepEqual(readCreds(), before, "saved once accepted");
  assert.equal(readCreds().token, second.__vcToken);
  assert.equal(main.__test.getControlWs(), second);
  assert.ok(first.closeCalls >= 1, "the old connection is closed once the new one is in");
});

test("a forged open-terminal helper token with the owner's own account id is never saved", async () => {
  await relayAccepts(await launchAndGetSocket(await launchLink("owner-A")));
  const before = readCreds();
  const baseline = FakeWebSocket.instances.length;

  const flow = main.__test.handleOpenTerminalUrl(
    buildOpenTerminalDeepLink({
      relay: RELAY,
      helperToken: await mintHelperToken({ sub: "owner-A", secret: "not-the-relay-secret" }),
      cwd: os.tmpdir(),
      agent: "codex",
    }),
  );
  for (let i = 0; i < 100 && FakeWebSocket.instances.length === baseline; i++) await settle();
  const handshake = lastSocket();
  assert.ok(FakeWebSocket.instances.length > baseline, "a handshake socket was opened");
  handshake.emit("close", 4006, Buffer.from("bad token"));
  await flow;

  assert.deepEqual(readCreds(), before, "a token the relay refused is never saved");
});
