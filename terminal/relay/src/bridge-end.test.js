// Regression tests for card 6b2cb8ac, causes E and G: a bridge that stops ON
// PURPOSE (close 1000 with a reason: "pty-exit", "agent-not-installed",
// "folder-missing", …) used to open the 90s reconnect hold exactly like a
// dropped link. The browser showed "Connected" plus "Connection interrupted —
// reconnecting…" for 90s, the session stayed "active" (so the next launch was
// told to isolate), and only then did it end with an untrue "couldn't
// reattach". Now a deliberate bridge end closes the browser at once with the
// same reason, tells the app (`bridge_ended`), and leaves a 10-minute
// tombstone so a late browser attach learns the reason too. A real drop
// (1006 / 1001 / error) keeps the hold.
//
// Run: cd terminal/relay && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { TerminalRelay } from "./index.js";
import { isPeerDegradedFrame } from "../../shared/control-frames.mjs";
import { mintSessionTokens } from "../../shared/session-token.mjs";
import {
  makeFakeStorage,
  makeFakeState,
  makeLiveSocket,
  withWorkerGlobals,
  captureFetch,
} from "./fake-do.test-util.js";

const SECRET = "bridge-end-test-secret";
const ENV = { VIBECODES_APP_URL: "https://app.example.test", TERMINAL_SESSION_SECRET: SECRET };
const SID = "sess-bridge-end-1";

function liveSession() {
  const now = Date.now();
  const storage = makeFakeStorage({ owner: "user-A", sid: SID, sessionStartedAt: now, lastActivityAt: now });
  const state = makeFakeState(storage);
  const bridge = makeLiveSocket(state, "bridge");
  const browser = makeLiveSocket(state, "browser");
  const relay = new TerminalRelay(state, ENV);
  return { storage, state, bridge, browser, relay };
}

