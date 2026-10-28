import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import { stepUsageSchema } from "../../../src/lib/step-cost/usage-schema";
import { noScriptMarker, stepUsageCommand } from "../../../src/lib/step-cost/usage-command";
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
      '"cache_write_1h_tokens"}],"output_estimated"}. If it prints NO_TRANSCRIPT no-script, the reply gives you a full ' +
      "command to run once instead. Required on a Claude step you claimed: without it (or " +
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
 * Card 1117ac6b stage 4: the short usage command found no saved script on this
 * machine (only the Mac helper saves one). The refusal hands back the full
 * self-contained command to run once. It writes nothing to disk and never
 * prints a no-script line, so it cannot be refused a second time.
 */
export function noScriptRetryMessage(marker: string): string {
  return (
    "This machine has no step-counting script, so the short usage command could not measure the step. " +
    "Nothing was changed; the claim_token is still valid. Run the full command between the lines below once " +
    "(swap AGENT_ID for the agentId of each subagent that did the work, or leave it as it is if you did the work " +
    "yourself) and call again with the single line it prints as usage. It only reads Claude's session history; " +
    "it changes nothing on this machine. If it can't be run, call again with usage_unavailable and the reason instead of usage.\n" +
    "----- command start -----\n" +
    stepUsageCommand(marker) +
    "\n----- command end -----"
  );
}

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
  // A stated reason always lets the call through, so the retry advice below can never loop.
  if (params.usage_unavailable?.trim()) return null;
  const marker = noScriptMarker(u);
  if (marker) return noScriptRetryMessage(marker);
  const hasUsage = u !== undefined && u !== null && !(typeof u === "string" && u.trim() === "");
  if (hasUsage) return null;
  if (params.usage_unavailable?.trim()) return null;
  return (
    "usage is missing: run the usage_command from claim_next_step (AGENT_ID swapped for the helper's agentId) and " +
    "call again with the line it prints as usage, NO_TRANSCRIPT included. Only if the command can't be run at all, " +
    "pass usage_unavailable with the reason instead. Nothing was changed; the claim_token is still valid."
  );
}

const TOKEN_FIELDS = ["input_tokens", "output_tokens", "cache_read_tokens", "cache_write_5m_tokens", "cache_write_1h_tokens"] as const;

/**
 * Card 1117ac6b stage 4: Claude Code sometimes records a cache-write figure
 * that makes the 5-minute share come out negative. A negative count would
 * make the whole report unreadable and lose the step's cost, so any negative
 * token count becomes 0. Only the live path does this; the admin import stays strict.
 */
export function floorNegativeTokens(value: unknown, stepId?: string): unknown {
  if (!value || typeof value !== "object" || !Array.isArray((value as { models?: unknown }).models)) return value;
  let floored = false;
  const models = (value as { models: unknown[] }).models.map((m) => {
    if (!m || typeof m !== "object") return m;
    const copy: Record<string, unknown> = { ...(m as Record<string, unknown>) };
    for (const f of TOKEN_FIELDS) {
      const v = copy[f];
      if (typeof v === "number" && Number.isFinite(v) && v < 0) {
        copy[f] = 0;
        floored = true;
      }
    }
    return copy;
  });
  if (!floored) return value;
  logger.info("step usage: negative token count floored at zero", { stepId });
  return { ...(value as Record<string, unknown>), models };
}

type Outcome = "completed" | "awaiting_approval" | "failed";
export type UnmeasuredKind = "unavailable" | "no_transcript" | "unreadable" | "codex";

/**
 * Card 1117ac6b stage 2: a lasting record that a finished attempt's cost
 * couldn't be measured, and why. Best effort like the cost rows: a failure
 * (including a database where migration 00204 hasn't landed yet) is logged
 * and never takes completion down with it.
 */
export async function recordUnmeasured(
  ctx: McpContext,
  step: { id: string; run_id: string | null; idea_id: string },
  outcome: Outcome,
  kind: UnmeasuredKind,
  reason: string | null
): Promise<void> {
  try {
    const { error } = await ctx.supabase.from("workflow_step_unmeasured").insert({
      step_id: step.id,
      run_id: step.run_id,
      idea_id: step.idea_id,
      outcome,
      kind,
      reason: reason?.trim() ? reason.trim().slice(0, 300) : null,
      reported_by: ctx.ownerUserId ?? ctx.userId,
    });
    if (error) {
      logger.warn("step unmeasured write failed — completion unaffected", { stepId: step.id, error: error.message });
    }
  } catch (err) {
    logger.warn("step unmeasured write threw — completion unaffected", {
      stepId: step.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Stores one attempt's usage, one row per model. Best effort: a failure here
 * (including a database where migration 00196 hasn't landed yet) is logged
 * and never takes completion down with it. When no cost can be stored, the
 * reason is recorded in workflow_step_unmeasured instead (card 1117ac6b).
 */
export async function recordStepUsage(
  ctx: McpContext,
  step: { id: string; run_id: string | null; idea_id: string },
  outcome: Outcome,
  raw: unknown,
  unavailableReason?: string | null,
  agent: "claude" | "codex" = "claude"
): Promise<void> {
  // Card 1117ac6b: a step finished without a cost is logged at warn, so a
  // gap shows in production logs instead of vanishing.
  if (raw === undefined || raw === null || raw === "") {
    if (agent === "codex") {
      await recordUnmeasured(ctx, step, outcome, "codex", null);
    } else if (unavailableReason?.trim()) {
      logger.warn("step usage unavailable", { stepId: step.id, reason: unavailableReason.trim().slice(0, 300) });
      await recordUnmeasured(ctx, step, outcome, "unavailable", unavailableReason);
    }
    return;
  }
  let value: unknown = raw;
  if (noScriptMarker(value) && unavailableReason?.trim() && agent !== "codex") {
    // The session ran the short command, got the no-script line, then said it can't run the full one either.
    logger.warn("step usage unavailable", { stepId: step.id, reason: unavailableReason.trim().slice(0, 300) });
    await recordUnmeasured(ctx, step, outcome, "unavailable", unavailableReason);
    return;
  }
  if (typeof value === "string" && value.trim().startsWith("NO_TRANSCRIPT")) {
    logger.warn("step usage skipped: NO_TRANSCRIPT", { stepId: step.id, detail: value.trim().slice(0, 120) });
    await recordUnmeasured(ctx, step, outcome, "no_transcript", noScriptMarker(value) ? " no-script" : value.trim().slice("NO_TRANSCRIPT".length));
    return;
  }
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      logger.warn("step usage skipped: not JSON", { stepId: step.id });
      await recordUnmeasured(ctx, step, outcome, "unreadable", "not JSON");
      return;
    }
  }
  value = floorNegativeTokens(value, step.id);
  const parsed = stepUsageSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message;
    logger.warn("step usage skipped: unexpected shape", { stepId: step.id, issue });
    await recordUnmeasured(ctx, step, outcome, "unreadable", issue ?? "unexpected shape");
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
