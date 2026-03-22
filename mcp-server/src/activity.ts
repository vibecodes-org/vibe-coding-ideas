import { logger } from "../../src/lib/logger";
import type { McpContext } from "./context";
import type { Json } from "../../src/types/database";

export async function logActivity(
  ctx: McpContext,
  taskId: string,
  ideaId: string,
  action: string,
  details?: Record<string, Json>
): Promise<void> {
  const { error } = await ctx.supabase.from("board_task_activity").insert({
    task_id: taskId,
    idea_id: ideaId,
    actor_id: ctx.userId,
    action,
    details: details ?? null,
  });
  if (error) {
    logger.error("Failed to log activity", { error: error.message, taskId, action });
  }
}
