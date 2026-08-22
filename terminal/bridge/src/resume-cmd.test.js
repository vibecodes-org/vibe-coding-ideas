// Unit tests for the exact-conversation Resume launch decision (rework 5).
// Run: cd terminal/bridge && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveClaudeLaunch } from "./resume-cmd.js";

const MINTED = "11111111-2222-3333-4444-555555555555";
const RESUME_ID = "99999999-8888-7777-6666-555555555555";

test("an explicit --cmd/BRIDGE_CMD override is never touched — no id minted or injected", () => {
  let minted = false;
  const result = resolveClaudeLaunch({
    explicitCmd: "bash",
    resumeId: RESUME_ID, // even if somehow also present, explicitCmd wins
    resume: true,
    mintId: () => {
      minted = true;
      return MINTED;
    },
  });
  assert.deepEqual(result, { cmd: "bash", conv: null });
  assert.equal(minted, false, "mintId must never be called on the explicit-cmd path");
});

test("a resumeId spawns `claude --resume <id>` and announces that SAME id", () => {
  const result = resolveClaudeLaunch({ resumeId: RESUME_ID, resume: false, mintId: () => MINTED });
  assert.deepEqual(result, { cmd: `claude --resume ${RESUME_ID}`, conv: RESUME_ID });
});

test("resumeId wins over the legacy resume flag when both are somehow set", () => {
  const result = resolveClaudeLaunch({ resumeId: RESUME_ID, resume: true, mintId: () => MINTED });
  assert.equal(result.cmd, `claude --resume ${RESUME_ID}`);
  assert.equal(result.conv, RESUME_ID);
});

test("the legacy resume flag (no tracked id) spawns `claude --continue` and announces nothing", () => {
  let minted = false;
  const result = resolveClaudeLaunch({
    resume: true,
    mintId: () => {
      minted = true;
      return MINTED;
    },
  });
  assert.deepEqual(result, { cmd: "claude --continue", conv: null });
  assert.equal(minted, false, "mintId must never be called on the legacy --continue path");
});

test("a brand-new session mints an id and spawns `claude --session-id <id>`", () => {
  const result = resolveClaudeLaunch({ mintId: () => MINTED });
  assert.deepEqual(result, { cmd: `claude --session-id ${MINTED}`, conv: MINTED });
});

test("falsy resumeId/resume (undefined, empty string, false) all fall through to the mint path", () => {
  for (const resumeId of [undefined, null, ""]) {
    for (const resume of [undefined, false]) {
      const result = resolveClaudeLaunch({ resumeId, resume, mintId: () => MINTED });
      assert.deepEqual(result, { cmd: `claude --session-id ${MINTED}`, conv: MINTED });
    }
  }
});

// ── terminal starting model (task c4ca2d95) — model only ever applies to a
// fresh mint (branch 4); branches 1-3 must never append --model. ───────────

test("a fresh mint with a model appends --model <value> after --session-id", () => {
  const result = resolveClaudeLaunch({ model: "opus", mintId: () => MINTED });
  assert.deepEqual(result, { cmd: `claude --session-id ${MINTED} --model opus`, conv: MINTED });
});

test("a fresh mint with no model spawns exactly today's command — no trailing space, no flag", () => {
  const result = resolveClaudeLaunch({ mintId: () => MINTED });
  assert.equal(result.cmd, `claude --session-id ${MINTED}`);
});

test("a novel/custom model id is carried verbatim", () => {
  const result = resolveClaudeLaunch({ model: "claude-opus-5-20260101", mintId: () => MINTED });
  assert.equal(result.cmd, `claude --session-id ${MINTED} --model claude-opus-5-20260101`);
});

test("resumeId NEVER receives --model, even if one is somehow passed (AC-8)", () => {
  const result = resolveClaudeLaunch({ resumeId: RESUME_ID, model: "opus", mintId: () => MINTED });
  assert.equal(result.cmd, `claude --resume ${RESUME_ID}`);
  assert.ok(!result.cmd.includes("--model"));
});

test("the legacy --continue resume NEVER receives --model, even if one is somehow passed (AC-8)", () => {
  const result = resolveClaudeLaunch({ resume: true, model: "opus", mintId: () => MINTED });
  assert.equal(result.cmd, "claude --continue");
  assert.ok(!result.cmd.includes("--model"));
});

test("an explicit --cmd override NEVER receives --model, even if one is somehow passed", () => {
  const result = resolveClaudeLaunch({ explicitCmd: "bash", model: "opus", mintId: () => MINTED });
  assert.deepEqual(result, { cmd: "bash", conv: null });
});
