import { describe, it, expect } from "vitest";
import {
  buildOwnAgentHooks,
  isNamedAgentFor,
  isReviewStep,
  parseAttestPayload,
  resolveRanInOwnAgent,
} from "./own-agent";
import {
  OWN_AGENT_HOOK_MATCHER as MJS_MATCHER,
  expectedOwnAgentHooks,
  hooksMatchOwnAgentShape,
} from "../../../terminal/shared/own-agent-hook.mjs";
import { OWN_AGENT_HOOK_MATCHER } from "./own-agent";

const STEP = "11111111-2222-4333-8444-555555555555";
const BOT = "37e8ffb2-3f88-49e5-9ab4-a516c1088f77";
const good = {
  hook_event_name: "PreToolUse",
  agent_type: "vc-atlas-37e8ffb2-standard",
  agent_id: "a1",
  tool_name: "mcp__vibecodes__save_step_output",
  tool_input: { step_id: STEP, work_token: "wt_abc" },
};

describe("parseAttestPayload", () => {
  it("accepts a subagent's save_step_output", () => {
    expect(parseAttestPayload(good)).toMatchObject({ agentType: "vc-atlas-37e8ffb2-standard", stepId: STEP, taskId: null });
  });
  it("accepts add_task_comment with a task id", () => {
    const r = parseAttestPayload({ ...good, tool_name: "mcp__x__add_task_comment", tool_input: { task_id: STEP, work_token: "wt_a" } });
    expect(r).toMatchObject({ taskId: STEP, stepId: null });
  });
  it.each([
    ["no agent_type (main thread)", { ...good, agent_type: undefined }],
    ["other event", { ...good, hook_event_name: "PostToolUse" }],
    ["other tool", { ...good, tool_name: "mcp__vibecodes__complete_step" }],
    ["claim token", { ...good, tool_input: { step_id: STEP, work_token: "ct_abc" } }],
    ["no token", { ...good, tool_input: { step_id: STEP } }],
    ["no ids", { ...good, tool_input: { work_token: "wt_a" } }],
    ["bad id", { ...good, tool_input: { step_id: "nope", work_token: "wt_a" } }],
    ["array", []],
    ["null", null],
  ])("rejects %s", (_n, body) => {
    expect(parseAttestPayload(body)).toBeNull();
  });
});

describe("resolveRanInOwnAgent", () => {
  const base = { agent: "claude" as const, botId: BOT, nativeNamed: true };
  it("codex can't be confirmed", () => {
    expect(resolveRanInOwnAgent({ ...base, agent: "codex", attestedType: "vc-atlas-37e8ffb2" })).toBe("cant_confirm");
  });
  it("no bot or no named agent can't be confirmed", () => {
    expect(resolveRanInOwnAgent({ ...base, botId: null, attestedType: null })).toBe("cant_confirm");
    expect(resolveRanInOwnAgent({ ...base, nativeNamed: false, attestedType: null })).toBe("cant_confirm");
  });
  it("own agent confirms, another agent differs, none is not confirmed", () => {
    expect(resolveRanInOwnAgent({ ...base, attestedType: "vc-atlas-37e8ffb2-standard" })).toBe("confirmed");
    expect(resolveRanInOwnAgent({ ...base, attestedType: "general-purpose" })).toBe("other_agent");
    expect(resolveRanInOwnAgent({ ...base, attestedType: "vc-lens-87e09eb1-frontier" })).toBe("other_agent");
    expect(resolveRanInOwnAgent({ ...base, attestedType: null })).toBe("not_confirmed");
  });
});

describe("isReviewStep / isNamedAgentFor", () => {
  it("matches review, QA, test and audit roles only", () => {
    for (const r of ["Code Reviewer", "QA Engineer", "Tester", "Security Auditor", "Test Lead"]) expect(isReviewStep(r)).toBe(true);
    for (const r of ["Planner", "Full Stack Engineer", "Product Owner", null, ""]) expect(isReviewStep(r)).toBe(false);
  });
  it("names a bot's own agent", () => {
    expect(isNamedAgentFor("vc-atlas-37e8ffb2", BOT)).toBe(true);
    expect(isNamedAgentFor("general-purpose", BOT)).toBe(false);
  });
});

describe("hook shape drift between the app and the bridge", () => {
  it("uses one matcher", () => expect(MJS_MATCHER).toBe(OWN_AGENT_HOOK_MATCHER));
  it("builds identical hooks", () => {
    expect(buildOwnAgentHooks("https://vibecodes.co.uk/")).toEqual(expectedOwnAgentHooks("https://vibecodes.co.uk"));
  });
  it("the bridge check accepts the app's hooks and nothing else", () => {
    const o = "https://vibecodes.co.uk";
    const ok = buildOwnAgentHooks(o);
    expect(hooksMatchOwnAgentShape(ok, o)).toBe(true);
    expect(hooksMatchOwnAgentShape(ok, "https://evil.example")).toBe(false);
    const cmd = JSON.parse(JSON.stringify(ok));
    cmd.PreToolUse[0].hooks[0] = { type: "command", command: "rm -rf ~" };
    expect(hooksMatchOwnAgentShape(cmd, o)).toBe(false);
    const extra = JSON.parse(JSON.stringify(ok));
    extra.PreToolUse[0].hooks[0].headers = { a: "b" };
    expect(hooksMatchOwnAgentShape(extra, o)).toBe(false);
    const slow = JSON.parse(JSON.stringify(ok));
    slow.PreToolUse[0].hooks[0].timeout = 60;
    expect(hooksMatchOwnAgentShape(slow, o)).toBe(false);
    const matcher = JSON.parse(JSON.stringify(ok));
    matcher.PreToolUse[0].matcher = ".*";
    expect(hooksMatchOwnAgentShape(matcher, o)).toBe(false);
    expect(hooksMatchOwnAgentShape({ ...ok, PostToolUse: [] }, o)).toBe(false);
  });
});
