// @vitest-environment node
import { describe, it, expect } from "vitest";
import { backfillSession, findAttempts, readCall, totalCalls } from "./step-usage-backfill.mjs";

// Lines shaped like Claude Code 2.1.300's session transcript.
let clock = 0;
const at = () => `2026-10-15T10:${String(clock++).padStart(2, "0")}:00.000Z`;

function call(id, { model = "claude-opus-5-5", read = 1000, text = "x".repeat(35), uses = [], sidechain = false, time } = {}) {
  return JSON.stringify({
    parentUuid: "p", isSidechain: sidechain,
    message: {
      model, id, type: "message", role: "assistant",
      content: [{ type: "text", text }, ...uses.map(([useId, name, input]) => ({ type: "tool_use", id: useId, name, input }))],
      stop_reason: null,
      usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: read, output_tokens: 1 },
    },
    type: "assistant", timestamp: time ?? at(),
  });
}
function result(useId, payload, { isError = false, toolUseResult } = {}) {
  return JSON.stringify({
    isSidechain: false, type: "user", timestamp: at(),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: useId, is_error: isError, content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) }] }] },
    ...(toolUseResult ? { toolUseResult } : {}),
  });
}
const CLAIM = "mcp__VibeCodes__claim_next_step";
const COMPLETE = "mcp__VibeCodes__complete_step";
const FAIL = "mcp__VibeCodes__fail_step";
const STEP = "11111111-1111-4111-8111-111111111111";
const STEP2 = "22222222-2222-4222-8222-222222222222";
const claimed = (step, token) => ({ done: false, step: { id: step, status: "in_progress" }, claim_token: token });

/** One subagent step, then one the session did itself, then a step it failed. */
function session() {
  clock = 0;
  return [
    call("msg_0", { read: 999_000, uses: [["u1", CLAIM, { task_id: "t" }]] }),
    result("u1", claimed(STEP, "ct_a")),
    call("msg_1", { uses: [["u2", "Agent", { prompt: "do it" }]] }),
    result("u2", "Async agent launched successfully.\nagentId: agentA (internal ID)", { toolUseResult: { agentId: "agentA" } }),
    call("msg_2", { uses: [["u3", COMPLETE, { step_id: STEP, claim_token: "ct_a" }]] }),
    result("u3", "Error: claim token is invalid", { isError: true }),
    call("msg_3", { uses: [["u4", COMPLETE, { step_id: STEP, claim_token: "ct_a" }]] }),
    result("u4", { step: { id: STEP, status: "awaiting_approval" } }),
    call("msg_4", { read: 777_000 }),
    call("msg_5", { uses: [["u5", CLAIM, { task_id: "t" }]] }),
    result("u5", claimed(STEP2, "ct_b")),
    call("msg_6", { read: 5000 }),
    call("msg_7", { uses: [["u6", FAIL, { step_id: STEP2, claim_token: "ct_b" }]] }),
    result("u6", { step: { id: STEP2, status: "failed" } }),
    call("msg_8", { uses: [["u7", CLAIM, { task_id: "t" }]] }),
    result("u7", { done: true, message: "No pending steps" }),
  ];
}

describe("findAttempts", () => {
  it("pairs each claim with the completion that used its token, and records the subagents in between", () => {
    const attempts = findAttempts(session());
    expect(attempts.map((a) => [a.stepId, a.outcome, a.agentIds])).toEqual([
      [STEP, "awaiting_approval", ["agentA"]],
      [STEP2, "failed", []],
    ]);
    // A completion the server refused doesn't close the attempt.
    expect(attempts[0].to).toBe(6);
  });

  it("leaves out a claim that never finished", () => {
    clock = 0;
    const lines = [call("msg_0", { uses: [["u1", CLAIM, {}]] }), result("u1", claimed(STEP, "ct_a")), call("msg_1")];
    expect(findAttempts(lines)).toEqual([]);
  });
});

