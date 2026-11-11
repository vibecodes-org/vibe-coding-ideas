// Session-to-session messages through the relay (card f0a13bde).
// Run: cd terminal/relay && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { TerminalRelay } from "./index.js";
import { mintControlToken } from "../../shared/session-token.mjs";
import { encodePeerAckFrame, encodePeerFrame, signPeerEnvelope } from "../../shared/peer-message.mjs";
import { makeFakeStorage, makeFakeState, makeLiveSocket, withWorkerGlobals } from "./fake-do.test-util.js";

const SECRET = "peer-test-secret";
const ENV = { VIBECODES_APP_URL: "https://app.example.test", TERMINAL_SESSION_SECRET: SECRET };
const SID = "sess-peer-1";

function setup({ helperVersion = "0.3.32", withBridge = true, withBrowser = true, rate } = {}) {
  const now = Date.now();
  const storage = makeFakeStorage({
    owner: "user-A", sid: SID, sessionStartedAt: now, lastActivityAt: now,
    ...(helperVersion ? { bridgeHelperVersion: helperVersion } : {}),
    ...(rate ? { peerRate: rate } : {}),
  });
  const state = makeFakeState(storage);
  const bridge = withBridge ? makeLiveSocket(state, "bridge") : null;
  const browser = withBrowser ? makeLiveSocket(state, "browser") : null;
  const relay = new TerminalRelay(state, ENV);
  return { storage, bridge, browser, relay };
}
const frameFor = (id = "msg-00000001") =>
  encodePeerFrame(signPeerEnvelope("k", { id, to: SID, from: { sid: "s1", name: "Fix login", agent: "codex" }, text: "hi", ts: Date.now() }));

async function post(relay, id, frame, { token } = {}) {
  const control = token ?? (await mintControlToken({ sub: "user-A", sid: SID, secret: SECRET }));
  return relay.fetch(
    new Request(`https://relay.test/message?session=${SID}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${control}`, "content-type": "application/json" },
      body: JSON.stringify({ id, frame }),
    }),
  );
}
const json = async (res) => res.json();

test("the frame goes to the bridge only; the bridge's answer decides the outcome; the tab gets a notice with the name only", async () => {
  await withWorkerGlobals(async () => {
    const { bridge, browser, relay } = setup();
    const p = post(relay, "msg-00000001", frameFor());
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(bridge.sent.length, 1);
    assert.equal(JSON.parse(bridge.sent[0]).t, "peer-message");
    assert.equal(browser.sent.length, 0);
    await relay.webSocketMessage(bridge, encodePeerAckFrame("msg-00000001", "delivered"));
    assert.deepEqual(await json(await p), { outcome: "delivered" });
    assert.equal(browser.sent.length, 1);
    const notice = JSON.parse(browser.sent[0]);
    assert.equal(notice.t, "peer-message-notice");
    assert.equal(notice.fromName, "Fix login");
    assert.ok(!browser.sent[0].includes("hi"));
    // the ack is consumed, never forwarded
    assert.equal(browser.sent.length, 1);
  });
});

test("no live bridge: not-running", async () => {
  await withWorkerGlobals(async () => {
    const { relay } = setup({ withBridge: false });
    assert.deepEqual(await json(await post(relay, "msg-00000001", frameFor())), { outcome: "not-running" });
  });
});

test("a helper below the minimum, or one that never reported: helper-too-old, and nothing is sent", async () => {
  await withWorkerGlobals(async () => {
    for (const helperVersion of ["0.3.31", null]) {
      const { bridge, relay } = setup({ helperVersion });
      assert.deepEqual(await json(await post(relay, "msg-00000001", frameFor())), { outcome: "helper-too-old" });
      assert.equal(bridge.sent.length, 0);
    }
  });
});

test("the 11th message inside a minute is refused", async () => {
  await withWorkerGlobals(async () => {
    const t = Date.now();
    const { bridge, relay } = setup({ rate: { minute: { start: t, count: 10 }, hour: { start: t, count: 10 } } });
    assert.deepEqual(await json(await post(relay, "msg-00000001", frameFor())), { outcome: "rate-limited" });
    assert.equal(bridge.sent.length, 0);
  });
});

test("the 61st message inside an hour is refused even when the minute is clear", async () => {
  await withWorkerGlobals(async () => {
    const t = Date.now();
    const { relay } = setup({ rate: { minute: { start: t - 120_000, count: 0 }, hour: { start: t - 120_000, count: 60 } } });
    assert.deepEqual(await json(await post(relay, "msg-00000001", frameFor())), { outcome: "rate-limited" });
  });
});

test("no answer within 5 seconds: unconfirmed", async () => {
  await withWorkerGlobals(async () => {
    const { relay } = setup();
    const res = await post(relay, "msg-00000001", frameFor());
    assert.deepEqual(await json(res), { outcome: "unconfirmed" });
  });
}, { timeout: 12000 });

test("a bad or missing control token is refused with 401 and nothing is sent", async () => {
  await withWorkerGlobals(async () => {
    const { bridge, relay } = setup();
    const res = await post(relay, "msg-00000001", frameFor(), { token: "nope" });
    assert.equal(res.status, 401);
    assert.equal(bridge.sent.length, 0);
  });
});

test("a browser frame of type peer-message (or an ack) is dropped and never reaches the bridge", async () => {
  await withWorkerGlobals(async () => {
    const { bridge, browser, relay } = setup();
    await relay.webSocketMessage(browser, frameFor());
    await relay.webSocketMessage(browser, encodePeerAckFrame("msg-00000001", "delivered"));
    assert.equal(bridge.sent.length, 0);
  });
});

test("a bridge cannot push a peer-message frame at the browser; ordinary text frames still pass", async () => {
  await withWorkerGlobals(async () => {
    const { bridge, browser, relay } = setup();
    await relay.webSocketMessage(bridge, frameFor());
    assert.equal(browser.sent.length, 0);
    await relay.webSocketMessage(bridge, JSON.stringify({ t: "bridge-cwd", cwd: "/x" }));
    assert.equal(browser.sent.length, 1);
  });
});
