// Stage 2 of card 9b5336c1: nothing readable, secret or oversized on the
// command line. Run: cd terminal/bridge && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { planClaudeAgents, tomlEscapedString } from "./session-agents.js";

const ATLAS = {
  description: "VibeCodes agent Atlas. [vc 1a2b3c4d opus high]",
  prompt: "## Goal\nShip it.",
  model: "opus",
  effort: "high",
};

test("tomlEscapedString: no readable text, decodes to the same value", () => {
  const text = 'Use the vibecodes-msg command.\nQuote " and slash \\ and emoji 😀 and é';
  const out = tomlEscapedString(text);
  assert.ok(!out.includes("vibecodes"));
  assert.ok(!/[A-Za-z]{3}/.test(out.replace(/\\[uU][0-9a-f]+/g, "")), "no plain words left");
  const decoded = out
    .slice(1, -1)
    .replace(/\\U([0-9a-f]{8})/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  assert.equal(decoded, text);
});

test("Windows: a board that fits is passed whole, as plain JSON, with no files", () => {
  const plan = planClaudeAgents({ agents: { "vc-a": ATLAS } }, undefined, { platform: "win32", budget: 24_000 });
  assert.ok(plan);
  assert.deepEqual(plan.files, []);
  assert.equal(JSON.parse(plan.json)["vc-a"].prompt, ATLAS.prompt);
});

test("Windows: a big board always fits the command line; the biggest prompts move to files", () => {
  const agents = {};
  for (let i = 0; i < 12; i++) agents[`vc-agent-${i}`] = { ...ATLAS, prompt: `agent ${i} ` + "long instructions. ".repeat(500 + i * 50) };
  const plan = planClaudeAgents({ agents }, undefined, {
    platform: "win32",
    budget: 20_000,
    pathFor: (f) => `C:\\Temp\\vc\\${f}`,
  });
  assert.ok(plan);
  assert.ok(plan.json.length <= 20_000, `json is ${plan.json.length}`);
  assert.deepEqual(plan.dropped, []);
  assert.ok(plan.stubbed.length > 0);
  const parsed = JSON.parse(plan.json);
  assert.equal(Object.keys(parsed).length, 12, "every agent still loads");
  for (const name of plan.stubbed) {
    const file = plan.files.find((f) => f.fileName === `${name}.md`);
    assert.ok(file, "the full prompt is in a file");
    assert.equal(file.text, agents[name].prompt, "the file holds the whole original prompt");
    assert.ok(parsed[name].prompt.includes(`C:\\Temp\\vc\\${name}.md`), "the stub names the file");
  }
});

test("Windows: when even stubs don't fit, agents are left out and reported", () => {
  const agents = {};
  for (let i = 0; i < 40; i++) agents[`vc-agent-${i}`] = { ...ATLAS, prompt: "x".repeat(2000) };
  const plan = planClaudeAgents({ agents }, undefined, { platform: "win32", budget: 6_000 });
  assert.ok(plan);
  assert.ok(plan.json.length <= 6_000);
  assert.ok(plan.dropped.length > 0);
  assert.equal(Object.keys(JSON.parse(plan.json)).length + plan.dropped.length, 40);
  assert.equal(plan.files.length, plan.stubbed.length, "no file left behind for a dropped agent");
});

test("Mac/Linux: agents stay inline as coded JSON, never as files", () => {
  const plan = planClaudeAgents({ agents: { "vc-a": ATLAS } }, undefined, { platform: "darwin" });
  assert.ok(plan);
  assert.deepEqual(plan.files, []);
  assert.ok(!plan.json.includes("Ship it"));
  assert.equal(JSON.parse(plan.json)["vc-a"].prompt, ATLAS.prompt);
});

test("planClaudeAgents refuses the same bad bodies as before", () => {
  assert.equal(planClaudeAgents({ agents: { "code-reviewer": ATLAS } }, undefined), null);
  assert.equal(planClaudeAgents(null, undefined), null);
});
