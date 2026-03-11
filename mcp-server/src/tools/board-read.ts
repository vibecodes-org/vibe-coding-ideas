import { z } from "zod";
import { DEFAULT_BOARD_COLUMNS } from "../constants";
import type { McpContext } from "../context";

export const getBoardSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  include_archived: z
    .boolean()
    .default(false)
    .describe("Include archived tasks"),
  exclude_done: z
    .boolean()
    .default(true)
    .describe("Exclude tasks in done columns (default true)"),
});

export async function getBoard(ctx: McpContext, params: z.infer<typeof getBoardSchema>) {
  // Check if columns exist; if not, initialize defaults
  let { data: columns, error: colError } = await ctx.supabase
    .from("board_columns")
    .select("*")
    .eq("idea_id", params.idea_id)
    .order("position");

  if (colError) throw new Error(`Failed to get board: ${colError.message}`);

  if (!columns || columns.length === 0) {
    // Before initializing, verify the idea exists and user has access
    const { data: idea, error: ideaError } = await ctx.supabase
      .from("ideas")
      .select("id")
      .eq("id", params.idea_id)
      .maybeSingle();

    if (ideaError) throw new Error(`Failed to check idea access: ${ideaError.message}`);
    if (!idea) throw new Error(`Idea not found or access denied: ${params.idea_id}`);

    // Check user's custom default columns
    const { data: userProfile } = await ctx.supabase
      .from("users")
      .select("default_board_columns")
      .eq("id", ctx.ownerUserId ?? ctx.userId)
      .single();

    const columnDefs = userProfile?.default_board_columns ?? DEFAULT_BOARD_COLUMNS;

    const { data: newCols, error: initError } = await ctx.supabase
      .from("board_columns")
      .insert(
        columnDefs.map((col: { title: string; is_done_column: boolean }, i: number) => ({
          idea_id: params.idea_id,
          title: col.title,
          position: i * 1000,
          is_done_column: col.is_done_column,
        }))
      )
      .select();

    if (initError)
      throw new Error(`Failed to initialize board: ${initError.message}`);
    columns = newCols;
  }

  // Fetch tasks
  let taskQuery = ctx.supabase
    .from("board_tasks")
    .select(
      "*, users!board_tasks_assignee_id_fkey(id, full_name), board_task_labels(label_id, board_labels(id, name, color))"
    )
    .eq("idea_id", params.idea_id)
    .order("position");

  if (!params.include_archived) {
    taskQuery = taskQuery.eq("archived", false);
  }

  const { data: tasks, error: taskError } = await taskQuery;
  if (taskError) throw new Error(`Failed to get tasks: ${taskError.message}`);

  // Fetch labels
  const { data: labels } = await ctx.supabase
    .from("board_labels")
    .select("*")
    .eq("idea_id", params.idea_id);

  // Determine which columns to exclude (done columns when exclude_done is true)
  const doneColumnIds = params.exclude_done
    ? new Set(columns!.filter((c) => c.is_done_column).map((c) => c.id))
    : new Set<string>();

  // Group tasks by column, omit descriptions to keep payload small (use get_task for full details)
  const board = columns!
    .filter((col) => !doneColumnIds.has(col.id))
    .map((col) => ({
      ...col,
      tasks: (tasks ?? [])
        .filter((t) => t.column_id === col.id)
        .map((t) => ({
          id: t.id,
          title: t.title,
          position: t.position,
          assignee: (t as Record<string, unknown>).users ?? null,
          due_date: t.due_date,
          archived: t.archived,
          workflow_step_total: t.workflow_step_total,
          workflow_step_completed: t.workflow_step_completed,
          attachment_count: t.attachment_count,
          labels:
            ((t as Record<string, unknown>).board_task_labels as Array<Record<string, unknown>>)?.map(
              (tl) => tl.board_labels
            ) ?? [],
        })),
    }));

  return { columns: board, labels: labels ?? [] };
}

export const getTaskSchema = z.object({
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID (for context)"),
});

