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

// ── terminal auto-accept mode (task d3de150c) — permissionMode only ever
// applies to a fresh mint (branch 4); branches 1-3 must never append
// --permission-mode, and only the literal "auto" is ever appended. ──

test("a fresh mint with permissionMode auto appends --permission-mode auto", () => {
  const result = resolveClaudeLaunch({ permissionMode: "auto", mintId: () => MINTED });
  assert.deepEqual(result, { cmd: `claude --session-id ${MINTED} --permission-mode auto`, conv: MINTED });
});

test("a fresh mint with no permissionMode spawns exactly today's command — no trailing space, no flag", () => {
  const result = resolveClaudeLaunch({ mintId: () => MINTED });
  assert.equal(result.cmd, `claude --session-id ${MINTED}`);
});

test("model and permissionMode append together, model first, on a fresh mint", () => {
  const result = resolveClaudeLaunch({ model: "opus", permissionMode: "auto", mintId: () => MINTED });
  assert.equal(result.cmd, `claude --session-id ${MINTED} --model opus --permission-mode auto`);
});

test("hard safety requirement: any permissionMode value other than the literal 'auto' is dropped, never appended", () => {
  for (const bad of ["bypassPermissions", "plan", "default", "AcceptEdits", " auto", ""]) {
    const result = resolveClaudeLaunch({ permissionMode: bad, mintId: () => MINTED });
    assert.equal(result.cmd, `claude --session-id ${MINTED}`, `permissionMode=${JSON.stringify(bad)} must be dropped`);
    assert.ok(!result.cmd.includes("--permission-mode"));
  }
});

test("resumeId NEVER receives --permission-mode, even if one is somehow passed (fresh-launch-only rule)", () => {
  const result = resolveClaudeLaunch({ resumeId: RESUME_ID, permissionMode: "auto", mintId: () => MINTED });
  assert.equal(result.cmd, `claude --resume ${RESUME_ID}`);
  assert.ok(!result.cmd.includes("--permission-mode"));
});

test("the legacy --continue resume NEVER receives --permission-mode, even if one is somehow passed", () => {
  const result = resolveClaudeLaunch({ resume: true, permissionMode: "auto", mintId: () => MINTED });
  assert.equal(result.cmd, "claude --continue");
  assert.ok(!result.cmd.includes("--permission-mode"));
});

test("an explicit --cmd override NEVER receives --permission-mode, even if one is somehow passed", () => {
  const result = resolveClaudeLaunch({ explicitCmd: "bash", permissionMode: "auto", mintId: () => MINTED });
  assert.deepEqual(result, { cmd: "bash", conv: null });
});

// ── concurrent-terminal isolation (native --worktree flag) — worktree only
// ever applies to a fresh mint (branch 4); branches 1-3 must never append
// --worktree, and it reuses the SAME id minted for --session-id. ──

test("a fresh mint with worktree true appends --worktree <the minted id> after model/permission-mode", () => {
  const result = resolveClaudeLaunch({ worktree: true, mintId: () => MINTED });
  assert.deepEqual(result, { cmd: `claude --session-id ${MINTED} --worktree ${MINTED}`, conv: MINTED });
});

test("a fresh mint with worktree false/undefined spawns exactly today's command — no trailing space, no flag", () => {
  for (const worktree of [false, undefined]) {
    const result = resolveClaudeLaunch({ worktree, mintId: () => MINTED });
    assert.equal(result.cmd, `claude --session-id ${MINTED}`);
    assert.ok(!result.cmd.includes("--worktree"));
  }
});

test("model, permissionMode and worktree all append together, in that order, on a fresh mint", () => {
  const result = resolveClaudeLaunch({
    model: "opus",
    permissionMode: "auto",
    worktree: true,
    mintId: () => MINTED,
  });
  assert.equal(
    result.cmd,
    `claude --session-id ${MINTED} --model opus --permission-mode auto --worktree ${MINTED}`
  );
});

test("resumeId NEVER receives --worktree, even if one is somehow passed — Claude Code's own --resume already reopens the original worktree", () => {
  const result = resolveClaudeLaunch({ resumeId: RESUME_ID, worktree: true, mintId: () => MINTED });
  assert.equal(result.cmd, `claude --resume ${RESUME_ID}`);
  assert.ok(!result.cmd.includes("--worktree"));
});

test("the legacy --continue resume NEVER receives --worktree, even if one is somehow passed", () => {
  const result = resolveClaudeLaunch({ resume: true, worktree: true, mintId: () => MINTED });
  assert.equal(result.cmd, "claude --continue");
  assert.ok(!result.cmd.includes("--worktree"));
});

test("an explicit --cmd override NEVER receives --worktree, even if one is somehow passed", () => {
  const result = resolveClaudeLaunch({ explicitCmd: "bash", worktree: true, mintId: () => MINTED });
  assert.deepEqual(result, { cmd: "bash", conv: null });
});
