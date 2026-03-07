import { z } from "zod";
import { POSITION_GAP } from "../constants";
import type { McpContext } from "../context";

export const listDiscussionsSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  status: z
    .enum(["open", "resolved", "ready_to_convert", "converted"])
    .optional()
    .describe("Filter by discussion status"),
  limit: z
    .number()
    .min(1)
    .max(50)
    .default(20)
    .describe("Max results (default 20)"),
});

export async function listDiscussions(
  ctx: McpContext,
  params: z.infer<typeof listDiscussionsSchema>
) {
  let query = ctx.supabase
    .from("idea_discussions")
    .select(
      "id, title, status, pinned, reply_count, upvotes, last_activity_at, created_at, users!idea_discussions_author_id_fkey(full_name)"
    )
    .eq("idea_id", params.idea_id)
    .order("last_activity_at", { ascending: false })
    .limit(params.limit);

  if (params.status) {
    query = query.eq("status", params.status);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list discussions: ${error.message}`);

  return data.map((d) => ({
    ...d,
    author: (d as Record<string, unknown>).users,
    users: undefined,
  }));
}

export const getDiscussionSchema = z.object({
  discussion_id: z.string().uuid().describe("The discussion ID"),
  idea_id: z.string().uuid().describe("The idea ID (for context)"),
});

export async function getDiscussion(
  ctx: McpContext,
  params: z.infer<typeof getDiscussionSchema>
) {
  // Fetch discussion with author
  const { data: discussion, error } = await ctx.supabase
    .from("idea_discussions")
    .select(
      "id, title, body, status, pinned, upvotes, reply_count, last_activity_at, created_at, users!idea_discussions_author_id_fkey(id, full_name)"
    )
    .eq("id", params.discussion_id)
    .eq("idea_id", params.idea_id)
    .maybeSingle();

  if (error) throw new Error(`Failed to get discussion: ${error.message}`);
  if (!discussion)
    throw new Error(`Discussion not found: ${params.discussion_id}`);

  // Fetch all replies with authors
  const { data: replies, error: repliesError } = await ctx.supabase
    .from("idea_discussion_replies")
    .select(
      "id, content, parent_reply_id, created_at, updated_at, users!idea_discussion_replies_author_id_fkey(id, full_name)"
    )
    .eq("discussion_id", params.discussion_id)
    .order("created_at", { ascending: true });

  if (repliesError)
    throw new Error(`Failed to get replies: ${repliesError.message}`);

  // Group replies into parent/child structure (single-level nesting)
  const topLevel: unknown[] = [];
  const childMap = new Map<string, unknown[]>();

  for (const reply of replies ?? []) {
    const formatted = {
      id: reply.id,
      content: reply.content,
      parent_reply_id: reply.parent_reply_id,
      created_at: reply.created_at,
      updated_at: reply.updated_at,
      author: (reply as Record<string, unknown>).users,
    };

    if (reply.parent_reply_id) {
      const children = childMap.get(reply.parent_reply_id) ?? [];
      children.push(formatted);
      childMap.set(reply.parent_reply_id, children);
    } else {
      topLevel.push({ ...formatted, replies: [] as unknown[] });
    }
  }

  // Attach children to their parents
  for (const parent of topLevel) {
    const p = parent as { id: string; replies: unknown[] };
    p.replies = childMap.get(p.id) ?? [];
  }

  return {
    ...discussion,
    author: (discussion as Record<string, unknown>).users,
    users: undefined,
    replies: topLevel,
  };
}

export const addDiscussionReplySchema = z.object({
  discussion_id: z.string().uuid().describe("The discussion ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
  content: z
    .string()
    .min(1)
    .max(5000)
    .describe("Reply content (markdown)"),
  parent_reply_id: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .describe("Parent reply ID for nested replies (optional)"),
});

export async function addDiscussionReply(
  ctx: McpContext,
  params: z.infer<typeof addDiscussionReplySchema>
) {
  // Flatten nested replies: if parent has a parent, use grandparent
  let resolvedParentId = params.parent_reply_id ?? null;
  if (resolvedParentId) {
    const { data: parent } = await ctx.supabase
      .from("idea_discussion_replies")
      .select("parent_reply_id")
      .eq("id", resolvedParentId)
      .single();
    if (parent?.parent_reply_id) {
      resolvedParentId = parent.parent_reply_id;
    }
  }

  const { data, error } = await ctx.supabase
    .from("idea_discussion_replies")
    .insert({
      discussion_id: params.discussion_id,
      author_id: ctx.userId,
      content: params.content,
      parent_reply_id: resolvedParentId,
    })
    .select("id, content, created_at")
    .single();

  if (error) throw new Error(`Failed to add discussion reply: ${error.message}`);

  // Auto-mark any unread mention notifications for this agent on this discussion
  await ctx.supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", ctx.userId)
    .eq("discussion_id", params.discussion_id)
    .eq("type", "discussion_mention" as const)
    .eq("read", false);

  return { success: true, reply: data };
}

export const createDiscussionSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  title: z.string().min(1).max(200).describe("Discussion title"),
  body: z
    .string()
    .min(1)
    .max(10000)
    .describe("Discussion body (markdown)"),
});

export async function createDiscussion(
  ctx: McpContext,
  params: z.infer<typeof createDiscussionSchema>
) {
  const { data, error } = await ctx.supabase
    .from("idea_discussions")
    .insert({
      idea_id: params.idea_id,
      author_id: ctx.userId,
      title: params.title,
      body: params.body,
    })
    .select("id, title, created_at")
    .single();

  if (error) throw new Error(`Failed to create discussion: ${error.message}`);
  return { success: true, discussion: data };
}

export const updateDiscussionSchema = z.object({
  discussion_id: z.string().uuid().describe("The discussion ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
  title: z.string().min(1).max(200).optional().describe("New title"),
  body: z.string().min(1).max(10000).optional().describe("New body (markdown)"),
  status: z
    .enum(["open", "resolved", "ready_to_convert", "converted"])
    .optional()
    .describe("New status"),
  pinned: z.boolean().optional().describe("Pin or unpin the discussion"),
});

export async function updateDiscussion(
  ctx: McpContext,
  params: z.infer<typeof updateDiscussionSchema>
) {
  const updates: Record<string, unknown> = {};
  if (params.title !== undefined) updates.title = params.title;
  if (params.body !== undefined) updates.body = params.body;
  if (params.status !== undefined) updates.status = params.status;
  if (params.pinned !== undefined) updates.pinned = params.pinned;

  if (Object.keys(updates).length === 0) {
    throw new Error("No fields to update");
  }

  const { data, error } = await ctx.supabase
    .from("idea_discussions")
    .update(updates)
    .eq("id", params.discussion_id)
    .eq("idea_id", params.idea_id)
    .select("id, title, status, pinned")
    .single();

  if (error) throw new Error(`Failed to update discussion: ${error.message}`);
  return { success: true, discussion: data };
}

export const deleteDiscussionSchema = z.object({
  discussion_id: z.string().uuid().describe("The discussion ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function deleteDiscussion(
  ctx: McpContext,
  params: z.infer<typeof deleteDiscussionSchema>
) {
  const { error } = await ctx.supabase
    .from("idea_discussions")
    .delete()
    .eq("id", params.discussion_id)
    .eq("idea_id", params.idea_id);

  if (error) throw new Error(`Failed to delete discussion: ${error.message}`);
  return { success: true, deleted: { id: params.discussion_id } };
}

export const getDiscussionsReadyToConvertSchema = z.object({
  idea_id: z
    .string()
    .uuid()
    .optional()
    .describe("Filter to a specific idea"),
  limit: z
    .number()
    .min(1)
    .max(50)
    .default(20)
    .describe("Max results (default 20)"),
});

export async function getDiscussionsReadyToConvert(
  ctx: McpContext,
  params: z.infer<typeof getDiscussionsReadyToConvertSchema>
) {
  let query = ctx.supabase
    .from("idea_discussions")
    .select(
      "id, title, body, status, target_column_id, target_assignee_id, autonomy_level, reply_count, last_activity_at, created_at, idea_id, users!idea_discussions_author_id_fkey(id, full_name), ideas!idea_discussions_idea_id_fkey(id, title)"
    )
    .eq("status", "ready_to_convert")
    .order("created_at", { ascending: true })
    .limit(params.limit);

  if (params.idea_id) {
    query = query.eq("idea_id", params.idea_id);
  }

  const { data, error } = await query;
  if (error)
    throw new Error(
      `Failed to get discussions ready to convert: ${error.message}`
    );

  if (!data || data.length === 0) {
    return {
      discussions: [],
      message: "No discussions are currently queued for conversion.",
    };
  }

  const discussionIds = data.map((d) => d.id);

  // Batch-fetch all replies for all discussions in one query
  const { data: allReplies } = await ctx.supabase
    .from("idea_discussion_replies")
    .select(
      "id, content, parent_reply_id, created_at, discussion_id, users!idea_discussion_replies_author_id_fkey(id, full_name)"
    )
    .in("discussion_id", discussionIds)
    .order("created_at", { ascending: true });

  // Group replies by discussion_id
  const repliesByDiscussion = new Map<string, typeof allReplies>();
  for (const reply of allReplies ?? []) {
    const existing = repliesByDiscussion.get(reply.discussion_id) ?? [];
    existing.push(reply);
    repliesByDiscussion.set(reply.discussion_id, existing);
  }

  // Batch-fetch column names
  const columnIds = [...new Set(data.map((d) => d.target_column_id).filter(Boolean))] as string[];
  const columnMap = new Map<string, string>();
  if (columnIds.length > 0) {
    const { data: cols } = await ctx.supabase
      .from("board_columns")
      .select("id, title")
      .in("id", columnIds);
    for (const col of cols ?? []) {
      columnMap.set(col.id, col.title);
    }
  }

  // Batch-fetch orchestration agent names (stored as target_assignee_id on the discussion)
  const agentIds = [...new Set(data.map((d) => d.target_assignee_id).filter(Boolean))] as string[];
  const agentMap = new Map<string, string>();
  if (agentIds.length > 0) {
    const { data: users } = await ctx.supabase
      .from("users")
      .select("id, full_name")
      .in("id", agentIds);
    for (const user of users ?? []) {
      if (user.full_name) agentMap.set(user.id, user.full_name);
    }
  }

  const enriched = data.map((d) => {
    const replies = repliesByDiscussion.get(d.id) ?? [];
    return {
      id: d.id,
      idea_id: d.idea_id,
      idea: (d as Record<string, unknown>).ideas,
      title: d.title,
      body: d.body,
      author: (d as Record<string, unknown>).users,
      reply_count: d.reply_count,
      last_activity_at: d.last_activity_at,
      created_at: d.created_at,
      target_column_id: d.target_column_id,
      target_column_name: d.target_column_id ? (columnMap.get(d.target_column_id) ?? null) : null,
      orchestration_agent_id: d.target_assignee_id,
      orchestration_agent_name: d.target_assignee_id ? (agentMap.get(d.target_assignee_id) ?? null) : null,
      autonomy_level: d.autonomy_level,
      replies: replies.map((r) => ({
        id: r.id,
        content: r.content,
        parent_reply_id: r.parent_reply_id,
        created_at: r.created_at,
        author: (r as Record<string, unknown>).users,
      })),
    };
  });

  return {
    discussions: enriched,
    workflow: [
      "For each discussion:",
      "1. If orchestration_agent_id is set, call set_agent_identity with that ID to act as the orchestrator",
      "2. Call convert_discussion with the discussion_id, idea_id, and target_column_id",
      "   - This creates the task, marks the discussion as converted, and returns the full discussion context including autonomy_level",
      "3. Use the returned discussion body and replies to analyze what workflow steps are needed",
      "4. Call list_idea_agents to see which agents are available for the idea",
      "5. Call create_workflow_steps to create sequential implementation steps, assigning each to an appropriate agent",
      "   - Respect the autonomy_level: 1=human after every step, 2=human after key deliverables (after automated checks), 3=single human sign-off at end, 4=no human steps",
      "6. Add a discussion reply confirming the task and workflow steps were created",
      "7. Call set_agent_identity (no args) to reset to default identity",
    ],
  };
}

// --- convert_discussion ---

export const convertDiscussionSchema = z.object({
  discussion_id: z.string().uuid().describe("The discussion ID to convert"),
  idea_id: z.string().uuid().describe("The idea ID"),
  column_id: z.string().uuid().describe("The target board column ID for the new task"),
  task_title: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Custom task title (defaults to discussion title)"),
});

export async function convertDiscussion(
  ctx: McpContext,
  params: z.infer<typeof convertDiscussionSchema>
) {
  // Fetch discussion with status guard
  const { data: discussion, error: fetchError } = await ctx.supabase
    .from("idea_discussions")
    .select("id, title, body, status, target_assignee_id, autonomy_level")
    .eq("id", params.discussion_id)
    .eq("idea_id", params.idea_id)
    .single();

  if (fetchError || !discussion) throw new Error(`Discussion not found: ${params.discussion_id}`);
  if (discussion.status === "converted") {
    throw new Error("Discussion has already been converted to a task");
  }

  const title = params.task_title || discussion.title;

  // Get max position in the target column
  const { data: tasks } = await ctx.supabase
    .from("board_tasks")
    .select("position")
    .eq("column_id", params.column_id)
    .order("position", { ascending: false })
    .limit(1);

  const maxPos = tasks && tasks.length > 0 ? tasks[0].position : -POSITION_GAP;

  // Fetch all replies for context
  const { data: replies } = await ctx.supabase
    .from("idea_discussion_replies")
    .select(
      "id, content, created_at, users!idea_discussion_replies_author_id_fkey(id, full_name)"
    )
    .eq("discussion_id", params.discussion_id)
    .order("created_at", { ascending: true });

  // Create the board task with discussion backlink
  const { data: task, error: taskError } = await ctx.supabase
    .from("board_tasks")
    .insert({
      idea_id: params.idea_id,
      column_id: params.column_id,
      title,
      description: `From discussion: ${discussion.title}\n\n${discussion.body}`,
      discussion_id: params.discussion_id,
      position: maxPos + POSITION_GAP,
    })
    .select("id, title, column_id, position")
    .single();

  if (taskError) throw new Error(`Failed to create task: ${taskError.message}`);

  // Mark discussion as converted — guard against concurrent conversion
  const { data: updated, error: updateError } = await ctx.supabase
    .from("idea_discussions")
    .update({ status: "converted" })
    .eq("id", params.discussion_id)
    .in("status", ["open", "resolved", "ready_to_convert"])
    .select("id")
    .maybeSingle();

  if (updateError) {
    await ctx.supabase.from("board_tasks").delete().eq("id", task.id);
    throw new Error(`Failed to update discussion status: ${updateError.message}`);
  }

  if (!updated) {
    await ctx.supabase.from("board_tasks").delete().eq("id", task.id);
    throw new Error("Discussion was already converted by another user");
  }

  const formattedReplies = (replies ?? []).map((r) => ({
    id: r.id,
    content: r.content,
    created_at: r.created_at,
    author: (r as Record<string, unknown>).users,
  }));

  // Resolve orchestration agent name if set on the discussion
  let orchestrationAgentName: string | null = null;
  if (discussion.target_assignee_id) {
    const { data: agentUser } = await ctx.supabase
      .from("users")
      .select("full_name")
      .eq("id", discussion.target_assignee_id)
      .maybeSingle();
    orchestrationAgentName = agentUser?.full_name ?? null;
  }

  const autonomyLabels: Record<number, string> = {
    1: "Full Oversight — add a human checkpoint after EVERY agent step",
    2: "Key Checkpoints — add human review after key deliverables, always AFTER automated quality gates (code review, QA) so humans review validated work.",
    3: "Review on Completion — add a single human sign-off step at the end",
    4: "Fully Autonomous — do NOT add any human validation steps",
  };
  const autonomyLevel = discussion.autonomy_level ?? 2;

  return {
    success: true,
    task,
    discussion_context: {
      title: discussion.title,
      body: discussion.body,
      replies: formattedReplies,
    },
    orchestration_agent: discussion.target_assignee_id
      ? { id: discussion.target_assignee_id, name: orchestrationAgentName }
      : null,
    autonomy_level: autonomyLevel,
    autonomy_instruction: autonomyLabels[autonomyLevel] ?? autonomyLabels[2],
    next_steps: [
      "The task has been created and the discussion marked as converted.",
      `Autonomy level: ${autonomyLevel}/4 — ${autonomyLabels[autonomyLevel] ?? autonomyLabels[2]}`,
      "Now build workflow steps for this task:",
      "1. Analyze the discussion body and replies above to identify implementation steps",
      "2. Call list_idea_agents to see which agents are available for this idea",
      `3. Call create_workflow_steps with the task_id and idea_id, assigning each step to an appropriate agent. Use step_type 'human' for validation checkpoints per the autonomy level above.`,
      ...(discussion.target_assignee_id
        ? [`4. The orchestration agent is "${orchestrationAgentName}" (${discussion.target_assignee_id}) — use set_agent_identity to act as this agent for coordination tasks`]
        : []),
      `${discussion.target_assignee_id ? "5" : "4"}. Add a discussion reply confirming the task and workflow were created`,
    ],
  };
}
