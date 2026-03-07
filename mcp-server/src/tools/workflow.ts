import { z } from "zod";
import { POSITION_GAP } from "../constants";
import { logActivity } from "../activity";
import type { McpContext } from "../context";

// --- create_workflow_steps ---

export const createWorkflowStepsSchema = z.object({
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
  after_step_id: z.string().uuid().optional().describe("Insert new steps after this step ID. Subsequent steps are repositioned automatically. If omitted, steps are appended to the end."),
  steps: z
    .array(
      z.object({
        title: z.string().min(1).max(200).describe("Step title"),
        description: z.string().max(10000).optional().describe("Step description"),
        bot_id: z.string().uuid().describe("The agent (bot user ID) for this step"),
        human_check_required: z.boolean().default(false).describe("If true, the agent must get human approval before completing this step"),
      })
    )
    .min(1)
    .max(50)
    .describe("Ordered list of workflow steps to create"),
});

export async function createWorkflowSteps(
  ctx: McpContext,
  params: z.infer<typeof createWorkflowStepsSchema>
) {
  let insertPos: number;

  if (params.after_step_id) {
    // Get the anchor step's position
    const { data: anchor } = await ctx.supabase
      .from("task_workflow_steps")
      .select("position")
      .eq("id", params.after_step_id)
      .eq("task_id", params.task_id)
      .maybeSingle();

    if (!anchor) throw new Error("after_step_id not found in this task");

    // Bump all subsequent steps to make room
    const spacingNeeded = params.steps.length * POSITION_GAP;
    const { data: subsequentSteps } = await ctx.supabase
      .from("task_workflow_steps")
      .select("id, position")
      .eq("task_id", params.task_id)
      .gt("position", anchor.position)
      .order("position", { ascending: false });

    // Update from highest to lowest to avoid constraint conflicts
    for (const s of subsequentSteps ?? []) {
      await ctx.supabase
        .from("task_workflow_steps")
        .update({ position: s.position + spacingNeeded })
        .eq("id", s.id);
    }

    insertPos = anchor.position + POSITION_GAP;
  } else {
    // Append to end
    const { data: existing } = await ctx.supabase
      .from("task_workflow_steps")
      .select("position")
      .eq("task_id", params.task_id)
      .order("position", { ascending: false })
      .limit(1);

    insertPos = (existing?.[0]?.position ?? 0) + POSITION_GAP;
  }

  const rows = params.steps.map((step) => {
    const row = {
      task_id: params.task_id,
      idea_id: params.idea_id,
      bot_id: step.bot_id,
      human_check_required: step.human_check_required,
      title: step.title,
      description: step.description ?? null,
      position: insertPos,
    };
    insertPos += POSITION_GAP;
    return row;
  });

  const { data, error } = await ctx.supabase
    .from("task_workflow_steps")
    .insert(rows)
    .select("id, title, position, bot_id, status, human_check_required");

  if (error) throw new Error(`Failed to create workflow steps: ${error.message}`);

  for (const step of data ?? []) {
    await logActivity(ctx, params.task_id, params.idea_id, "workflow_step_added", {
      title: step.title,
    });
  }

  return { success: true, steps: data };
}

// --- claim_next_step ---

