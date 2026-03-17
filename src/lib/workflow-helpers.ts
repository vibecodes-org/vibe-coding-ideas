import type { SupabaseClient } from "@supabase/supabase-js";

export const TERMINAL_STATUSES = ["completed", "skipped"] as const;

/**
 * Check if any auto-rules match a label being added to a task.
 * If a match is found and no active workflow exists, applies the
 * workflow template. Non-throwing — errors are logged but label
 * assignment always succeeds.
 */
export async function checkAndApplyAutoRules(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  taskId: string,
  labelId: string,
  ideaId: string,
  applyFn: (taskId: string, templateId: string) => Promise<unknown>
): Promise<void> {
  try {
    // Find matching auto-rule for this idea + label
    const { data: rule } = await supabase
      .from("workflow_auto_rules")
      .select("id, template_id")
      .eq("idea_id", ideaId)
      .eq("label_id", labelId)
      .maybeSingle();

    if (!rule) return;

    // Check for existing active workflow run on this task
    const { data: activeRun } = await supabase
      .from("workflow_runs")
      .select("id")
      .eq("task_id", taskId)
      .not("status", "in", '("completed","failed")')
      .maybeSingle();

    if (activeRun) return;

    await applyFn(taskId, rule.template_id);
  } catch (err) {
    console.error(
      `[checkAndApplyAutoRules] Failed to apply auto-rule for task=${taskId} label=${labelId}:`,
      err
    );
  }
}

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
