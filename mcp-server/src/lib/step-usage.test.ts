import { describe, it, expect, vi } from "vitest";
import { floorNegativeTokens, missingUsageError, noScriptRetryMessage, recordStepUsage, stepUsageSchema, type StepUsage } from "./step-usage";
import { noScriptMarker, stepUsageCommand } from "../../../src/lib/step-cost/usage-command";
import type { McpContext } from "../context";
import { logger } from "../../../src/lib/logger";

const STEP = { id: "11111111-1111-4111-8111-111111111111", run_id: "22222222-2222-4222-8222-222222222222", idea_id: "33333333-3333-4333-8333-333333333333" };
const USAGE: StepUsage = {
  models: [
    { model: "claude-opus-5-5", calls: 9, input_tokens: 18, output_tokens: 2447, cache_read_tokens: 724043, cache_write_5m_tokens: 110834, cache_write_1h_tokens: 0 },
    { model: "claude-haiku-5-5", calls: 1, input_tokens: 2, output_tokens: 10, cache_read_tokens: 0, cache_write_5m_tokens: 900, cache_write_1h_tokens: 0 },
  ],
  output_estimated: true,
};

function ctxWith(
  insert: ReturnType<typeof vi.fn>,
  extra: Partial<McpContext> = {},
  unmeasured: ReturnType<typeof vi.fn> = vi.fn(() => Promise.resolve({ error: null }))
): McpContext {
  return {
    supabase: {
      from: vi.fn((table: string) => ({ insert: table === "workflow_step_unmeasured" ? unmeasured : insert })),
    } as unknown as McpContext["supabase"],
    userId: "bot-user",
    ...extra,
  };
}

describe("stepUsageSchema", () => {
  it("accepts exactly what the usage command prints", () => {
    const line = '{"models":[{"model":"claude-sonnet-5-5","calls":1,"input_tokens":2,"output_tokens":24,"cache_read_tokens":0,"cache_write_5m_tokens":72216,"cache_write_1h_tokens":0}],"output_estimated":true}';
    expect(stepUsageSchema.parse(JSON.parse(line)).models[0].cache_write_5m_tokens).toBe(72216);
  });

  it("rejects negative, fractional and missing counts, and an empty model list", () => {
    const m = USAGE.models[0];
    expect(stepUsageSchema.safeParse({ models: [{ ...m, input_tokens: -1 }] }).success).toBe(false);
    expect(stepUsageSchema.safeParse({ models: [{ ...m, output_tokens: 1.5 }] }).success).toBe(false);
    const { cache_read_tokens: _omit, ...missing } = m;
    expect(stepUsageSchema.safeParse({ models: [missing] }).success).toBe(false);
    expect(stepUsageSchema.safeParse({ models: [] }).success).toBe(false);
  });
});

describe("recordStepUsage", () => {
  it("writes one row per model, attributed to the human behind the connection", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    await recordStepUsage(ctxWith(insert, { ownerUserId: "human" }), STEP, "completed", USAGE);
    expect(insert).toHaveBeenCalledTimes(1);
    const rows = (insert.mock.calls[0] as unknown[])[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      step_id: STEP.id, run_id: STEP.run_id, idea_id: STEP.idea_id, outcome: "completed",
      model: "claude-opus-5-5", calls: 9, input_tokens: 18, output_tokens: 2447,
      cache_read_tokens: 724043, cache_write_5m_tokens: 110834, cache_write_1h_tokens: 0,
      output_estimated: true, reported_by: "human",
    });
  });

  it("accepts the command's line passed as a string", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    await recordStepUsage(ctxWith(insert), STEP, "completed", JSON.stringify(USAGE));
    expect(((insert.mock.calls[0] as unknown[])[0] as unknown[])).toHaveLength(2);
  });

  it("skips, without throwing, anything that isn't a usage report", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    for (const bad of [{ models: [], output_estimated: true }, "NO_TRANSCRIPT a1", "{not json", 42, { models: [{ model: "x" }] }]) {
      await expect(recordStepUsage(ctxWith(insert), STEP, "completed", bad)).resolves.toBeUndefined();
    }
    expect(insert).not.toHaveBeenCalled();
  });

  it("does nothing when no usage was reported", async () => {
    const insert = vi.fn();
    await recordStepUsage(ctxWith(insert), STEP, "failed", undefined);
    expect(insert).not.toHaveBeenCalled();
  });

  it("never throws when the write fails or throws", async () => {
    await expect(recordStepUsage(ctxWith(vi.fn(() => Promise.resolve({ error: { message: "relation does not exist" } }))), STEP, "completed", USAGE)).resolves.toBeUndefined();
    await expect(recordStepUsage(ctxWith(vi.fn(() => { throw new Error("boom"); })), STEP, "completed", USAGE)).resolves.toBeUndefined();
  });
});

