// Helper lifecycle relay integration tests (card cc74a067).
//
// Proves the relay's `role=helper` leg + its two HTTP endpoints end-to-end
// against the Node stand-in (shares the exact handler shape the Cloudflare DO
// uses — see terminal/relay/src/index.js → fetchHelperLeg/handleHelperStatus/
// handleHelperCommand vs. standin-relay.mjs → handleHelperConnection/
// handleHelperStatusHttp/handleHelperCommandHttp):
//   (1) a helper attaches → GET /helper/status reports it running, with its
//       announced version/machineLabel/alwaysOn
//   (2) a clean goodbye then disconnect → status goes to not-connected, no
//       "stopped unexpectedly"
//   (3) a drop WITHOUT a goodbye → status flips to stoppedUnexpectedly, and a
//       fresh attach clears it again
//   (4) POST /helper/command forwards stop/quiesce/set-always-on frames to a
//       live helper leg, and reports delivered:false when none is live
//
// Run: cd terminal/test && node --test helper-lifecycle.test.mjs   (or: npm test)

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintHelperToken, mintControlToken, helperSessionId } from "../shared/session-token.mjs";
import { encodeGoodbyeFrame, parseHelperCommandFrame } from "../shared/control-frames.mjs";

const SECRET = "helper-lifecycle-test-secret";

