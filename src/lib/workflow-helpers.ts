import { logger } from "@/lib/logger";
import { sameRole } from "@/lib/role-matching";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkflowTemplateStep } from "@/types/database";
import { planReshape, type RunStepForMatch } from "@/lib/workflow-template-match";
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
 * Resolve an open ("suggested") workflow suggestion once a matching template has
 * ALREADY been applied to the task by the caller. This is the write-side fix for
 * the orphaned-suggestion bug: several apply paths created a run without closing
 * the suggestion that recommended it, leaving a stale "workflow may be wrong"
 * badge on the card.
 *
 * Scope is APPLY-ONLY and STRICTLY match-on-template-id:
 *   - Matches the open suggestion for `taskId` whose `suggested_template_id` OR
 *     `recommended_template_id` equals the just-applied `templateId`.
 *   - `templateId === suggested_template_id` → the suggested workflow was taken →
 *     `accepted`.
 *   - matches `recommended_template_id` but differs from the suggested one →
 *     `replaced` (record the chosen template in `replacement_template_id`).
 *   - matches NEITHER → no-op (a genuinely different applied template leaves the
 *     suggestion open; that warning is still valid).
 *
 * Never applies a template itself. Non-fatal: any failure is logged and swallowed
 * so the successful apply is never aborted. The `.eq('status','suggested')` guard
 * makes a concurrent/duplicate resolve match zero rows (idempotent no-op), which
 * is exactly what the Keep/Replace buttons rely on — they resolve the suggestion
 * BEFORE calling apply, so this second attempt harmlessly matches nothing.
 *
 * `resolvedBy` MUST be a valid `users` FK and an honest actor: the human user id
 * in the server action, and the real human owner (`ctx.ownerUserId`) in MCP — not
 * a bot identity.
 *
 * Returns `{ resolved }` where `resolved` is true only when a row was transitioned.
 */
