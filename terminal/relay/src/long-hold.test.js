// Long-hold sessions (card f4be2981): a bridge that attached with hold=1 is held
// with no 90 s grace and no idle cap. Only the max-age backstop ends it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TerminalRelay } from "./index.js";
import { holdPolicy, LONG_HOLD_DEADLINE } from "./pairing.js";

function makeStorage(initial) {
  const map = new Map(Object.entries(initial));
  const alarms = [];
  return {
    async get(k) { return map.has(k) ? map.get(k) : undefined; },
    async put(k, v) { map.set(k, v); },
    async delete(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k); },
    async deleteAlarm() {},
    async setAlarm(t) { alarms.push(t); },
    alarms,
    _map: map,
  };
}

function makeRelay(initial, env = {}) {
  const storage = makeStorage(initial);
  const sockets = [];
  const relay = new TerminalRelay({ storage, getWebSockets: () => sockets }, { TERMINAL_IDLE_MS: "1000", TERMINAL_MAX_MS: "100000", ...env });
  return { relay, storage };
}

test("holdPolicy picks long only for a bridge that opted in", () => {
  assert.equal(holdPolicy({ bridgeLongHold: true }), "long");
  assert.equal(holdPolicy({ bridgeLongHold: false }), "grace");
  assert.equal(holdPolicy({}), "grace");
});

test("armAlarm for a long-hold session only arms the max-age backstop", async () => {
  const now = Date.now();
  const { relay, storage } = makeRelay({
    sessionStartedAt: now,
    lastActivityAt: now - 5000,
    graceDeadline: LONG_HOLD_DEADLINE,
    bridgeLongHold: true,
  });
  await relay.armAlarm(now);
  assert.equal(storage.alarms.at(-1), now + 100000);
});

test("armAlarm for an old bridge still arms idle and grace", async () => {
  const now = Date.now();
  const { relay, storage } = makeRelay({ sessionStartedAt: now, lastActivityAt: now, graceDeadline: now + 90000 });
  await relay.armAlarm(now);
  assert.equal(storage.alarms.at(-1), now + 1000);
});

test("alarm does not end a long-hold session for being idle", async () => {
  const now = Date.now();
  const { relay, storage } = makeRelay({
    sessionStartedAt: now - 10000,
    lastActivityAt: now - 9000, // idle well past TERMINAL_IDLE_MS (1s)
    sid: "s1",
    owner: "u1",
    bridgeLongHold: true,
  });
  await relay.alarm();
  assert.equal(await storage.get("owner"), "u1");
  assert.equal(await storage.get("sessionStartedAt") != null, true);
});

test("alarm still ends an old (no hold) session for being idle", async () => {
  const now = Date.now();
  const { relay, storage } = makeRelay({
    sessionStartedAt: now - 10000,
    lastActivityAt: now - 9000,
    sid: "s1",
    owner: "u1",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try { await relay.alarm(); } finally { globalThis.fetch = originalFetch; }
  assert.equal(await storage.get("owner"), undefined);
});

test("the max-age backstop still ends a long-hold session", async () => {
  const now = Date.now();
  const { relay, storage } = makeRelay({
    sessionStartedAt: now - 200000,
    lastActivityAt: now - 200000,
    graceDeadline: LONG_HOLD_DEADLINE,
    sid: "s1",
    owner: "u1",
    bridgeLongHold: true,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try { await relay.alarm(); } finally { globalThis.fetch = originalFetch; }
  assert.equal(await storage.get("owner"), undefined);
  assert.equal(await storage.get("bridgeLongHold"), undefined);
});

test("a long-hold hold survives an alarm that fires long after (grace sentinel never expires)", async () => {
  const now = Date.now();
  const { relay, storage } = makeRelay({
    sessionStartedAt: now - 50000,
    lastActivityAt: now - 50000,
    graceDeadline: LONG_HOLD_DEADLINE,
    sid: "s1",
    owner: "u1",
    bridgeLongHold: true,
  });
  await relay.alarm();
  assert.equal(await storage.get("owner"), "u1");
});