test("bridge closes 1000 'pty-exit' → browser closed 1000 'pty-exit' at once, no peer-degraded, one bridge_ended callback", async () => {
  const { storage, bridge, browser, relay } = liveSession();
  const before = Date.now();
  const calls = await captureFetch(() => relay.webSocketClose(bridge, 1000, "pty-exit", true));

  assert.deepEqual(browser.closes, [[1000, "pty-exit"]]);
  assert.equal(browser.sent.some((f) => typeof f === "string" && isPeerDegradedFrame(f)), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://app.example.test/api/terminal/session/closed");
  assert.deepEqual(calls[0].body, { sid: SID, reason: "bridge_ended" });

  // Session state released; no grace hold.
  assert.equal(await storage.get("owner"), undefined);
  assert.equal(await storage.get("sessionStartedAt"), undefined);
  assert.equal(await storage.get("graceDeadline"), undefined);
  // Tombstone written, alarm armed ~10 min out.
  assert.equal(await storage.get("tombstoneReason"), "pty-exit");
  assert.equal(await storage.get("tombstoneOwner"), "user-A");
  assert.ok((await storage.get("tombstoneAt")) >= before);
  assert.ok(storage.alarm >= before + 10 * 60 * 1000 - 50 && storage.alarm <= Date.now() + 10 * 60 * 1000);
});

test("the bridge's own reason is passed through (agent-stopped-early:1); empty → pty-exit; unsafe → ended", async () => {
  for (const [reason, expected] of [
    ["agent-stopped-early:1", "agent-stopped-early:1"],
    ["folder-missing", "folder-missing"],
    ["", "pty-exit"],
    ["/Users/x/secret path", "ended"],
  ]) {
    const { browser, relay, storage } = liveSession();
    await captureFetch(() => relay.webSocketClose(relay.state.getWebSockets("role:bridge")[0], 1000, reason, true));
    assert.deepEqual(browser.closes, [[1000, expected]], `reason ${JSON.stringify(reason)}`);
    assert.equal(await storage.get("tombstoneReason"), expected);
  }
});

test("a REAL drop (1006) still holds the session: peer-degraded + grace deadline, browser not closed, no callback", async () => {
  const { storage, bridge, browser, relay } = liveSession();
  const calls = await captureFetch(() => relay.webSocketClose(bridge, 1006, "", false));
  assert.deepEqual(browser.closes, []);
  assert.equal(browser.sent.some((f) => typeof f === "string" && isPeerDegradedFrame(f)), true);
  assert.ok((await storage.get("graceDeadline")) > Date.now());
  assert.equal(calls.length, 0);
  assert.equal(await storage.get("tombstoneReason"), undefined);
});

test("1001 (going away) and a socket error also keep the hold", async () => {
  {
    const { storage, bridge, relay } = liveSession();
    await captureFetch(() => relay.webSocketClose(bridge, 1001, "", true));
    assert.ok((await storage.get("graceDeadline")) != null);
  }
  {
    const { storage, bridge, relay } = liveSession();
    await captureFetch(() => relay.webSocketError(bridge, new Error("boom")));
    assert.ok((await storage.get("graceDeadline")) != null);
  }
});

test("a BROWSER closing 1000 is not a bridge end: today's hold is unchanged", async () => {
  const { storage, bridge, browser, relay } = liveSession();
  const calls = await captureFetch(() => relay.webSocketClose(browser, 1000, "", true));
  assert.deepEqual(bridge.closes, []);
  assert.ok((await storage.get("graceDeadline")) != null);
  assert.equal(calls.length, 0);
});

test("a RETIRED bridge closing 1000 (preempted by a relaunch) ends nothing", async () => {
  const { storage, bridge, browser, relay } = liveSession();
  relay.retire(bridge, 4001, "preempted");
  const calls = await captureFetch(() => relay.webSocketClose(bridge, 1000, "pty-exit", true));
  assert.deepEqual(browser.closes, []);
  assert.equal(calls.length, 0);
  assert.equal(await storage.get("owner"), "user-A");
});

test("a bridge 1000 close AFTER the session already ended (endSession closed it) ends nothing twice", async () => {
  const storage = makeFakeStorage({});
  const state = makeFakeState(storage);
  const bridge = makeLiveSocket(state, "bridge");
  const relay = new TerminalRelay(state, ENV);
  const calls = await captureFetch(() => relay.webSocketClose(bridge, 1000, "pty-exit", true));
  assert.equal(calls.length, 0);
  assert.equal(await storage.get("tombstoneReason"), undefined);
});

// ── Tombstone (regression test 2) ────────────────────────────────────────────

async function attachBrowser(relay, sid, sub = "user-A", opts = {}) {
  const tokens = await mintSessionTokens({ sub, idea: "idea-1", sid, secret: SECRET, ...opts });
  const url = `https://relay.example.test/?session=${sid}&role=browser&token=${encodeURIComponent(tokens.browser)}`;
  return withWorkerGlobals(() => relay.fetch(new Request(url)));
}

async function attachBridge(relay, sid, sub = "user-A") {
  const tokens = await mintSessionTokens({ sub, idea: "idea-1", sid, secret: SECRET });
  const url = `https://relay.example.test/?session=${sid}&role=bridge&token=${encodeURIComponent(tokens.bridge)}`;
  return withWorkerGlobals(() => relay.fetch(new Request(url)));
}

test("a browser attaching within 10 min of a bridge end is closed 1000 with the reason; nothing is bound", async () => {
  const { storage, bridge, relay } = liveSession();
  await captureFetch(() => relay.webSocketClose(bridge, 1000, "agent-stopped-early:1", true));

  const { server } = await attachBrowser(relay, SID);
  assert.equal(server.accepted, true);
  assert.deepEqual(server.closes, [[1000, "agent-stopped-early:1"]]);
  assert.equal(await storage.get("owner"), undefined, "no owner bound");
  assert.equal(await storage.get("sessionStartedAt"), undefined, "no session started");
  assert.equal(relay.state.getWebSockets("role:browser").filter((s) => s === server).length, 0, "not accepted into hibernation");
});

test("an aged browser token of the SAME owner still gets the reason (not a 4006)", async () => {
  const { bridge, relay } = liveSession();
  await captureFetch(() => relay.webSocketClose(bridge, 1000, "pty-exit", true));
  const old = Math.floor(Date.now() / 1000) - 3600; // an hour-old token: expired
  const { server } = await attachBrowser(relay, SID, "user-A", { now: old });
  assert.deepEqual(server.closes, [[1000, "pty-exit"]]);
});

test("a FOREIGN owner's aged token gets the normal 4006, never the reason", async () => {
  const { bridge, relay } = liveSession();
  await captureFetch(() => relay.webSocketClose(bridge, 1000, "pty-exit", true));
  const old = Math.floor(Date.now() / 1000) - 3600;
  const { server } = await attachBrowser(relay, SID, "user-B", { now: old });
  assert.equal(server.closes[0][0], 4006);
});

test("after the tombstone expires a browser attach behaves as today (new session)", async () => {
  const { storage, bridge, relay } = liveSession();
  await captureFetch(() => relay.webSocketClose(bridge, 1000, "pty-exit", true));
  await storage.put("tombstoneAt", Date.now() - 11 * 60 * 1000);
  const { server } = await attachBrowser(relay, SID);
  assert.deepEqual(server.closes, []);
  assert.equal(await storage.get("owner"), "user-A");
});

test("a BRIDGE attaching clears the tombstone and proceeds (deliberate relaunch)", async () => {
  const { storage, bridge, relay } = liveSession();
  await captureFetch(() => relay.webSocketClose(bridge, 1000, "pty-exit", true));
  const { server } = await attachBridge(relay, SID);
  assert.deepEqual(server.closes, []);
  assert.equal(await storage.get("tombstoneReason"), undefined);
  assert.equal(await storage.get("tombstoneAt"), undefined);
  assert.equal(await storage.get("tombstoneOwner"), undefined);
  assert.equal(await storage.get("owner"), "user-A");
});

test("alarm(): a fresh tombstone with no session re-arms to its expiry; an expired one is deleted", async () => {
  const { storage, bridge, relay } = liveSession();
  await captureFetch(() => relay.webSocketClose(bridge, 1000, "pty-exit", true));
  const at = await storage.get("tombstoneAt");
  storage.alarm = null;
  await relay.alarm();
  assert.equal(storage.alarm, at + 10 * 60 * 1000);
  assert.equal(await storage.get("tombstoneReason"), "pty-exit");

  await storage.put("tombstoneAt", Date.now() - 11 * 60 * 1000);
  await relay.alarm();
  assert.equal(await storage.get("tombstoneReason"), undefined);
  assert.equal(await storage.get("tombstoneAt"), undefined);
  assert.equal(await storage.get("tombstoneOwner"), undefined);
});

test("TERMINAL_TOMBSTONE_MS overrides the 10-minute window", async () => {
  const now = Date.now();
  const storage = makeFakeStorage({ owner: "user-A", sid: SID, sessionStartedAt: now, lastActivityAt: now });
  const state = makeFakeState(storage);
  const bridge = makeLiveSocket(state, "bridge");
  const relay = new TerminalRelay(state, { ...ENV, TERMINAL_TOMBSTONE_MS: "500" });
  await captureFetch(() => relay.webSocketClose(bridge, 1000, "pty-exit", true));
  assert.ok(storage.alarm <= Date.now() + 500);
});
