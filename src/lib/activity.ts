import { createClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";
import type { Json } from "@/types/database";

export function logTaskActivity(
  taskId: string,
  ideaId: string,
  actorId: string,
  action: string,
  details?: Record<string, Json>
) {
  const supabase = createClient();
  // Fire-and-forget — no await needed
  supabase
    .from("board_task_activity")
    .insert({
      task_id: taskId,
      idea_id: ideaId,
      actor_id: actorId,
      action,
      details: details ?? null,
    })
    .then(({ error }) => {
      if (error) logger.error("Failed to log activity", { error: error.message, taskId, action });
    });
}
