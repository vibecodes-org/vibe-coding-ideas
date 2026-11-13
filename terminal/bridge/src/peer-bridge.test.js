import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  buildHookSettings,
  CODEX_HOOK_COMMAND,
  CODEX_HOOK_ENV,
  codexHookArgs,
  codexHookHash,
  codexHookUrl,
  createPeerBridge,
  hookSettingsArgs,
  startHookServer,
} from "./peer-bridge.js";

const NOW = 1_700_000_000_000;
const FROM = { sid: "s1aaaaaa-1111", agent: "codex", folder: "app" };

function make(over = {}) {
  const writes = [];
  let t = NOW;
  const bridge = createPeerBridge({
    agent: "claude",
    explicitCmd: false,
    envValue: "me.proof",
    replyCommand: "/x/vibecodes-msg",
    writePty: (d) => writes.push(d),
    now: () => t,
    delay: (ms) => new Promise((r) => setTimeout(r, ms > 200 ? 30 : 1)),
    ...over,
  });
  return { bridge, writes, tick: (ms) => (t += ms) };
}
const msg = (over = {}) => ({ id: over.id ?? "d1", from: over.from ?? FROM, text: over.text ?? "hi" });
const hook = (b, name, extra = {}) => b.handleHook({ hook_event_name: name, ...extra });

test("idle, no draft: pastes in brackets, then Enter, and reports delivered once the prompt is submitted", async () => {
  const { bridge, writes } = make();
  hook(bridge, "Stop");
  const p = bridge.deliver(msg());
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(writes.length, 2);
  assert.ok(writes[0].startsWith('\x1b[200~[Message from session s1aaaaaa (Codex, working in "app").'));
  assert.ok(writes[0].includes('Reply with: /x/vibecodes-msg send s1aaaaaa "your reply"]'));
  assert.ok(writes[0].endsWith("\nhi\x1b[201~"));
  assert.equal(writes[1], "\r");
  hook(bridge, "UserPromptSubmit");
  assert.equal(await p, "delivered");
});

test("idle, but Enter never leads to a submit: unconfirmed, not delivered", async () => {
  const { bridge } = make();
  hook(bridge, "Stop");
  assert.equal(await bridge.deliver(msg()), "unconfirmed");
});

