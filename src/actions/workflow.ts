"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateTitle, validateOptionalDescription, validateComment } from "@/lib/validation";

export async function createWorkflowStep(
  taskId: string,
  ideaId: string,
  title: string,
  description: string | null,
  botId: string | null,
  stepType: "agent" | "human" = "agent"
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  title = validateTitle(title);
  if (description) description = validateOptionalDescription(description) ?? null;

  if (stepType === "agent" && !botId) throw new Error("Agent steps require a bot_id");

  // Get max position (gap-based: 1000, 2000, etc.)
  const { data: steps } = await supabase
    .from("task_workflow_steps")
    .select("position")
    .eq("task_id", taskId)
    .order("position", { ascending: false })
    .limit(1);

  const maxPos = steps && steps.length > 0 ? steps[0].position : 0;

  const { error } = await supabase.from("task_workflow_steps").insert({
    task_id: taskId,
    idea_id: ideaId,
    bot_id: stepType === "human" ? null : botId,
    step_type: stepType,
    title,
    description,
    position: maxPos + 1000,
  });

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/board`);
}

export async function updateWorkflowStep(
  stepId: string,
  ideaId: string,
  updates: {
    title?: string;
    description?: string | null;
    bot_id?: string;
    position?: number;
  }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  if (updates.title !== undefined) {
    updates.title = validateTitle(updates.title);
  }
  if (updates.description !== undefined && updates.description !== null) {
    updates.description = validateOptionalDescription(updates.description);
  }

  const { error } = await supabase
    .from("task_workflow_steps")
    .update(updates)
    .eq("id", stepId)
    .eq("idea_id", ideaId);

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/board`);
}

export async function deleteWorkflowStep(stepId: string, ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("task_workflow_steps")
    .delete()
    .eq("id", stepId)
    .eq("idea_id", ideaId);

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/board`);
}

export async function startWorkflowStep(stepId: string, ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch the step to get bot_id for assignee update
  const { data: step } = await supabase
    .from("task_workflow_steps")
    .select("bot_id, task_id, status, step_type")
    .eq("id", stepId)
    .eq("idea_id", ideaId)
    .single();

  if (!step) throw new Error("Step not found");
  if (step.status !== "pending" && step.status !== "failed") {
    throw new Error("Step is not pending or failed");
  }

  const { error } = await supabase
    .from("task_workflow_steps")
    .update({
      status: "in_progress",
      started_at: new Date().toISOString(),
    })
    .eq("id", stepId)
    .eq("idea_id", ideaId);

  if (error) throw new Error(error.message);

  // Update task assignee to this step's bot (only for agent steps)
  if (step.step_type === "agent" && step.bot_id) {
    await supabase
      .from("board_tasks")
      .update({ assignee_id: step.bot_id })
      .eq("id", step.task_id);
  }

  revalidatePath(`/ideas/${ideaId}/board`);
}

export async function completeWorkflowStep(
  stepId: string,
  ideaId: string,
  output: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("task_workflow_steps")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", stepId)
    .eq("idea_id", ideaId);

  if (error) throw new Error(error.message);

  // Post output as a comment on the step thread
  await supabase.from("workflow_step_comments").insert({
    step_id: stepId,
    idea_id: ideaId,
    author_id: user.id,
    type: "output",
    content: output,
  });

  revalidatePath(`/ideas/${ideaId}/board`);
}

export async function failWorkflowStep(
  stepId: string,
  targetStepId: string,
  ideaId: string,
  reason: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Get the target step's position for cascade reset
  const { data: targetStep } = await supabase
    .from("task_workflow_steps")
    .select("position, task_id")
    .eq("id", targetStepId)
    .eq("idea_id", ideaId)
    .single();

  if (!targetStep) throw new Error("Target step not found");

  // Set target step to failed
  const { error: failError } = await supabase
    .from("task_workflow_steps")
    .update({ status: "failed" })
    .eq("id", targetStepId)
    .eq("idea_id", ideaId);

  if (failError) throw new Error(failError.message);

  // Post failure reason as a comment on the step thread
  await supabase.from("workflow_step_comments").insert({
    step_id: targetStepId,
    idea_id: ideaId,
    author_id: user.id,
    type: "failure",
    content: reason,
  });

  // Cascade: reset ALL subsequent steps (after the failed step) back to pending
  await supabase
    .from("task_workflow_steps")
    .update({ status: "pending", started_at: null, completed_at: null })
    .eq("task_id", targetStep.task_id)
    .eq("idea_id", ideaId)
    .gt("position", targetStep.position)
    .neq("status", "pending");

  revalidatePath(`/ideas/${ideaId}/board`);
}

export async function addStepComment(
  stepId: string,
  ideaId: string,
  content: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  content = validateComment(content);

  const { error } = await supabase.from("workflow_step_comments").insert({
    step_id: stepId,
    idea_id: ideaId,
    author_id: user.id,
    content,
  });

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/board`);
}

