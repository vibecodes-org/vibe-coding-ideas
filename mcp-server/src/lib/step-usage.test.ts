import { describe, it, expect, vi } from "vitest";
import { recordStepUsage, stepUsageSchema, type StepUsage } from "./step-usage";
import type { McpContext } from "../context";

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