export async function resolveSuggestionOnApply(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  args: { taskId: string; templateId: string; resolvedBy: string }
): Promise<{ resolved: boolean }> {
  const { taskId, templateId, resolvedBy } = args;

  try {
    // A task can carry more than one open suggestion (one per label — see the
    // partial unique index on (task_id, label_id) WHERE status='suggested'), so
    // fetch the open set and match in JS rather than risking a multi-row single.
    const { data: openSuggestions, error: findError } = await supabase
      .from("workflow_suggestions")
      .select("id, suggested_template_id, recommended_template_id")
      .eq("task_id", taskId)
      .eq("status", "suggested");

    if (findError) throw new Error(findError.message);

    const match = (openSuggestions ?? []).find(
      (s) =>
        s.suggested_template_id === templateId ||
        s.recommended_template_id === templateId
    );

    if (!match) return { resolved: false };

    // STRICT equality decides the transition. accepted = the suggested workflow
    // was taken; replaced = a recommended-but-different template was applied.
    const tookSuggested = match.suggested_template_id === templateId;
    const patch: Record<string, unknown> = tookSuggested
      ? { status: "accepted" }
      : { status: "replaced", replacement_template_id: templateId };

    // Concurrency guard: only the still-open row is claimed (mirrors the Keep /
    // Replace / Remove server actions). A second resolver matches zero rows.
    const { data: claimed, error: updateError } = await supabase
      .from("workflow_suggestions")
      .update({
        ...patch,
        resolved_at: new Date().toISOString(),
        resolved_by: resolvedBy,
        adjudication_started_at: null,
      })
      .eq("id", match.id)
      .eq("status", "suggested")
      .select("id")
      .maybeSingle();

    if (updateError) throw new Error(updateError.message);

    return { resolved: !!claimed };
  } catch (err) {
    // Non-fatal — the template was applied successfully; a stale suggestion is a
    // cosmetic badge, not a reason to fail the whole operation.
    logger.error("Failed to resolve workflow suggestion on apply", {
      error: err instanceof Error ? err.message : String(err),
      taskId,
      templateId,
    });
    return { resolved: false };
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

export interface TemplatePropagationPreviewItem {
  taskId: string;
  title: string;
  adds: string[];
  removes: string[];
  keeps: string[];
  renames: { from: string; to: string }[];
  stepsRewritten: number;
}

export interface TemplatePropagationResult {
  /** Runs reshaped (or, in a dry run, that would be). */
  runsUpdated: number;
  stepsUpdated: number;
  /** Runs that had not started and were swapped to the new steps whole. */
  runsReplaced: number;
  /** Runs left as they were because they changed while saving, or the write failed. */
  skippedStructuralMismatch: number;
  affectedTaskIds: string[];
  /** Removed template steps kept on a card because someone has worked on them. */
  keptRemoved: { taskId: string; title: string; stepTitle: string }[];
  /** Cards left as they were because a step changed while saving. */
  changedWhileSaving: { taskId: string; title: string }[];
  /** Dry run only: what would happen to each card. Nothing was written. */
  preview?: TemplatePropagationPreviewItem[];
  dryRun: boolean;
}

/**
 * Propagate template step edits to the work still to come on running cards
 * (card bff94aed). Steps that are not pending are never touched. Each run's
 * steps are matched to the template by title (renames by place) in
 * planReshape, and the plan is applied atomically by reshape_workflow_run, which
 * re-checks the run under lock. A run nobody has touched whose step count
 * differs is swapped whole by replace_unstarted_workflow_run. Archived cards
 * are skipped. With dryRun nothing is written and a per-card preview is returned.
 * Does NOT re-match bot_id — every task changed is returned in affectedTaskIds
 * so callers rematch it. A step whose role changed has its agent cleared (it was
 * matched to the old role); a step whose role is unchanged keeps its agent.
 */
export async function propagateTemplateEdits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  templateId: string,
  newSteps: WorkflowTemplateStep[],
  options: { dryRun?: boolean } = {}
): Promise<TemplatePropagationResult> {
  const dryRun = options.dryRun === true;
  const result: TemplatePropagationResult = {
    runsUpdated: 0,
    stepsUpdated: 0,
    runsReplaced: 0,
    skippedStructuralMismatch: 0,
    affectedTaskIds: [],
    keptRemoved: [],
    changedWhileSaving: [],
    dryRun,
  };
  if (dryRun) result.preview = [];

  // Find active runs for this template, with their card (archived cards are skipped).
  const { data: activeRuns } = await supabase
    .from("workflow_runs")
    .select("id, task_id, board_tasks(title, archived)")
    .eq("template_id", templateId)
    .not("status", "in", '("completed","failed")');

  if (!activeRuns || activeRuns.length === 0) return result;

  for (const run of activeRuns) {
    const card = Array.isArray(run.board_tasks) ? run.board_tasks[0] : run.board_tasks;
    if (card?.archived === true) continue;
    const cardTitle: string = card?.title ?? "Untitled card";

    const { data: steps } = await supabase
      .from("task_workflow_steps")
      .select(
        "id, status, step_order, position, title, description, agent_role, human_check_required, expected_deliverables, model_tier, effort_override, started_at, claimed_by, claim_token_hash, work_token_hash, output, comment_count"
      )
      .eq("run_id", run.id)
      .order("step_order", { ascending: true });

    if (!steps) {
      result.skippedStructuralMismatch++;
      continue;
    }

    const runSteps: RunStepForMatch[] = steps.map((st: Record<string, unknown>) => ({
      id: st.id as string,
      status: st.status as string,
      step_order: (st.step_order as number | null) ?? 0,
      position: st.position as number | null,
      title: st.title as string,
      description: (st.description as string | null) ?? null,
      agent_role: (st.agent_role as string | null) ?? null,
      human_check_required: Boolean(st.human_check_required),
      expected_deliverables: (st.expected_deliverables as string[] | null) ?? [],
      model_tier: (st.model_tier as string | null) ?? null,
      effort_override: (st.effort_override as string | null) ?? null,
      untouched:
        st.status === "pending" &&
        !st.started_at &&
        !st.claimed_by &&
        !st.claim_token_hash &&
        !st.work_token_hash &&
        st.output == null &&
        !st.comment_count,
    }));

    // Nothing has started on the card and the step count differs: swap whole.
    const wholeSwap = runSteps.length !== newSteps.length && runSteps.every((st) => st.untouched);
    if (wholeSwap && !dryRun) {
      const { data: replaced, error: replaceError } = await supabase.rpc("replace_unstarted_workflow_run", {
        p_run_id: run.id,
        p_steps: newSteps.map((s) => ({
          title: s.title,
          description: s.description ?? null,
          agent_role: s.role,
          human_check_required: s.requires_approval ?? false,
          expected_deliverables: s.deliverables ?? [],
          model_tier: s.model_tier ?? null,
          effort_override: s.effort ?? null,
        })),
      });
      if (replaceError) {
        logger.error("Failed to replace unstarted workflow run", { error: replaceError.message, runId: run.id });
      }
      if (replaced === true) {
        result.runsReplaced++;
        result.affectedTaskIds.push(run.task_id);
        continue;
      }
      // A comment or claim appeared meanwhile: fall through to the careful path.
    }

    const plan = planReshape(runSteps, newSteps);
    if (plan.unchanged) continue;

    if (dryRun) {
      const titleById = new Map(runSteps.map((st) => [st.id, st.title]));
      result.runsUpdated++;
      for (const kept of plan.keptRemoved) {
        result.keptRemoved.push({ taskId: run.task_id, title: cardTitle, stepTitle: kept.title });
      }
      result.preview?.push({
        taskId: run.task_id,
        title: cardTitle,
        adds: plan.inserts.map((i) => i.title),
        removes: plan.deletes.map((id) => titleById.get(id) ?? id),
        keeps: plan.keptRemoved.map((k) => k.title),
        renames: plan.updates
          .filter((u) => titleById.get(u.id) !== u.title)
          .map((u) => ({ from: titleById.get(u.id) ?? "", to: u.title })),
        stepsRewritten: plan.updates.length,
      });
      continue;
    }

    const { data: outcome, error: reshapeError } = await supabase.rpc("reshape_workflow_run", {
      p_run_id: run.id,
      p_expected: plan.snapshot,
      p_deletes: plan.deletes,
      p_updates: plan.updates,
      p_inserts: plan.inserts,
    });

    if (reshapeError) {
      logger.error("Failed to reshape workflow run", { error: reshapeError.message, runId: run.id });
    }

    if (!reshapeError && outcome === "applied") {
      result.runsUpdated++;
      result.stepsUpdated += plan.updates.length + plan.inserts.length + plan.deletes.length;
      result.affectedTaskIds.push(run.task_id);
      for (const kept of plan.keptRemoved) {
        result.keptRemoved.push({ taskId: run.task_id, title: cardTitle, stepTitle: kept.title });
      }
    } else {
      // Changed while saving, or the write failed: the card was left as it was.
      result.skippedStructuralMismatch++;
      result.changedWhileSaving.push({ taskId: run.task_id, title: cardTitle });
    }
  }

  return result;
}