export const claimNextStepSchema = z.object({
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function claimNextStep(
  ctx: McpContext,
  params: z.infer<typeof claimNextStepSchema>
) {
  // Get all steps ordered by position
  const { data: steps, error } = await ctx.supabase
    .from("task_workflow_steps")
    .select("*, agent:users!task_workflow_steps_bot_id_fkey(id, full_name)")
    .eq("task_id", params.task_id)
    .eq("idea_id", params.idea_id)
    .order("position");

  if (error) throw new Error(`Failed to get workflow steps: ${error.message}`);
  if (!steps || steps.length === 0) return { step: null, context: [] };

  // Find first non-completed step that needs work
  const nextStep = steps.find((s) => s.status === "pending" || s.status === "failed");
  const wasFailure = nextStep?.status === "failed";
  if (!nextStep) {
    const awaitingApproval = steps.find((s) => s.status === "awaiting_approval");
    if (awaitingApproval) {
      return {
        step: null,
        blocked_by_approval: true,
        awaiting_step: { id: awaitingApproval.id, title: awaitingApproval.title },
        message: `Step "${awaitingApproval.title}" is awaiting human approval. A team member must approve or reject it before the pipeline can continue.`,
        context: [],
      };
    }
    return { step: null, all_completed: true, context: [] };
  }

  // Start the step (race-condition safe)
  const { data: claimed, error: startError } = await ctx.supabase
    .from("task_workflow_steps")
    .update({
      status: "in_progress",
      started_at: new Date().toISOString(),
    })
    .eq("id", nextStep.id)
    .eq("idea_id", params.idea_id)
    .in("status", ["pending", "failed"])
    .select("id, task_id, bot_id, title, human_check_required")
    .maybeSingle();

  if (startError) throw new Error(`Failed to start step: ${startError.message}`);
  if (!claimed) throw new Error("Step was already claimed by another agent");

  // Update task assignee to this step's bot
  await ctx.supabase
    .from("board_tasks")
    .update({ assignee_id: claimed.bot_id })
    .eq("id", claimed.task_id);

  await logActivity(ctx, claimed.task_id, params.idea_id, "workflow_step_started", {
    title: claimed.title,
  });

  // Collect output comments from all completed steps before this one as context
  const completedBefore = steps.filter(
    (s) => s.status === "completed" && s.position < nextStep.position
  );
  const completedIds = completedBefore.map((s) => s.id);

  let context: { step_title: string; output: string }[] = [];
  if (completedIds.length > 0) {
    const { data: outputComments } = await ctx.supabase
      .from("workflow_step_comments")
      .select("step_id, content")
      .in("step_id", completedIds)
      .eq("type", "output")
      .eq("idea_id", params.idea_id);

    const outputByStep = new Map(
      (outputComments ?? []).map((c) => [c.step_id, c.content])
    );
    context = completedBefore
      .filter((s) => outputByStep.has(s.id))
      .map((s) => ({ step_title: s.title, output: outputByStep.get(s.id)! }));
  }

  // Fetch all comments on this step (inter-agent communication + any failure reasons)
  // and the agent's deliverables from bot_profiles
  const [{ data: comments }, { data: agentProfile }] = await Promise.all([
    ctx.supabase
      .from("workflow_step_comments")
      .select("id, type, content, created_at, author:users!workflow_step_comments_author_id_fkey(id, full_name)")
      .eq("step_id", nextStep.id)
      .eq("idea_id", params.idea_id)
      .order("created_at", { ascending: true }),
    ctx.supabase
      .from("bot_profiles")
      .select("deliverables")
      .eq("id", claimed.bot_id)
      .maybeSingle(),
  ]);

  const deliverables = (agentProfile?.deliverables as string[] | undefined) ?? [];

  return {
    step: { ...nextStep, status: "in_progress" },
    human_check_required: nextStep.human_check_required,
    ...(deliverables.length > 0
      ? { expected_deliverables: deliverables }
      : {}),
    context,
    comments: comments ?? [],
    ...(wasFailure
      ? {
          rework_instructions: `IMPORTANT: This step was previously completed and then FAILED/REJECTED. Review the failure comments above to understand what needs to change. You MUST only update this step's deliverable ("${nextStep.title}"). Do NOT implement changes that belong to subsequent steps in the pipeline — those steps will run after you complete this one. Produce a revised output for this step only.`,
        }
      : {}),
  };
}

// --- complete_step ---

export const completeStepSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID to complete"),
  idea_id: z.string().uuid().describe("The idea ID"),
  output: z.string().max(50000).describe("Structured markdown output/deliverable from this step"),
});

export async function completeStep(
  ctx: McpContext,
  params: z.infer<typeof completeStepSchema>
) {
  // Check if human approval is required
  const { data: stepInfo } = await ctx.supabase
    .from("task_workflow_steps")
    .select("human_check_required")
    .eq("id", params.step_id)
    .eq("idea_id", params.idea_id)
    .eq("status", "in_progress")
    .maybeSingle();

  if (!stepInfo) throw new Error("Step is not in progress or does not exist");

  const nextStatus = stepInfo.human_check_required ? "awaiting_approval" : "completed";

  const { data, error } = await ctx.supabase
    .from("task_workflow_steps")
    .update({
      status: nextStatus,
      ...(nextStatus === "completed" ? { completed_at: new Date().toISOString() } : {}),
    })
    .eq("id", params.step_id)
    .eq("idea_id", params.idea_id)
    .eq("status", "in_progress")
    .select("id, task_id, title, idea_id")
    .maybeSingle();

  if (error) throw new Error(`Failed to complete step: ${error.message}`);
  if (!data) throw new Error("Step was modified concurrently");

  // Post output as a comment on the step thread
  const { error: commentError } = await ctx.supabase
    .from("workflow_step_comments")
    .insert({
      step_id: params.step_id,
      idea_id: params.idea_id,
      author_id: ctx.userId,
      type: "output",
      content: params.output,
    });

  if (commentError) throw new Error(`Failed to save step output: ${commentError.message}`);

  if (nextStatus === "completed") {
    await logActivity(ctx, data.task_id, params.idea_id, "workflow_step_completed", {
      title: data.title,
    });
  }

  return {
    success: true,
    step: { ...data, status: nextStatus },
    awaiting_approval: nextStatus === "awaiting_approval",
    ...(nextStatus === "awaiting_approval"
      ? { message: "This step requires human approval before it is considered complete. A team member must approve or reject it." }
      : {}),
  };
}

