/**
 * Fire-and-forget notifier for workflow step compliance violations
 * (docs/design-compliance-alerts.html §2). Mirrors mention-notify.ts's shape:
 * one lookup + one insert, never throws, logged on failure. Called from
 * completeStep and failStep (mcp-server/src/tools/workflows.ts) right after
 * the step update succeeds, using the already-computed tierHonored /
 * personaHonored locals — no recomputation.
 */

import { logger } from "../../../src/lib/logger";
import type { McpContext } from "../context";

export interface NotifyComplianceViolationArgs {
  ideaId: string;
  taskId: string;
  tierHonored: boolean | null;
  personaHonored: boolean | null;
}

interface IdeaOwnerRow {
  author_id: string | null;
  author: { notification_preferences: { compliance_alerts?: boolean } | null } | null;
}

/**
 * Notifies the idea owner when a workflow step completes/fails without
 * honoring its assigned model tier or persona. Strict gate — only an
 * explicit `false` triggers; `null` (old clients that never reported, or
 * steps with nothing assigned) never does, avoiding transition-period alert
 * fatigue (design §4).
 *
 * Deliberately NOT self-skipped: unlike @mention notifications (a social
 * ping the sender doesn't need for their own action), a compliance
 * violation is a governance signal about an AGENT's behavior. The idea
 * owner running their own orchestration session is exactly who needs to
 * know when an agent under it misbehaved — skipping when
 * owner === ctx.userId/ctx.ownerUserId would silently suppress the alert
 * for the common case (an owner running their own sessions).
 *
 * Never throws — the step update has already succeeded; a failed lookup or
 * insert here is logged and swallowed.
 */
export async function notifyComplianceViolation(
  ctx: McpContext,
  args: NotifyComplianceViolationArgs
): Promise<void> {
  const violated = args.tierHonored === false || args.personaHonored === false;
  if (!violated) return;

  try {
    const { data, error: fetchError } = await ctx.supabase
      .from("ideas")
      .select("author_id, author:users!ideas_author_id_fkey(notification_preferences)")
      .eq("id", args.ideaId)
      .maybeSingle();

    if (fetchError) {
      logger.warn("compliance alert: idea owner lookup failed", {
        error: fetchError.message,
        ideaId: args.ideaId,
        taskId: args.taskId,
      });
      return;
    }

    const row = data as unknown as IdeaOwnerRow | null;
    const ownerId = row?.author_id;
    if (!ownerId) return;

    const enabled = row?.author?.notification_preferences?.compliance_alerts !== false; // absent key = ON
    if (!enabled) return;

    const { error: insertError } = await ctx.supabase.from("notifications").insert({
      user_id: ownerId,
      actor_id: ctx.userId, // the agent that completed/failed the step
      type: "step_compliance",
      idea_id: args.ideaId,
      task_id: args.taskId,
    });

    if (insertError) {
      logger.warn("compliance alert insert failed", {
        error: insertError.message,
        ideaId: args.ideaId,
        taskId: args.taskId,
      });
    }
  } catch (error) {
    logger.warn("compliance alert notify threw", {
      error: error instanceof Error ? error.message : String(error),
      ideaId: args.ideaId,
      taskId: args.taskId,
    });
  }
}
