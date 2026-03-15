"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkAndCompleteRun } from "@/lib/workflow-helpers";

// ─── Workflow Steps ───

export async function createWorkflowStep(
  taskId: string,
  ideaId: string,
  title: string,
  description?: string | null,
  agentRole?: string | null,
  humanCheckRequired?: boolean
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Calculate next position as MAX(position) + 1000
  const { data: existing } = await supabase
    .from("task_workflow_steps")
    .select("position")
    .eq("task_id", taskId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPosition = (existing?.position ?? 0) + 1000;

  const { data, error } = await supabase
    .from("task_workflow_steps")
    .insert({
      task_id: taskId,
      idea_id: ideaId,
      title,
      description: description ?? null,
      agent_role: agentRole ?? null,
      human_check_required: humanCheckRequired ?? false,
      position: nextPosition,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/board`);

  return data;
}

export async function updateWorkflowStep(
  stepId: string,
  updates: {
    title?: string;
    description?: string | null;
    agent_role?: string | null;
    human_check_required?: boolean;
    bot_id?: string | null;
  }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  if (Object.keys(updates).length === 0) {
    throw new Error("No fields to update");
  }

  const { data, error } = await supabase
    .from("task_workflow_steps")
    .update(updates)
    .eq("id", stepId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${data.idea_id}/board`);

  return data;
}

export async function deleteWorkflowStep(stepId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch idea_id for revalidation before deleting
  const { data: step } = await supabase
    .from("task_workflow_steps")
    .select("idea_id")
    .eq("id", stepId)
    .single();

  const { error } = await supabase
    .from("task_workflow_steps")
    .delete()
    .eq("id", stepId);

  if (error) throw new Error(error.message);

  if (step) {
    revalidatePath(`/ideas/${step.idea_id}/board`);
  }
}

export async function startWorkflowStep(stepId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("task_workflow_steps")
    .update({
      status: "in_progress",
      started_at: new Date().toISOString(),
    })
    .eq("id", stepId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Step is no longer pending — it may have been started by another agent");

  // Update the workflow run's status to 'running' and current_step if this step belongs to a run
  if (data.run_id) {
    await supabase
      .from("workflow_runs")
      .update({
        status: "running",
        current_step: data.step_order ?? undefined,
      })
      .eq("id", data.run_id)
      .in("status", ["pending", "paused"]);
  }

  revalidatePath(`/ideas/${data.idea_id}/board`);

  return data;
}

export async function completeWorkflowStep(stepId: string, output?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch the step to check human_check_required
  const { data: existing } = await supabase
    .from("task_workflow_steps")
    .select("human_check_required")
    .eq("id", stepId)
    .single();

  // If step requires human approval, route to awaiting_approval instead of completed
  const newStatus =
    existing?.human_check_required ? "awaiting_approval" : "completed";

  const { data, error } = await supabase
    .from("task_workflow_steps")
    .update({
      status: newStatus,
      completed_at: newStatus === "completed" ? new Date().toISOString() : null,
      output: output ?? null,
    })
    .eq("id", stepId)
    .eq("status", "in_progress")
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Step is no longer in progress — it may have been modified by another agent");

  // If step belongs to a run, check if all steps in that run are completed
  if (data.run_id && newStatus === "completed") {
    await checkAndCompleteRun(supabase, data.run_id);
  }

  revalidatePath(`/ideas/${data.idea_id}/board`);

  return data;
}

export async function skipWorkflowStep(stepId: string, reason?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("task_workflow_steps")
    .update({
      status: "skipped" as const,
      completed_at: new Date().toISOString(),
      output: reason ?? "Skipped — not applicable to this task",
    })
    .eq("id", stepId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Step is no longer pending — it may have been claimed by another agent");

  // Check if all steps in the run are now resolved
  if (data.run_id) {
    await checkAndCompleteRun(supabase, data.run_id);
  }

  revalidatePath(`/ideas/${data.idea_id}/board`);

  return data;
}

export async function failWorkflowStep(
  stepId: string,
  output?: string,
  resetToStepId?: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("task_workflow_steps")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      output: output ?? null,
    })
    .eq("id", stepId)
    .in("status", ["in_progress", "awaiting_approval"])
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Step is not in a state that can be failed (must be in_progress or awaiting_approval)");

  // Cascade rejection: reset all steps from resetToStepId up to (but not including) the failed step
  if (resetToStepId && data.run_id) {
    // Fetch the target step to get its step_order
    const { data: targetStep } = await supabase
      .from("task_workflow_steps")
      .select("step_order, position")
      .eq("id", resetToStepId)
      .eq("run_id", data.run_id)
      .single();

    if (targetStep) {
      // Reset all steps from the target step onward (except the current failed step)
      await supabase
        .from("task_workflow_steps")
        .update({
          status: "pending",
          output: null,
          started_at: null,
          completed_at: null,
        })
        .eq("run_id", data.run_id)
        .neq("id", stepId)
        .gte("step_order", targetStep.step_order ?? 0);
    }
  }

  // Update the run status to 'failed' if this step belongs to a run
  if (data.run_id) {
    await supabase
      .from("workflow_runs")
      .update({ status: "failed" })
      .eq("id", data.run_id);
  }

  revalidatePath(`/ideas/${data.idea_id}/board`);

  return data;
}

export async function approveWorkflowStep(stepId: string, output?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const updateFields: Record<string, unknown> = {
    status: "completed",
    completed_at: new Date().toISOString(),
  };
  // Only overwrite output if the approver explicitly provides one;
  // otherwise preserve the agent's original deliverable.
  if (output !== undefined) updateFields.output = output;

  const { data, error } = await supabase
    .from("task_workflow_steps")
    .update(updateFields)
    .eq("id", stepId)
    .eq("status", "awaiting_approval")
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Step is no longer awaiting approval — it may have been modified concurrently");

  // If step belongs to a run, check if all steps are now completed
  if (data.run_id) {
    await checkAndCompleteRun(supabase, data.run_id);
  }

  revalidatePath(`/ideas/${data.idea_id}/board`);

  return data;
}

export async function retryWorkflowStep(stepId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("task_workflow_steps")
    .update({
      status: "pending",
      output: null,
      started_at: null,
      completed_at: null,
    })
    .eq("id", stepId)
    .eq("status", "failed")
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  // Restore the run to 'running' status so it can continue
  if (data.run_id) {
    await supabase
      .from("workflow_runs")
      .update({ status: "running" })
      .eq("id", data.run_id)
      .eq("status", "failed");
  }

  revalidatePath(`/ideas/${data.idea_id}/board`);

  return data;
}

// ─── Workflow Reset & Remove ───

export async function resetWorkflow(runId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch run + task for idea_id (for revalidation)
  const { data: run, error: runError } = await supabase
    .from("workflow_runs")
    .select("id, task_id, board_tasks!inner(idea_id)")
    .eq("id", runId)
    .single();

  if (runError || !run) throw new Error("Workflow run not found");

  const ideaId = (run.board_tasks as unknown as { idea_id: string }).idea_id;

  // Reset all steps
  const { error: stepsError } = await supabase
    .from("task_workflow_steps")
    .update({
      status: "pending",
      output: null,
      started_at: null,
      completed_at: null,
      claimed_by: null,
    })
    .eq("run_id", runId);

  if (stepsError) throw new Error(stepsError.message);

  // Reset run
  const { error: resetError } = await supabase
    .from("workflow_runs")
    .update({
      status: "pending",
      current_step: 0,
      completed_at: null,
    })
    .eq("id", runId);

  if (resetError) throw new Error(resetError.message);

  revalidatePath(`/ideas/${ideaId}/board`);
}

export async function removeWorkflow(runId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch run + task for idea_id (for revalidation)
  const { data: run, error: runError } = await supabase
    .from("workflow_runs")
    .select("id, task_id, board_tasks!inner(idea_id)")
    .eq("id", runId)
    .single();

  if (runError || !run) throw new Error("Workflow run not found");

  const ideaId = (run.board_tasks as unknown as { idea_id: string }).idea_id;

  // Delete run — steps cascade via FK ON DELETE CASCADE
  const { error } = await supabase
    .from("workflow_runs")
    .delete()
    .eq("id", runId);

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/board`);
}

// ─── Step Comments ───

export async function addStepComment(
  stepId: string,
  ideaId: string,
  content: string,
  type: "comment" | "output" | "failure" | "approval" | "changes_requested" = "comment"
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("workflow_step_comments")
    .insert({
      step_id: stepId,
      idea_id: ideaId,
      author_id: user.id,
      type,
      content,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/board`);

  return data;
}

export async function deleteStepComment(commentId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch idea_id for revalidation before deleting
  const { data: comment } = await supabase
    .from("workflow_step_comments")
    .select("idea_id")
    .eq("id", commentId)
    .single();

  const { error } = await supabase
    .from("workflow_step_comments")
    .delete()
    .eq("id", commentId);

  if (error) throw new Error(error.message);

  if (comment) {
    revalidatePath(`/ideas/${comment.idea_id}/board`);
  }
}
