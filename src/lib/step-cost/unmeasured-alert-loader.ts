// Card fe1896ee: reads for the board strip. Kept apart from the pure logic so
// that file stays free of database code.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchAllRows } from "@/lib/db-helpers";
import { logger } from "@/lib/logger";
import {
  alertWindowStart,
  buildUnmeasuredAlert,
  flaggedRuns,
  type UnmeasuredAlert,
  type UnmeasuredAlertRow,
} from "./unmeasured-alert";

export interface UnmeasuredAlertData {
  rows: UnmeasuredAlertRow[];
  /** run id -> card id, for the flagged runs only. */
  runTasks: Map<string, string>;
}

/**
 * Records from the look-back window plus the card of each flagged run.
 * Returns null when nothing is flagged, and also when a read fails: a failed
 * read is logged and shows no strip, it never breaks the board.
 */
export async function loadUnmeasuredAlertData(
  supabase: SupabaseClient<Database>,
  ideaId: string,
  now: Date = new Date()
): Promise<UnmeasuredAlertData | null> {
  try {
    const since = alertWindowStart(now);
    // Paged: a bad week was over 200 rows and a bare select stops at 1,000 without an error.
    const { data, error } = await fetchAllRows<UnmeasuredAlertRow>((from, to) =>
      supabase
        .from("workflow_step_unmeasured")
        .select("run_id, kind, reason, created_at")
        .eq("idea_id", ideaId)
        .neq("kind", "codex")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    );
    if (error) {
      logger.warn("Unmeasured-cost alert read failed", { ideaId, message: error.message });
      return null;
    }
    const rows = data ?? [];
    const flagged = flaggedRuns(rows);
    if (flagged.length === 0) return null;

    const { data: runs, error: runError } = await supabase
      .from("workflow_runs")
      .select("id, task_id")
      .in("id", flagged.map((f) => f.runId));
    if (runError) {
      logger.warn("Unmeasured-cost alert run read failed", { ideaId, message: runError.message });
      return null;
    }
    return { rows, runTasks: new Map((runs ?? []).map((r) => [r.id, r.task_id])) };
  } catch (err) {
    logger.warn("Unmeasured-cost alert failed", {
      ideaId,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Join the card titles in (archived or missing cards get no link) and build the strip payload. */
export function toUnmeasuredAlert(
  data: UnmeasuredAlertData | null,
  tasks: ReadonlyArray<{ id: string; title: string; archived: boolean }>
): UnmeasuredAlert | null {
  if (!data) return null;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const cardsByRun = new Map<string, { taskId: string; title: string } | null>();
  for (const [runId, taskId] of data.runTasks) {
    const t = byId.get(taskId);
    cardsByRun.set(runId, t && !t.archived ? { taskId: t.id, title: t.title } : null);
  }
  return buildUnmeasuredAlert(data.rows, cardsByRun);
}