// Card 1117ac6b: a session that skipped the usage command finished ~55 steps
// with no cost, and complete_step accepted it silently.
describe("missingUsageError", () => {
  const CT = "ct_abc";
  const MARK = "vcu_0123456789abcdef01234567";
  it("answers a marker-carrying no-script line with the full command, once, and no wording about saving anything", () => {
    const msg = missingUsageError({ claim_token: CT, usage: `NO_TRANSCRIPT no-script ${MARK}` });
    expect(msg).toBe(noScriptRetryMessage(MARK));
    expect(msg).toContain(stepUsageCommand(MARK));
    expect(msg).toContain("AGENT_ID");
    expect(msg).toContain("usage_unavailable and the reason instead of usage");
    expect(msg).toMatch(/claim_token is still valid/);
    const prose = msg!.replace(stepUsageCommand(MARK), "");
    expect(prose).not.toMatch(/save|write|install/i);
    // The command itself never produces a line that would be refused again.
    expect(noScriptMarker(msg!)).toBeNull();
  });

  it("leaves the older marker-less no-script line, other NO_TRANSCRIPT lines, Codex and no-claim calls alone", () => {
    expect(missingUsageError({ claim_token: CT, usage: "NO_TRANSCRIPT no-script" })).toBeNull();
    expect(missingUsageError({ claim_token: CT, usage: "NO_TRANSCRIPT a1b2" })).toBeNull();
    expect(missingUsageError({ claim_token: CT, agent: "codex", usage: `NO_TRANSCRIPT no-script ${MARK}` })).toBeNull();
    expect(missingUsageError({ usage: `NO_TRANSCRIPT no-script ${MARK}` })).toBeNull();
  });

  it("refuses a Claude-claimed attempt that reports no usage at all", () => {
    for (const usage of [undefined, null, "", "   "]) {
      expect(missingUsageError({ claim_token: CT, usage })).toMatch(/usage_command/);
    }
    expect(missingUsageError({ claim_token: CT, agent: "claude" })).toMatch(/Nothing was changed/);
  });

  it("accepts any usage the command printed, NO_TRANSCRIPT included", () => {
    expect(missingUsageError({ claim_token: CT, usage: USAGE })).toBeNull();
    expect(missingUsageError({ claim_token: CT, usage: "NO_TRANSCRIPT abc" })).toBeNull();
    expect(missingUsageError({ claim_token: CT, usage: "{oops" })).toBeNull();
  });

  it("accepts an explicit reason when the command could not run, so a step is never trapped", () => {
    expect(missingUsageError({ claim_token: CT, usage_unavailable: "no shell in this client" })).toBeNull();
    expect(missingUsageError({ claim_token: CT, usage_unavailable: "  " })).toMatch(/usage_command/);
  });

  it("does not apply to Codex runs or to a human rejecting an approval gate (no claim token)", () => {
    expect(missingUsageError({ claim_token: CT, agent: "codex" })).toBeNull();
    expect(missingUsageError({})).toBeNull();
    expect(missingUsageError({ claim_token: "" })).toBeNull();
  });
});

