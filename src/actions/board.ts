"use server";

import { createClient } from "@/lib/supabase/server";
import { DEFAULT_BOARD_COLUMNS, POSITION_GAP } from "@/lib/constants";
import { validateTitle, validateOptionalDescription, validateLabelName, validateLabelColor, validateComment } from "@/lib/validation";
import { checkAndApplyAutoRules, checkAutoRuleWorkflow, removeAutoRuleWorkflow } from "@/lib/workflow-helpers";
import { applyWorkflowTemplate, applyWorkflowTemplateWithContext } from "@/actions/workflow-templates";
import { logger } from "@/lib/logger";
import type { RoleMatchWithTier } from "@/lib/ai-role-matching";

export async function initializeBoardColumns(ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Check if columns already exist
  const { data: existing } = await supabase
    .from("board_columns")
    .select("id")
    .eq("idea_id", ideaId)
    .limit(1);

  if (existing && existing.length > 0) return;

  // Check for user's custom default columns
  const { data: userProfile } = await supabase
    .from("users")
    .select("default_board_columns")
    .eq("id", user.id)
    .single();

  const columnDefs = userProfile?.default_board_columns ?? DEFAULT_BOARD_COLUMNS;

  const columns = columnDefs.map((col, i) => ({
    idea_id: ideaId,
    title: col.title,
    position: i * POSITION_GAP,
    is_done_column: col.is_done_column,
  }));

  await supabase.from("board_columns").insert(columns);
}

