// Card f4be2981 stage 2: which relay log lines go into a session's record,
// under what name, and that nothing large or nested is sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { relayEventName, relayEventDetail } from "./index.js";

test("session-level lines are recorded under a relay.* name", () => {
  assert.equal(relayEventName("attach rejected (auth)"), "relay.attach-rejected-auth");
  assert.equal(relayEventName("holding session for reconnect"), "relay.holding-session-for-reconnect");
  assert.equal(relayEventName("reattached — pair whole again"), "relay.reattached-pair-whole-again");
  assert.equal(relayEventName("stale leg preempted"), "relay.stale-leg-preempted");
});

test("helper-leg, peer-message and callback chatter is left out", () => {
  for (const msg of [
    "helper attached",
    "peer message outcome",
    "open-terminal-authorized send failed",
    "heartbeat auto-response unavailable",
    "session-closed callback delivered",
    "session events send failed",
  ]) {
    assert.equal(relayEventName(msg), null, msg);
  }
});

test("names fit the record's 64-character limit", () => {
  const name = relayEventName("x".repeat(200));
  assert.ok(name.length <= 64);
});

test("detail keeps plain values, drops the session id and nested objects", () => {
  assert.deepEqual(
    relayEventDetail({ session: "s", sid: "s", role: "bridge", code: 4006, ok: false, obj: { a: 1 }, reason: "y".repeat(500) }),
    { role: "bridge", code: 4006, ok: false, reason: "y".repeat(200) },
  );
});
