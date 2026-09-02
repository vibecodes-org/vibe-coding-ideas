// Regression test (2 Sep 2026 relay tail): `endSession`/`endGrace` close every
// socket and clear the session, but each of those sockets still fires
// webSocketClose → handleDetach AFTERWARDS. Without a guard, handleDetach
// re-armed a fresh 90 s grace hold on a session that no longer existed, and
// 90 s later alarm() logged "reconnect grace expired — tearing down" with a
// null sid and skipped the session-closed callback. `sessionStartedAt` is the
// write-once lifecycle marker (set on the first attach, deleted by
// clearSessionState), so its absence means "no session here — nothing to hold".
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
    async getAlarm() {
      return alarms.length ? alarms[alarms.length - 1] : null;
    },
    async setAlarm(at) {
      alarms.push(at);
    },
    async deleteAlarm() {
      alarms.length = 0;
    },
    _map: map,
    _alarms: alarms,
  };
}

function makeSocket(role) {
  const sent = [];
  return {
    sent,
    send: (frame) => sent.push(frame),
    close() {},
    deserializeAttachment: () => ({ role, sub: "user-A" }),
  };
}

function makeRelay(storage, sockets) {
  const state = { storage, getWebSockets: () => sockets };
  return new TerminalRelay(state, { TERMINAL_SESSION_SECRET: "s" });
}

test("handleDetach after the session was cleared arms NO grace hold and tells no one", async () => {
  const storage = makeFakeStorage({}); // clearSessionState already ran: no sessionStartedAt
  const closing = makeSocket("browser");
  const survivor = makeSocket("bridge");
  const relay = makeRelay(storage, [closing, survivor]);

  await relay.handleDetach(closing, "close", { code: 1000 });

  assert.equal(await storage.get("graceDeadline"), undefined, "no grace hold on a dead session");
  assert.deepEqual(storage._alarms, [], "no alarm armed");
  assert.deepEqual(survivor.sent, [], "no peer-degraded sent to a leg the end already closed");
});

test("handleDetach on a LIVE session still opens the grace hold and warns the survivor (unchanged)", async () => {
  const storage = makeFakeStorage({ owner: "user-A", sid: "sess-1", sessionStartedAt: 1, lastActivityAt: 1 });
  const closing = makeSocket("browser");
  const survivor = makeSocket("bridge");
  const relay = makeRelay(storage, [closing, survivor]);

  await relay.handleDetach(closing, "close", { code: 1006 });

  assert.equal(typeof (await storage.get("graceDeadline")), "number", "grace hold opened");
  assert.equal(storage._alarms.length, 1, "alarm armed for the hold");
  assert.equal(survivor.sent.length, 1, "survivor told the session is being held");
  assert.match(survivor.sent[0], /peer-degraded/);
});
