"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
    .select("*")
    .single();

  if (error) throw new Error(error.message);

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
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  // If step belongs to a run, check if all steps in that run are completed
  if (data.run_id) {
    const { data: runSteps } = await supabase
      .from("task_workflow_steps")
      .select("id, status")
      .eq("run_id", data.run_id);

    const allCompleted =
      runSteps !== null &&
      runSteps.length > 0 &&
      runSteps.every((s) => s.status === "completed");

    if (allCompleted) {
      await supabase
        .from("workflow_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", data.run_id);
    }
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
    .select("*")
    .single();

  if (error) throw new Error(error.message);

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

  const { data, error } = await supabase
    .from("task_workflow_steps")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      output: output ?? null,
    })
    .eq("id", stepId)
    .eq("status", "awaiting_approval")
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  // If step belongs to a run, check if all steps are now completed
  if (data.run_id) {
    const { data: runSteps } = await supabase
      .from("task_workflow_steps")
      .select("id, status")
      .eq("run_id", data.run_id);

    const allCompleted =
      runSteps !== null &&
      runSteps.length > 0 &&
      runSteps.every((s) => s.status === "completed");

    if (allCompleted) {
      await supabase
        .from("workflow_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", data.run_id);
    }
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
