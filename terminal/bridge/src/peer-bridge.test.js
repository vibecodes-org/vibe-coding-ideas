import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildHookSettings, createPeerBridge, hookSettingsArgs, startHookServer } from "./peer-bridge.js";
import { encodePeerFrame, parsePeerAckFrame, signPeerEnvelope } from "../../shared/peer-message.mjs";

const KEY = "k".repeat(43);
const SID = "target-sid";
const NOW = 1_700_000_000_000;

function make(over = {}) {
  const writes = [];
  const acks = [];
  let t = NOW;
  const bridge = createPeerBridge({
    key: KEY,
    sid: SID,
    agent: "claude",
    explicitCmd: false,
    envValue: "me.proof",
    writePty: (d) => writes.push(d),
    sendAck: (f) => acks.push(parsePeerAckFrame(f)),
    now: () => t,
    delay: (ms) => new Promise((r) => setTimeout(r, ms > 200 ? 30 : 1)),
    ...over,
  });
  return { bridge, writes, acks, tick: (ms) => (t += ms) };
}
const frame = (over = {}, key = KEY) =>
  encodePeerFrame(
    signPeerEnvelope(key, { id: over.id ?? "id-000001", to: SID, from: { sid: "s1", name: "Fix login", agent: "codex" }, text: over.text ?? "hi", ts: NOW }),
  );
const hook = (b, name, extra = {}) => b.handleHook({ hook_event_name: name, ...extra });

test("idle, no draft: pastes in brackets, then Enter, and reports delivered once the prompt is submitted", async () => {
  const { bridge, writes, acks } = make();
  hook(bridge, "Stop");
  const p = bridge.handleFrame(frame());
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(writes.length, 2);
  assert.ok(writes[0].startsWith("\x1b[200~[Message from your session \"Fix login\" (Codex)."));
  assert.ok(writes[0].endsWith("\nhi\x1b[201~"));
  assert.equal(writes[1], "\r");
  hook(bridge, "UserPromptSubmit");
  await p;
  assert.deepEqual(acks, [{ id: "id-000001", outcome: "delivered" }]);
});

test("idle, but Enter never leads to a submit: unconfirmed, not delivered", async () => {
  const { bridge, acks } = make();
  hook(bridge, "Stop");
  await bridge.handleFrame(frame());
  assert.deepEqual(acks, [{ id: "id-000001", outcome: "unconfirmed" }]);
});

