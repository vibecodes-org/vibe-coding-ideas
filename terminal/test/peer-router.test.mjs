// Card f0a13bde: the Mac app passes messages between the Claude Code and Codex
// sessions it runs. Nothing leaves the Mac; the sender's name comes from the
// app, never from the sending agent; message text is never logged.
//
// Run: cd terminal/test && node --test peer-router.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createPeerRouter, PER_MINUTE, PER_HOUR } = require("../helper/peer-router.js");

function setup(opts = {}) {
  let t = 1_700_000_000_000;
  const logs = [];
  const router = createPeerRouter({
    now: () => t,
    log: (level, msg, extra) => logs.push({ level, msg, extra }),
    deliverTimeoutMs: opts.deliverTimeoutMs ?? 50,
    newId: (() => {
      let n = 0;
      return () => `r${n++}`;
    })(),
  });
  const boxes = new Map();
  function join(key, sid, agent, extra = {}) {
    const box = [];
    boxes.set(key, box);
    const send = (m) => {
      box.push(m);
      return true;
    };
    router.hello(key, { sid, agent, folder: "app", canReceive: true, ...extra }, send);
    return { box, send };
  }
  return { router, logs, join, boxes, tick: (ms) => (t += ms) };
}

const CODEX = "c0dex111-aaaa";
const CLAUDE = "c1aude22-bbbb";
const CLAUDE2 = "c1aude33-cccc";

test("list shows the other sessions, and tells Claude to use SendMessage for Claude peers", () => {
  const { router, join } = setup();
  const a = join("A", CLAUDE, "claude");
  join("B", CODEX, "codex");
  join("C", CLAUDE2, "claude", { canReceive: false, folder: "web" });
  router.request("A", { reqId: "q1", cmd: "list" }, a.send);
  const r = a.box.at(-1);
  assert.equal(r.type, "peer-result");
  assert.equal(r.reqId, "q1");
  assert.equal(r.status, "ok");
  assert.match(r.body, /^You are session c1aude22\. Other sessions on this Mac:/);
  assert.match(r.body, /c0dex111  Codex working in "app"/);
  assert.match(r.body, /c1aude33  Claude Code working in "web"  \(can't receive messages\)/);
  assert.match(r.body, /use your built-in SendMessage tool/);
  assert.doesNotMatch(r.body, /c1aude22  /);
});

test("list on its own says nobody else is running", () => {
  const { router, join } = setup();
  const a = join("A", CODEX, "codex");
  router.request("A", { reqId: "q", cmd: "list" }, a.send);
  assert.match(a.box.at(-1).body, /^No other Claude Code or Codex sessions/);
});

test("send passes the message on with the sender's real identity, then reports the outcome", () => {
  const { router, join, logs } = setup();
  const a = join("A", CLAUDE, "claude");
  const b = join("B", CODEX, "codex");
  router.request("A", { reqId: "q1", cmd: "send", to: "C0DEX1", text: "secret plan" }, a.send);
  const d = b.box.at(-1);
  assert.deepEqual(d, { type: "peer-deliver", rid: "r0", from: { sid: CLAUDE, agent: "claude", folder: "app" }, text: "secret plan" });
  assert.equal(a.box.length, 0);
  router.outcome({ rid: "r0", outcome: "delivered" });
  assert.equal(a.box.at(-1).status, "ok");
  assert.match(a.box.at(-1).body, /^Delivered/);
  router.outcome({ rid: "r0", outcome: "delivered" });
  assert.equal(a.box.length, 1);
  assert.ok(logs.some((l) => l.msg === "session message passed on" && l.extra.outcome === "delivered"));
  assert.ok(!JSON.stringify(logs).includes("secret plan"));
});

test("busy and unconfirmed count as sent; cannot-receive does not", () => {
  const { router, join } = setup();
  const a = join("A", CODEX, "codex");
  join("B", CLAUDE, "claude");
  for (const [i, outcome, status] of [[0, "waiting", "ok"], [1, "unconfirmed", "ok"], [2, "cannot-receive", "error"]]) {
    router.request("A", { reqId: `q${i}`, cmd: "send", to: "c1aude22", text: "x" }, a.send);
    router.outcome({ rid: `r${i}`, outcome });
    assert.equal(a.box.at(-1).status, status);
  }
});

test("no answer from the receiver in time: unconfirmed", async () => {
  const { router, join } = setup({ deliverTimeoutMs: 20 });
  const a = join("A", CODEX, "codex");
  join("B", CLAUDE, "claude");
  router.request("A", { reqId: "q", cmd: "send", to: "c1aude", text: "x" }, a.send);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(a.box.at(-1).status, "ok");
  assert.match(a.box.at(-1).body, /couldn't confirm/);
});

test("the receiver closes mid-delivery: the sender is told it isn't running", () => {
  const { router, join } = setup();
  const a = join("A", CODEX, "codex");
  join("B", CLAUDE, "claude");
  router.request("A", { reqId: "q", cmd: "send", to: "c1aude", text: "x" }, a.send);
  router.gone("B");
  assert.equal(a.box.at(-1).status, "error");
  assert.match(a.box.at(-1).body, /isn't running any more/);
  assert.equal(router.size, 1);
});

test("refusals: unknown sender, short id, no match, ambiguous, self, Claude to Claude, can't receive", () => {
  const { router, join } = setup();
  const a = join("A", CLAUDE, "claude");
  join("B", CLAUDE2, "claude");
  join("C", CODEX, "codex", { canReceive: false });
  const stranger = [];
  router.request("Z", { reqId: "q", cmd: "list" }, (m) => stranger.push(m));
  assert.match(stranger[0].body, /doesn't know this session yet/);
  const cases = [
    ["c1a", /at least the first 4/],
    ["ffffffff", /isn't running any more/],
    ["c1aude", /More than one session/],
    ["c1aude22", /That's this session/],
    ["c1aude33", /SendMessage/],
    ["c0dex", /can't receive messages/],
  ];
  for (const [to, re] of cases) {
    router.request("A", { reqId: "q", cmd: "send", to, text: "x" }, a.send);
    assert.equal(a.box.at(-1).status, "error", to);
    assert.match(a.box.at(-1).body, re, to);
  }
  router.request("A", { reqId: "q", cmd: "delete" }, a.send);
  assert.match(a.box.at(-1).body, /Unknown command/);
});

test("a session can't be flooded: per-minute and per-hour limits", () => {
  const { router, join, tick, boxes } = setup();
  const a = join("A", CODEX, "codex");
  join("B", CLAUDE, "claude");
  const send = () => router.request("A", { reqId: "q", cmd: "send", to: "c1aude", text: "x" }, a.send);
  for (let i = 0; i < PER_MINUTE; i++) send();
  assert.equal(boxes.get("B").length, PER_MINUTE);
  send();
  assert.match(a.box.at(-1).body, /too many messages/);
  let sent = PER_MINUTE;
  while (sent < PER_HOUR) {
    tick(61_000);
    for (let i = 0; i < PER_MINUTE && sent < PER_HOUR; i++, sent++) send();
  }
  tick(61_000);
  send();
  assert.match(a.box.at(-1).body, /too many messages/);
  tick(3_600_000);
  send();
  assert.equal(boxes.get("B").length, PER_HOUR + 1);
});

test("hello ignores anything that isn't a Claude Code or Codex session", () => {
  const { router } = setup();
  router.hello("A", { sid: "x", agent: "gemini" }, () => true);
  router.hello("B", { agent: "codex" }, () => true);
  assert.equal(router.size, 0);
});
