import { z } from "zod";
import { POSITION_GAP } from "../constants";
import { logActivity } from "../activity";
import type { McpContext } from "../context";
import { checkAndApplyAutoRules } from "../../../src/lib/workflow-helpers";
import { applyWorkflowTemplate } from "./workflows";

/** Auto-add a user as collaborator on an idea if they aren't already (author or collaborator). */
async function ensureCollaborator(ctx: McpContext, ideaId: string, userId: string) {
  // Check if user is the idea author
  const { data: idea } = await ctx.supabase
    .from("ideas")
    .select("author_id")
    .eq("id", ideaId)
    .single();
  if (idea?.author_id === userId) return;

  // Upsert collaborator (ignore conflict = already a collaborator)
  await ctx.supabase
    .from("collaborators")
    .upsert({ idea_id: ideaId, user_id: userId }, { onConflict: "idea_id,user_id", ignoreDuplicates: true });
}

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
  labels: z
    .array(z.string().min(1).max(50))
    .optional()
    .describe("Label names to attach (e.g. [\"bug\", \"frontend\"]). Matched case-insensitively against existing board labels."),
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
      position,
    })
    .select("id, title, column_id, position")
    .single();

  if (error) throw new Error(`Failed to create task: ${error.message}`);

  await logActivity(ctx, task.id, params.idea_id, "created");

  if (params.assignee_id) {
    await ensureCollaborator(ctx, params.idea_id, params.assignee_id);
    await logActivity(ctx, task.id, params.idea_id, "assigned", {
      assignee_id: params.assignee_id,
    });
  }

  if (params.due_date) {
    await logActivity(ctx, task.id, params.idea_id, "due_date_set", {
      due_date: params.due_date,
    });
  }

  // Attach labels by name (case-insensitive match against existing board labels)
  const attachedLabels: { id: string; name: string }[] = [];
  if (params.labels && params.labels.length > 0) {
    const { data: boardLabels } = await ctx.supabase
      .from("board_labels")
      .select("id, name")
      .eq("idea_id", params.idea_id);

    const labelMap = new Map(
      (boardLabels ?? []).map((l) => [l.name.toLowerCase(), l])
    );

    for (const labelName of params.labels) {
      const match = labelMap.get(labelName.toLowerCase());
      if (!match) continue;

      const { error: linkError } = await ctx.supabase
        .from("board_task_labels")
        .insert({ task_id: task.id, label_id: match.id });

      if (!linkError) {
        attachedLabels.push({ id: match.id, name: match.name });
        await logActivity(ctx, task.id, params.idea_id, "label_added", {
          label_name: match.name,
        });
        // Must await adjudication here: the MCP route has no after()/waitUntil
        // to schedule post-response work, so a fire-and-forget promise gets
        // killed by the serverless runtime once this tool call returns,
        // silently dropping the AI adjudication.
        await checkAndApplyAutoRules(
          ctx.supabase, task.id, match.id, params.idea_id,
          (taskId, templateId) => applyWorkflowTemplate(ctx, { task_id: taskId, template_id: templateId }),
          {
            userId: ctx.ownerUserId ?? ctx.userId,
            isAutonomousAgent: !!ctx.ownerUserId && ctx.ownerUserId !== ctx.userId,
            awaitAdjudication: true,
          }
        );
      }
    }
  }

  return { success: true, task, labels: attachedLabels };
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
});

