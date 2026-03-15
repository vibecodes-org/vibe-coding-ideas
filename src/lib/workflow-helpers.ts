import type { SupabaseClient } from "@supabase/supabase-js";

export const TERMINAL_STATUSES = ["completed", "skipped"] as const;

/**
 * Check if all steps in a workflow run are in a terminal state (completed or skipped).
 * If so, mark the run as completed. Failed steps do NOT count as terminal —
 * the run stays running/failed until a retry resolves the failure.
 *
 * Returns true if the run was completed.
 */
export async function checkAndCompleteRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  runId: string
): Promise<boolean> {
  const { data: steps } = await supabase
    .from("task_workflow_steps")
    .select("id, status")
    .eq("run_id", runId);

  if (!steps || steps.length === 0) {
    // Edge case: run with no steps — mark as completed
    await supabase
      .from("workflow_runs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", runId);
    return true;
  }

  const allTerminal = steps.every(
    (s) => s.status === "completed" || s.status === "skipped"
  );

  if (allTerminal) {
    await supabase
      .from("workflow_runs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", runId);
    return true;
  }

  return false;
}
