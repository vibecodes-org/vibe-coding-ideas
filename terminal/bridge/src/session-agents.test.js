// Unit tests for the bridge's handling of the board's agents (task 59889027).
// Run: cd terminal/bridge && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSpawnArgs, serializeSessionAgents, wantsSessionAgents, SESSION_AGENTS_MAX_BYTES } from "./session-agents.js";

const ATLAS = {
  description: "VibeCodes agent Atlas for frontier-tier workflow steps. [vc 1a2b3c4d opus high]",
  prompt: "## Goal\nShip it.",
  model: "opus",
  effort: "high",
};

test("a valid payload is serialised as-is", () => {
  const json = serializeSessionAgents({ agents: { "vc-atlas-37e8ffb2-frontier": ATLAS } });
  assert.deepEqual(JSON.parse(json), { "vc-atlas-37e8ffb2-frontier": ATLAS });
});

test("an untiered definition without model/effort is accepted", () => {
  const json = serializeSessionAgents({ agents: { "vc-lens-87e09eb1": { description: "d", prompt: "p" } } });
  assert.deepEqual(JSON.parse(json), { "vc-lens-87e09eb1": { description: "d", prompt: "p" } });
});

test("null, empty or malformed bodies give no agents", () => {
  for (const body of [null, undefined, {}, { agents: null }, { agents: {} }, { agents: [] }, "x"]) {
    assert.equal(serializeSessionAgents(body), null);
  }
});

test("a name outside the vc- namespace is refused — it could shadow a user's own agent", () => {
  assert.equal(serializeSessionAgents({ agents: { "code-reviewer": ATLAS } }), null);
  assert.equal(serializeSessionAgents({ agents: { "vc-Atlas": ATLAS } }), null);
});

test("settings that aren't plain tokens are refused", () => {
  assert.equal(serializeSessionAgents({ agents: { "vc-a": { ...ATLAS, model: "opus; rm -rf" } } }), null);
  assert.equal(serializeSessionAgents({ agents: { "vc-a": { ...ATLAS, effort: 3 } } }), null);
  assert.equal(serializeSessionAgents({ agents: { "vc-a": { ...ATLAS, prompt: "  " } } }), null);
});

test("an oversized payload is dropped rather than risking the launch", () => {
  const big = { ...ATLAS, prompt: "x".repeat(SESSION_AGENTS_MAX_BYTES) };
  assert.equal(serializeSessionAgents({ agents: { "vc-a": big } }), null);
});

test("agents and prompt are separate argv elements, after the command's own flags", () => {
  const args = buildSpawnArgs(["--session-id", "abc", "--model", "opus"], '{"vc-a":{}}', "do the thing");
  assert.deepEqual(args, ["--session-id", "abc", "--model", "opus", "--agents", '{"vc-a":{}}', "do the thing"]);
});

test("without agents the argv is exactly today's", () => {
  assert.deepEqual(buildSpawnArgs(["--session-id", "abc"], null, "p"), ["--session-id", "abc", "p"]);
  assert.deepEqual(buildSpawnArgs(["--continue"], null, ""), ["--continue"]);
});

test("only a fresh, prompt-carrying Claude launch asks for agents", () => {
  const fresh = { agent: "claude", prompt: "p", resume: false, resumeId: null, explicitCmd: null };
  assert.equal(wantsSessionAgents(fresh), true);
  assert.equal(wantsSessionAgents({ ...fresh, agent: "codex" }), false);
  assert.equal(wantsSessionAgents({ ...fresh, prompt: "" }), false);
  assert.equal(wantsSessionAgents({ ...fresh, resume: true }), false);
  assert.equal(wantsSessionAgents({ ...fresh, resumeId: "11111111-1111-4111-8111-111111111111" }), false);
  assert.equal(wantsSessionAgents({ ...fresh, explicitCmd: "bash" }), false);
});
