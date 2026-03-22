import { createClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";
import type { User } from "@/types";

/**
 * Fire-and-forget discussion @mention notifications.
 *
 * Shared by new-discussion-form, discussion-reply-form, and
 * discussion-thread inline edit forms.
 */
export function sendDiscussionMentionNotifications(
  mentionedUserIds: Set<string>,
  currentUserId: string,
  teamMembers: User[],
  ideaId: string,
  discussionId: string,
  replyId?: string
) {
  if (mentionedUserIds.size === 0) return;
  const supabase = createClient();
  for (const userId of mentionedUserIds) {
    if (userId === currentUserId) continue;
    const member = teamMembers.find((m) => m.id === userId);
    if (!member) continue;
    if (member.notification_preferences?.discussion_mentions === false) continue;
    supabase
      .from("notifications")
      .insert({
        user_id: userId,
        actor_id: currentUserId,
        type: "discussion_mention" as const,
        idea_id: ideaId,
        discussion_id: discussionId,
        reply_id: replyId ?? null,
      })
      .then(({ error }) => {
        if (error)
          logger.error("Failed to send mention notification", {
            error: error.message,
            userId,
            discussionId,
          });
      });
  }
}
