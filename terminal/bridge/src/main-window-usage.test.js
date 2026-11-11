// Run: cd terminal/bridge && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createUsageReporter, locateConversationFile, readMainWindowUsage, usageBody, MAX_HOUR_ROWS } from "./main-window-usage.js";

const ID = "11111111-2222-4333-8444-555555555555";
const call = (id, ts) =>
  JSON.stringify({
    isSidechain: false,
    message: { model: "claude-opus-5-5", id, type: "message", role: "assistant", content: [{ type: "text", text: "hi" }], stop_reason: null, usage: { input_tokens: 5, cache_read_input_tokens: 50, cache_creation_input_tokens: 0, output_tokens: 2 } },
    type: "assistant",
    timestamp: ts,
  });

function config(t) {
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vc-mwu-")));
  t.after(() => fs.rmSync(h, { recursive: true, force: true }));
  return h;
}

test("finds the newest copy of the conversation across project folders", (t) => {
  const cfg = config(t);
  for (const [key, when] of [["-a", 1000], ["-b-worktree", 2000]]) {
    const dir = path.join(cfg, "projects", key);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${ID}.jsonl`);
    fs.writeFileSync(f, "x\n");
    fs.utimesSync(f, when, when);
  }
  const found = locateConversationFile({ id: ID, env: { CLAUDE_CONFIG_DIR: cfg }, homedir: "/nowhere" });
  assert.ok(found.file.includes("-b-worktree"));
  assert.equal(locateConversationFile({ id: "nope", env: { CLAUDE_CONFIG_DIR: cfg }, homedir: "/x" }), null);
});

test("reads a conversation file and totals the main window's calls", async (t) => {
  const cfg = config(t);
  const f = path.join(cfg, "c.jsonl");
  fs.writeFileSync(f, [call("msg_1", "2026-11-10T09:10:00Z"), call("msg_2", "2026-11-10T10:10:00Z")].join("\n") + "\n");
  const u = await readMainWindowUsage(f, {});
  assert.equal(u.hours.length, 2);
  assert.equal(u.hours[0].calls, 1);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await readMainWindowUsage(f, { signal: aborted.signal }), null);
});

test("the body keeps the last 35 days and caps the rows", () => {
  const now = Date.parse("2026-11-11T00:00:00Z");
  const hours = [{ hour: "2026-09-01T00:00:00.000Z" }, ...Array.from({ length: MAX_HOUR_ROWS + 5 }, (_, i) => ({ hour: new Date(now - i * 1000).toISOString() }))];
  const body = usageBody(ID, { hours: hours.sort((a, b) => (a.hour < b.hour ? -1 : 1)), stepIds: [], firstCallAt: null, lastCallAt: null }, now);
  assert.equal(body.hours.length, MAX_HOUR_ROWS);
  assert.ok(body.hours.every((h) => h.hour > "2026-10-01"));
});

function reporter({ mtimes, post }) {
  let i = 0;
  const sent = [];
  const r = createUsageReporter({
    conversationId: ID,
    locate: () => ({ file: "f", mtimeMs: mtimes[Math.min(i++, mtimes.length - 1)] }),
    read: async () => ({ hours: [], stepIds: [], firstCallAt: null, lastCallAt: null }),
    post: post ?? (async (b) => { sent.push(b); return true; }),
  });
  return { r, sent };
}

test("skips the hourly send when the file hasn't changed, sends when it has, and at exit", async () => {
  const { r, sent } = reporter({ mtimes: [1, 1, 2, 2] });
  assert.equal(await r.send(), true); // first
  assert.equal(await r.send(), false); // unchanged
  assert.equal(await r.send(), true); // changed
  assert.equal(await r.send({ final: true }), false); // unchanged at exit, nothing new
  assert.equal(sent.length, 2);
  const { r: r2, sent: s2 } = reporter({ mtimes: [5] });
  assert.equal(await r2.send({ final: true }), true);
  assert.equal(s2.length, 1);
});

test("sends nothing without a conversation id", async () => {
  const r = createUsageReporter({ conversationId: null, locate: () => assert.fail(), read: async () => null, post: async () => true });
  assert.equal(await r.send({ final: true }), false);
});

test("the exit-time send gives up after its time limit when the request hangs, and never throws", async () => {
  const { r } = reporter({
    mtimes: [1],
    post: (_b, { signal }) => new Promise((resolve) => signal.addEventListener("abort", () => resolve(false))),
  });
  const started = Date.now();
  assert.equal(await r.send({ final: true, timeoutMs: 50 }), false);
  assert.ok(Date.now() - started < 2000);
  const boom = createUsageReporter({ conversationId: ID, locate: () => { throw new Error("x"); }, read: async () => null, post: async () => true });
  assert.equal(await boom.send(), false);
});
