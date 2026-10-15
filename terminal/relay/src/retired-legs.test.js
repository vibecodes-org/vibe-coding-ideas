// Regression tests for board task b829d62d ("Reconnect often doesn't work"):
// a leg the relay has told to close (preempted by a newer attach, or ended)
// stays in getWebSockets() until its close handshake completes — forever when
// its network died silently or its tab is frozen. getWebSockets(tag)[0] is the
// OLDEST socket, so the relay kept forwarding to the dead leg: the reconnected
// view showed "Connected" while keystrokes and output went nowhere, and only a
// fresh sid (Resume) escaped. Reproduced end to end against `wrangler dev`
// with a silently-frozen TCP path; these pin the routing rule itself.
//
// Run: cd terminal/relay && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { TerminalRelay } from "./index.js";

function makeFakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const alarms = [];
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : undefined;
    },
    async put(key, value) {
      map.set(key, value);
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k);
    },
    async setAlarm(at) {
      alarms.push(at);
    },
    async deleteAlarm() {
      alarms.length = 0;
    },
    _alarms: alarms,
  };
}

/** A hibernatable-socket stand-in: a close() that never completes, like a dead network path. */
function makeSocket(role, extra = {}) {
  let attachment = { role, sub: "user-A", ...extra };
  const s = {
    role,
    sent: [],
    closes: [],
    send: (frame) => s.sent.push(frame),
    close: (code, reason) => s.closes.push({ code, reason }),
    serializeAttachment: (a) => {
      attachment = a;
    },
    deserializeAttachment: () => attachment,
  };
  return s;
}

/** getWebSockets(tag) in attach order — the OLDEST first, as the runtime returns it. */
function makeRelay(storage, sockets) {
  const state = {
    storage,
    getWebSockets: (tag) => (tag ? sockets.filter((s) => `role:${s.role}` === tag) : sockets.slice()),
  };
  return new TerminalRelay(state, { TERMINAL_SESSION_SECRET: "s" });
}

const liveSession = () =>
  makeFakeStorage({ owner: "user-A", sid: "sess-1", sessionStartedAt: Date.now(), lastActivityAt: Date.now() });

test("retire() marks the leg and closes it", () => {
  const stale = makeSocket("browser");
  const relay = makeRelay(liveSession(), [stale]);

  relay.retire(stale, 4001, "preempted");

  assert.equal(stale.deserializeAttachment().retired, true);
  assert.equal(stale.deserializeAttachment().role, "browser", "role/sub kept");
  assert.deepEqual(stale.closes, [{ code: 4001, reason: "preempted" }]);
});

test("output goes to the NEW browser, not the replaced one still listed first", () => {
  const oldBrowser = makeSocket("browser");
  const bridge = makeSocket("bridge");
  const newBrowser = makeSocket("browser");
  const relay = makeRelay(liveSession(), [oldBrowser, bridge, newBrowser]);
  relay.retire(oldBrowser, 4001, "preempted");

  assert.equal(relay.findPeer("bridge"), newBrowser);
});

test("keystrokes go to the NEW bridge, not the replaced one still listed first", () => {
  const oldBridge = makeSocket("bridge");
  const browser = makeSocket("browser");
  const newBridge = makeSocket("bridge");
  const relay = makeRelay(liveSession(), [oldBridge, browser, newBridge]);
  relay.retire(oldBridge, 4001, "preempted");

  assert.equal(relay.findPeer("browser"), newBridge);
});

test("a forwarded frame reaches the live peer end to end (webSocketMessage)", async () => {
  const oldBrowser = makeSocket("browser");
  const bridge = makeSocket("bridge");
  const newBrowser = makeSocket("browser");
  const relay = makeRelay(liveSession(), [oldBrowser, bridge, newBrowser]);
  relay.retire(oldBrowser, 4001, "preempted");

  const ptyBytes = new Uint8Array([1, 2, 3]).buffer;
  await relay.webSocketMessage(bridge, ptyBytes);

  assert.deepEqual(newBrowser.sent, [ptyBytes]);
  assert.deepEqual(oldBrowser.sent, []);
});

