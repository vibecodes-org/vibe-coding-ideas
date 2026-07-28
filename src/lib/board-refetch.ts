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
import { chunkIds } from "@/lib/db-helpers";

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
 * Fetch `board_task_labels` rows for a bounded set of `label_id`s, chunked to
 * stay under the `.in()` URL-length limit (`chunkIds`, `IN_FILTER_CHUNK_SIZE`).
 *
 * Replaces the old `board_tasks!inner(idea_id)` join-through-tasks shape,
 * which forced Postgres to evaluate `board_task_labels`'s RLS `EXISTS` policy
 * (a correlated subquery calling the VOLATILE `is_idea_team_member()`)
 * against every row of the whole platform-wide table before the app's own
 * `idea_id` filter could narrow anything — 71x slower in production than the
 * `.in("task_id", …)` form it replaced. Filtering by `label_id` up front lets
 * the planner narrow first, cutting the RLS subplan's row count from
 * "every row in the table" down to "rows matching these labels".
 *
 * Correct without the idea_id join: every `board_labels` row belongs to
 * exactly one idea (`UNIQUE (idea_id, lower(name))`), so `label_id IN (this
 * board's — or these boards' — label ids)` scopes exactly as tightly as the
 * join did. Chunked (not a single `.in()`) because the dashboard's
 * multi-idea caller unions labels across every idea a user owns or
 * collaborates on, which is not bounded the way a single board's label count
 * is.
 */
export async function fetchTaskLabelsByLabelIds(
  supabase: SupabaseClient<Database>,
  labelIds: readonly string[]
): Promise<{ data: RawTaskLabelRow[] | null; error: { message: string } | null }> {
  if (labelIds.length === 0) return { data: [], error: null };

  const results = await Promise.all(
    chunkIds(labelIds).map((chunk) =>
      supabase
        .from("board_task_labels")
        .select("task_id, label:board_labels!board_task_labels_label_id_fkey(*)")
        .in("label_id", chunk)
    )
  );

  const firstError = results.find((r) => r.error)?.error;
  if (firstError) return { data: null, error: { message: firstError.message } };

  return { data: results.flatMap((r) => (r.data ?? []) as RawTaskLabelRow[]), error: null };
}

/**
 * Reduce Supabase Storage `createSignedUrls` results to a path→URL map, mirroring
 * the board page RSC's cover-image composition exactly. Skips entries the storage
 * API couldn't sign (each entry carries its own `error`, leaving `signedUrl`/`path`
 * unusable). Pure/no I/O so it can be unit-tested in isolation.
 */
export function composeCoverImageUrls(
  signedUrls: { path: string | null; signedUrl: string }[] | null
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!signedUrls) return map;
  for (const entry of signedUrls) {
    if (entry.signedUrl && entry.path) map[entry.path] = entry.signedUrl;
  }
  return map;
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
  /** The board's label definitions (master list backing the label picker/filter). */
  boardLabels: BoardLabel[];
  /** Fresh cover-image signed URLs keyed by storage path (1h TTL, same as RSC). */
  coverImageUrls: Record<string, string>;
}

/**
 * Re-mint cover-image signed URLs for the tasks we just fetched, exactly as the
 * board page RSC does (single batched `createSignedUrls`, 1h TTL). Rare on the
 * hot path — most boards have no cover images, so the storage call is skipped
 * entirely. A signing failure degrades to an empty map (callers merge additively,
 * so covers just aren't refreshed this cycle) rather than failing the refetch.
 */
async function fetchCoverImageUrls(
  supabase: SupabaseClient<Database>,
  rawTasks: RawTaskRow[]
): Promise<Record<string, string>> {
  const coverPaths = rawTasks.map((t) => t.cover_image_path).filter((p): p is string => !!p);
  if (coverPaths.length === 0) return {};
  try {
    const { data: signedUrls, error } = await supabase.storage
      .from("task-attachments")
      .createSignedUrls(coverPaths, 3600);
    if (error) {
      logger.warn("Board refetch cover-URL signing failed", { error: error.message });
      return {};
    }
    return composeCoverImageUrls(signedUrls);
  } catch (err) {
    logger.warn("Board refetch cover-URL signing threw", { error: err instanceof Error ? err.message : String(err) });
    return {};
  }
}

/**
 * Client-side refetch of the LIVE board tables that BoardRealtime subscribes
 * to and that feed KanbanBoard's server-merge machinery: board_columns,
 * board_tasks (+ assignee/labels join, workflow_step_* counts), open
 * workflow_suggestions, the board's label definitions (board_labels), and
 * cover-image signed URLs for the current tasks.
 *
 * Deliberately scoped down from a full page reload: team members, agents, and
 * profile/AI-access are NOT refetched here — they stay whatever the board
 * mounted with (they don't change under normal board use). Everything that DOES
 * churn while a board is open (including agents creating labels over MCP, which
 * is why board_labels is now included) gets a router.refresh()-free path.
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
      // Master label list backing the picker/filter — same order() as the RSC page
      // so the two paths can't drift. Fetched in this batch (not after) because
      // the task-labels query below needs its ids up front.
      { data: rawBoardLabels, error: boardLabelsError },
      { data: suggestionRows, error: suggestionsError },
    ] = await Promise.all([
      supabase.from("board_columns").select("*").eq("idea_id", ideaId).order("position", { ascending: true }),
      supabase
        .from("board_tasks")
        .select("*, assignee:users!board_tasks_assignee_id_fkey(*)")
        .eq("idea_id", ideaId)
        .order("position", { ascending: true }),
      supabase.from("board_labels").select("*").eq("idea_id", ideaId).order("created_at", { ascending: true }),
      supabase
        .from("workflow_suggestions")
        .select("task_id, source, reason, adjudication_started_at")
        .eq("idea_id", ideaId)
        .eq("status", "suggested"),
    ]);

    const batchError = columnsError ?? tasksError ?? boardLabelsError ?? suggestionsError;
    if (batchError) {
      logger.warn("Board refetch query failed", { ideaId, error: batchError.message });
      return null;
    }

    // Depends on rawBoardLabels resolving first — see fetchTaskLabelsByLabelIds
    // for why label_id (not the old board_tasks!inner(idea_id) join) is the
    // filter, and why this can't just join into the Promise.all above.
    const boardLabelIds = (rawBoardLabels ?? []).map((l) => l.id);
    const { data: taskLabelRows, error: labelsError } = await fetchTaskLabelsByLabelIds(supabase, boardLabelIds);
    if (labelsError) {
      logger.warn("Board refetch query failed", { ideaId, error: labelsError.message });
      return null;
    }

    const typedTasks = (rawTasks ?? []) as RawTaskRow[];
    const coverImageUrls = await fetchCoverImageUrls(supabase, typedTasks);

    return {
      columns: composeBoardColumns(rawColumns ?? [], typedTasks, taskLabelRows as RawTaskLabelRow[] | null),
      suggestionsByTask: composeSuggestionsByTask(suggestionRows as RawSuggestionRow[] | null, Date.now()),
      boardLabels: (rawBoardLabels ?? []) as BoardLabel[],
      coverImageUrls,
    };
  } catch (err) {
    logger.warn("Board refetch threw", { ideaId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
