// Unit tests for the memory-limit launch flags (task 5e654dd1).
// Run: cd terminal/bridge && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AUTO_COMPACT_MAX,
  AUTO_COMPACT_MIN,
  autoCompactArgs,
  isValidWindow,
  parseAutoCompactWindow,
  parseClaudeVersion,
  supportsAutocompact,
} from "./auto-compact.js";
import { buildSpawnArgs, validateSessionAgents } from "./session-agents.js";

test("a whole number from 100,000 to 1,000,000 is valid; everything else is not", () => {
  for (const ok of [100_000, 150_000, 300_000, 1_000_000]) assert.equal(isValidWindow(ok), true);
  for (const bad of [0, -5, 99_999, 1_000_001, 300_000.5, "300000", "300k", null, undefined, NaN, Infinity, {}, []]) {
    assert.equal(isValidWindow(bad), false, String(bad));
  }
});

test("parseAutoCompactWindow reads the endpoint body and ignores anything else", () => {
  assert.equal(parseAutoCompactWindow({ agents: null, autoCompactWindow: 300_000 }), 300_000);
  for (const body of [null, undefined, {}, { agents: {} }, { autoCompactWindow: "300000" }, { autoCompactWindow: 5 }, "x"]) {
    assert.equal(parseAutoCompactWindow(body), null);
  }
});

test("parseClaudeVersion reads the version out of `claude --version`", () => {
  assert.deepEqual(parseClaudeVersion("2.1.221 (Claude Code)\n"), [2, 1, 221]);
  assert.deepEqual(parseClaudeVersion("Claude Code v2.3.4"), [2, 3, 4]);
  for (const bad of ["", "no version", null, undefined, 5, "2.1"]) assert.equal(parseClaudeVersion(bad), null);
});

test("supportsAutocompact is true only at 2.1.221 or newer", () => {
  assert.equal(supportsAutocompact([2, 1, 221]), true);
  assert.equal(supportsAutocompact([2, 1, 222]), true);
  assert.equal(supportsAutocompact([2, 2, 0]), true);
  assert.equal(supportsAutocompact([3, 0, 0]), true);
  assert.equal(supportsAutocompact([2, 1, 220]), false);
  assert.equal(supportsAutocompact([2, 0, 999]), false);
  assert.equal(supportsAutocompact([1, 9, 999]), false);
  assert.equal(supportsAutocompact(null), false);
});

test("Claude gets --autocompact N when the version check passes", () => {
  const r = autoCompactArgs({ agent: "claude", explicitCmd: null, window: 300_000, claudeVersionText: "2.1.221 (Claude Code)" });
  assert.deepEqual(r, { flags: ["--autocompact", "300000"], skipped: null });
});

test("Claude gets nothing when the version is old, unreadable or the probe failed", () => {
  for (const text of ["2.1.220 (Claude Code)", "garbage", "", null, undefined]) {
    const r = autoCompactArgs({ agent: "claude", explicitCmd: null, window: 300_000, claudeVersionText: text });
    assert.deepEqual(r.flags, []);
    assert.equal(r.skipped, "claude-too-old-or-unknown");
  }
});

test("Codex gets -c model_auto_compact_token_limit=N with no version check", () => {
  const r = autoCompactArgs({ agent: "codex", explicitCmd: null, window: 150_000 });
  assert.deepEqual(r, { flags: ["-c", "model_auto_compact_token_limit=150000"], skipped: null });
});

test("a bad or missing value adds nothing, for both agents", () => {
  for (const window of [null, undefined, 5, 2_000_000, 1.5, "300000", NaN]) {
    for (const agent of ["claude", "codex"]) {
      const r = autoCompactArgs({ agent, explicitCmd: null, window, claudeVersionText: "2.1.221" });
      assert.deepEqual(r.flags, []);
      assert.equal(r.skipped, "no-value");
    }
  }
});

test("an explicit --cmd launch is never touched", () => {
  for (const agent of ["claude", "codex"]) {
    const r = autoCompactArgs({ agent, explicitCmd: "bash", window: 300_000, claudeVersionText: "2.1.221" });
    assert.deepEqual(r, { flags: [], skipped: "explicit-cmd" });
  }
});

test("an unknown agent gets nothing", () => {
  assert.deepEqual(autoCompactArgs({ agent: "other", explicitCmd: null, window: 300_000 }).flags, []);
});

test("the flags come before the agents flags and the prompt, each as its own argv element", () => {
  const { flags } = autoCompactArgs({ agent: "claude", explicitCmd: null, window: 300_000, claudeVersionText: "2.1.221" });
  const argv = buildSpawnArgs(["--effort", "high"], [...flags, "--agents", "{}"], "do the thing; rm -rf /");
  assert.deepEqual(argv, ["--effort", "high", "--autocompact", "300000", "--agents", "{}", "do the thing; rm -rf /"]);
  // a resume carries no prompt
  assert.deepEqual(buildSpawnArgs(["--resume", "id"], flags, ""), ["--resume", "id", "--autocompact", "300000"]);
});

test("drift: MIN and MAX match the app's constants", () => {
  const appFile = fileURLToPath(new URL("../../../src/lib/terminal/auto-compact.ts", import.meta.url));
  const src = fs.readFileSync(appFile, "utf8");
  const min = /AUTO_COMPACT_MIN = ([\d_]+)/.exec(src);
  const max = /AUTO_COMPACT_MAX = ([\d_]+)/.exec(src);
  assert.ok(min && max, "constants found in the app file");
  assert.equal(Number(min[1].replace(/_/g, "")), AUTO_COMPACT_MIN);
  assert.equal(Number(max[1].replace(/_/g, "")), AUTO_COMPACT_MAX);
});

test("the top-level autoCompactWindow does not affect the agents validator", () => {
  const agents = { "vc-a": { description: "d", prompt: "p", model: "opus" } };
  assert.deepEqual(validateSessionAgents({ agents, autoCompactWindow: 300_000 }), validateSessionAgents({ agents }));
});

test("a board agent definition may carry autoCompactWindow; a bad value rejects the whole payload", () => {
  const ok = validateSessionAgents({ agents: { "vc-a": { description: "d", prompt: "p", autoCompactWindow: 1_000_000 } } });
  assert.equal(ok["vc-a"].autoCompactWindow, 1_000_000);
  for (const bad of [5, 2_000_000, "1000000", 1.5, null]) {
    assert.equal(validateSessionAgents({ agents: { "vc-a": { description: "d", prompt: "p", autoCompactWindow: bad } } }), null, String(bad));
  }
});
