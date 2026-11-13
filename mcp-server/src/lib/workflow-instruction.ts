import { pickCurrentRunKey, pickNextOpenStep } from "../../../src/lib/workflow-current-run";
import type { McpContext } from "../context";
import { noWorkflowInstruction } from "./no-workflow";

type StepRow = Record<string, unknown>;

/**
 * Builds the `workflow_instruction` text an agent sees. One builder so get_task,
 * create_task and manage_labels (add_to_task) all say exactly the same thing.
 * `allSteps` is every step of the card (all runs); counts cover the live run only.
 */
export async function buildWorkflowInstruction(
  ctx: McpContext,
  args: { taskId: string; ideaId: string; allSteps: StepRow[]; suggestionCount: number }
): Promise<string | null> {
  const { allSteps } = args;
  const currentRun = pickCurrentRunKey(allSteps);
  const liveSteps = allSteps.filter((s) => ((s.run_id as string | null) ?? null) === currentRun);
  const pendingCount = liveSteps.filter((s) => s.status === "pending").length;
  const hasApprovalGates = liveSteps.some(
    (s) => s.human_check_required && s.status !== "completed" && s.status !== "skipped"
  );

  const nextOpen = pickNextOpenStep(
    allSteps as unknown as Array<{
      id: string;
      run_id: string | null;
      created_at: string | null;
      status: string;
      step_order: number | null;
      position: number | null;
      title: string;
    }>
  );

  if (nextOpen?.status === "failed") {
    return (
      `This task's workflow has stopped: step ${nextOpen.step_order ?? ""} "${nextOpen.title}" failed. ` +
      `Do NOT claim further steps or begin implementation. Tell the user; they can retry the failed step on the card, or send the work back.`
    );
  }
  if (pendingCount > 0) {
    return (
      `This task has a workflow with ${liveSteps.length} steps (${pendingCount} pending). ` +
      `Do NOT begin implementation directly. Use claim_next_step(task_id) to claim and execute steps sequentially — ` +
      `each step has specific deliverables, role requirements, and instructions that are only revealed when claimed.` +
      (hasApprovalGates ? ` Some steps require human approval before proceeding.` : ``)
    );
  }
  if (liveSteps.length === 0) {
    if (args.suggestionCount > 0) {
      // Open suggestion + no steps (AC-20): suppress the self-assign instruction.
      return (
        `This task has an unresolved workflow suggestion. Do NOT begin work or assign yourself. ` +
        `Surface it to a human to Keep / Replace / Remove. Agents cannot resolve suggestions.`
      );
    }
    return noWorkflowInstruction(ctx, args.taskId, args.ideaId);
  }
  return null;
}
