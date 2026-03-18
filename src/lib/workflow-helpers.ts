import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkflowTemplateStep } from "@/types/database";

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
 * Check if removing a label would orphan a workflow applied by an auto-rule.
 * If so, returns info about the active workflow run. Does NOT delete anything.
 */
export async function checkAutoRuleWorkflow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  taskId: string,
  labelId: string,
  ideaId: string
): Promise<{ hasActiveWorkflow: boolean; runId?: string; templateName?: string }> {
  // Find matching auto-rule for this idea + label
  const { data: rule } = await supabase
    .from("workflow_auto_rules")
    .select("id, template_id, workflow_templates(name)")
    .eq("idea_id", ideaId)
    .eq("label_id", labelId)
    .maybeSingle();

  if (!rule) return { hasActiveWorkflow: false };

  // Check for active workflow run on this task matching the rule's template
  const { data: activeRun } = await supabase
    .from("workflow_runs")
    .select("id")
    .eq("task_id", taskId)
    .eq("template_id", rule.template_id)
    .not("status", "in", '("completed","failed")')
    .maybeSingle();

  if (!activeRun) return { hasActiveWorkflow: false };

  const templateName =
    (rule.workflow_templates as unknown as { name: string } | null)?.name ?? undefined;

  return { hasActiveWorkflow: true, runId: activeRun.id, templateName };
}

/**
 * Remove the workflow run applied by an auto-rule when its label is removed.
 * Only removes active runs (pending/running/paused) — completed/failed are preserved.
 * Steps cascade-delete via FK.
 */
export async function removeAutoRuleWorkflow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  taskId: string,
  labelId: string,
  ideaId: string
): Promise<{ removed: boolean; templateName?: string }> {
  const check = await checkAutoRuleWorkflow(supabase, taskId, labelId, ideaId);

  if (!check.hasActiveWorkflow || !check.runId) {
    return { removed: false };
  }

  const { error } = await supabase
    .from("workflow_runs")
    .delete()
    .eq("id", check.runId);

  if (error) {
    console.error(
      `[removeAutoRuleWorkflow] Failed to delete workflow run=${check.runId}:`,
      error
    );
    return { removed: false };
  }

  return { removed: true, templateName: check.templateName };
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

/**
 * Propagate template step edits to pending steps in active workflow runs.
 * Only updates steps with status = 'pending'. Skips runs where the step
 * count differs (structural changes are too risky to propagate).
 * Does NOT re-match bot_id — use rematch_workflow_agents separately.
 */
export async function propagateTemplateEdits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  templateId: string,
  newSteps: WorkflowTemplateStep[]
): Promise<{ runsUpdated: number; stepsUpdated: number; skippedStructuralMismatch: number }> {
  // Find active runs for this template
  const { data: activeRuns } = await supabase
    .from("workflow_runs")
    .select("id")
    .eq("template_id", templateId)
    .not("status", "in", '("completed","failed")');

  if (!activeRuns || activeRuns.length === 0) {
    return { runsUpdated: 0, stepsUpdated: 0, skippedStructuralMismatch: 0 };
  }

  let runsUpdated = 0;
  let stepsUpdated = 0;
  let skippedStructuralMismatch = 0;

  for (const run of activeRuns) {
    const { data: steps } = await supabase
      .from("task_workflow_steps")
      .select("id, status, step_order")
      .eq("run_id", run.id)
      .order("step_order", { ascending: true });

    if (!steps || steps.length !== newSteps.length) {
      skippedStructuralMismatch++;
      continue;
    }

    let runHadUpdates = false;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.status !== "pending") continue;

      const templateStep = newSteps[i];
      const { count } = await supabase
        .from("task_workflow_steps")
        .update({
          title: templateStep.title,
          description: templateStep.description ?? null,
          agent_role: templateStep.role,
          human_check_required: templateStep.requires_approval ?? false,
          expected_deliverables: templateStep.deliverables ?? [],
        })
        .eq("id", step.id)
        .eq("status", "pending");

      if (count && count > 0) {
        stepsUpdated++;
        runHadUpdates = true;
      }
    }

    if (runHadUpdates) runsUpdated++;
  }

  return { runsUpdated, stepsUpdated, skippedStructuralMismatch };
}
