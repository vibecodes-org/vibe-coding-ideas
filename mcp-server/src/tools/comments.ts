import { z } from "zod";
import { logActivity } from "../activity";
import type { McpContext } from "../context";
import { notifyMentions } from "../lib/mention-notify";

export const mentionedUserIdsSchema = z
  .array(z.string().uuid())
  .optional()
  .describe(
    "Optional explicit user IDs to notify (idea team members only). You usually don't need this: any @Full Name written in `content` that matches a team member is detected and notified automatically (a single unique first name also matches). Use this only to notify someone without writing their name in the text. IDs and parsed names are merged and de-duplicated; unresolved entries are reported non-fatally and never block the comment."
  );

export const addIdeaCommentSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  content: z.string().min(1).max(5000).describe("Comment content (markdown)"),
  type: z
    .enum(["comment", "suggestion", "question"])
    .default("comment")
    .describe("Comment type"),
});

export async function addIdeaComment(
  ctx: McpContext,
  params: z.infer<typeof addIdeaCommentSchema>
) {
  const { data, error } = await ctx.supabase
    .from("comments")
    .insert({
      idea_id: params.idea_id,
      author_id: ctx.userId,
      content: params.content,
      type: params.type,
    })
    .select("id, content, type, created_at")
    .single();

  if (error) throw new Error(`Failed to add comment: ${error.message}`);
  return { success: true, comment: data };
}

export const addTaskCommentSchema = z.object({
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
  content: z.string().min(1).max(5000).describe("Comment content (markdown)"),
  mentioned_user_ids: mentionedUserIdsSchema,
});

export async function addTaskComment(
  ctx: McpContext,
  params: z.infer<typeof addTaskCommentSchema>
) {
  const { data, error } = await ctx.supabase
    .from("board_task_comments")
    .insert({
      task_id: params.task_id,
      idea_id: params.idea_id,
      author_id: ctx.userId,
      content: params.content,
    })
    .select("id, content, created_at")
    .single();

  if (error) throw new Error(`Failed to add task comment: ${error.message}`);

  await logActivity(ctx, params.task_id, params.idea_id, "comment_added");

  const mentions = await notifyMentions(ctx, {
    ideaId: params.idea_id,
    taskId: params.task_id,
    content: params.content,
    mentionedUserIds: params.mentioned_user_ids,
  });

  return { success: true, comment: data, mentions };
}