export async function createBoardColumn(ideaId: string, title: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  title = validateTitle(title);

  // Get max position
  const { data: cols } = await supabase
    .from("board_columns")
    .select("position")
    .eq("idea_id", ideaId)
    .order("position", { ascending: false })
    .limit(1);

  const maxPos = cols && cols.length > 0 ? cols[0].position : -POSITION_GAP;

  const { data, error } = await supabase
    .from("board_columns")
    .insert({
      idea_id: ideaId,
      title,
      position: maxPos + POSITION_GAP,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
  return data;
}

export async function updateBoardColumn(
  columnId: string,
  ideaId: string,
  title: string,
  isDoneColumn?: boolean
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  title = validateTitle(title);

  const updates: { title: string; is_done_column?: boolean } = { title };
  if (isDoneColumn !== undefined) {
    updates.is_done_column = isDoneColumn;
  }

  const { error } = await supabase
    .from("board_columns")
    .update(updates)
    .eq("id", columnId)
    .eq("idea_id", ideaId);

  if (error) throw new Error(error.message);

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
}

export async function deleteBoardColumn(columnId: string, ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("board_columns")
    .delete()
    .eq("id", columnId)
    .eq("idea_id", ideaId);

  if (error) throw new Error(error.message);

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
}

export async function reorderBoardColumns(
  ideaId: string,
  columnIds: string[]
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Update each column's position based on array index
  const updates = columnIds.map((id, index) =>
    supabase
      .from("board_columns")
      .update({ position: index * POSITION_GAP })
      .eq("id", id)
      .eq("idea_id", ideaId)
  );

  await Promise.all(updates);

  // No revalidatePath — Realtime subscription handles sync.
  // Skipping avoids a redundant full server re-render on every column drag.
}

export async function createBoardTask(
  ideaId: string,
  columnId: string,
  title: string,
  description?: string,
  assigneeId?: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  title = validateTitle(title);
  description = validateOptionalDescription(description ?? null) ?? undefined;

  // Get max position in this column
  const { data: tasks } = await supabase
    .from("board_tasks")
    .select("position")
    .eq("column_id", columnId)
    .order("position", { ascending: false })
    .limit(1);

  const maxPos = tasks && tasks.length > 0 ? tasks[0].position : -POSITION_GAP;

  const { data, error } = await supabase
    .from("board_tasks")
    .insert({
      idea_id: ideaId,
      column_id: columnId,
      title,
      description: description || null,
      assignee_id: assigneeId || null,
      position: maxPos + POSITION_GAP,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
  return data.id;
}

export async function updateBoardTask(
  taskId: string,
  ideaId: string,
  updates: {
    title?: string;
    description?: string | null;
    assignee_id?: string | null;
    due_date?: string | null;
    archived?: boolean;
  }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  if (updates.title !== undefined) {
    updates.title = validateTitle(updates.title);
  }
  if (updates.description !== undefined) {
    updates.description = validateOptionalDescription(updates.description ?? null);
  }

  const { error } = await supabase
    .from("board_tasks")
    .update(updates)
    .eq("id", taskId)
    .eq("idea_id", ideaId);

  if (error) throw new Error(error.message);

  // Auto-add bot as collaborator when assigned to a task
  if (updates.assignee_id) {
    const { data: assignee } = await supabase
      .from("users")
      .select("id, is_bot")
      .eq("id", updates.assignee_id)
      .maybeSingle();

    if (assignee?.is_bot) {
      const { data: existingCollab } = await supabase
        .from("collaborators")
        .select("id")
        .eq("idea_id", ideaId)
        .eq("user_id", updates.assignee_id)
        .maybeSingle();

      if (!existingCollab) {
        await supabase
          .from("collaborators")
          .insert({ idea_id: ideaId, user_id: updates.assignee_id });
      }
    }
  }

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
}

export async function archiveColumnTasks(columnId: string, ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Get all non-archived tasks in this column
  const { data: tasks } = await supabase
    .from("board_tasks")
    .select("id")
    .eq("column_id", columnId)
    .eq("idea_id", ideaId)
    .eq("archived", false);

  if (!tasks || tasks.length === 0) return 0;

  const updates = tasks.map((t) =>
    supabase
      .from("board_tasks")
      .update({ archived: true })
      .eq("id", t.id)
      .eq("idea_id", ideaId)
  );

  await Promise.all(updates);

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
  return tasks.length;
}

export async function deleteBoardTask(taskId: string, ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("board_tasks")
    .delete()
    .eq("id", taskId)
    .eq("idea_id", ideaId);

  if (error) throw new Error(error.message);

  // No revalidatePath — Realtime subscription in BoardRealtime handles the
  // refresh for other users. The deleting user already removed the task
  // optimistically, and the pendingOps guard prevents premature state sync.
}

export async function moveBoardTask(
  taskId: string,
  ideaId: string,
  newColumnId: string,
  newPosition: number
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("board_tasks")
    .update({ column_id: newColumnId, position: newPosition })
    .eq("id", taskId)
    .eq("idea_id", ideaId);

  if (error) throw new Error(error.message);

  // No revalidatePath — Realtime subscription handles sync.
  // Skipping avoids a redundant full server re-render on every drag.
}

// ============================================================
// Label actions
// ============================================================

export async function createBoardLabel(
  ideaId: string,
  name: string,
  color: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  name = validateLabelName(name);
  color = validateLabelColor(color);

  const { data, error } = await supabase.from("board_labels").insert({
    idea_id: ideaId,
    name,
    color,
  }).select().single();

  if (error) throw new Error(error.message);

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
  return data;
}

export async function updateBoardLabel(
  labelId: string,
  ideaId: string,
  updates: { name?: string; color?: string }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  if (updates.name !== undefined) {
    updates.name = validateLabelName(updates.name);
  }
  if (updates.color !== undefined) {
    updates.color = validateLabelColor(updates.color);
  }

  const { error } = await supabase
    .from("board_labels")
    .update(updates)
    .eq("id", labelId)
    .eq("idea_id", ideaId);

  if (error) throw new Error(error.message);

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
}

export async function deleteBoardLabel(labelId: string, ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("board_labels")
    .delete()
    .eq("id", labelId)
    .eq("idea_id", ideaId);

  if (error) throw new Error(error.message);

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
}

export async function addLabelToTask(
  taskId: string,
  labelId: string,
  ideaId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.from("board_task_labels").insert({
    task_id: taskId,
    label_id: labelId,
  });

  if (error) throw new Error(error.message);

  // Check for auto-rule workflow application
  await checkAndApplyAutoRules(supabase, taskId, labelId, ideaId, applyWorkflowTemplate);

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
}

export async function addLabelsToTask(
  taskId: string,
  labelIds: string[],
  ideaId: string
) {
  if (labelIds.length === 0) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const rows = labelIds.map((labelId) => ({
    task_id: taskId,
    label_id: labelId,
  }));

  const { error } = await supabase.from("board_task_labels").insert(rows);

  if (error) throw new Error(error.message);

  // Check for auto-rule workflow application for each label
  for (const labelId of labelIds) {
    await checkAndApplyAutoRules(supabase, taskId, labelId, ideaId, applyWorkflowTemplate);
  }

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
}

/**
 * Trigger auto-rules for tasks that already have labels assigned.
 * Uses controlled concurrency (batches of 5) with a shared Supabase client
 * and cached role matching to avoid redundant auth + AI calls.
 */
export async function triggerAutoRulesForTasks(
  taskLabelPairs: { taskId: string; labelIds: string[] }[],
  ideaId: string,
  onProgress?: (taskId: string) => void
) {
  if (taskLabelPairs.length === 0) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Shared role match cache — same template+idea pair reuses AI results
  const roleMatchCache = new Map<string, Record<string, RoleMatchWithTier>>();

  // Wrap applyWorkflowTemplate to use shared client + cache
  const applyFn = (taskId: string, templateId: string) =>
    applyWorkflowTemplateWithContext(supabase, user.id, taskId, templateId, roleMatchCache);

  // Process in batches of 5 for controlled concurrency
  const BATCH_SIZE = 5;
  for (let i = 0; i < taskLabelPairs.length; i += BATCH_SIZE) {
    const batch = taskLabelPairs.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ taskId, labelIds }) => {
        for (const labelId of labelIds) {
          await checkAndApplyAutoRules(supabase, taskId, labelId, ideaId, applyFn);
        }
        onProgress?.(taskId);
      })
    );
  }

  logger.info("Auto-rules triggered", {
    taskCount: taskLabelPairs.length,
    cachedTemplates: roleMatchCache.size,
  });
}