export async function updateTask(ctx: McpContext, params: z.infer<typeof updateTaskSchema>) {
  // Fetch current task for activity diffs (and, when assignee_id is part of
  // this update, as the optimistic-concurrency precondition below).
  const { data: current } = await ctx.supabase
    .from("board_tasks")
    .select("title, description, assignee_id, due_date, archived")
    .eq("id", params.task_id)
    .single();

  if (!current) throw new Error(`Task not found: ${params.task_id}`);

  const updates: Record<string, unknown> = {};
  if (params.title !== undefined) updates.title = params.title;
  if (params.description !== undefined) updates.description = params.description;
  if (params.assignee_id !== undefined) updates.assignee_id = params.assignee_id;
  if (params.due_date !== undefined) updates.due_date = params.due_date;
  if (params.archived !== undefined) updates.archived = params.archived;

  if (Object.keys(updates).length === 0) {
    return { success: true, message: "No changes to apply" };
  }

  // Assignment is racy across concurrent callers: two self-assign calls can
  // both read the same pre-update assignee_id and both proceed to write, so
  // the last writer silently wins. Gate the write on the assignee_id we just
  // read above, mirroring claim_next_step's read-then-conditionally-write
  // pattern (see claimNextStep in workflows.ts) — the precondition travels
  // in the SAME round trip as the write itself, so nothing can slip in
  // between a separate read and write.
  const guardingAssignee = params.assignee_id !== undefined;
  let write = ctx.supabase
    .from("board_tasks")
    .update(updates)
    .eq("id", params.task_id)
    .eq("idea_id", params.idea_id);

  if (guardingAssignee) {
    write =
      current.assignee_id === null
        ? write.is("assignee_id", null)
        : write.eq("assignee_id", current.assignee_id);
  }

  const { data: task, error } = await write.select("id, title").maybeSingle();

  if (error) throw new Error(`Failed to update task: ${error.message}`);
  if (!task) {
    if (guardingAssignee) {
      throw new Error(
        "This task was already assigned by someone else — refresh and try again."
      );
    }
    throw new Error(`Task not found: ${params.task_id}`);
  }

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
      await ensureCollaborator(ctx, params.idea_id, params.assignee_id);
      await logActivity(ctx, params.task_id, params.idea_id, "assigned", {
        assignee_id: params.assignee_id,
      });
      // Auto-set working_started_at for bot assignees on non-workflow tasks
      const { data: assignee } = await ctx.supabase
        .from("bot_profiles")
        .select("id")
        .eq("id", params.assignee_id)
        .maybeSingle();
      if (assignee) {
        // Only set if task has no active workflow run
        const { count } = await ctx.supabase
          .from("workflow_runs")
          .select("*", { head: true, count: "exact" })
          .eq("task_id", params.task_id)
          .not("status", "in", '("completed","failed")');
        if ((count ?? 0) === 0) {
          // Guard against a concurrent reassignment/unassignment racing in
          // between the guarded assignment write above and this secondary
          // write — only touch working_started_at if the assignee we just
          // set is still in place.
          await ctx.supabase
            .from("board_tasks")
            .update({ working_started_at: new Date().toISOString() })
            .eq("id", params.task_id)
            .eq("assignee_id", params.assignee_id);
        }
      }
    } else {
      await logActivity(ctx, params.task_id, params.idea_id, "unassigned", {
        assignee_id: current.assignee_id!,
      });
      // Clear working_started_at when unassigned — guarded the same way, so
      // a concurrent reassignment that raced in doesn't get its
      // working_started_at wiped out from under it.
      await ctx.supabase
        .from("board_tasks")
        .update({ working_started_at: null })
        .eq("id", params.task_id)
        .is("assignee_id", null);
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

  // Read the task's CURRENT column (not just the target one, which is fetched
  // below purely for the activity log / done-column check) so the write can
  // be gated on it — mirrors claim_next_step's read-then-conditionally-write
  // pattern, protecting against two concurrent moves of the same task.
  const { data: currentTask } = await ctx.supabase
    .from("board_tasks")
    .select("column_id")
    .eq("id", params.task_id)
    .eq("idea_id", params.idea_id)
    .single();

  if (!currentTask) throw new Error(`Task not found: ${params.task_id}`);

  // Get column details for activity log + done column check
  const { data: column } = await ctx.supabase
    .from("board_columns")
    .select("title, is_done_column")
    .eq("id", params.column_id)
    .single();

  // Clear working_started_at when moved to a done column
  const taskUpdate: Record<string, unknown> = { column_id: params.column_id, position };
  if (column?.is_done_column) {
    taskUpdate.working_started_at = null;
  }

  const { data: moved, error } = await ctx.supabase
    .from("board_tasks")
    .update(taskUpdate)
    .eq("id", params.task_id)
    .eq("idea_id", params.idea_id)
    .eq("column_id", currentTask.column_id)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Failed to move task: ${error.message}`);
  if (!moved) {
    throw new Error(
      "This task was already moved by someone else — refresh and try again."
    );
  }

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
