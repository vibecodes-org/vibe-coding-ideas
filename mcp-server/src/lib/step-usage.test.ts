import { describe, it, expect, vi } from "vitest";
import { missingUsageError, recordStepUsage, stepUsageSchema, type StepUsage } from "./step-usage";
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

function ctxWith(insert: ReturnType<typeof vi.fn>, extra: Partial<McpContext> = {}): McpContext {
  return {
    supabase: { from: vi.fn(() => ({ insert })) } as unknown as McpContext["supabase"],
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
