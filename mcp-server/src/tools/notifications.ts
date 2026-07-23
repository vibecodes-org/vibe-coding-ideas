import { z } from "zod";
import type { McpContext } from "../context";
import { buildNotificationUrl } from "../../../src/lib/notification-url";
import { logger } from "../../../src/lib/logger";
import type { Database } from "../../../src/types/database";

// docs/design-mcp-notifications-enrichment.html — additive enrichment so a
// calling agent can act on a notification without a second round-trip: raw
// FK ids, inline task/discussion titles, a never-null deep-link `url`
// (built via the canonical web helper, zero drift), and a best-effort
// `mention_context` excerpt for task_mention notifications (one extra
// batched query, skipped entirely when there are no mention pairs).

type NotificationType = Database["public"]["Enums"]["notification_type"];

// Read once at module load (§5): same env var in both remote (Next.js route)
// and local (stdio) modes; each process resolves its own env. Trailing-slash
// strip keeps buildNotificationUrl's `{appUrl}/ideas/…` concatenation clean.
const APP_BASE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://vibecodes.co.uk").replace(/\/+$/, "");

const MENTION_CONTEXT_MAX_LEN = 200;
// Safety cap against a chatty author on one task (§3b) — not a page-size limit.
const MENTION_CONTEXT_QUERY_LIMIT = 200;

interface NotificationRow {
  id: string;
  type: NotificationType;
  read: boolean;
  created_at: string;
  idea_id: string | null;
  task_id: string | null;
  comment_id: string | null;
  discussion_id: string | null;
  reply_id: string | null;
  actor: { id: string; full_name: string | null } | null;
  idea: { id: string; title: string } | null;
  task: { id: string; title: string } | null;
  discussion: { title: string } | null;
}

interface MentionContext {
  text: string;
  source: "board_task_comment";
  best_effort: true;
}

function mentionKey(taskId: string, actorId: string): string {
  return `${taskId}:${actorId}`;
}

/**
 * Best-effort mention_context lookup (§3b, §6). ONE batched query into
 * board_task_comments across every (task_id, actor_id) pair pulled from
 * task_mention notifications, using `.or()` of `and()` pairs so we fetch
 * exactly the requested pairs — never the .in()×.in() cross-product (a
 * chatty author's comments on an unrelated task must not leak in). Skipped
 * entirely when there are no pairs. Never throws: a lookup failure logs a
 * warning and yields an empty map, so mention_context is simply omitted.
 */
async function fetchMentionContexts(
  ctx: McpContext,
  rows: NotificationRow[]
): Promise<Map<string, MentionContext>> {
  const pairs: { task_id: string; actor_id: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.type === "task_mention" && row.task_id && row.actor?.id) {
      const key = mentionKey(row.task_id, row.actor.id);
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push({ task_id: row.task_id, actor_id: row.actor.id });
      }
    }
  }

  const result = new Map<string, MentionContext>();
  if (pairs.length === 0) return result;

  try {
    const filter = pairs.map((p) => `and(task_id.eq.${p.task_id},author_id.eq.${p.actor_id})`).join(",");

    const { data, error } = await ctx.supabase
      .from("board_task_comments")
      .select("task_id, author_id, content, created_at")
      .or(filter)
      .order("created_at", { ascending: false })
      .limit(MENTION_CONTEXT_QUERY_LIMIT);

    if (error) {
      logger.warn("Failed to fetch mention context for notifications", { error: error.message });
      return result;
    }

    // Rows arrive newest-first; keep the first row seen per (task_id,
    // author_id) — the most-recent comment by that author on that task,
    // which is the triggering comment in ~all cases (best_effort: true).
    for (const comment of data ?? []) {
      const key = mentionKey(comment.task_id, comment.author_id);
      if (result.has(key)) continue;
      const text =
        comment.content.length > MENTION_CONTEXT_MAX_LEN
          ? `${comment.content.slice(0, MENTION_CONTEXT_MAX_LEN)}…`
          : comment.content;
      result.set(key, { text, source: "board_task_comment", best_effort: true });
    }
  } catch (e) {
    logger.warn("Failed to fetch mention context for notifications", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return result;
}

// --- List Notifications ---

export const listNotificationsSchema = z.object({
  unread_only: z
    .boolean()
    .default(false)
    .describe("Only return unread notifications"),
  limit: z
    .number()
    .min(1)
    .max(50)
    .default(20)
    .describe("Max results (default 20)"),
});

export async function listNotifications(
  ctx: McpContext,
  params: z.infer<typeof listNotificationsSchema>
) {
  let query = ctx.supabase
    .from("notifications")
    .select(
      "id, type, read, created_at, idea_id, task_id, comment_id, discussion_id, reply_id, actor:users!notifications_actor_id_fkey(id, full_name), idea:ideas!notifications_idea_id_fkey(id, title), task:board_tasks!notifications_task_id_fkey(id, title), discussion:idea_discussions!notifications_discussion_id_fkey(title)"
    )
    .eq("user_id", ctx.ownerUserId ?? ctx.userId)
    .order("created_at", { ascending: false })
    .limit(params.limit);

  if (params.unread_only) {
    query = query.eq("read", false);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list notifications: ${error.message}`);

  const rows = (data ?? []) as unknown as NotificationRow[];
  const mentionContexts = await fetchMentionContexts(ctx, rows);

  const notifications = rows.map((row) => {
    const { discussion, ...rest } = row;

    const url = buildNotificationUrl({
      type: row.type,
      ideaId: row.idea_id,
      commentId: row.comment_id,
      taskId: row.task_id,
      discussionId: row.discussion_id,
      replyId: row.reply_id,
      appUrl: APP_BASE_URL,
    });

    const mentionContext =
      row.type === "task_mention" && row.task_id && row.actor?.id
        ? mentionContexts.get(mentionKey(row.task_id, row.actor.id))
        : undefined;

    return {
      ...rest,
      discussion_title: discussion?.title ?? null,
      url,
      ...(mentionContext ? { mention_context: mentionContext } : {}),
    };
  });

  return {
    notifications,
    total: notifications.length,
    unread_count: notifications.filter((n) => !n.read).length,
  };
}

// --- Mark Notification Read ---

export const markNotificationReadSchema = z.object({
  notification_id: z.string().uuid().describe("The notification ID to mark as read"),
});

export async function markNotificationRead(
  ctx: McpContext,
  params: z.infer<typeof markNotificationReadSchema>
) {
  const { error } = await ctx.supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", params.notification_id)
    .eq("user_id", ctx.ownerUserId ?? ctx.userId);

  if (error) throw new Error(`Failed to mark notification read: ${error.message}`);
  return { success: true, notification_id: params.notification_id };
}

// --- Mark All Notifications Read ---

export const markAllNotificationsReadSchema = z.object({});

export async function markAllNotificationsRead(ctx: McpContext) {
  const { error } = await ctx.supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", ctx.ownerUserId ?? ctx.userId)
    .eq("read", false);

  if (error) throw new Error(`Failed to mark all notifications read: ${error.message}`);
  return { success: true };
}
