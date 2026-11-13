import { pickCurrentRunKey } from "../../../src/lib/workflow-current-run";
import type { McpContext } from "../context";
import { fetchOpenSuggestions } from "../tools/board-read";
import { buildWorkflowInstruction } from "./workflow-instruction";

/**
 * What create_task and manage_labels(add_to_task) add to their reply so an agent
 * learns straight away that a workflow was attached (or suggested), with the
 * same instruction get_task would give.
 */
export async function loadWorkflowReply(ctx: McpContext, taskId: string, ideaId: string) {
  const { data, error } = await ctx.supabase
    .from("task_workflow_steps")
    .select("id, run_id, status, title, step_order, position, created_at, human_check_required")
    .eq("task_id", taskId)
    .order("position");
  if (error) throw new Error(`Failed to read workflow steps: ${error.message}`);
  const allSteps = (data ?? []) as Array<Record<string, unknown>>;
  const suggestions = await fetchOpenSuggestions(ctx, taskId);
  const workflow_instruction = await buildWorkflowInstruction(ctx, {
    taskId,
    ideaId,
    allSteps,
    suggestionCount: suggestions.length,
  });

  const run = pickCurrentRunKey(allSteps);
  const live = allSteps.filter((s) => ((s.run_id as string | null) ?? null) === run);
  const workflow =
    live.length > 0
      ? {
          steps_total: live.length,
          steps_pending: live.filter((s) => s.status === "pending").length,
        }
      : null;
  return { workflow, workflow_suggestions: suggestions, workflow_instruction };
}
