import { logger } from "../../src/lib/logger";
import type { McpContext } from "./context";
import type { Json } from "../../src/types/database";

export async function logActivity(
  ctx: McpContext,
  taskId: string,
  ideaId: string,
  action: string,
  details?: Record<string, Json>,
  // Agent-voiced comments (docs/agent-voice-comments-design.html §1.4): a
  // valid work_token attributes the activity to the step's assigned agent,
  // not the connection's ctx.userId. Omit to keep today's behaviour.
  actorId?: string
): Promise<void> {
  const { error } = await ctx.supabase.from("board_task_activity").insert({
    task_id: taskId,
    idea_id: ideaId,
    actor_id: actorId ?? ctx.userId,
    action,
    details: details ?? null,
  });
  if (error) {
    logger.error("Failed to log activity", { error: error.message, taskId, action });
  }
}
