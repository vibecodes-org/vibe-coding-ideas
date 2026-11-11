import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyInput, createPeerState, joinHeld, onHook, onInput, onMessage, onTick, safeToSubmit, endTyping } from "./peer-delivery.js";
import { PEER_HOLD_MAX_COUNT, PEER_HOLD_MAX_MS } from "../../shared/peer-message.mjs";

const T = 1000;
const idle = () => onHook(createPeerState(), { name: "Stop" }, T).state;

test("idle with no draft: type now", () => {
  assert.equal(onMessage(idle(), { id: "a", text: "x" }, T).decision, "type-now");
});

test("unknown (nothing heard yet), busy and asking: hold", () => {
  assert.equal(onMessage(createPeerState(), { id: "a", text: "x" }, T).decision, "hold");
  const busy = onHook(idle(), { name: "UserPromptSubmit" }, T).state;
  assert.equal(onMessage(busy, { id: "a", text: "x" }, T).decision, "hold");
  const asking = onHook(busy, { name: "PermissionRequest" }, T).state;
  assert.equal(asking.phase, "asking");
  assert.equal(onMessage(asking, { id: "a", text: "x" }, T).decision, "hold");
  assert.equal(onHook(busy, { name: "Notification", notification: "permission_prompt" }, T).state.phase, "asking");
});

test("idle with a draft: hold", () => {
  const s = onInput(idle(), "hello");
  assert.equal(s.draft, true);
  assert.equal(onMessage(s, { id: "a", text: "x" }, T).decision, "hold");
});

test("Stop with a held message blocks with its text and empties the inbox; Stop with nothing is silent", () => {
  let s = onHook(idle(), { name: "UserPromptSubmit" }, T).state;
  s = onMessage(s, { id: "a", text: "one" }, T).state;
  s = onMessage(s, { id: "b", text: "two" }, T).state;
  const r = onHook(s, { name: "Stop" }, T + 5);
  assert.deepEqual(r.block, ["one", "two"]);
  assert.equal(joinHeld(r.block), "one\n\ntwo");
  assert.equal(r.state.inbox.length, 0);
  assert.equal(r.state.phase, "busy");
  const again = onHook(r.state, { name: "Stop", stopHookActive: true }, T + 10);
  assert.equal(again.block, null);
  assert.equal(again.state.phase, "idle");
});

test("a tool call after a prompt means the prompt was answered", () => {
  const asking = onHook(idle(), { name: "PermissionRequest" }, T).state;
  assert.equal(onHook(asking, { name: "PostToolUse" }, T).state.phase, "busy");
});

test("idle_prompt notification makes an unknown session idle", () => {
  assert.equal(onHook(createPeerState(), { name: "Notification", notification: "idle_prompt" }, T).state.phase, "idle");
});

test("idle_prompt never overrides busy or asking", () => {
  const idlePrompt = { name: "Notification", notification: "idle_prompt" };
  const busy = onHook(idle(), { name: "UserPromptSubmit" }, T).state;
  const asking = onHook(idle(), { name: "PermissionRequest" }, T).state;
  const typing = onMessage(idle(), { id: "a", text: "x" }, T).state;
  assert.equal(onHook(busy, idlePrompt, T).state.phase, "busy");
  assert.equal(onHook(asking, idlePrompt, T).state.phase, "asking");
  assert.equal(onHook(typing, idlePrompt, T).state.phase, "typing");
  assert.equal(onMessage(onHook(asking, idlePrompt, T).state, { id: "b", text: "y" }, T).decision, "hold");
  assert.equal(onMessage(onHook(busy, idlePrompt, T).state, { id: "b", text: "y" }, T).decision, "hold");
});

test("while one message is being typed, the next one waits", () => {
  const first = onMessage(idle(), { id: "a", text: "x" }, T);
  assert.equal(first.decision, "type-now");
  assert.equal(first.state.phase, "typing");
  const second = onMessage(first.state, { id: "b", text: "y" }, T);
  assert.equal(second.decision, "hold");
  assert.equal(second.state.inbox.length, 1);
});

test("safeToSubmit only while still typing; any hook event since ends it", () => {
  const typing = onMessage(idle(), { id: "a", text: "x" }, T).state;
  assert.equal(safeToSubmit(typing), true);
  for (const name of ["UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop"]) {
    assert.equal(safeToSubmit(onHook(typing, { name }, T).state), false, name);
  }
  assert.equal(safeToSubmit(idle()), false);
  assert.equal(safeToSubmit(createPeerState()), false);
});

test("endTyping: back to unknown when unsubmitted; pasted-but-not-sent counts as a draft", () => {
  const typing = onMessage(idle(), { id: "a", text: "x" }, T).state;
  const timedOut = endTyping(typing, { pasted: true, submitted: false });
  assert.equal(timedOut.phase, "unknown");
  assert.equal(timedOut.draft, true);
  const done = onHook(typing, { name: "UserPromptSubmit" }, T).state;
  assert.equal(endTyping(done, { pasted: true, submitted: true }).phase, "busy");
});

test("UserPromptSubmit clears the draft", () => {
  const s = onHook(onInput(idle(), "abc"), { name: "UserPromptSubmit" }, T).state;
  assert.equal(s.draft, false);
});

test("held messages are dropped after 30 minutes and the inbox is capped at 20", () => {
  let s = createPeerState();
  s = onMessage(s, { id: "old", text: "x" }, T).state;
  const t = onTick(s, T + PEER_HOLD_MAX_MS + 1);
  assert.deepEqual(t.dropped, ["old"]);
  assert.equal(t.state.inbox.length, 0);
  s = createPeerState();
  for (let i = 0; i < PEER_HOLD_MAX_COUNT; i++) s = onMessage(s, { id: `m${i}`, text: "x" }, T).state;
  assert.equal(onMessage(s, { id: "extra", text: "x" }, T).decision, "full");
});

test("an expired held message is not handed over at Stop", () => {
  let s = onMessage(createPeerState(), { id: "old", text: "x" }, T).state;
  const r = onHook(s, { name: "Stop" }, T + PEER_HOLD_MAX_MS + 1);
  assert.equal(r.block, null);
  assert.deepEqual(r.dropped, ["old"]);
});

test("classifyInput: printable text is a draft, arrows and focus reports are not, lone Ctrl-C clears", () => {
  assert.equal(classifyInput("hi"), "draft");
  assert.equal(classifyInput("\x1b[A"), "none");
  assert.equal(classifyInput("\x1b[I"), "none");
  assert.equal(classifyInput("\x1bOP"), "none");
  assert.equal(classifyInput("\r"), "none");
  assert.equal(classifyInput("\x03"), "clear");
  assert.equal(classifyInput("\x1b[200~pasted\x1b[201~"), "draft");
  assert.equal(onInput(onInput(idle(), "a"), "\x03").draft, false);
});

test("safeToSubmit refuses while asking or when a draft appeared", () => {
  const typing = onMessage(idle(), { id: "a", text: "x" }, T).state;
  assert.equal(safeToSubmit(typing), true);
  assert.equal(safeToSubmit(onInput(typing, "x")), false);
  assert.equal(safeToSubmit(onHook(idle(), { name: "PermissionRequest" }, T).state), false);
});
