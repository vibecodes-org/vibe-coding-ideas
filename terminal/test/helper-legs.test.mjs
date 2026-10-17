// Card 6b2cb8ac, cause K, against the Node stand-in relay (relay/src/
// helper-legs.test.js pins the real DO class). Helper legs are per Mac: two
// Macs' helpers stay connected side by side, a relaunch on the same Mac
// replaces only that Mac's leg, and `machines` targets status and commands.
//
// Run: cd terminal/test && node --test helper-legs.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintHelperToken, mintControlToken, helperSessionId } from "../shared/session-token.mjs";
import { parseHelperCommandFrame } from "../shared/control-frames.mjs";

const SECRET = "helper-legs-standin-secret";

async function openHelper(relay, session, token, params = {}) {
  const qs = new URLSearchParams({ session, role: "helper", token, ...params });
  const ws = new WebSocket(`${relay.url}/?${qs}`);
  const leg = { ws, texts: [], closed: null };
  ws.on("message", (d, isBinary) => {
    if (!isBinary) leg.texts.push(String(d));
  });
  ws.on("close", (code, r) => {
    leg.closed = [code, r ? r.toString() : ""];
  });
  await Promise.race([once(ws, "open"), new Promise((_, rej) => setTimeout(() => rej(new Error("open timeout")), 5000))]);
  return leg;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("two Macs coexist; same-Mac relaunch replaces only that Mac; quiesce targets one Mac; status per Mac", { timeout: 15000 }, async (t) => {
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const session = helperSessionId(owner);
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  t.after(() => relay.close());
  const token = await mintHelperToken({ sub: owner, secret: SECRET });
  const control = () => mintControlToken({ sub: owner, sid: session, secret: SECRET });

  const book = await openHelper(relay, session, token, { machineLabel: "Nicks-MacBook-Pro.local", machineAliases: "Nicks-MBP.home.local", helperVersion: "0.3.24" });
  const mini = await openHelper(relay, session, token, { machineLabel: "Nicks-Mac-mini.local", helperVersion: "0.3.25" });
  t.after(() => { for (const l of [book, mini]) try { l.ws.terminate(); } catch { /* */ } });
  await sleep(100);
  assert.equal(book.closed, null, "another Mac's helper must not preempt");

  const res = await fetch(`${relay.httpUrl}/helper/command?session=${session}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await control()}`, "content-type": "application/json" },
    body: JSON.stringify({ cmd: "quiesce", machines: ["Nicks-Mac-mini.local"] }),
  });
  assert.deepEqual(await res.json(), { delivered: true });
  await sleep(100);
  assert.deepEqual(mini.texts.map(parseHelperCommandFrame).filter(Boolean), [{ cmd: "quiesce" }]);
  assert.deepEqual(book.texts.map(parseHelperCommandFrame).filter(Boolean), []);

  const miss = await fetch(`${relay.httpUrl}/helper/command?session=${session}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await control()}`, "content-type": "application/json" },
    body: JSON.stringify({ cmd: "quiesce", machines: ["Other.local"] }),
  });
  assert.deepEqual(await miss.json(), { delivered: false, reason: "not-on-this-mac" });

  const st = async (machines) =>
    (await fetch(`${relay.httpUrl}/helper/status?session=${session}&machines=${encodeURIComponent(machines)}`, {
      headers: { Authorization: `Bearer ${await control()}` },
    })).json();
  assert.equal((await st("nicks-mbp.home.local")).version, "0.3.24");
  assert.equal((await st("Nicks-Mac-mini.local")).version, "0.3.25");

  // Same Mac relaunching under its other name replaces only the MacBook's leg.
  const book2 = await openHelper(relay, session, token, { machineLabel: "Nicks-MBP.home.local", machineAliases: "Nicks-MacBook-Pro.local" });
  t.after(() => { try { book2.ws.terminate(); } catch { /* */ } });
  await sleep(150);
  assert.equal(book.closed?.[0], 4001);
  assert.equal(mini.closed, null);

  // The mini drops without a goodbye → only the mini reads "stopped unexpectedly".
  mini.ws.terminate();
  await sleep(150);
  const sMini = await st("Nicks-Mac-mini.local");
  assert.equal(sMini.connected, false);
  assert.equal(sMini.stoppedUnexpectedly, true);
  assert.equal((await st("Nicks-MacBook-Pro.local")).connected, true);
});
