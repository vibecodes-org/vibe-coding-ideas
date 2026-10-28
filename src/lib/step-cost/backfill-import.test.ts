import { describe, it, expect } from "vitest";
import { planImport, importKey } from "./backfill-import";
import { backfillFileSchema, type BackfillAttempt } from "./usage-schema";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const T = "2026-10-27T10:00:00.000Z";

const model = (name: string) => ({
  model: name, calls: 1, input_tokens: 1, output_tokens: 1, cache_read_tokens: 1, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0,
});
const attempt = (step_id: string, models: string[], extra: Partial<BackfillAttempt> = {}): BackfillAttempt => ({
  step_id, outcome: "completed", ended_at: T, models: models.map(model), ...extra,
});
const steps = new Map([[S1, { id: S1, run_id: "r", idea_id: "i" }]]);
const base = { steps, costedStepIds: new Set<string>(), existingKeys: new Set<string>() };

describe("planImport", () => {
  it("skips a normal attempt on a costed step", () => {
    const p = planImport([attempt(S1, ["opus"])], { ...base, costedStepIds: new Set([S1]) });
    expect(p).toMatchObject({ imported: 0, alreadyCosted: 1, unknownSteps: 0 });
    expect(p.rowsByStep.size).toBe(0);
  });

  it("stores an attempt that adds to existing on a costed step", () => {
    const p = planImport([attempt(S1, ["opus"], { adds_to_existing: true })], { ...base, costedStepIds: new Set([S1]) });
    expect(p).toMatchObject({ imported: 1, alreadyCosted: 0 });
    expect(p.rowsByStep.get(S1)).toEqual([expect.objectContaining({ model: "opus", created_at: T })]);
  });

  it("skips a flagged re-import when step, model and time already exist", () => {
    const existingKeys = new Set([importKey(S1, "opus", T)]);
    const p = planImport([attempt(S1, ["opus"], { adds_to_existing: true })], { ...base, costedStepIds: new Set([S1]), existingKeys });
    expect(p).toMatchObject({ imported: 0, alreadyCosted: 1 });
    expect(p.rowsByStep.size).toBe(0);
  });

  it("stores only the missing model on a partial match", () => {
    const existingKeys = new Set([importKey(S1, "opus", T)]);
    const p = planImport([attempt(S1, ["opus", "sonnet"], { adds_to_existing: true })], { ...base, costedStepIds: new Set([S1]), existingKeys });
    expect(p.imported).toBe(1);
    expect(p.rowsByStep.get(S1)?.map((r) => r.model)).toEqual(["sonnet"]);
  });

  it("matches the time to the millisecond, whatever the offset spelling", () => {
    const existingKeys = new Set([importKey(S1, "opus", "2026-10-27T11:00:00.000+01:00")]);
    const p = planImport([attempt(S1, ["opus"], { adds_to_existing: true })], { ...base, existingKeys });
    expect(p.alreadyCosted).toBe(1);
  });

  it("counts an unknown step", () => {
    const p = planImport([attempt(S2, ["opus"], { adds_to_existing: true })], base);
    expect(p).toMatchObject({ imported: 0, unknownSteps: 1 });
  });

  it("imports a normal attempt on an uncosted step", () => {
    expect(planImport([attempt(S1, ["opus"])], base).imported).toBe(1);
  });
});

describe("backfillFileSchema", () => {
  const file = (a: object) => ({ kind: "vibecodes-step-usage-backfill", version: 1, attempts: [a] });
  it("still accepts a file without the new field", () => {
    expect(backfillFileSchema.safeParse(file(attempt(S1, ["opus"]))).success).toBe(true);
  });
  it("accepts the flag", () => {
    expect(backfillFileSchema.safeParse(file(attempt(S1, ["opus"], { adds_to_existing: true }))).success).toBe(true);
  });
});