test("two messages back to back: the second waits, and no Enter is pressed mid-turn", async () => {
  const { bridge, writes } = make();
  hook(bridge, "Stop");
  const p1 = bridge.deliver(msg({ id: "d1", text: "one" }));
  const p2 = bridge.deliver(msg({ id: "d2", text: "two" }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(writes.filter((w) => w === "\r").length, 1);
  assert.equal(writes.filter((w) => w.startsWith("\x1b[200~")).length, 1);
  hook(bridge, "UserPromptSubmit");
  assert.deepEqual(await Promise.all([p1, p2]), ["delivered", "waiting"]);
  assert.equal(hook(bridge, "Stop").reason.includes("two"), true);
});

test("a turn starts during the paste: Enter is not pressed", async () => {
  const { bridge, writes } = make({ delay: (ms) => new Promise((r) => setTimeout(r, ms > 200 ? 30 : 20)) });
  hook(bridge, "Stop");
  const p = bridge.deliver(msg());
  await new Promise((r) => setTimeout(r, 5));
  hook(bridge, "UserPromptSubmit");
  assert.equal(await p, "unconfirmed");
  assert.equal(writes.includes("\r"), false);
});

test("a late idle_prompt notice during a permission prompt does not allow typing", async () => {
  const { bridge, writes } = make();
  hook(bridge, "PermissionRequest");
  hook(bridge, "Notification", { notification_type: "idle_prompt" });
  assert.equal(await bridge.deliver(msg()), "waiting");
  assert.equal(writes.length, 0);
});

test("the session record notes what happened to each message, never its text", async () => {
  const logs = [];
  const { bridge } = make({ log: (level, m, extra) => logs.push({ level, msg: m, extra }) });
  hook(bridge, "UserPromptSubmit");
  await bridge.deliver(msg({ text: "secret plan" }));
  const held = logs.find((l) => l.msg === "peer message held until the session is free");
  assert.ok(held);
  assert.deepEqual(held.extra, { id: "d1", phase: "busy", held: 1 });
  assert.ok(!JSON.stringify(logs).includes("secret plan"));
});

test("busy: nothing is typed, the sender hears waiting, and the Stop hook hands the message over", async () => {
  const { bridge, writes } = make();
  hook(bridge, "UserPromptSubmit");
  assert.equal(await bridge.deliver(msg()), "waiting");
  assert.deepEqual(writes, []);
  const out = hook(bridge, "Stop");
  assert.equal(out.decision, "block");
  assert.match(out.reason, /Not from the person you work for/);
  assert.match(out.reason, /\nhi$/);
  assert.deepEqual(hook(bridge, "Stop", { stop_hook_active: true }), {});
});

test("a permission prompt is open: nothing is typed", async () => {
  const { bridge, writes } = make();
  hook(bridge, "Stop");
  hook(bridge, "PermissionRequest");
  assert.equal(await bridge.deliver(msg()), "waiting");
  assert.deepEqual(writes, []);
});

test("the person has unsent text: held", async () => {
  const { bridge, writes } = make();
  hook(bridge, "Stop");
  bridge.handleInput("half a sentence");
  assert.equal(await bridge.deliver(msg()), "waiting");
  assert.deepEqual(writes, []);
});

test("terminal control characters in the message never reach the terminal", async () => {
  const { bridge, writes } = make();
  hook(bridge, "Stop");
  const p = bridge.deliver(msg({ text: "a\x1b[201~\x03b" }));
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(writes[0].endsWith("\na[201~b\x1b[201~"));
  hook(bridge, "UserPromptSubmit");
  await p;
});

test("a custom command, another agent, or an empty message: cannot-receive", async () => {
  for (const over of [{ agent: "gemini" }, { explicitCmd: true }, { agent: "codex", explicitCmd: true }]) {
    const { bridge, writes } = make(over);
    assert.equal(bridge.canReceive, false);
    assert.equal(await bridge.deliver(msg()), "cannot-receive");
    assert.deepEqual(writes, []);
  }
  const { bridge } = make();
  assert.equal(await bridge.deliver(msg({ text: " \x1b " })), "cannot-receive");
});

test("Codex busy: held, then handed over at the end of its turn", async () => {
  const { bridge, writes } = make({ agent: "codex" });
  hook(bridge, "SessionStart");
  hook(bridge, "UserPromptSubmit");
  assert.equal(await bridge.deliver(msg()), "waiting");
  assert.deepEqual(writes, []);
  const out = hook(bridge, "Stop", { stop_hook_active: false });
  assert.equal(out.decision, "block");
  assert.match(out.reason, /\nhi$/);
});

test("Codex launched with no prompt is free once it has started; with a prompt it is not", async () => {
  const free = make({ agent: "codex", startsIdle: true });
  hook(free.bridge, "SessionStart", { source: "startup" });
  const p = free.bridge.deliver(msg());
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(free.writes.at(-1), "\r");
  hook(free.bridge, "UserPromptSubmit");
  assert.equal(await p, "delivered");

  const busy = make({ agent: "codex", startsIdle: false });
  hook(busy.bridge, "SessionStart", { source: "startup" });
  assert.equal(await busy.bridge.deliver(msg()), "waiting");
  assert.deepEqual(busy.writes, []);
});

test("a late SessionStart never overrides a running turn or an open question", async () => {
  for (const ev of ["UserPromptSubmit", "PermissionRequest"]) {
    const { bridge, writes } = make({ agent: "codex", startsIdle: true });
    hook(bridge, ev);
    hook(bridge, "SessionStart");
    await bridge.deliver(msg());
    assert.deepEqual(writes, []);
  }
});

test("Codex hook fingerprints match the ones Codex itself computes", () => {
  // Taken from `codex app-server` hooks/list (Codex 0.163.0) for a test command.
  const cmd = 'cat >> "$VCH/hook.log"; echo >> "$VCH/hook.log"';
  assert.equal(codexHookHash("stop", null, cmd), "sha256:5cbf8b83e8ab71110661a6cd8b50804268b20ad185f3648e6cd4bfd09bac8ef5");
  assert.equal(codexHookHash("user_prompt_submit", null, cmd), "sha256:0104f1630d47d459ec971dc1b913573c571aec0930d25538262f194755104fb7");
});

test("Codex launch flags: one hook per event, all pre-approved, no address baked in", () => {
  const args = codexHookArgs();
  const values = args.filter((_, i) => i % 2 === 1);
  assert.ok(args.filter((_, i) => i % 2 === 0).every((a) => a === "-c"));
  const events = values.filter((v) => !v.startsWith("hooks.state=")).map((v) => v.split("=")[0]);
  assert.deepEqual(events, ["hooks.UserPromptSubmit", "hooks.Stop", "hooks.PostToolUse", "hooks.PermissionRequest", "hooks.SessionStart"]);
  const state = values.find((v) => v.startsWith("hooks.state="));
  for (const label of ["user_prompt_submit", "stop", "post_tool_use", "permission_request", "session_start"]) {
    assert.ok(state.includes(`"/<session-flags>/config.toml:${label}:0:0"={trusted_hash="${codexHookHash(label, null, CODEX_HOOK_COMMAND)}"}`));
  }
  assert.ok(!args.join(" ").includes("127.0.0.1"));
  assert.ok(CODEX_HOOK_COMMAND.includes(`"$${CODEX_HOOK_ENV}"`));
  assert.equal(codexHookUrl(4321, "abc"), "http://127.0.0.1:4321/abc/hook");
});

test("an offer_next_card call gets from_session filled in; other tools are untouched", () => {
  const { bridge } = make();
  const r = hook(bridge, "PreToolUse", { tool_name: "mcp__vibecodes__offer_next_card", tool_input: { finished_task_id: "t" } });
  assert.deepEqual(r.hookSpecificOutput.updatedInput, { finished_task_id: "t", from_session: "me.proof" });
  assert.deepEqual(hook(bridge, "PreToolUse", { tool_name: "Bash", tool_input: {} }), {});
  assert.deepEqual(hook(bridge, "PreToolUse", { tool_name: "mcp__vibecodes__send_session_message", tool_input: {} }), {});
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