describe("backfillSession", () => {
  const agent = [
    call("msg_a1", { model: "claude-sonnet-5-5", read: 300, sidechain: true, time: "2026-10-15T10:02:30.000Z" }),
    // After the step closed: a later SendMessage to the same agent isn't this step's cost.
    call("msg_a2", { model: "claude-sonnet-5-5", read: 900_000, sidechain: true, time: "2026-10-15T11:00:00.000Z" }),
  ];

  it("costs the session's own calls from the claim to the completion, plus the subagent's up to then", () => {
    const { attempts, skipped } = backfillSession(session(), (id) => (id === "agentA" ? agent : null));
    expect(skipped).toBe(0);
    const [first, second] = attempts;
    expect(first).toMatchObject({ step_id: STEP, outcome: "awaiting_approval", output_estimated: true });
    const byModel = Object.fromEntries(first.models.map((m) => [m.model, m]));
    // msg_1, msg_2 and msg_3; not the claim call before (999,000) or the call after (777,000).
    expect(byModel["claude-opus-5-5"]).toMatchObject({ calls: 3, cache_read_tokens: 3000 });
    expect(byModel["claude-sonnet-5-5"]).toMatchObject({ calls: 1, cache_read_tokens: 300 });
    // The step the session did itself: msg_6 and the fail_step call.
    expect(second).toMatchObject({ step_id: STEP2, outcome: "failed" });
    expect(second.models).toEqual([expect.objectContaining({ model: "claude-opus-5-5", calls: 2, cache_read_tokens: 6000 })]);
  });

  it("splits the session's own calls across attempts open at the same time (stage 16)", () => {
    clock = 0;
    const lines = [
      call("msg_0", { uses: [["u1", CLAIM, {}]] }),
      result("u1", claimed(STEP, "ct_a")),
      call("msg_1", { read: 1000 }),
      call("msg_2", { uses: [["u2", CLAIM, {}]] , read: 2000 }),
      result("u2", claimed(STEP2, "ct_b")),
      call("msg_3", { read: 4000 }),
      call("msg_4", { uses: [["u3", COMPLETE, { step_id: STEP2, claim_token: "ct_b" }]], read: 600 }),
      result("u3", { step: { id: STEP2, status: "completed" } }),
      call("msg_5", { uses: [["u4", COMPLETE, { step_id: STEP, claim_token: "ct_a" }]], read: 8000 }),
      result("u4", { step: { id: STEP, status: "completed" } }),
      call("msg_6", { uses: [["u5", CLAIM, {}]] }),
      result("u5", claimed("33333333-3333-4333-8333-333333333333", "ct_c")),
      call("msg_7", { read: 50_000 }),
    ];
    const { attempts } = backfillSession(lines, () => null);
    const read = Object.fromEntries(attempts.map((a) => [a.step_id, a.models[0].cache_read_tokens]));
    // STEP: 1000 + 2000 alone, 4000 + 600 shared, 8000 alone. STEP2: half of 4000 + 600.
    expect(read[STEP]).toBe(1000 + 2000 + 2300 + 8000);
    expect(read[STEP2]).toBe(2300);
  });

  it("leaves out a resumed subagent's rounds from before the claim (card 1117ac6b, stage 5)", () => {
    const twoRounds = [
      call("msg_r1", { model: "claude-sonnet-5-5", read: 700, sidechain: true, time: "2026-10-15T09:00:00.000Z" }),
      ...agent,
    ];
    const { attempts } = backfillSession(session(), (id) => (id === "agentA" ? twoRounds : null));
    const sonnet = attempts[0].models.find((m) => m.model === "claude-sonnet-5-5");
    expect(sonnet).toMatchObject({ calls: 1, cache_read_tokens: 300 });
  });

  it("skips an attempt whose subagent transcript is gone rather than under-counting it", () => {
    const { attempts, skipped } = backfillSession(session(), () => null);
    expect(skipped).toBe(1);
    expect(attempts.map((a) => a.step_id)).toEqual([STEP2]);
  });
});

describe("session share only (stage 3)", () => {
  it("counts only the session's own calls, never reads a subagent, and marks the attempt as an addition", () => {
    let reads = 0;
    const { attempts, skipped } = backfillSession(
      session(),
      () => {
        reads++;
        return null;
      },
      { sessionShareOnly: true }
    );
    expect(reads).toBe(0);
    expect(skipped).toBe(0);
    expect(attempts.map((a) => a.step_id)).toEqual([STEP, STEP2]);
    expect(attempts.every((a) => a.adds_to_existing === true)).toBe(true);
    expect(attempts[0].models).toEqual([expect.objectContaining({ model: "claude-opus-5-5", calls: 3, cache_read_tokens: 3000 })]);
  });

  it("uses the same split as the normal mode", () => {
    const lines = session();
    const normal = backfillSession(lines, () => []).attempts;
    const share = backfillSession(lines, () => null, { sessionShareOnly: true }).attempts;
    expect(share.map((a) => a.models)).toEqual(normal.map((a) => a.models.filter((m) => m.model.includes("opus"))));
  });

  it("leaves the flag off in the normal mode", () => {
    const { attempts } = backfillSession(session(), () => []);
    expect(attempts.some((a) => "adds_to_existing" in a)).toBe(false);
  });

  it("takes the nearest earlier timestamp when the completion line has none", () => {
    clock = 0;
    const done = result("u2", { step: { id: STEP, status: "completed" } });
    const noTime = JSON.stringify({ ...JSON.parse(done), timestamp: undefined });
    const lines = [
      call("msg_0", { uses: [["u1", CLAIM, {}]] }),
      result("u1", claimed(STEP, "ct_a")),
      call("msg_1", { uses: [["u2", COMPLETE, { step_id: STEP, claim_token: "ct_a" }]], time: "2026-10-15T10:30:00.000Z" }),
      noTime,
    ];
    expect(lines[3]).not.toContain("timestamp");
    const [a] = backfillSession(lines, () => null).attempts;
    expect(a.ended_at).toBe("2026-10-15T10:30:00.000Z");
  });
});

describe("readCall", () => {
  it("never reports a negative 5-minute cache write when the 1-hour figure is larger than the total", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-5-5", id: "msg_odd", content: [{ type: "text", text: "x" }], stop_reason: null,
        usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 5, output_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 789 } },
      },
    });
    const c = readCall(line);
    expect(c.write1h).toBe(789);
    expect(c.write5m).toBe(0);
  });
});

describe("totalCalls", () => {
  it("counts a call once across its content-block lines and estimates output from what was written", () => {
    const line = (text, read) => call("msg_1", { text, read });
    const [m] = totalCalls([line("y".repeat(350), 10), line("y".repeat(350), 20)]);
    expect(m).toMatchObject({ calls: 1, cache_read_tokens: 20 });
    expect(m.output_tokens).toBeGreaterThan(190);
    expect(m.output_tokens).toBeLessThan(230);
  });
});
