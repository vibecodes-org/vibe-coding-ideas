// Unit tests for the bridge's handling of the board's agents (tasks 59889027,
// e16d69e8). Run: cd terminal/bridge && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSpawnArgs,
  codexAgentConfigArgs,
  codexAgentFiles,
  serializeSessionAgents,
  tomlString,
  wantsSessionAgents,
  SESSION_AGENTS_MAX_BYTES,
} from "./session-agents.js";

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
  const args = buildSpawnArgs(["--session-id", "abc", "--model", "opus"], ["--agents", '{"vc-a":{}}'], "do the thing");
  assert.deepEqual(args, ["--session-id", "abc", "--model", "opus", "--agents", '{"vc-a":{}}', "do the thing"]);
});

test("without agents the argv is exactly today's", () => {
  assert.deepEqual(buildSpawnArgs(["--session-id", "abc"], [], "p"), ["--session-id", "abc", "p"]);
  assert.deepEqual(buildSpawnArgs(["--continue"], [], ""), ["--continue"]);
});

// ── Codex: role files ──────────────────────────────────────────────────────

test("tomlString writes a TOML basic string, escaping DEL as well as JSON's set", () => {
  assert.equal(tomlString('say "hi"\\now\n\ttab'), '"say \\"hi\\"\\\\now\\n\\ttab"');
  assert.equal(tomlString("a\u007fb"), '"a\\u007Fb"');
  assert.equal(tomlString("a\u0001b"), '"a\\u0001b"');
  // Non-ASCII passes through raw — TOML files are UTF-8.
  assert.equal(tomlString("café — ✓"), '"café — ✓"');
});

test("each Codex agent becomes one role file holding the persona as its instructions", () => {
  const files = codexAgentFiles({
    agents: {
      "vc-atlas-37e8ffb2-frontier": { ...ATLAS, model: "gpt-5.6-sol", effort: "high" },
      "vc-lens-87e09eb1": { description: "d", prompt: "p" },
    },
  });
  assert.equal(files.length, 2);
  assert.deepEqual(files[0], {
    name: "vc-atlas-37e8ffb2-frontier",
    fileName: "vc-atlas-37e8ffb2-frontier.toml",
    toml:
      'name = "vc-atlas-37e8ffb2-frontier"\n' +
      'description = "VibeCodes agent Atlas for frontier-tier workflow steps. [vc 1a2b3c4d opus high]"\n' +
      'developer_instructions = "## Goal\\nShip it."\n' +
      'model = "gpt-5.6-sol"\n' +
      'model_reasoning_effort = "high"\n',
  });
  // Untiered: no model or effort lines, so the session's own apply.
  assert.equal(files[1].toml, 'name = "vc-lens-87e09eb1"\ndescription = "d"\ndeveloper_instructions = "p"\n');
});

test("a persona can't break out of its string into other TOML keys", () => {
  const hostile = 'x"\nmodel = "evil"\n[agents.other]\nconfig_file = "/etc/passwd'; // quotes and newlines
  const [file] = codexAgentFiles({ agents: { "vc-a": { description: hostile, prompt: hostile } } });
  const lines = file.toml.trimEnd().split("\n");
  assert.equal(lines.length, 3, "every value stays on its own single line");
  assert.ok(lines.every((l) => /^(name|description|developer_instructions) = ".*"$/.test(l)));
});

test("Codex role files get the same validation as Claude's definitions", () => {
  assert.equal(codexAgentFiles(null), null);
  assert.equal(codexAgentFiles({ agents: { "code-reviewer": ATLAS } }), null);
  assert.equal(codexAgentFiles({ agents: { "vc-a": { ...ATLAS, model: "x y" } } }), null);
});

test("each role file is registered with its own -c flag pointing at its path", () => {
  const args = codexAgentConfigArgs([
    { name: "vc-atlas-37e8ffb2-frontier", path: "/tmp/vibecodes-agents-AbC/vc-atlas-37e8ffb2-frontier.toml" },
    { name: "vc-lens-87e09eb1", path: '/tmp/odd "dir"/vc-lens-87e09eb1.toml' },
  ]);
  assert.deepEqual(args, [
    "-c",
    'agents.vc-atlas-37e8ffb2-frontier.config_file="/tmp/vibecodes-agents-AbC/vc-atlas-37e8ffb2-frontier.toml"',
    "-c",
    'agents.vc-lens-87e09eb1.config_file="/tmp/odd \\"dir\\"/vc-lens-87e09eb1.toml"',
  ]);
  // Before the prompt, which Codex takes as its one positional argument.
  assert.deepEqual(buildSpawnArgs(["-m", "gpt-5.6-sol"], args.slice(0, 2), "go"), ["-m", "gpt-5.6-sol", ...args.slice(0, 2), "go"]);
});

test("every Claude or Codex launch asks for agents, resumed ones included", () => {
  const launch = { agent: "claude", explicitCmd: null };
  assert.equal(wantsSessionAgents(launch), true);
  assert.equal(wantsSessionAgents({ ...launch, agent: "codex" }), true);
  // A resume carries no prompt and no flags of its own here: it still gets agents,
  // because a resumed conversation does not keep the ones it started with.
  assert.equal(wantsSessionAgents({ agent: "claude", prompt: "", resume: true, resumeId: null, explicitCmd: null }), true);
  assert.equal(
    wantsSessionAgents({ agent: "codex", prompt: "", resume: false, resumeId: "11111111-1111-4111-8111-111111111111", explicitCmd: null }),
    true,
  );
  assert.equal(wantsSessionAgents({ ...launch, agent: "bash" }), false);
  assert.equal(wantsSessionAgents({ ...launch, explicitCmd: "bash" }), false);
});