// --- approve_step ---

export const approveStepSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID to approve"),
  idea_id: z.string().uuid().describe("The idea ID"),
  comment: z.string().max(5000).optional().describe("Optional approval comment"),
});

export async function approveStep(
  ctx: McpContext,
  params: z.infer<typeof approveStepSchema>
) {
  const { data, error } = await ctx.supabase
    .from("task_workflow_steps")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", params.step_id)
    .eq("idea_id", params.idea_id)
    .eq("status", "awaiting_approval")
    .select("id, task_id, title, idea_id")
    .maybeSingle();

  if (error) throw new Error(`Failed to approve step: ${error.message}`);
  if (!data) throw new Error("Step is not awaiting approval or does not exist");

  // Post approval comment
  const { error: commentError } = await ctx.supabase
    .from("workflow_step_comments")
    .insert({
      step_id: params.step_id,
      idea_id: params.idea_id,
      author_id: ctx.userId,
      type: "approval",
      content: params.comment || "Approved",
    });

  if (commentError) throw new Error(`Failed to save approval: ${commentError.message}`);

  await logActivity(ctx, data.task_id, params.idea_id, "workflow_step_completed", {
    title: data.title,
  });

  return { success: true, step: { ...data, status: "completed" } };
}

// --- fail_step ---

export const failStepSchema = z.object({
  target_step_id: z.string().uuid().describe("The step that failed (will be marked failed). All subsequent steps are automatically reset to pending."),
  idea_id: z.string().uuid().describe("The idea ID"),
  reason: z.string().max(5000).describe("Failure reason"),
});

export async function failStep(
  ctx: McpContext,
  params: z.infer<typeof failStepSchema>
) {
  // Get the target step's position for cascade reset
  const { data: targetStepData, error: fetchError } = await ctx.supabase
    .from("task_workflow_steps")
    .select("task_id, title, position")
    .eq("id", params.target_step_id)
    .eq("idea_id", params.idea_id)
    .maybeSingle();

  if (fetchError) throw new Error(`Failed to fetch target step: ${fetchError.message}`);
  if (!targetStepData) throw new Error("Target step not found");

  // Mark target step as failed
  const { error: failError } = await ctx.supabase
    .from("task_workflow_steps")
    .update({ status: "failed" })
    .eq("id", params.target_step_id)
    .eq("idea_id", params.idea_id);

  if (failError) throw new Error(`Failed to mark step as failed: ${failError.message}`);

  // Post failure reason as a comment on the step thread
  const { error: commentError } = await ctx.supabase
    .from("workflow_step_comments")
    .insert({
      step_id: params.target_step_id,
      idea_id: params.idea_id,
      author_id: ctx.userId,
      type: "failure",
      content: params.reason,
    });

  if (commentError) throw new Error(`Failed to save failure reason: ${commentError.message}`);

  // Cascade: reset ALL subsequent steps (after the failed step) back to pending
  const { error: cascadeError } = await ctx.supabase
    .from("task_workflow_steps")
    .update({ status: "pending", started_at: null, completed_at: null })
    .eq("task_id", targetStepData.task_id)
    .eq("idea_id", params.idea_id)
    .gt("position", targetStepData.position)
    .neq("status", "pending");

  if (cascadeError) throw new Error(`Failed to cascade reset: ${cascadeError.message}`);

  await logActivity(ctx, targetStepData.task_id, params.idea_id, "workflow_step_failed", {
    title: targetStepData.title,
    reason: params.reason,
  });

  return { success: true };
}

// --- get_step_context ---

