// Card f4be2981 stage 2: the bridge's own session record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bridgeEventName, bridgeEventDetail, createSessionEventLog } from "./session-events.js";

test("log lines become bridge.* event names; chatty ones are skipped", () => {
  assert.equal(bridgeEventName("relay link dropped — will reconnect"), "bridge.relay-link-dropped-will-reconnect");
  assert.equal(bridgeEventName("resized PTY"), null);
});

test("detail never carries anything named like a token, key, url or prompt", () => {
  assert.deepEqual(bridgeEventDetail({ code: 1006, reason: "x", token: "t", sessionKey: "k", relayUrl: "u", prompt: "p", nested: {} }), {
    code: 1006,
    reason: "x",
  });
});

test("events wait while offline and go out once a send works", async () => {
  let online = false;
  const sent = [];
  const log = createSessionEventLog({
    appUrl: "https://app.example/",
    sid: "s1",
    token: "tok",
    autoFlush: false,
    fetchImpl: async (url, init) => {
      if (!online) throw new Error("offline");
      sent.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200 };
    },
  });
  log.record("warn", "relay link dropped — will reconnect", { code: 1006 });
  log.record("debug", "relay reports peer degraded (holding session)", {});
  await log.flush();
  assert.equal(log.size(), 1);
  online = true;
  await log.flush();
  assert.equal(log.size(), 0);
  assert.equal(sent[0].url, "https://app.example/api/terminal/session/events");
  assert.equal(sent[0].body.sid, "s1");
  assert.equal(sent[0].body.token, "tok");
  assert.equal(sent[0].body.events[0].event, "bridge.relay-link-dropped-will-reconnect");
  assert.equal(sent[0].body.events[0].detail.code, 1006);
});

test("a dev session (no real sid) records nothing", async () => {
  const log = createSessionEventLog({ appUrl: "https://a", sid: "dev-abc", token: "t", autoFlush: false, fetchImpl: async () => ({ ok: true }) });
  log.record("info", "relay connected (bridge leg)", {});
  assert.equal(log.size(), 0);
});

test("the queue is bounded, keeping how it started and the latest", async () => {
  const sent = [];
  const log = createSessionEventLog({
    appUrl: "https://a",
    sid: "s",
    token: "t",
    autoFlush: false,
    fetchImpl: async (_u, init) => {
      sent.push(...JSON.parse(init.body).events);
      return { ok: true, status: 200 };
    },
  });
  for (let i = 0; i < 400; i++) log.record("info", "reconnecting to relay", { i });
  assert.equal(log.size(), 300);
  while (log.size() > 0) await log.flush();
  assert.equal(sent[0].detail.i, 0);
  assert.equal(sent[149].detail.i, 149);
  assert.equal(sent[150].detail.i, 250);
  assert.equal(sent[299].detail.i, 399);
});