export async function checkLabelAutoRuleWorkflow(
  taskId: string,
  labelId: string,
  ideaId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  return checkAutoRuleWorkflow(supabase, taskId, labelId, ideaId);
}

export async function removeLabelFromTask(
  taskId: string,
  labelId: string,
  ideaId: string,
  removeWorkflow?: boolean
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("board_task_labels")
    .delete()
    .eq("task_id", taskId)
    .eq("label_id", labelId);

  if (error) throw new Error(error.message);

  // Remove associated auto-rule workflow if requested
  let workflowRemoved = false;
  if (removeWorkflow) {
    const result = await removeAutoRuleWorkflow(supabase, taskId, labelId, ideaId);
    workflowRemoved = result.removed;
  }

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
  return { workflowRemoved };
}

// ============================================================
// Workflow step actions are in src/actions/workflow.ts
// ============================================================

// ============================================================
// Task comment actions
// ============================================================

export async function createTaskComment(
  taskId: string,
  ideaId: string,
  content: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  content = validateComment(content);

  const { error } = await supabase.from("board_task_comments").insert({
    task_id: taskId,
    idea_id: ideaId,
    author_id: user.id,
    content,
  });

  if (error) throw new Error(error.message);

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
}

export async function updateTaskComment(
  commentId: string,
  ideaId: string,
  content: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  content = validateComment(content);

  // App-level author check + RLS defense-in-depth
  const { error } = await supabase
    .from("board_task_comments")
    .update({ content })
    .eq("id", commentId)
    .eq("author_id", user.id);

  if (error) throw new Error(error.message);

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
}

export async function deleteTaskComment(commentId: string, ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // RLS enforces: author_id = auth.uid() OR is_bot_owner(author_id, auth.uid())
  const { error } = await supabase
    .from("board_task_comments")
    .delete()
    .eq("id", commentId);

  if (error) throw new Error(error.message);

  // No revalidatePath — board is force-dynamic and Realtime subscription handles sync.
}

// ── Board Switcher ────────────────────────────────────────────────────

export interface RecentBoard {
  ideaId: string;
  title: string;
  lastActivity: string;
}

/** Return up to 5 boards the user owns or collaborates on, ordered by most recent activity. */
export async function getUserRecentBoards(): Promise<RecentBoard[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  // Get ideas the user owns or collaborates on
  const [{ data: ownedIdeas }, { data: collabRows }] = await Promise.all([
    supabase
      .from("ideas")
      .select("id, title, updated_at")
      .eq("author_id", user.id)
      .in("status", ["open", "in_progress"]),
    supabase
      .from("collaborators")
      .select("idea:ideas!collaborators_idea_id_fkey(id, title, updated_at)")
      .eq("user_id", user.id),
  ]);

  // Merge and dedupe
  const ideasMap = new Map<string, { id: string; title: string; updated_at: string }>();
  for (const idea of ownedIdeas ?? []) {
    ideasMap.set(idea.id, idea);
  }
  for (const row of collabRows ?? []) {
    const idea = row.idea as unknown as { id: string; title: string; updated_at: string } | null;
    if (idea && !ideasMap.has(idea.id)) {
      ideasMap.set(idea.id, idea);
    }
  }

  if (ideasMap.size === 0) return [];

  // Only include ideas that have board columns (i.e. have a board set up)
  const ideaIds = [...ideasMap.keys()];
  const { data: columnsData } = await supabase
    .from("board_columns")
    .select("idea_id")
    .in("idea_id", ideaIds);

  const ideaIdsWithBoards = new Set((columnsData ?? []).map((c) => c.idea_id));

  // Build result, sorted by updated_at descending
  const boards: RecentBoard[] = [];
  for (const idea of ideasMap.values()) {
    if (!ideaIdsWithBoards.has(idea.id)) continue;
    boards.push({
      ideaId: idea.id,
      title: idea.title,
      lastActivity: idea.updated_at,
    });
  }

  boards.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  return boards.slice(0, 5);
}
