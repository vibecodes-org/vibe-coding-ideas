import type { Database } from "@/types/database";
import type { BackfillAttempt } from "./usage-schema";

// Decides which rows a step cost backfill file adds (the admin report's
// "Import past cost"). Pure, so the rules are testable without a database.
//
// A normal attempt is skipped when its step already has any cost. An attempt
// marked adds_to_existing (scripts/step-usage-backfill.mjs --session-share) is
// stored even then, but each of its model entries is skipped when a row with
// the same step, model and time already exists, so importing it twice
// changes nothing.

export type UsageInsert = Database["public"]["Tables"]["workflow_step_usage"]["Insert"];

export interface StepRef {
  id: string;
  run_id: string | null;
  idea_id: string;
}

export interface ImportPlan {
  rowsByStep: Map<string, UsageInsert[]>;
  imported: number;
  alreadyCosted: number;
  unknownSteps: number;
}

/** Key of a stored row: step, model and creation time to the millisecond. */
export function importKey(stepId: string, model: string, time: string | number): string {
  const ms = typeof time === "number" ? time : Date.parse(time);
  return `${stepId}|${model}|${ms}`;
}

export function planImport(
  attempts: BackfillAttempt[],
  ctx: { steps: Map<string, StepRef>; costedStepIds: Set<string>; existingKeys: Set<string>; reportedBy?: string }
): ImportPlan {
  const plan: ImportPlan = { rowsByStep: new Map(), imported: 0, alreadyCosted: 0, unknownSteps: 0 };
  for (const a of attempts) {
    const step = ctx.steps.get(a.step_id);
    if (!step) {
      plan.unknownSteps++;
      continue;
    }
    const adds = a.adds_to_existing === true;
    if (!adds && ctx.costedStepIds.has(a.step_id)) {
      plan.alreadyCosted++;
      continue;
    }
    const models = adds ? a.models.filter((m) => !ctx.existingKeys.has(importKey(step.id, m.model, a.ended_at))) : a.models;
    if (models.length === 0) {
      plan.alreadyCosted++;
      continue;
    }
    plan.imported++;
    const rows = plan.rowsByStep.get(step.id) ?? [];
    plan.rowsByStep.set(step.id, rows);
    for (const m of models) {
      rows.push({
        step_id: step.id,
        run_id: step.run_id,
        idea_id: step.idea_id,
        outcome: a.outcome,
        model: m.model,
        calls: m.calls ?? 0,
        input_tokens: m.input_tokens,
        output_tokens: m.output_tokens,
        cache_read_tokens: m.cache_read_tokens,
        cache_write_5m_tokens: m.cache_write_5m_tokens,
        cache_write_1h_tokens: m.cache_write_1h_tokens,
        output_estimated: a.output_estimated ?? true,
        reported_by: ctx.reportedBy ?? null,
        created_at: a.ended_at,
      });
    }
  }
  return plan;
}