test("a retired leg that wakes up late is not forwarded", async () => {
  const oldBrowser = makeSocket("browser");
  const bridge = makeSocket("bridge");
  const newBrowser = makeSocket("browser");
  const relay = makeRelay(liveSession(), [oldBrowser, bridge, newBrowser]);
  relay.retire(oldBrowser, 4001, "preempted");

  await relay.webSocketMessage(oldBrowser, new Uint8Array([9]).buffer);

  assert.deepEqual(bridge.sent, []);
});

test("attach state ignores retired legs", async () => {
  const oldBridge = makeSocket("bridge");
  const browser = makeSocket("browser");
  const relay = makeRelay(liveSession(), [oldBridge, browser]);
  relay.retire(oldBridge, 4001, "preempted");

  const state = await relay.computeAttachState();

  assert.equal(state.bridge, false, "a replaced bridge is not a live bridge");
  assert.equal(state.browser, true);
});

test("broadcast reaches live legs only", () => {
  const oldBrowser = makeSocket("browser");
  const bridge = makeSocket("bridge");
  const newBrowser = makeSocket("browser");
  const relay = makeRelay(liveSession(), [oldBrowser, bridge, newBrowser]);
  relay.retire(oldBrowser, 4001, "preempted");

  relay.broadcast('{"t":"peer-reattached"}');

  assert.equal(oldBrowser.sent.length, 0);
  assert.equal(bridge.sent.length, 1);
  assert.equal(newBrowser.sent.length, 1);
});

test("a retired leg finally closing opens no grace hold and warns no one", async () => {
  const storage = liveSession();
  const oldBrowser = makeSocket("browser");
  const bridge = makeSocket("bridge");
  const relay = makeRelay(storage, [oldBrowser, bridge]);
  relay.retire(oldBrowser, 4001, "preempted");

  await relay.handleDetach(oldBrowser, "close", { code: 4001 });

  assert.equal(await storage.get("graceDeadline"), undefined);
  assert.deepEqual(bridge.sent, [], "the live bridge is not told its peer degraded");
});

test("a live leg dropping still opens the grace hold (unchanged), and a retired leg is no survivor", async () => {
  const storage = liveSession();
  const retiredBridge = makeSocket("bridge");
  const browser = makeSocket("browser");
  const relay = makeRelay(storage, [retiredBridge, browser]);
  relay.retire(retiredBridge, 4001, "preempted");

  await relay.handleDetach(browser, "close", { code: 1006 });

  assert.equal(typeof (await storage.get("graceDeadline")), "number", "grace hold opened");
  assert.deepEqual(retiredBridge.sent, [], "no peer-degraded to a retired leg");
});

test("ending a session retires every leg, so a lingering one is never routed to again", async () => {
  const storage = liveSession();
  const bridge = makeSocket("bridge");
  const browser = makeSocket("browser");
  const relay = makeRelay(storage, [bridge, browser]);

  await relay.endSession("ended-by-user");

  assert.equal(bridge.deserializeAttachment().retired, true);
  assert.equal(browser.deserializeAttachment().retired, true);
  assert.deepEqual(bridge.closes, [{ code: 1000, reason: "ended-by-user" }]);
  assert.equal(relay.findPeer("browser"), null);
});

test("helper: status and commands follow the live helper, and a replaced one closing marks nothing unclean", async () => {
  const storage = makeFakeStorage({ owner: "user-A" });
  const oldHelper = makeSocket("helper");
  const newHelper = makeSocket("helper");
  const relay = makeRelay(storage, [oldHelper, newHelper]);
  relay.retire(oldHelper, 4001, "preempted");

  assert.deepEqual(relay.liveSockets("role:helper"), [newHelper]);
  await relay.handleHelperDetach(oldHelper);
  assert.equal(await storage.get("helperUncleanAt"), undefined);
});
