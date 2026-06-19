import { logger } from "@/lib/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkflowTemplateStep } from "@/types/database";
import {
  decideAutoRuleApplication,
  templateFromRow,
  type GenerateObjectFn,
} from "@/lib/workflow-matching";

export const TERMINAL_STATUSES = ["completed", "skipped"] as const;

/** Fallback label for the workflow chip when the template name is missing. */
export const WORKFLOW_FALLBACK_NAME = "Workflow";

/**
 * Resolve the display name for a workflow on a task card, falling back to
 * "Workflow" when the template name is null, undefined, or blank.
 */
export function workflowDisplayName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : WORKFLOW_FALLBACK_NAME;
}

/**
 * Percent (0–100, integer) of workflow steps completed, for the thin progress
 * bar on task cards. Guards divide-by-zero (total 0 → 0, never NaN) and caps
 * any overflow at 100.
 */
export function workflowProgressPct(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

/** Count how many steps in a template require human approval. */
export function approvalCount(steps: Pick<WorkflowTemplateStep, "requires_approval">[]): number {
  return steps.filter((s) => s.requires_approval).length;
}

/**
 * Check if any auto-rules match a label being added to a task.
 * If a match is found and no active workflow exists, applies the
 * workflow template. Non-throwing — errors are logged but label
 * assignment always succeeds.
 */
export interface AutoRuleOptions {
  /** User id for AI access / usage logging. Required to run AI adjudication. */
  userId?: string;
  /** True when an autonomous agent (not a human in the UI) triggered this. */
  isAutonomousAgent?: boolean;
  /** Test seam: override the AI generate call. */
  generate?: GenerateObjectFn;
  /** Test seam: await the async adjudication. */
  awaitAdjudication?: boolean;
  /**
   * Schedule the async adjudication as a post-response task (Next.js `after()`)
   * so it reliably runs on serverless and its logs are captured. Server actions
   * pass `after`; non-Next callers omit it and get the detached-promise fallback.
   */
  schedule?: (task: () => void) => void;
}

export async function checkAndApplyAutoRules(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  taskId: string,
  labelId: string,
  ideaId: string,
  applyFn: (taskId: string, templateId: string) => Promise<unknown>,
  options: AutoRuleOptions = {}
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
      .select("id, template_id")
      .eq("task_id", taskId)
      .not("status", "in", '("completed","failed")')
      .maybeSingle();

    if (activeRun) {
      // Same template already applied — nothing to do
      if (activeRun.template_id === rule.template_id) return;

      // Check if the active run was triggered by an auto-rule whose label
      // is no longer on this task (swap case: label A removed + label B added)
      const { data: triggeringRule } = await supabase
        .from("workflow_auto_rules")
        .select("id, label_id")
        .eq("idea_id", ideaId)
        .eq("template_id", activeRun.template_id)
        .maybeSingle();

      if (triggeringRule) {
        const { data: labelStillOnTask } = await supabase
          .from("board_task_labels")
          .select("id")
          .eq("task_id", taskId)
          .eq("label_id", triggeringRule.label_id)
          .maybeSingle();

        if (!labelStillOnTask) {
          // Triggering label was removed — delete the orphaned run so the new rule can apply
          await supabase.from("workflow_runs").delete().eq("id", activeRun.id);
        } else {
          // Active run's label is still present — don't replace it
          return;
        }
      } else {
        // Active run wasn't auto-rule triggered (manually applied) — don't replace
        return;
      }
    }

    // Past all active-run guards — route through the shared apply/suggest
    // decision (detect mismatch → auto-apply good fits, suggest suspect ones).
    await applyOrSuggest(supabase, {
      taskId,
      labelId,
      ideaId,
      ruleId: rule.id,
      templateId: rule.template_id,
      applyFn,
      options,
    });
  } catch (err) {
    logger.error("Failed to apply auto-rule", {
      error: err instanceof Error ? err.message : String(err),
      taskId,
      labelId,
    });
  }
}

/**
 * Gather the template + task + sibling-label context and run the shared
 * apply/suggest decision. Used by both the synchronous label-write path and
 * the retroactive bulk path so detection logic lives in one place.
 */