// Card 1117ac6b review: a skipped cost must show in production logs.
describe("recordStepUsage — skipped costs are logged at warn", () => {
  it("warns with the step id for a NO_TRANSCRIPT line and for a usage_unavailable reason, and writes nothing", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const insert = vi.fn();
      await recordStepUsage(ctxWith(insert), STEP, "completed", "NO_TRANSCRIPT abc");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("NO_TRANSCRIPT"), expect.objectContaining({ stepId: STEP.id }));
      warn.mockClear();
      await recordStepUsage(ctxWith(insert), STEP, "completed", undefined, "client has no shell");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("unavailable"), expect.objectContaining({ stepId: STEP.id, reason: "client has no shell" }));
      expect(insert).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

// Card 1117ac6b stage 2: the reason is kept, not only logged.
describe("recordStepUsage — lasting record when the cost couldn't be measured", () => {
  const quiet = () => vi.spyOn(logger, "warn").mockImplementation(() => {});
  async function run(raw: unknown, reason?: string | null, agent: "claude" | "codex" = "claude", extra: Partial<McpContext> = {}) {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    const unmeasured = vi.fn(() => Promise.resolve({ error: null }));
    const warn = quiet();
    try {
      await recordStepUsage(ctxWith(insert, extra, unmeasured), STEP, "completed", raw, reason, agent);
    } finally {
      warn.mockRestore();
    }
    return { insert, unmeasured, row: (unmeasured.mock.calls[0] as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined };
  }

  it("usage_unavailable stores kind unavailable with the reason, outcome, step, run, board and reporter", async () => {
    const { row, insert, unmeasured } = await run(undefined, "  client has no shell ", "claude", { ownerUserId: "human" });
    expect(unmeasured).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
    expect(row).toEqual({
      step_id: STEP.id, run_id: STEP.run_id, idea_id: STEP.idea_id, outcome: "completed",
      kind: "unavailable", reason: "client has no shell", reported_by: "human",
    });
  });

  it("NO_TRANSCRIPT: no-script, an agent id, or nothing", async () => {
    expect((await run("NO_TRANSCRIPT no-script")).row).toMatchObject({ kind: "no_transcript", reason: "no-script" });
    expect((await run("NO_TRANSCRIPT a1b2c3")).row).toMatchObject({ kind: "no_transcript", reason: "a1b2c3" });
    expect((await run("NO_TRANSCRIPT")).row).toMatchObject({ kind: "no_transcript", reason: null });
  });

  it("a line that isn't JSON, or has the wrong shape, is unreadable", async () => {
    expect((await run("{not json")).row).toMatchObject({ kind: "unreadable", reason: "not JSON" });
    const wrong = await run({ models: [{ model: "x" }] });
    expect(wrong.row).toMatchObject({ kind: "unreadable" });
    expect(typeof wrong.row!.reason).toBe("string");
    expect(wrong.insert).not.toHaveBeenCalled();
  });

  it("a negative token count is floored at zero and the cost is stored, not dropped", async () => {
    const neg = { models: [{ ...USAGE.models[0], cache_write_5m_tokens: -789 }], output_estimated: true };
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    try {
      const { insert, unmeasured } = await run(neg);
      expect(unmeasured).not.toHaveBeenCalled();
      expect(((insert.mock.calls[0] as unknown[])[0] as Record<string, unknown>[])[0]).toMatchObject({ cache_write_5m_tokens: 0, input_tokens: 18 });
      expect(info).toHaveBeenCalledWith(expect.stringContaining("floored"), expect.objectContaining({ stepId: STEP.id }));
      expect((await run(JSON.stringify(neg))).insert).toHaveBeenCalledTimes(1);
    } finally {
      info.mockRestore();
    }
    expect(floorNegativeTokens(USAGE)).toBe(USAGE);
    expect((await run({ models: [{ ...USAGE.models[0], input_tokens: 1.5 }] })).row).toMatchObject({ kind: "unreadable" });
  });

  it("the no-script line plus a usage_unavailable reason is accepted and recorded as unavailable with that reason", async () => {
    const line = "NO_TRANSCRIPT no-script vcu_0123456789abcdef01234567";
    expect(missingUsageError({ claim_token: "ct_abc", usage: line, usage_unavailable: "client has no shell" })).toBeNull();
    const { row, insert } = await run(line, "client has no shell");
    expect(row).toMatchObject({ kind: "unavailable", reason: "client has no shell" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("a marker-carrying no-script line that gets past the refusal is stored as the plain no-script reason", async () => {
    expect((await run("NO_TRANSCRIPT no-script vcu_0123456789abcdef01234567")).row).toMatchObject({ kind: "no_transcript", reason: "no-script" });
  });

  it("valid usage writes cost rows and no unmeasured record", async () => {
    const { insert, unmeasured } = await run(USAGE);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(unmeasured).not.toHaveBeenCalled();
  });

  it("a Codex step with no usage is recorded as codex", async () => {
    expect((await run(undefined, null, "codex")).row).toMatchObject({ kind: "codex", reason: null });
  });

  it("nothing is recorded when nothing was reported and no reason given (no claim token)", async () => {
    expect((await run(undefined)).unmeasured).not.toHaveBeenCalled();
  });

  it("cuts a long reason to 300 characters", async () => {
    expect(((await run(undefined, "x".repeat(500))).row!.reason as string).length).toBe(300);
  });

  it("never throws when the record can't be written (error, throw, table missing)", async () => {
    const warn = quiet();
    try {
      const insert = vi.fn();
      for (const u of [
        vi.fn(() => Promise.resolve({ error: { message: "relation does not exist" } })),
        vi.fn(() => { throw new Error("boom"); }),
      ]) {
        await expect(recordStepUsage(ctxWith(insert, {}, u), STEP, "failed", "NO_TRANSCRIPT")).resolves.toBeUndefined();
      }
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("unmeasured write"), expect.objectContaining({ stepId: STEP.id }));
    } finally {
      warn.mockRestore();
    }
  });
});
