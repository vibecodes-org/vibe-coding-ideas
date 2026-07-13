import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  BoardColumn,
  BoardColumnWithTasks,
  BoardTask,
  BoardTaskWithAssignee,
  BoardLabel,
  BoardSuggestionIndicator,
  User,
  WorkflowSuggestion,
} from "@/types";
import { WORKFLOW_AI_ADJUDICATION_TIMEOUT_MS } from "@/lib/workflow-suggestion-constants";
import { logger } from "@/lib/logger";

// Raw row shapes as returned by the Supabase queries below — same loose typing
// (cast at composition time) the board page RSC already uses for these joins.
type RawTaskRow = BoardTask & { assignee: unknown };
type RawTaskLabelRow = { task_id: string; label: unknown };
type RawSuggestionRow = {
  task_id: string;
  source: WorkflowSuggestion["source"];
  reason: string | null;
  adjudication_started_at: string | null;
};

/**
 * Assemble columns-with-tasks exactly as the board page RSC does: attach the
 * resolved assignee and per-task labels (via board_task_labels) onto each raw
 * board_tasks row, then bucket rows into their board_columns parent.
 *
 * workflow_step_total/completed/in_progress/failed/awaiting_approval are
 * denormalized columns on board_tasks itself (see database.ts), so they ride
 * along on `rawTasks` with no separate task_workflow_steps query needed.
 *
 * Pure/no I/O — shared by the board page (initial SSR render) and
 * `fetchBoardRefreshData` (client-side realtime refetch) so the two paths
 * cannot drift apart.
 */
export function composeBoardColumns(
  rawColumns: BoardColumn[],
  rawTasks: RawTaskRow[],
  taskLabelRows: RawTaskLabelRow[] | null
): BoardColumnWithTasks[] {
  const taskLabelsMap: Record<string, BoardLabel[]> = {};
  if (taskLabelRows) {
    for (const row of taskLabelRows) {
      if (!row.label) continue;
      const label = row.label as unknown as BoardLabel;
      if (!taskLabelsMap[row.task_id]) {
        taskLabelsMap[row.task_id] = [];
      }
      taskLabelsMap[row.task_id].push(label);
    }
  }

  return rawColumns.map((col) => ({
    ...col,
    tasks: rawTasks
      .filter((t) => t.column_id === col.id)
      .map((t) => ({
        ...t,
        assignee: (t.assignee as unknown as User) ?? null,
        labels: taskLabelsMap[t.id] ?? [],
      })) as BoardTaskWithAssignee[],
  }));
}

/**
 * Reduce open workflow_suggestions rows to one indicator per task (first open
 * suggestion wins) — mirrors the board page RSC's composition exactly.
 */
export function composeSuggestionsByTask(
  suggestionRows: RawSuggestionRow[] | null,
  now: number
): Record<string, BoardSuggestionIndicator> {
  const suggestionsByTask: Record<string, BoardSuggestionIndicator> = {};
  if (suggestionRows) {
    for (const row of suggestionRows) {
      // One indicator per task — first open suggestion wins.
      if (suggestionsByTask[row.task_id]) continue;
      const adjudicating =
        !row.reason &&
        !!row.adjudication_started_at &&
        now - new Date(row.adjudication_started_at).getTime() < WORKFLOW_AI_ADJUDICATION_TIMEOUT_MS;
      suggestionsByTask[row.task_id] = { source: row.source, adjudicating };
    }
  }
  return suggestionsByTask;
}

export interface BoardRefreshData {
  columns: BoardColumnWithTasks[];
  suggestionsByTask: Record<string, BoardSuggestionIndicator>;
}

/**
 * Client-side refetch of the LIVE board tables that BoardRealtime subscribes
 * to and that feed KanbanBoard's server-merge machinery: board_columns,
 * board_tasks (+ assignee/labels join, workflow_step_* counts), and open
 * workflow_suggestions.
 *
 * Deliberately scoped down from a full page reload: team members, agents,
 * profile/AI-access, cover image signed URLs, and the board's label
 * definitions are NOT refetched here — they stay whatever the board mounted
 * with, matching the approved fix design (only the tables that drive constant
 * agent-over-MCP churn need a router.refresh()-free path).
 *
 * Returns null (after logging a warning) on any query failure so callers can
 * skip the merge and keep showing the last-known-good board instead of
 * crashing or blanking it out.
 */
export async function fetchBoardRefreshData(
  supabase: SupabaseClient<Database>,
  ideaId: string
): Promise<BoardRefreshData | null> {
  try {
    const [
      { data: rawColumns, error: columnsError },
      { data: rawTasks, error: tasksError },
      { data: taskLabelRows, error: labelsError },
      { data: suggestionRows, error: suggestionsError },
    ] = await Promise.all([
      supabase.from("board_columns").select("*").eq("idea_id", ideaId).order("position", { ascending: true }),
      supabase
        .from("board_tasks")
        .select("*, assignee:users!board_tasks_assignee_id_fkey(*)")
        .eq("idea_id", ideaId)
        .order("position", { ascending: true }),
      // Same inner-join-scoped filter the page uses — board_task_labels has no
      // idea_id column, and a giant .in(taskIds) list silently drops rows once
      // the URL grows too large on big boards.
      supabase
        .from("board_task_labels")
        .select("task_id, label:board_labels!board_task_labels_label_id_fkey(*), board_tasks!inner(idea_id)")
        .eq("board_tasks.idea_id", ideaId),
      supabase
        .from("workflow_suggestions")
        .select("task_id, source, reason, adjudication_started_at")
        .eq("idea_id", ideaId)
        .eq("status", "suggested"),
    ]);

    const error = columnsError ?? tasksError ?? labelsError ?? suggestionsError;
    if (error) {
      logger.warn("Board refetch query failed", { ideaId, error: error.message });
      return null;
    }

    return {
      columns: composeBoardColumns(rawColumns ?? [], (rawTasks ?? []) as RawTaskRow[], taskLabelRows as RawTaskLabelRow[] | null),
      suggestionsByTask: composeSuggestionsByTask(suggestionRows as RawSuggestionRow[] | null, Date.now()),
    };
  } catch (err) {
    logger.warn("Board refetch threw", { ideaId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
