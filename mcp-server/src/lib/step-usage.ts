import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import { stepUsageSchema } from "../../../src/lib/step-cost/usage-schema";
import type { McpContext } from "../context";

// Card ba37039b: the token totals a session reports for one step attempt.
// The schema lives in src/lib/step-cost/usage-schema.ts, shared with the
// admin report's import of past runs.

export { stepUsageSchema, type StepUsage } from "../../../src/lib/step-cost/usage-schema";

/**
 * The tool parameter. Deliberately accepts anything: a malformed or empty
 * usage report must never make complete_step / fail_step fail. It is
 * checked against stepUsageSchema when stored, and skipped if it doesn't fit.
 */
export const stepUsageParam = z
  .unknown()
  .optional()
  .describe(
    "Optional: the step's token use, for the admin step report's cost column. When the step's work is done, " +
      "run the usage_command from claim_next_step (AGENT_ID replaced by the agentId of each subagent that did the " +
      "work, or left as it is if you did the work yourself) and pass the one line of JSON it prints here unchanged: " +
      '{"models":[{"model","calls","input_tokens","output_tokens","cache_read_tokens","cache_write_5m_tokens",' +
      '"cache_write_1h_tokens"}],"output_estimated"}. Omit it if the command printed NO_TRANSCRIPT. ' +
      "Self-reported; never blocks completion."
  );

/**
 * Stores one attempt's usage, one row per model. Best effort: a failure here
 * (including a database where migration 00196 hasn't landed yet) is logged
 * and never takes completion down with it.
 */
export async function recordStepUsage(
  ctx: McpContext,
  step: { id: string; run_id: string | null; idea_id: string },
  outcome: "completed" | "awaiting_approval" | "failed",
  raw: unknown
): Promise<void> {
  if (raw === undefined || raw === null || raw === "") return;
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      logger.warn("step usage skipped: not JSON", { stepId: step.id });
      return;
    }
  }
  const parsed = stepUsageSchema.safeParse(value);
  if (!parsed.success) {
    logger.warn("step usage skipped: unexpected shape", { stepId: step.id, issue: parsed.error.issues[0]?.message });
    return;
  }
  const usage = parsed.data;
  try {
    const { error } = await ctx.supabase.from("workflow_step_usage").insert(
      usage.models.map((m) => ({
        step_id: step.id,
        run_id: step.run_id,
        idea_id: step.idea_id,
        outcome,
        model: m.model,
        calls: m.calls ?? 0,
        input_tokens: m.input_tokens,
        output_tokens: m.output_tokens,
        cache_read_tokens: m.cache_read_tokens,
        cache_write_5m_tokens: m.cache_write_5m_tokens,
        cache_write_1h_tokens: m.cache_write_1h_tokens,
        output_estimated: usage.output_estimated ?? true,
        reported_by: ctx.ownerUserId ?? ctx.userId,
      }))
    );
    if (error) {
      logger.warn("step usage write failed — completion unaffected", { stepId: step.id, error: error.message });
    }
  } catch (err) {
    logger.warn("step usage write threw — completion unaffected", {
      stepId: step.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
