import { z } from "zod";
import type { McpContext } from "../context";
import { buildRoleMatcher } from "../../../src/lib/role-matching";

// --- Shared step schema used by template tools ---

const templateStepSchema = z.object({
  title: z.string().min(1).max(200).describe("Step title"),
  role: z.string().min(1).max(100).describe("Agent role that should execute this step"),
  description: z.string().max(5000).optional().describe("Step description"),
  requires_approval: z.boolean().optional().describe("Whether human approval is required after completion"),
});

// ============================================================
// Template Tools
// ============================================================

// --- List Workflow Templates ---

export const listWorkflowTemplatesSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function listWorkflowTemplates(
  ctx: McpContext,
  params: z.infer<typeof listWorkflowTemplatesSchema>
) {
  const { data, error } = await ctx.supabase
    .from("workflow_templates")
    .select("id, name, description, steps, usage_count, created_at")
    .eq("idea_id", params.idea_id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list workflow templates: ${error.message}`);
  return data ?? [];
}

// --- Create Workflow Template ---

export const createWorkflowTemplateSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  name: z.string().min(1).max(200).describe("Template name"),
  description: z.string().max(5000).optional().describe("Template description"),
  steps: z
    .array(templateStepSchema)
    .min(1)
    .describe("Ordered list of steps in this workflow template"),
});

export async function createWorkflowTemplate(
  ctx: McpContext,
  params: z.infer<typeof createWorkflowTemplateSchema>
) {
  const { data, error } = await ctx.supabase
    .from("workflow_templates")
    .insert({
      idea_id: params.idea_id,
      name: params.name,
      description: params.description ?? null,
      steps: params.steps,
      created_by: ctx.ownerUserId ?? ctx.userId,
    })
    .select("id, name, description, steps, usage_count, created_at")
    .single();

  if (error) throw new Error(`Failed to create workflow template: ${error.message}`);
  return data;
}

// --- Update Workflow Template ---

export const updateWorkflowTemplateSchema = z.object({
  template_id: z.string().uuid().describe("The template ID"),
  name: z.string().min(1).max(200).optional().describe("New template name"),
  description: z.string().max(5000).nullable().optional().describe("New description (null to clear)"),
  steps: z.array(templateStepSchema).min(1).optional().describe("Replacement step list"),
});

export async function updateWorkflowTemplate(
  ctx: McpContext,
  params: z.infer<typeof updateWorkflowTemplateSchema>
) {
  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) patch.name = params.name;
  if (params.description !== undefined) patch.description = params.description;
  if (params.steps !== undefined) patch.steps = params.steps;

  if (Object.keys(patch).length === 0) {
    return { success: true, message: "No changes to apply" };
  }

  const { data, error } = await ctx.supabase
    .from("workflow_templates")
    .update(patch)
    .eq("id", params.template_id)
    .select("id, name, description, steps, usage_count, created_at, updated_at")
    .single();

  if (error) throw new Error(`Failed to update workflow template: ${error.message}`);
  return data;
}

// --- Delete Workflow Template ---

export const deleteWorkflowTemplateSchema = z.object({
  template_id: z.string().uuid().describe("The template ID to delete"),
});

export async function deleteWorkflowTemplate(
  ctx: McpContext,
  params: z.infer<typeof deleteWorkflowTemplateSchema>
) {
  const { error } = await ctx.supabase
    .from("workflow_templates")
    .delete()
    .eq("id", params.template_id);

  if (error) throw new Error(`Failed to delete workflow template: ${error.message}`);
  return { success: true, template_id: params.template_id };
}

// --- Apply Workflow Template ---

export const applyWorkflowTemplateSchema = z.object({
  task_id: z.string().uuid().describe("The board task ID to apply the template to"),
  template_id: z.string().uuid().describe("The workflow template ID to apply"),
});

export async function applyWorkflowTemplate(
  ctx: McpContext,
  params: z.infer<typeof applyWorkflowTemplateSchema>
) {
  const actorId = ctx.ownerUserId ?? ctx.userId;

  // Fetch template
  const { data: template, error: templateError } = await ctx.supabase
    .from("workflow_templates")
    .select("id, name, steps, idea_id, usage_count")
    .eq("id", params.template_id)
    .single();

  if (templateError || !template) {
    throw new Error(`Template not found: ${params.template_id}`);
  }

  // Fetch task to get idea_id
  const { data: task, error: taskError } = await ctx.supabase
    .from("board_tasks")
    .select("id, idea_id, title")
    .eq("id", params.task_id)
    .single();

  if (taskError || !task) {
    throw new Error(`Task not found: ${params.task_id}`);
  }

  // Create workflow run
  const { data: run, error: runError } = await ctx.supabase
    .from("workflow_runs")
    .insert({
      task_id: params.task_id,
      template_id: params.template_id,
      status: "pending",
      started_by: actorId,
    })
    .select("id, task_id, template_id, status, current_step, started_by, created_at")
    .single();

  if (runError || !run) {
    throw new Error(`Failed to create workflow run: ${runError?.message}`);
  }

  // Fetch idea agent pool with bot profiles for role auto-matching
  const { data: ideaAgents } = await ctx.supabase
    .from("idea_agents")
    .select("bot_id, bot:bot_profiles!idea_agents_bot_id_fkey(id, name, role)")
    .eq("idea_id", task.idea_id);

  // Build fuzzy role matcher from idea agent pool
  const candidates = (ideaAgents ?? [])
    .map((entry) => {
      const bot = (entry as Record<string, unknown>).bot as Record<string, unknown> | null;
      return bot?.role && entry.bot_id
        ? { botId: entry.bot_id, role: String(bot.role) }
        : null;
    })
    .filter((c): c is { botId: string; role: string } => c !== null);

  const matchRole = buildRoleMatcher(candidates);

  // Create workflow steps from template steps array
  const steps = (template.steps ?? []) as unknown as Array<Record<string, unknown>>;
  const createdSteps: Record<string, unknown>[] = [];
  const agentMatches: Record<string, string | null> = {};

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const role = step.role ? String(step.role) : null;
    const matchedBotId = role ? (matchRole(role).botId) : null;

    if (role) {
      agentMatches[role] = matchedBotId;
    }

    const { data: createdStep, error: stepError } = await ctx.supabase
      .from("task_workflow_steps")
      .insert({
        task_id: params.task_id,
        idea_id: task.idea_id,
        run_id: run.id,
        title: String(step.title ?? ""),
        description: step.description ? String(step.description) : null,
        agent_role: role,
        bot_id: matchedBotId,
        human_check_required: Boolean(step.requires_approval ?? false),
        position: (i + 1) * 1000,
        step_order: i + 1,
      })
      .select("id, title, agent_role, bot_id, status, position, step_order, human_check_required")
      .single();

    if (stepError) {
      throw new Error(`Failed to create workflow step ${i + 1}: ${stepError.message}`);
    }
    if (createdStep) createdSteps.push(createdStep as Record<string, unknown>);
  }

  // Increment template usage_count
  await ctx.supabase
    .from("workflow_templates")
    .update({ usage_count: template.usage_count !== undefined ? (template.usage_count as number) + 1 : 1 })
    .eq("id", params.template_id);

  return { run, steps: createdSteps, agent_matches: agentMatches };
}

// ============================================================
// Step Execution Tools
// ============================================================

// --- Claim Next Step ---

export const claimNextStepSchema = z.object({
  task_id: z.string().uuid().describe("The board task ID"),
});

export async function claimNextStep(
  ctx: McpContext,
  params: z.infer<typeof claimNextStepSchema>
) {
  // Find first pending step ordered by step_order then position
  const { data: steps, error } = await ctx.supabase
    .from("task_workflow_steps")
    .select("id, task_id, idea_id, run_id, title, description, agent_role, bot_id, human_check_required, status, position, step_order, output, comment_count, started_at, completed_at, created_at")
    .eq("task_id", params.task_id)
    .eq("status", "pending")
    .order("step_order", { ascending: true, nullsFirst: false })
    .order("position", { ascending: true })
    .limit(1);

  if (error) throw new Error(`Failed to fetch pending steps: ${error.message}`);

  if (!steps || steps.length === 0) {
    return { done: true, message: "All steps complete or no pending steps" };
  }

  const step = steps[0];

  // Claim the step
  const { data: updated, error: updateError } = await ctx.supabase
    .from("task_workflow_steps")
    .update({
      status: "in_progress",
      started_at: new Date().toISOString(),
      bot_id: ctx.userId,
    })
    .eq("id", step.id)
    .select("id, task_id, idea_id, run_id, title, description, agent_role, bot_id, human_check_required, status, position, step_order, output, comment_count, started_at, completed_at, created_at")
    .single();

  if (updateError) throw new Error(`Failed to claim step: ${updateError.message}`);

  // Update workflow run status if step has a run_id
  if (step.run_id) {
    await ctx.supabase
      .from("workflow_runs")
      .update({
        status: "running",
        current_step: step.step_order ?? step.position,
      })
      .eq("id", step.run_id)
      .in("status", ["pending", "running", "failed"]);
  }

  // Fetch rework instructions if this step was previously failed (retry scenario)
  // Look for failure output and changes_requested comments
  let rework_instructions: {
    previous_failure_output: string | null;
    changes_requested: Array<{ content: string; author_id: string; created_at: string }>;
  } | null = null;

  if (step.output || step.comment_count > 0) {
    const { data: reworkComments } = await ctx.supabase
      .from("workflow_step_comments")
      .select("content, author_id, created_at, type")
      .eq("step_id", step.id)
      .in("type", ["failure", "changes_requested"])
      .order("created_at", { ascending: false })
      .limit(10);

    if (step.output || (reworkComments && reworkComments.length > 0)) {
      rework_instructions = {
        previous_failure_output: step.output,
        changes_requested: (reworkComments ?? []).map((c) => ({
          content: c.content,
          author_id: c.author_id,
          created_at: c.created_at,
        })),
      };
    }
  }

  return { done: false, step: updated, rework_instructions };
}

// --- Complete Step ---

export const completeStepSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID"),
  output: z.string().max(10000).optional().describe("Step output or result summary"),
});

export async function completeStep(
  ctx: McpContext,
  params: z.infer<typeof completeStepSchema>
) {
  // Fetch current step
  const { data: step, error: fetchError } = await ctx.supabase
    .from("task_workflow_steps")
    .select("id, run_id, human_check_required, status")
    .eq("id", params.step_id)
    .single();

  if (fetchError || !step) throw new Error(`Step not found: ${params.step_id}`);

  // Determine new status: awaiting_approval if human check required, else completed
  const newStatus = step.human_check_required ? "awaiting_approval" : "completed";

  const updateFields: Record<string, unknown> = { status: newStatus };
  if (params.output !== undefined) updateFields.output = params.output;
  if (newStatus === "completed") updateFields.completed_at = new Date().toISOString();

  const { data: updated, error: updateError } = await ctx.supabase
    .from("task_workflow_steps")
    .update(updateFields)
    .eq("id", params.step_id)
    .select("id, task_id, run_id, title, agent_role, status, output, completed_at")
    .single();

  if (updateError) throw new Error(`Failed to complete step: ${updateError.message}`);

  // Check if all steps in the run are done
  let runComplete = false;
  if (step.run_id && newStatus === "completed") {
    const { data: remainingSteps } = await ctx.supabase
      .from("task_workflow_steps")
      .select("id, status")
      .eq("run_id", step.run_id)
      .not("status", "in", '("completed","failed")');

    if (!remainingSteps || remainingSteps.length === 0) {
      await ctx.supabase
        .from("workflow_runs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", step.run_id);
      runComplete = true;
    }
  }

  return { step: updated, run_complete: runComplete, status: newStatus };
}

// --- Fail Step ---

export const failStepSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID"),
  output: z.string().max(10000).optional().describe("Failure reason or error details"),
  reset_to_step_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Cascade rejection: reset all steps from this step onward back to pending. Use this to send work back to an earlier step in the pipeline."
    ),
});

export async function failStep(
  ctx: McpContext,
  params: z.infer<typeof failStepSchema>
) {
  // Fetch current step to get run_id and step_order
  const { data: step, error: fetchError } = await ctx.supabase
    .from("task_workflow_steps")
    .select("id, run_id, step_order")
    .eq("id", params.step_id)
    .single();

  if (fetchError || !step) throw new Error(`Step not found: ${params.step_id}`);

  const updateFields: Record<string, unknown> = { status: "failed" };
  if (params.output !== undefined) updateFields.output = params.output;

  const { data: updated, error: updateError } = await ctx.supabase
    .from("task_workflow_steps")
    .update(updateFields)
    .eq("id", params.step_id)
    .select("id, task_id, run_id, title, agent_role, status, output")
    .single();

  if (updateError) throw new Error(`Failed to fail step: ${updateError.message}`);

  // Cascade rejection: reset all steps from the target step onward
  let stepsReset = 0;
  if (params.reset_to_step_id && step.run_id) {
    const { data: targetStep } = await ctx.supabase
      .from("task_workflow_steps")
      .select("step_order, position")
      .eq("id", params.reset_to_step_id)
      .eq("run_id", step.run_id)
      .single();

    if (targetStep) {
      const { data: resetSteps } = await ctx.supabase
        .from("task_workflow_steps")
        .update({
          status: "pending",
          output: null,
          started_at: null,
          completed_at: null,
        })
        .eq("run_id", step.run_id)
        .neq("id", params.step_id)
        .gte("step_order", targetStep.step_order ?? 0)
        .select("id");

      stepsReset = resetSteps?.length ?? 0;
    }
  }

  // Mark the run as failed
  if (step.run_id) {
    await ctx.supabase
      .from("workflow_runs")
      .update({ status: "failed" })
      .eq("id", step.run_id);
  }

  return { step: updated, steps_reset: stepsReset };
}

// --- Approve Step ---

export const approveStepSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID (must be in awaiting_approval status)"),
  comment: z.string().max(5000).optional().describe("Optional approval comment"),
});

export async function approveStep(
  ctx: McpContext,
  params: z.infer<typeof approveStepSchema>
) {
  // Fetch step — must be awaiting_approval
  const { data: step, error: fetchError } = await ctx.supabase
    .from("task_workflow_steps")
    .select("id, run_id, idea_id, status")
    .eq("id", params.step_id)
    .single();

  if (fetchError || !step) throw new Error(`Step not found: ${params.step_id}`);
  if (step.status !== "awaiting_approval") {
    throw new Error(`Step is not awaiting approval (current status: ${step.status})`);
  }

  const { data: updated, error: updateError } = await ctx.supabase
    .from("task_workflow_steps")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", params.step_id)
    .select("id, task_id, run_id, title, agent_role, status, output, completed_at")
    .single();

  if (updateError) throw new Error(`Failed to approve step: ${updateError.message}`);

  // Insert approval comment if provided
  if (params.comment && step.idea_id) {
    const { error: commentError } = await ctx.supabase
      .from("workflow_step_comments")
      .insert({
        step_id: params.step_id,
        idea_id: step.idea_id,
        author_id: ctx.userId,
        type: "approval",
        content: params.comment,
      });
    if (commentError) {
      // Non-fatal: step is already approved, just log
      console.warn(`Failed to insert approval comment: ${commentError.message}`);
    }
  }

  // Check if all steps in the run are done
  let runComplete = false;
  if (step.run_id) {
    const { data: remainingSteps } = await ctx.supabase
      .from("task_workflow_steps")
      .select("id, status")
      .eq("run_id", step.run_id)
      .not("status", "in", '("completed","failed")');

    if (!remainingSteps || remainingSteps.length === 0) {
      await ctx.supabase
        .from("workflow_runs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", step.run_id);
      runComplete = true;
    }
  }

  return { step: updated, run_complete: runComplete };
}

// --- Get Step Context ---

export const getStepContextSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID"),
});

export async function getStepContext(
  ctx: McpContext,
  params: z.infer<typeof getStepContextSchema>
) {
  // Fetch the step with its task details
  const { data: step, error: stepError } = await ctx.supabase
    .from("task_workflow_steps")
    .select(
      "id, task_id, idea_id, run_id, bot_id, title, description, agent_role, status, position, step_order, output, human_check_required, comment_count, started_at, completed_at, created_at, updated_at"
    )
    .eq("id", params.step_id)
    .single();

  if (stepError || !step) throw new Error(`Step not found: ${params.step_id}`);

  // Fetch task details
  const { data: task } = await ctx.supabase
    .from("board_tasks")
    .select("id, title, description, idea_id, column_id, assignee_id")
    .eq("id", step.task_id)
    .single();

  // Fetch comments for this step
  const { data: comments } = await ctx.supabase
    .from("workflow_step_comments")
    .select("id, type, content, author_id, created_at")
    .eq("step_id", params.step_id)
    .order("created_at", { ascending: true });

  // Fetch previous steps' outputs in the same run (for context chaining)
  let previousStepsOutput: Array<Record<string, unknown>> = [];
  if (step.run_id) {
    const { data: prevSteps } = await ctx.supabase
      .from("task_workflow_steps")
      .select("id, title, agent_role, step_order, status, output, completed_at")
      .eq("run_id", step.run_id)
      .lt("step_order", step.step_order ?? 999999)
      .order("step_order", { ascending: true });

    previousStepsOutput = (prevSteps ?? []) as Array<Record<string, unknown>>;
  }

  return {
    step,
    task: task ?? null,
    comments: comments ?? [],
    previous_steps: previousStepsOutput,
  };
}

// --- Add Step Comment ---

export const addStepCommentSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID"),
  idea_id: z.string().uuid().describe("The idea ID (required for RLS)"),
  content: z.string().min(1).max(5000).describe("Comment content"),
  type: z
    .enum(["comment", "output", "failure", "approval", "changes_requested"])
    .optional()
    .default("comment")
    .describe("Comment type (default: comment)"),
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
      type: params.type,
      content: params.content,
    })
    .select("id, step_id, idea_id, author_id, type, content, created_at")
    .single();

  if (error) throw new Error(`Failed to add step comment: ${error.message}`);
  return data;
}

// --- Get Step Comments ---

export const getStepCommentsSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID"),
});

export async function getStepComments(
  ctx: McpContext,
  params: z.infer<typeof getStepCommentsSchema>
) {
  const { data, error } = await ctx.supabase
    .from("workflow_step_comments")
    .select(
      "id, step_id, idea_id, author_id, type, content, created_at, updated_at, author:users!workflow_step_comments_author_id_fkey(full_name, avatar_url)"
    )
    .eq("step_id", params.step_id)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to fetch step comments: ${error.message}`);

  return (data ?? []).map((row) => {
    const author = (row as Record<string, unknown>).author as Record<string, unknown> | null;
    return {
      id: row.id,
      step_id: row.step_id,
      idea_id: row.idea_id,
      author_id: row.author_id,
      author_name: author?.full_name ?? null,
      author_avatar_url: author?.avatar_url ?? null,
      type: row.type,
      content: row.content,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });
}