test("two messages back to back: the second waits, and no Enter is pressed mid-turn", async () => {
  const { bridge, writes, acks } = make();
  hook(bridge, "Stop");
  const p1 = bridge.handleFrame(frame({ id: "id-000001", text: "one" }));
  const p2 = bridge.handleFrame(frame({ id: "id-000002", text: "two" }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(writes.filter((w) => w === "\r").length, 1);
  assert.equal(writes.filter((w) => w.startsWith("\x1b[200~")).length, 1);
  hook(bridge, "UserPromptSubmit");
  await Promise.all([p1, p2]);
  assert.deepEqual(acks.map((a) => [a.id, a.outcome]).sort(), [["id-000001", "delivered"], ["id-000002", "waiting"]]);
  assert.equal(hook(bridge, "Stop").reason.includes("two"), true);
});

test("a turn starts during the paste: Enter is not pressed", async () => {
  const { bridge, writes, acks } = make({ delay: (ms) => new Promise((r) => setTimeout(r, ms > 200 ? 30 : 20)) });
  hook(bridge, "Stop");
  const p = bridge.handleFrame(frame());
  await new Promise((r) => setTimeout(r, 5));
  hook(bridge, "UserPromptSubmit");
  await p;
  assert.equal(writes.includes("\r"), false);
  assert.deepEqual(acks, [{ id: "id-000001", outcome: "unconfirmed" }]);
});

test("a late idle_prompt notice during a permission prompt does not allow typing", async () => {
  const { bridge, writes, acks } = make();
  hook(bridge, "PermissionRequest");
  hook(bridge, "Notification", { notification_type: "idle_prompt" });
  await bridge.handleFrame(frame());
  assert.equal(writes.length, 0);
  assert.deepEqual(acks, [{ id: "id-000001", outcome: "waiting" }]);
});

test("the session record notes what happened to each message, never its text", async () => {
  const logs = [];
  const { bridge } = make({ log: (level, msg, extra) => logs.push({ level, msg, extra }) });
  hook(bridge, "UserPromptSubmit");
  await bridge.handleFrame(frame({ text: "secret plan" }));
  const held = logs.find((l) => l.msg === "peer message held until claude is free");
  assert.ok(held);
  assert.deepEqual(held.extra, { id: "id-000001", phase: "busy", held: 1 });
  assert.ok(!JSON.stringify(logs).includes("secret plan"));
});

test("busy: nothing is typed, the sender hears waiting, and the Stop hook hands the message over", async () => {
  const { bridge, writes, acks } = make();
  hook(bridge, "UserPromptSubmit");
  await bridge.handleFrame(frame());
  assert.deepEqual(writes, []);
  assert.deepEqual(acks, [{ id: "id-000001", outcome: "waiting" }]);
  const out = hook(bridge, "Stop");
  assert.equal(out.decision, "block");
  assert.match(out.reason, /Not from Nick/);
  assert.match(out.reason, /\nhi$/);
  assert.deepEqual(hook(bridge, "Stop", { stop_hook_active: true }), {});
});

test("a permission prompt is open: nothing is typed", async () => {
  const { bridge, writes, acks } = make();
  hook(bridge, "Stop");
  hook(bridge, "PermissionRequest");
  await bridge.handleFrame(frame());
  assert.deepEqual(writes, []);
  assert.equal(acks[0].outcome, "waiting");
});

test("the person has unsent text: held", async () => {
  const { bridge, writes, acks } = make();
  hook(bridge, "Stop");
  bridge.handleInput("half a sentence");
  await bridge.handleFrame(frame());
  assert.deepEqual(writes, []);
  assert.equal(acks[0].outcome, "waiting");
});

test("bad signature, stale and replayed frames never reach the terminal", async () => {
  const { bridge, writes, acks, tick } = make();
  hook(bridge, "Stop");
  await bridge.handleFrame(frame({}, "wrong-key"));
  assert.equal(acks.at(-1).outcome, "rejected");
  tick(200_000);
  await bridge.handleFrame(frame({ id: "id-000002" }));
  assert.equal(acks.at(-1).outcome, "rejected");
  assert.deepEqual(writes, []);
});

test("a replayed id is refused the second time", async () => {
  const { bridge, acks } = make();
  hook(bridge, "UserPromptSubmit");
  await bridge.handleFrame(frame());
  await bridge.handleFrame(frame());
  assert.deepEqual(acks.map((a) => a.outcome), ["waiting", "rejected"]);
});

test("no key: cannot-receive. Codex or a custom command: cannot-receive (stage 1)", async () => {
  for (const over of [{ key: null }, { agent: "codex" }, { explicitCmd: true }]) {
    const { bridge, writes, acks } = make(over);
    await bridge.handleFrame(frame());
    assert.equal(acks[0].outcome, "cannot-receive");
    assert.deepEqual(writes, []);
  }
});

test("a send_session_message call gets from_session filled in; other tools are untouched", () => {
  const { bridge } = make();
  const r = hook(bridge, "PreToolUse", { tool_name: "mcp__vibecodes__send_session_message", tool_input: { to: "x", message: "m" } });
  assert.deepEqual(r.hookSpecificOutput.updatedInput, { to: "x", message: "m", from_session: "me.proof" });
  assert.deepEqual(hook(bridge, "PreToolUse", { tool_name: "Bash", tool_input: {} }), {});
});

test("hook settings use the secret path and cover every event", () => {
  const s = buildHookSettings(4321, "sec");
  assert.deepEqual(Object.keys(s.hooks).sort(), ["Notification", "PermissionRequest", "PostToolUse", "PreToolUse", "Stop", "UserPromptSubmit"]);
  assert.equal(s.hooks.Stop[0].hooks[0].url, "http://127.0.0.1:4321/sec/Stop");
  const args = hookSettingsArgs(1, "s");
  assert.equal(args[0], "--settings");
  assert.doesNotThrow(() => JSON.parse(args[1]));
});

test("the hook server answers only its own secret path", async () => {
  const srv = await startHookServer({ secret: "sec", onEvent: (j) => ({ echoed: j.hook_event_name }) });
  const post = (path, body) =>
    new Promise((resolve) => {
      const req = http.request({ host: "127.0.0.1", port: srv.port, path, method: "POST" }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, body: d }));
      });
      req.end(body);
    });
  const good = await post("/sec/Stop", JSON.stringify({ hook_event_name: "Stop" }));
  assert.equal(good.status, 200);
  assert.deepEqual(JSON.parse(good.body), { echoed: "Stop" });
  assert.equal((await post("/other/Stop", "{}")).status, 404);
  srv.close();
});