export async function getTask(ctx: McpContext, params: z.infer<typeof getTaskSchema>) {
  const { data: task, error } = await ctx.supabase
    .from("board_tasks")
    .select(
      "*, users!board_tasks_assignee_id_fkey(id, full_name, email), board_task_labels(label_id, board_labels(id, name, color))"
    )
    .eq("id", params.task_id)
    .eq("idea_id", params.idea_id)
    .maybeSingle();

  if (error) throw new Error(`Failed to get task: ${error.message}`);
  if (!task) throw new Error(`Task not found: ${params.task_id}`);

  // Fetch workflow steps
  const { data: workflowSteps } = await ctx.supabase
    .from("task_workflow_steps")
    .select("*")
    .eq("task_id", params.task_id)
    .order("position");

  // Fetch comments
  const { data: comments } = await ctx.supabase
    .from("board_task_comments")
    .select("*, users!board_task_comments_author_id_fkey(id, full_name)")
    .eq("task_id", params.task_id)
    .order("created_at", { ascending: false })
    .limit(20);

  // Fetch recent activity
  const { data: activity } = await ctx.supabase
    .from("board_task_activity")
    .select("*, users!board_task_activity_actor_id_fkey(full_name)")
    .eq("task_id", params.task_id)
    .order("created_at", { ascending: false })
    .limit(10);

  // Fetch attachments (metadata only, no signed URLs — use list_attachments for URLs)
  const { data: attachments } = await ctx.supabase
    .from("board_task_attachments")
    .select("id, file_name, file_size, content_type, created_at")
    .eq("task_id", params.task_id)
    .order("created_at");

  return {
    ...task,
    assignee: (task as Record<string, unknown>).users ?? null,
    users: undefined,
    labels:
      ((task as Record<string, unknown>).board_task_labels as Array<Record<string, unknown>>)?.map(
        (tl) => tl.board_labels
      ) ?? [],
    board_task_labels: undefined,
    workflow_steps: workflowSteps ?? [],
    comments:
      comments?.map((c) => ({
        ...c,
        author: (c as Record<string, unknown>).users,
        users: undefined,
      })) ?? [],
    recent_activity:
      activity?.map((a) => ({
        ...a,
        actor: (a as Record<string, unknown>).users,
        users: undefined,
      })) ?? [],
    attachments: attachments ?? [],
  };
}

export const getMyTasksSchema = z.object({
  idea_id: z
    .string()
    .uuid()
    .optional()
    .describe("Filter to a specific idea"),
  include_done: z
    .boolean()
    .default(false)
    .describe("Include tasks in done columns"),
});

export async function getMyTasks(ctx: McpContext, params: z.infer<typeof getMyTasksSchema>) {
  let query = ctx.supabase
    .from("board_tasks")
    .select(
      "*, board_columns!board_tasks_column_id_fkey(title, is_done_column), ideas!board_tasks_idea_id_fkey(id, title)"
    )
    .eq("assignee_id", ctx.userId)
    .eq("archived", false)
    .order("updated_at", { ascending: false });

  if (params.idea_id) {
    query = query.eq("idea_id", params.idea_id);
  }

  const { data: tasks, error } = await query;
  if (error) throw new Error(`Failed to get my tasks: ${error.message}`);

  const filtered = params.include_done
    ? tasks
    : tasks?.filter(
        (t) =>
          !((t as Record<string, unknown>).board_columns as Record<string, unknown>)
            ?.is_done_column
      );

  // Group by idea
  const grouped: Record<
    string,
    { idea_id: string; idea_title: string; tasks: unknown[] }
  > = {};
  for (const task of filtered ?? []) {
    const idea = (task as Record<string, unknown>).ideas as Record<string, unknown>;
    const ideaId = idea?.id as string;
    const ideaTitle = idea?.title as string;
    if (!grouped[ideaId]) {
      grouped[ideaId] = { idea_id: ideaId, idea_title: ideaTitle, tasks: [] };
    }
    const desc = task.description;
    grouped[ideaId].tasks.push({
      id: task.id,
      title: task.title,
      description: desc && desc.length > 200 ? desc.slice(0, 200) + "…" : desc,
      column: ((task as Record<string, unknown>).board_columns as Record<string, unknown>)?.title,
      due_date: task.due_date,
      workflow_step_total: task.workflow_step_total,
      workflow_step_completed: task.workflow_step_completed,
    });
  }

  return Object.values(grouped);
}
