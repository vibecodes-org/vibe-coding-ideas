// Card 1553d11e: the model and effort a step's claim asked for, saved on the
// step so completion judges against what was asked, not against settings that
// may have changed while the step ran.
//
// Both calls are best effort: a deploy can reach production a little before or
// after migration 00213, and neither a missing column nor a failed write may
// take claim or completion down with it. A read that can't be had returns
// null, which keeps the old comparison against the live settings.

import { logger } from "../../../src/lib/logger";
import type { McpContext } from "../context";

export type DirectedSnapshot = { model: string | null; effort: string | null };

export async function saveDirectedSnapshot(
  ctx: McpContext,
  stepId: string,
  directed: { model: string; effort: string | null }
): Promise<void> {
  try {
    const { error } = await ctx.supabase
      .from("task_workflow_steps")
      .update({ directed_model: directed.model, directed_effort: directed.effort })
      .eq("id", stepId)
      .select("id");
    if (error) {
      logger.warn("directed-model snapshot write failed on claim_next_step — claim unaffected", { stepId, error: error.message });
    }
  } catch (err) {
    logger.warn("directed-model snapshot write threw on claim_next_step — claim unaffected", {
      stepId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function readDirectedSnapshot(ctx: McpContext, stepId: string): Promise<DirectedSnapshot | null> {
  try {
    const { data, error } = await ctx.supabase
      .from("task_workflow_steps")
      .select("directed_model, directed_effort")
      .eq("id", stepId)
      .maybeSingle();
    if (error) {
      logger.warn("directed-model snapshot read failed — judging against live settings", { stepId, error: error.message });
      return null;
    }
    if (!data?.directed_model) return null;
    return { model: data.directed_model, effort: data.directed_effort ?? null };
  } catch (err) {
    logger.warn("directed-model snapshot read threw — judging against live settings", {
      stepId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
