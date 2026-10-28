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
    "The step's token use, for the cost reports. When the step's work is done, run the usage_command from " +
      "claim_next_step (AGENT_ID replaced by the agentId of each subagent that did the work, or left as it is if you " +
      "did the work yourself) and pass the one line it prints here unchanged, NO_TRANSCRIPT included: " +
      '{"models":[{"model","calls","input_tokens","output_tokens","cache_read_tokens","cache_write_5m_tokens",' +
      '"cache_write_1h_tokens"}],"output_estimated"}. Required on a Claude step you claimed: without it (or ' +
      "usage_unavailable) the call is refused and nothing changes. A malformed line never blocks the step."
  );

/** The escape hatch, so a step can never be trapped by a command that can't run. */
export const usageUnavailableParam = z
  .string()
  .max(300)
  .optional()
  .describe(
    "Only when the usage_command could not be run at all (for example your client has no shell): say why in a few " +
      "words. Pass usage instead whenever the command ran, even if it printed NO_TRANSCRIPT."
  );

/**
 * Card 1117ac6b: a session that skipped the usage command finished about 55
 * steps on one board with no cost, and the call was accepted silently. A
 * Claude attempt finished with a claim token must now carry usage (anything
 * the command printed) or an explicit usage_unavailable reason; otherwise the
 * call is refused before anything is read or written. Codex claims get no
 * usage command, and a human rejecting an approval gate has no claim token,
 * so neither is affected. Returns the refusal message, or null to go ahead.
 */
export function missingUsageError(params: {
  claim_token?: string | null;
  agent?: "claude" | "codex";
  usage?: unknown;
  usage_unavailable?: string | null;
}): string | null {
  if (!params.claim_token) return null;
  if ((params.agent ?? "claude") !== "claude") return null;
  const u = params.usage;
  const hasUsage = u !== undefined && u !== null && !(typeof u === "string" && u.trim() === "");
  if (hasUsage) return null;
  if (params.usage_unavailable?.trim()) return null;
  return (
    "usage is missing: run the usage_command from claim_next_step (AGENT_ID swapped for the helper's agentId) and " +
    "call again with the line it prints as usage, NO_TRANSCRIPT included. Only if the command can't be run at all, " +
    "pass usage_unavailable with the reason instead. Nothing was changed; the claim_token is still valid."
  );
}

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
  if (typeof value === "string" && value.trim().startsWith("NO_TRANSCRIPT")) {
    logger.info("step usage not found in transcripts", { stepId: step.id, detail: value.trim().slice(0, 120) });
    return;
  }
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