async function waitFor(pred, ms, label, pollMs = 25) {
  const started = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - started > ms) throw new Error(`timed out after ${ms}ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Open a raw helper-leg ws and collect its TEXT control frames. */
async function openHelperLeg(relayUrl, session, token, { version, machineLabel, alwaysOn } = {}) {
  const params = new URLSearchParams({ session, role: "helper", token });
  if (version) params.set("helperVersion", version);
  if (machineLabel) params.set("machineLabel", machineLabel);
  if (alwaysOn) params.set("alwaysOn", "1");
  const ws = new WebSocket(`${relayUrl}/?${params}`);
  const leg = { ws, texts: [], closed: null };
  ws.on("message", (data, isBinary) => {
    if (!isBinary) leg.texts.push(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
  });
  ws.on("close", (code, reasonBuf) => { leg.closed = [code, reasonBuf ? reasonBuf.toString() : ""]; });
  await Promise.race([
    once(ws, "open"),
    new Promise((_, rej) => setTimeout(() => rej(new Error("helper open timeout")), 5000)),
  ]);
  return leg;
}

async function getStatus(relay, session, control) {
  const res = await fetch(`${relay.httpUrl}/helper/status?session=${session}`, {
    headers: { Authorization: `Bearer ${control}` },
  });
  return { status: res.status, body: await res.json() };
}

test("(1) helper attach → GET /helper/status reports connected with announced fields", { timeout: 15000 }, async (t) => {
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const session = helperSessionId(owner);
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());

  const token = await mintHelperToken({ sub: owner, secret: SECRET });
  const helper = await openHelperLeg(relay.url, session, token, {
    version: "0.3.0",
    machineLabel: "Nick's MacBook Pro",
    alwaysOn: true,
  });
  t.after(() => { try { helper.ws.terminate(); } catch { /* */ } });

  const control = await mintControlToken({ sub: owner, sid: session, secret: SECRET });
  const { status, body } = await waitFor(
    async () => {
      const r = await getStatus(relay, session, control);
      return r.body.connected ? r : null;
    },
    5000,
    "status to report connected",
  );
  assert.equal(status, 200);
  assert.deepEqual(body, {
    connected: true,
    version: "0.3.0",
    machineLabel: "Nick's MacBook Pro",
    alwaysOn: true,
    stoppedUnexpectedly: false,
    lastEventAt: null,
  });
  console.log("[helper/1] PASS — attach reports connected with announced version/machineLabel/alwaysOn");
});

test("(2) goodbye then disconnect → not connected, never stoppedUnexpectedly", { timeout: 15000 }, async (t) => {
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const session = helperSessionId(owner);
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());

  const token = await mintHelperToken({ sub: owner, secret: SECRET });
  const helper = await openHelperLeg(relay.url, session, token);
  const control = await mintControlToken({ sub: owner, sid: session, secret: SECRET });
  await waitFor(async () => (await getStatus(relay, session, control)).body.connected, 5000, "attach to land");

  helper.ws.send(encodeGoodbyeFrame("idle-quit"));
  await new Promise((r) => setTimeout(r, 100)); // let the goodbye land before closing
  helper.ws.close();
  await once(helper.ws, "close");

  const { body } = await waitFor(
    async () => {
      const r = await getStatus(relay, session, control);
      return r.body.connected === false ? r : null;
    },
    5000,
    "status to report disconnected",
  );
  assert.equal(body.connected, false);
  assert.equal(body.stoppedUnexpectedly, false, "a goodbye'd exit is never flagged unexpected");
  console.log("[helper/2] PASS — goodbye + disconnect never flips stoppedUnexpectedly");
});

test("(3) drop without goodbye → stoppedUnexpectedly, cleared by a fresh attach", { timeout: 15000 }, async (t) => {
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const session = helperSessionId(owner);
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());

  const token = await mintHelperToken({ sub: owner, secret: SECRET });
  const helper = await openHelperLeg(relay.url, session, token);
  const control = await mintControlToken({ sub: owner, sid: session, secret: SECRET });
  await waitFor(async () => (await getStatus(relay, session, control)).body.connected, 5000, "attach to land");

  // No goodbye — simulate a crash/kill by terminating the socket outright.
  helper.ws.terminate();
  await once(helper.ws, "close");

  const dropped = await waitFor(
    async () => {
      const r = await getStatus(relay, session, control);
      return r.body.connected === false ? r.body : null;
    },
    5000,
    "status to report disconnected",
  );
  assert.equal(dropped.stoppedUnexpectedly, true, "a goodbye-less drop is flagged unexpected");
  assert.ok(typeof dropped.lastEventAt === "number");

  // A fresh attach clears it (design rule: reconnect wipes the rose chip).
  const token2 = await mintHelperToken({ sub: owner, secret: SECRET });
  const helper2 = await openHelperLeg(relay.url, session, token2);
  t.after(() => { try { helper2.ws.terminate(); } catch { /* */ } });
  const cleared = await waitFor(
    async () => {
      const r = await getStatus(relay, session, control);
      return r.body.connected ? r.body : null;
    },
    5000,
    "reattach to clear the flag",
  );
  assert.equal(cleared.stoppedUnexpectedly, false);
  console.log("[helper/3] PASS — goodbye-less drop flags stoppedUnexpectedly; a fresh attach clears it");
});

test("(4) POST /helper/command forwards stop/quiesce/set-always-on; reports delivered:false with no live leg", { timeout: 15000 }, async (t) => {
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const session = helperSessionId(owner);
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());
  const control = await mintControlToken({ sub: owner, sid: session, secret: SECRET });

  // No live leg yet — delivery is honestly reported as false.
  const noLeg = await fetch(`${relay.httpUrl}/helper/command?session=${session}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${control}`, "content-type": "application/json" },
    body: JSON.stringify({ cmd: "stop" }),
  });
  assert.equal(noLeg.status, 200);
  assert.deepEqual(await noLeg.json(), { delivered: false });

  const token = await mintHelperToken({ sub: owner, secret: SECRET });
  const helper = await openHelperLeg(relay.url, session, token);
  t.after(() => { try { helper.ws.terminate(); } catch { /* */ } });
  await waitFor(async () => (await getStatus(relay, session, control)).body.connected, 5000, "attach to land");

  for (const [cmd, value] of [["stop", undefined], ["quiesce", undefined], ["set-always-on", true]]) {
    const res = await fetch(`${relay.httpUrl}/helper/command?session=${session}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${control}`, "content-type": "application/json" },
      body: JSON.stringify(value === undefined ? { cmd } : { cmd, value }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { delivered: true });
    const frame = await waitFor(
      () => helper.texts.map(parseHelperCommandFrame).find((f) => f?.cmd === cmd) ?? null,
      5000,
      `${cmd} frame to arrive`,
    );
    assert.deepEqual(frame, value === undefined ? { cmd } : { cmd, value });
  }
  console.log("[helper/4] PASS — commands forward to a live leg; delivered:false is honest with none live");
});

test("(5) an unauthorized status/command call is rejected without touching a live leg", { timeout: 15000 }, async (t) => {
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const session = helperSessionId(owner);
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());

  const token = await mintHelperToken({ sub: owner, secret: SECRET });
  const helper = await openHelperLeg(relay.url, session, token);
  t.after(() => { try { helper.ws.terminate(); } catch { /* */ } });
  const control = await mintControlToken({ sub: owner, sid: session, secret: SECRET });
  await waitFor(async () => (await getStatus(relay, session, control)).body.connected, 5000, "attach to land");

  const badStatus = await fetch(`${relay.httpUrl}/helper/status?session=${session}`);
  assert.equal(badStatus.status, 401);

  const foreignControl = await mintControlToken({ sub: owner, sid: `${session}-other`, secret: SECRET });
  const badCommand = await fetch(`${relay.httpUrl}/helper/command?session=${session}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${foreignControl}`, "content-type": "application/json" },
    body: JSON.stringify({ cmd: "stop" }),
  });
  assert.equal(badCommand.status, 401);

  await new Promise((r) => setTimeout(r, 100));
  assert.equal(helper.ws.readyState, WebSocket.OPEN, "rejected calls never touch the live helper leg");
  console.log("[helper/5] PASS — unauthorized status/command calls are rejected, live leg untouched");
});
