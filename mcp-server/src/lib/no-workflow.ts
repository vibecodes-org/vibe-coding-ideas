import type { McpContext } from "../context";

/** Today's instruction for a card with no workflow: assign an agent and start. */
export const ASSIGN_AND_START_INSTRUCTION =
  `This task has no workflow. Before starting work, pick the team agent that best fits it ` +
  `(your .vibecodes config botId, or choose from list_idea_agents) and call update_task with ` +
  `assignee_id set to that agent's ID so the board shows who is working on it. ` +
  `When finished, move the task to the appropriate done/verify column using move_task.`;

/** Asks the agent to suggest an existing workflow, then stop. */
export const SUGGEST_WORKFLOW_INSTRUCTION =
  `This task has no workflow. Do NOT begin work or assign yourself. ` +
  `Call list_workflow_templates for this idea, choose the one that best fits this task ` +
  `(reuse what the board already has), and record it with suggest_workflow(task_id, template_id, reason) ` +
  `giving a one-sentence reason. Do NOT call apply_workflow_template yourself. ` +
  `Then tell the user which workflow you suggested and why, and stop: ` +
  `a human keeps, replaces or removes it on the card.`;

export const NO_TEMPLATES_PREFIX = "This board has no workflows to suggest. ";

/**
 * The instruction for a card that has no workflow steps and no open suggestion.
 * - Board has no templates: say so, then today's assign-and-start text.
 * - A suggestion on this card was already dismissed (the human chose Remove):
 *   today's assign-and-start text, no second suggestion.
 * - Otherwise: suggest a workflow and stop.
 */
export async function noWorkflowInstruction(
  ctx: McpContext,
  taskId: string,
  ideaId: string
): Promise<string> {
  const { count, error: countError } = await ctx.supabase
    .from("workflow_templates")
    .select("id", { count: "exact", head: true })
    .eq("idea_id", ideaId);
  if (countError) throw new Error(`Failed to check workflow templates: ${countError.message}`);
  if (!count) return NO_TEMPLATES_PREFIX + ASSIGN_AND_START_INSTRUCTION;

  const { data: dismissed, error: dismissedError } = await ctx.supabase
    .from("workflow_suggestions")
    .select("id")
    .eq("task_id", taskId)
    .eq("status", "dismissed")
    .limit(1);
  if (dismissedError) throw new Error(`Failed to check dismissed suggestions: ${dismissedError.message}`);
  if ((dismissed ?? []).length > 0) return ASSIGN_AND_START_INSTRUCTION;

  return SUGGEST_WORKFLOW_INSTRUCTION;
}