export const getStepContextSchema = z.object({
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function getStepContext(
  ctx: McpContext,
  params: z.infer<typeof getStepContextSchema>
) {
  const { data: steps, error } = await ctx.supabase
    .from("task_workflow_steps")
    .select("*, agent:users!task_workflow_steps_bot_id_fkey(id, full_name)")
    .eq("task_id", params.task_id)
    .eq("idea_id", params.idea_id)
    .order("position");

  if (error) throw new Error(`Failed to get step context: ${error.message}`);

  // Fetch all comments for these steps
  const stepIds = (steps ?? []).map((s) => s.id);
  let commentsByStep: Record<string, { id: string; type: string; content: string; created_at: string; author: unknown }[]> = {};

  if (stepIds.length > 0) {
    const { data: comments } = await ctx.supabase
      .from("workflow_step_comments")
      .select("id, step_id, type, content, created_at, author:users!workflow_step_comments_author_id_fkey(id, full_name)")
      .in("step_id", stepIds)
      .eq("idea_id", params.idea_id)
      .order("created_at", { ascending: true });

    for (const c of comments ?? []) {
      const key = (c as unknown as { step_id: string }).step_id;
      if (!commentsByStep[key]) commentsByStep[key] = [];
      commentsByStep[key].push(c);
    }
  }

  const stepsWithComments = (steps ?? []).map((s) => ({
    ...s,
    comments: commentsByStep[s.id] ?? [],
  }));

  return { steps: stepsWithComments };
}

// --- update_workflow_step ---

export const updateWorkflowStepSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
  title: z.string().min(1).max(200).optional().describe("New title"),
  description: z.string().max(10000).optional().nullable().describe("New description"),
  bot_id: z.string().uuid().optional().describe("New agent assignment"),
  position: z.number().int().optional().describe("New position"),
  human_check_required: z.boolean().optional().describe("Whether human approval is required before completing"),
});

export async function updateWorkflowStep(
  ctx: McpContext,
  params: z.infer<typeof updateWorkflowStepSchema>
) {
  const updates: Record<string, unknown> = {};
  if (params.title !== undefined) updates.title = params.title;
  if (params.description !== undefined) updates.description = params.description;
  if (params.bot_id !== undefined) updates.bot_id = params.bot_id;
  if (params.position !== undefined) updates.position = params.position;
  if (params.human_check_required !== undefined) updates.human_check_required = params.human_check_required;

  if (Object.keys(updates).length === 0) {
    throw new Error("No updates provided");
  }

  const { data, error } = await ctx.supabase
    .from("task_workflow_steps")
    .update(updates)
    .eq("id", params.step_id)
    .eq("idea_id", params.idea_id)
    .select("id, title, position, bot_id, status, human_check_required")
    .maybeSingle();

  if (error) throw new Error(`Failed to update workflow step: ${error.message}`);
  if (!data) throw new Error("Workflow step not found");

  return { success: true, step: data };
}

// --- add_step_comment ---

export const addStepCommentSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
  content: z.string().min(1).max(5000).describe("Comment content (markdown). Use this to ask questions, provide feedback, or communicate with other agents."),
});

export async function addStepComment(
  ctx: McpContext,
  params: z.infer<typeof addStepCommentSchema>
) {
  const { data, error } = await ctx.supabase
    .from("workflow_step_comments")
    .insert({
      step_id: params.step_id,
      idea_id: params.idea_id,
      author_id: ctx.userId,
      content: params.content,
    })
    .select("id, content, created_at")
    .single();

  if (error) throw new Error(`Failed to add step comment: ${error.message}`);

  return { success: true, comment: data };
}

// --- get_step_comments ---

export const getStepCommentsSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID"),
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function getStepComments(
  ctx: McpContext,
  params: z.infer<typeof getStepCommentsSchema>
) {
  const { data, error } = await ctx.supabase
    .from("workflow_step_comments")
    .select("*, author:users!workflow_step_comments_author_id_fkey(id, full_name, avatar_url, is_bot)")
    .eq("step_id", params.step_id)
    .eq("idea_id", params.idea_id)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to get step comments: ${error.message}`);

  return { comments: data ?? [] };
}

// --- delete_workflow_step ---

export const deleteWorkflowStepSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID to delete"),
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function deleteWorkflowStep(
  ctx: McpContext,
  params: z.infer<typeof deleteWorkflowStepSchema>
) {
  const { error } = await ctx.supabase
    .from("task_workflow_steps")
    .delete()
    .eq("id", params.step_id)
    .eq("idea_id", params.idea_id);

  if (error) throw new Error(`Failed to delete workflow step: ${error.message}`);

  return { success: true };
}
