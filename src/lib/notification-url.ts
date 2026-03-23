import type { Database } from "@/types/database";

type NotificationType = Database["public"]["Enums"]["notification_type"];

interface NotificationUrlParams {
  type: NotificationType;
  ideaId: string | null;
  commentId: string | null;
  taskId: string | null;
  discussionId: string | null;
  replyId: string | null;
  appUrl: string;
}

/**
 * Build the deep-link URL for a notification.
 * Used by both email notifications and in-app notification bell.
 */
export function buildNotificationUrl({
  type,
  ideaId,
  commentId,
  taskId,
  discussionId,
  replyId,
  appUrl,
}: NotificationUrlParams): string {
  if (!ideaId) return appUrl;

  const base = `${appUrl}/ideas/${ideaId}`;

  // Task-related types
  if (taskId) {
    return `${base}/board?taskId=${taskId}`;
  }

  // Discussion-related types
  if (discussionId) {
    const replyHash = replyId ? `#reply-${replyId}` : "";
    return `${base}/discussions/${discussionId}${replyHash}`;
  }

  // Comment-related types
  if (commentId) {
    return `${base}#comment-${commentId}`;
  }

  // Fallback: board page for task_mention without taskId, idea page otherwise
  if (type === "task_mention") {
    return `${base}/board`;
  }

  if (type === "discussion" || type === "discussion_reply" || type === "discussion_mention") {
    return `${base}/discussions`;
  }

  return base;
}
