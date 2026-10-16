import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import type { McpContext } from "../context";

// Card ba37039b: the token totals a session reports for one step attempt.
// The shape is exactly what stepUsageCommand (src/lib/step-cost/usage-command.ts)
// prints, so the session can pass that JSON line straight through.

const tokenCount = z.number().int().min(0).max(1e12);

export const stepUsageSchema = z.object({
  models: z
    .array(
      z.object({
        model: z.string().min(1).max(80),
        calls: z.number().int().min(0).max(1e6).optional(),
        input_tokens: tokenCount,
        output_tokens: tokenCount,
        cache_read_tokens: tokenCount,
        cache_write_5m_tokens: tokenCount,
        cache_write_1h_tokens: tokenCount,
      })
    )
    .min(1)
    .max(12),
  output_estimated: z.boolean().optional(),
});

export type StepUsage = z.infer<typeof stepUsageSchema>;

/**
 * The tool parameter. Deliberately accepts anything: a malformed or empty
 * usage report must never make complete_step / fail_step fail. It is
 * checked against stepUsageSchema when stored, and skipped if it doesn't fit.
 */
export const stepUsageParam = z
  .unknown()
  .optional()
  .describe(
    "Optional: the step's token use, for the admin step report's cost column. After this step's subagent " +
      "returns, run the usage_command from claim_next_step with AGENT_ID replaced by the agentId the Agent tool " +
      "returned, and pass the one line of JSON it prints here unchanged: " +
      '{"models":[{"model","calls","input_tokens","output_tokens","cache_read_tokens","cache_write_5m_tokens",' +
      '"cache_write_1h_tokens"}],"output_estimated"}. Omit it if the command printed NO_TRANSCRIPT or the step ' +
      "ran without a subagent. Self-reported; never blocks completion."
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