export async function approveWorkflowStep(
  stepId: string,
  ideaId: string,
  comment: string | null
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  if (comment) comment = validateComment(comment);

  // Verify it's a human step that's pending/in_progress
  const { data: step } = await supabase
    .from("task_workflow_steps")
    .select("step_type, status, task_id")
    .eq("id", stepId)
    .eq("idea_id", ideaId)
    .single();

  if (!step) throw new Error("Step not found");
  if (step.step_type !== "human") throw new Error("Only human steps can be approved");
  if (step.status !== "pending" && step.status !== "in_progress") {
    throw new Error("Step is not awaiting approval");
  }

  const { error } = await supabase
    .from("task_workflow_steps")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", stepId)
    .eq("idea_id", ideaId);

  if (error) throw new Error(error.message);

  // Post approval comment
  await supabase.from("workflow_step_comments").insert({
    step_id: stepId,
    idea_id: ideaId,
    author_id: user.id,
    type: "approval",
    content: comment || "Approved",
  });

  revalidatePath(`/ideas/${ideaId}/board`);
}

export async function requestChangesWorkflowStep(
  stepId: string,
  targetStepId: string,
  ideaId: string,
  reason: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  reason = validateComment(reason);

  // Verify it's a human step
  const { data: step } = await supabase
    .from("task_workflow_steps")
    .select("step_type, status")
    .eq("id", stepId)
    .eq("idea_id", ideaId)
    .single();

  if (!step) throw new Error("Step not found");
  if (step.step_type !== "human") throw new Error("Only human steps can request changes");

  // Get the target step's position for cascade reset
  const { data: targetStep } = await supabase
    .from("task_workflow_steps")
    .select("position, task_id")
    .eq("id", targetStepId)
    .eq("idea_id", ideaId)
    .single();

  if (!targetStep) throw new Error("Target step not found");

  // Set target step to failed
  const { error: failError } = await supabase
    .from("task_workflow_steps")
    .update({ status: "failed" })
    .eq("id", targetStepId)
    .eq("idea_id", ideaId);

  if (failError) throw new Error(failError.message);

  // Post changes_requested comment on target step
  await supabase.from("workflow_step_comments").insert({
    step_id: targetStepId,
    idea_id: ideaId,
    author_id: user.id,
    type: "changes_requested",
    content: reason,
  });

  // Cascade: reset ALL subsequent steps (after the failed step) back to pending
  await supabase
    .from("task_workflow_steps")
    .update({ status: "pending", started_at: null, completed_at: null })
    .eq("task_id", targetStep.task_id)
    .eq("idea_id", ideaId)
    .gt("position", targetStep.position)
    .neq("status", "pending");

  revalidatePath(`/ideas/${ideaId}/board`);
}

export async function deleteStepComment(commentId: string, ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("workflow_step_comments")
    .delete()
    .eq("id", commentId)
    .eq("idea_id", ideaId);

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/board`);
}
