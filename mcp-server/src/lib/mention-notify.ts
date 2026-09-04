/**
 * Tool-level orchestration for @mention comments (docs/design-mcp-mention-comments.html).
 * Wraps the pure resolution logic in mentions.ts with the one DB lookup
 * (idea team) and one batched notification insert both comment tools share
 * (binding B/C). Used by add_task_comment and add_step_comment (after the
 * step resolves its parent task_id).
 */

import { logger } from "../../../src/lib/logger";
import type { McpContext } from "../context";
import { resolveMentions, type MentionResolution, type RosterMember } from "./mentions";

interface TeamRow {
  author: {
    id: string;
    full_name: string | null;
    notification_preferences: RosterMember["notification_preferences"];
  } | null;
  collaborators:
    | {
        user: {
          id: string;
          full_name: string | null;
          notification_preferences: RosterMember["notification_preferences"];
        } | null;
      }[]
    | null;
}

/**
 * Fetches an idea's human team (author + collaborators) with just the
 * fields mention resolution needs, in ONE lookup (design §2, binding C).
 */
async function fetchIdeaTeam(ctx: McpContext, ideaId: string): Promise<RosterMember[]> {
  const { data, error } = await ctx.supabase
    .from("ideas")
    .select(
      "id, author:users!ideas_author_id_fkey(id, full_name, notification_preferences), collaborators(user:users!collaborators_user_id_fkey(id, full_name, notification_preferences))"
    )
    .eq("id", ideaId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      logger.warn("Failed to fetch idea team for mention resolution", {
        error: error.message,
        ideaId,
      });
    }
    return [];
  }

  const row = data as unknown as TeamRow;
  const team: RosterMember[] = [];
  const seen = new Set<string>();

  if (row.author) {
    team.push({
      user_id: row.author.id,
      full_name: row.author.full_name,
      notification_preferences: row.author.notification_preferences,
    });
    seen.add(row.author.id);
  }
  for (const c of row.collaborators ?? []) {
    if (c.user && !seen.has(c.user.id)) {
      seen.add(c.user.id);
      team.push({
        user_id: c.user.id,
        full_name: c.user.full_name,
        notification_preferences: c.user.notification_preferences,
      });
    }
  }
  return team;
}

export interface NotifyMentionsArgs {
  ideaId: string;
  taskId: string;
  content: string;
  mentionedUserIds?: string[];
  /**
   * Agent-voiced comments (docs/agent-voice-comments-design.html §1.4,
   * decision 1 §7): when a valid work_token attributes the comment to the
   * step's assigned agent, pass that agent's id here. Self-suppression then
   * keys on the SPEAKING agent, not the connection — so an agent's "@Nick"
   * notifies Nick even though it was posted under his JWT. Omit for
   * human-attributed comments, which behave exactly as today (self-suppress
   * on ctx.userId/ctx.ownerUserId).
   */
  actorId?: string;
  /**
   * The id of the comment row that actually triggered this mention (e.g.
   * board_task_comments.id for a task comment, workflow_step_comments.id for
   * a step comment). Written as `comment_id` on the notification so the
   * email route can quote the real comment instead of guessing — without it,
   * a genuine comment mention is indistinguishable from a description-edit
   * mention and the email misattributes the quote to "the description of"
   * the task. Omit when there truly is no comment row (there is none today
   * for this pipeline) — never invent one.
   */
  commentId?: string;
}

/**
 * Full mention pipeline for a task comment (or a step comment whose parent
 * task was resolved): ONE team lookup + resolve + (if there are survivors)
 * ONE batched notification insert (design §7, binding B/C). Never throws —
 * mention handling is strictly downstream of a successful comment insert
 * and must never fail the tool call.
 */
export async function notifyMentions(ctx: McpContext, args: NotifyMentionsArgs): Promise<MentionResolution> {
  const team = await fetchIdeaTeam(ctx, args.ideaId);
  const actor = args.actorId ?? ctx.userId;
  const selfIds = args.actorId
    ? [args.actorId]
    : [ctx.userId, ctx.ownerUserId].filter((id): id is string => !!id);

  const resolution = resolveMentions({
    content: args.content,
    mentionedUserIds: args.mentionedUserIds,
    team,
    selfIds,
  });

  if (resolution.notified.length === 0) return resolution;

  const rows = resolution.notified.map((n) => ({
    user_id: n.user_id,
    actor_id: actor,
    type: "task_mention" as const,
    idea_id: args.ideaId,
    task_id: args.taskId,
    // Conditional spread (not `comment_id: args.commentId ?? null`) so call
    // sites that omit commentId keep writing byte-identical rows.
    ...(args.commentId ? { comment_id: args.commentId } : {}),
  }));

  const { error } = await ctx.supabase.from("notifications").insert(rows);
  if (error) {
    // Fire-and-forget, mirrors web (task-comments-section.tsx ~L257): the
    // comment already succeeded — a failed notification insert is logged,
    // never thrown, and the failed survivors are omitted from notified[].
    logger.error("Failed to insert mention notifications", {
      error: error.message,
      ideaId: args.ideaId,
      taskId: args.taskId,
      count: rows.length,
    });
    return { ...resolution, notified: [] };
  }

  return resolution;
}
