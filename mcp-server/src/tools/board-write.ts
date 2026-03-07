import { z } from "zod";
import { POSITION_GAP } from "../constants";
import { logActivity } from "../activity";
import type { McpContext } from "../context";

async function getNextPosition(
  ctx: McpContext,
  columnId: string,
  ideaId: string
): Promise<number> {
  const { data } = await ctx.supabase
    .from("board_tasks")
    .select("position")
    .eq("column_id", columnId)
    .eq("idea_id", ideaId)
    .order("position", { ascending: false })
    .limit(1);

  const maxPos = data?.[0]?.position ?? -POSITION_GAP;
  return maxPos + POSITION_GAP;
}

export const createTaskSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  column_id: z.string().uuid().describe("The column to create the task in"),
  title: z.string().min(1).max(200).describe("Task title"),
  description: z
    .string()
    .max(10000)
    .optional()
    .describe("Task description (markdown)"),
  assignee_id: z
    .string()
    .uuid()
    .optional()
    .describe("User ID to assign the task to"),
  due_date: z
    .string()
    .optional()
    .describe("Due date in ISO 8601 format (YYYY-MM-DD)"),
  discussion_id: z
    .string()
    .uuid()
    .optional()
    .describe("Link task back to a source discussion (for converted discussions)"),
  priority: z
    .enum(["low", "medium", "high", "urgent"])
    .default("medium")
    .describe("Task priority level (default: medium)"),
});

export async function createTask(ctx: McpContext, params: z.infer<typeof createTaskSchema>) {
  const position = await getNextPosition(ctx, params.column_id, params.idea_id);

  const { data: task, error } = await ctx.supabase
    .from("board_tasks")
    .insert({
      idea_id: params.idea_id,
      column_id: params.column_id,
      title: params.title,
      description: params.description ?? null,
      assignee_id: params.assignee_id ?? null,
      due_date: params.due_date ?? null,
      discussion_id: params.discussion_id ?? null,
      priority: params.priority,
      position,
    })
    .select("id, title, column_id, position")
    .single();

  if (error) throw new Error(`Failed to create task: ${error.message}`);

  await logActivity(ctx, task.id, params.idea_id, "created");

  if (params.assignee_id) {
    await logActivity(ctx, task.id, params.idea_id, "assigned", {
      assignee_id: params.assignee_id,
    });
  }

  if (params.due_date) {
    await logActivity(ctx, task.id, params.idea_id, "due_date_set", {
      due_date: params.due_date,
    });
  }

  return { success: true, task };
}

export const updateTaskSchema = z.object({
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
  title: z.string().min(1).max(200).optional().describe("New title"),
  description: z
    .string()
    .max(10000)
    .nullable()
    .optional()
    .describe("New description (null to clear)"),
  assignee_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe("New assignee (null to unassign)"),
  due_date: z
    .string()
    .nullable()
    .optional()
    .describe("New due date (null to clear)"),
  archived: z.boolean().optional().describe("Archive or unarchive the task"),
  priority: z
    .enum(["low", "medium", "high", "urgent"])
    .optional()
    .describe("Task priority level"),
});

export async function updateTask(ctx: McpContext, params: z.infer<typeof updateTaskSchema>) {
  // Fetch current task for activity diffs
  const { data: current } = await ctx.supabase
    .from("board_tasks")
    .select("title, description, assignee_id, due_date, archived, priority")
    .eq("id", params.task_id)
    .single();

  if (!current) throw new Error(`Task not found: ${params.task_id}`);

  const updates: Record<string, unknown> = {};
  if (params.title !== undefined) updates.title = params.title;
  if (params.description !== undefined) updates.description = params.description;
  if (params.assignee_id !== undefined) updates.assignee_id = params.assignee_id;
  if (params.due_date !== undefined) updates.due_date = params.due_date;
  if (params.archived !== undefined) updates.archived = params.archived;
  if (params.priority !== undefined) updates.priority = params.priority;

  if (Object.keys(updates).length === 0) {
    return { success: true, message: "No changes to apply" };
  }

  const { data: task, error } = await ctx.supabase
    .from("board_tasks")
    .update(updates)
    .eq("id", params.task_id)
    .eq("idea_id", params.idea_id)
    .select("id, title")
    .single();

  if (error) throw new Error(`Failed to update task: ${error.message}`);

  // Log activity for each change
  if (params.title !== undefined && params.title !== current.title) {
    await logActivity(ctx, params.task_id, params.idea_id, "title_changed", {
      from: current.title,
      to: params.title,
    });
  }
  if (
    params.description !== undefined &&
    params.description !== current.description
  ) {
    await logActivity(ctx, params.task_id, params.idea_id, "description_changed");
  }
  if (params.assignee_id !== undefined && params.assignee_id !== current.assignee_id) {
    if (params.assignee_id) {
      await logActivity(ctx, params.task_id, params.idea_id, "assigned", {
        assignee_id: params.assignee_id,
      });
    } else {
      await logActivity(ctx, params.task_id, params.idea_id, "unassigned", {
        assignee_id: current.assignee_id!,
      });
    }
  }
  if (params.due_date !== undefined && params.due_date !== current.due_date) {
    if (params.due_date) {
      await logActivity(ctx, params.task_id, params.idea_id, "due_date_set", {
        due_date: params.due_date,
      });
    } else {
      await logActivity(ctx, params.task_id, params.idea_id, "due_date_removed");
    }
  }
  if (params.archived !== undefined && params.archived !== current.archived) {
    await logActivity(
      ctx,
      params.task_id,
      params.idea_id,
      params.archived ? "archived" : "unarchived"
    );
  }
  if (params.priority !== undefined && params.priority !== current.priority) {
    await logActivity(ctx, params.task_id, params.idea_id, "priority_changed", {
      from: current.priority,
      to: params.priority,
    });
  }

  return { success: true, task };
}

export const moveTaskSchema = z.object({
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
  column_id: z.string().uuid().describe("Target column ID"),
  position: z.coerce
    .number()
    .optional()
    .describe("Target position (auto-calculated if omitted)"),
});

export async function moveTask(ctx: McpContext, params: z.infer<typeof moveTaskSchema>) {
  const position =
    params.position ?? (await getNextPosition(ctx, params.column_id, params.idea_id));

  // Get column name for activity log
  const { data: column } = await ctx.supabase
    .from("board_columns")
    .select("title")
    .eq("id", params.column_id)
    .single();

  const { error } = await ctx.supabase
    .from("board_tasks")
    .update({ column_id: params.column_id, position })
    .eq("id", params.task_id)
    .eq("idea_id", params.idea_id);

  if (error) throw new Error(`Failed to move task: ${error.message}`);

  await logActivity(ctx, params.task_id, params.idea_id, "moved", {
    to_column: column?.title ?? params.column_id,
  });

  return { success: true, column: column?.title, position };
}

export const deleteTaskSchema = z.object({
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function deleteTask(ctx: McpContext, params: z.infer<typeof deleteTaskSchema>) {
  const { error } = await ctx.supabase
    .from("board_tasks")
    .delete()
    .eq("id", params.task_id)
    .eq("idea_id", params.idea_id);

  if (error) throw new Error(`Failed to delete task: ${error.message}`);
  return { success: true };
}