export async function applyOrSuggest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  args: {
    taskId: string;
    labelId: string;
    ideaId: string;
    ruleId: string | null;
    templateId: string;
    applyFn: (taskId: string, templateId: string) => Promise<unknown>;
    options?: AutoRuleOptions;
  }
): Promise<{ applied: boolean; suggested: boolean }> {
  const { taskId, labelId, ideaId, ruleId, templateId, applyFn } = args;
  const options = args.options ?? {};

  // Without a userId we can't run AI adjudication; preserve the legacy
  // behaviour of applying directly rather than blocking the workflow.
  if (!options.userId) {
    await applyFn(taskId, templateId);
    return { applied: true, suggested: false };
  }

  // Fetch template (steps/name) — needed to classify the workflow.
  const { data: templateRow } = await supabase
    .from("workflow_templates")
    .select("id, name, description, steps")
    .eq("id", templateId)
    .maybeSingle();

  if (!templateRow) {
    // Template vanished — let applyFn surface the error path as before.
    await applyFn(taskId, templateId);
    return { applied: true, suggested: false };
  }

  // Fetch the task, the OTHER labels on it (to classify the task), and ALL of
  // the idea's templates (so the AI can recommend a BETTER-fitting one — not
  // just keep/null the mismatched template the rule attached).
  const [{ data: taskRow }, { data: labelRows }, { data: ideaTemplateRows }] =
    await Promise.all([
      supabase
        .from("board_tasks")
        .select("id, title, description")
        .eq("id", taskId)
        .maybeSingle(),
      supabase
        .from("board_task_labels")
        .select("board_labels(name)")
        .eq("task_id", taskId),
      supabase
        .from("workflow_templates")
        .select("id, name, description, steps")
        .eq("idea_id", ideaId),
    ]);

  if (!taskRow) {
    await applyFn(taskId, templateId);
    return { applied: true, suggested: false };
  }

  // Supabase may type the embedded relation as object or array depending on
  // the inferred FK cardinality — normalize both shapes to a name string.
  const labelNames = ((labelRows ?? []) as Array<{ board_labels: unknown }>)
    .map((r) => {
      const rel = r.board_labels;
      const obj = Array.isArray(rel) ? rel[0] : rel;
      return obj && typeof obj === "object" && "name" in obj
        ? (obj as { name: string }).name
        : undefined;
    })
    .filter((n): n is string => !!n);

  // Build the candidate set the AI may recommend from. Always include the
  // rule's own template; add every other template on the idea. Steps are
  // narrowed to {title, role} to match AdjudicationCandidateTemplate.
  const candidateTemplates = ((ideaTemplateRows ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    steps: unknown;
  }>).map((row) => {
    const t = templateFromRow(row);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      steps: t.steps.map((s) => ({ title: s.title, role: s.role })),
    };
  });
  if (!candidateTemplates.some((t) => t.id === templateRow.id)) {
    const t = templateFromRow(templateRow);
    candidateTemplates.push({
      id: t.id,
      name: t.name,
      description: t.description,
      steps: t.steps.map((s) => ({ title: s.title, role: s.role })),
    });
  }

  const result = await decideAutoRuleApplication(supabase, {
    ideaId,
    labelId,
    ruleId,
    template: templateFromRow(templateRow),
    candidateTemplates,
    task: {
      id: taskRow.id,
      title: taskRow.title,
      description: taskRow.description,
      labelNames,
    },
    applyFn,
    userId: options.userId,
    isAutonomousAgent: options.isAutonomousAgent,
    generate: options.generate,
    awaitAdjudication: options.awaitAdjudication,
    schedule: options.schedule,
  });

  return { applied: result.applied, suggested: result.suggested };
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
    logger.error("Failed to delete auto-rule workflow run", {
      error: error.message,
      runId: check.runId,
      taskId,
      labelId,
    });
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
): Promise<{ runsUpdated: number; stepsUpdated: number; skippedStructuralMismatch: number; affectedTaskIds: string[] }> {
  // Find active runs for this template
  const { data: activeRuns } = await supabase
    .from("workflow_runs")
    .select("id, task_id")
    .eq("template_id", templateId)
    .not("status", "in", '("completed","failed")');

  if (!activeRuns || activeRuns.length === 0) {
    return { runsUpdated: 0, stepsUpdated: 0, skippedStructuralMismatch: 0, affectedTaskIds: [] };
  }

  let runsUpdated = 0;
  let stepsUpdated = 0;
  let skippedStructuralMismatch = 0;
  const affectedTaskIds: string[] = [];

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

    if (runHadUpdates) {
      runsUpdated++;
      affectedTaskIds.push(run.task_id);
    }
  }

  return { runsUpdated, stepsUpdated, skippedStructuralMismatch, affectedTaskIds };
}
