import { z } from "zod";
import type { McpContext } from "../context";
import { buildRoleMatcher } from "../../../src/lib/role-matching";
import { checkAndCompleteRun } from "../../../src/lib/workflow-helpers";

// --- Shared step schema used by template tools ---

const templateStepSchema = z.object({
  title: z.string().min(1).max(200).describe("Step title"),
  role: z.string().min(1).max(100).describe("Agent role that should execute this step"),
  description: z.string().max(5000).optional().describe("Step description"),
  requires_approval: z.boolean().optional().describe("Whether human approval is required after completion"),
  deliverables: z.array(z.string().max(100)).max(10).optional()
    .describe("Expected deliverables this step should produce (e.g. 'HTML mockups', 'requirements doc')"),
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

  // Check for active runs on this task
  const { data: activeRun } = await ctx.supabase
    .from("workflow_runs")
    .select("id")
    .eq("task_id", params.task_id)
    .not("status", "in", '("completed","failed")')
    .maybeSingle();

  if (activeRun) {
    throw new Error(
      "This task already has an active workflow. Reset or remove it before applying a new one."
    );
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
    // Catch unique constraint violation as fallback
    if (runError?.code === "23505") {
      throw new Error(
        "This task already has an active workflow. Reset or remove it before applying a new one."
      );
    }
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
        expected_deliverables: Array.isArray(step.deliverables) ? step.deliverables : [],
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
    .select("id, task_id, idea_id, run_id, title, description, agent_role, bot_id, claimed_by, human_check_required, status, position, step_order, output, comment_count, started_at, completed_at, created_at")
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

  // Claim the step — status guard prevents concurrent claims
  const { data: updated, error: updateError } = await ctx.supabase
    .from("task_workflow_steps")
    .update({
      status: "in_progress",
      started_at: new Date().toISOString(),
      claimed_by: ctx.userId,
    })
    .eq("id", step.id)
    .eq("status", "pending")
    .select("id, task_id, idea_id, run_id, title, description, agent_role, bot_id, claimed_by, human_check_required, status, position, step_order, output, expected_deliverables, comment_count, started_at, completed_at, created_at")
    .maybeSingle();

  if (updateError) throw new Error(`Failed to claim step: ${updateError.message}`);
  if (!updated) throw new Error("Step is no longer pending — it may have been claimed by another agent");

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

  // Fetch available agents on this idea so Claude Code can reason about
  // which agent persona to assume for the step's agent_role
  const { data: ideaAgents } = await ctx.supabase
    .from("idea_agents")
    .select("bot_id, bot:bot_profiles!idea_agents_bot_id_fkey(id, name, role, avatar_url, is_active)")
    .eq("idea_id", step.idea_id)
    .order("created_at", { ascending: true });

  const available_agents = (ideaAgents ?? []).map((row) => {
    const bot = (row as Record<string, unknown>).bot as Record<string, unknown> | null;
    return {
      bot_id: row.bot_id,
      bot_name: bot?.name ?? null,
      bot_role: bot?.role ?? null,
      is_active: bot?.is_active ?? false,
    };
  });

  // Fetch context from prior completed/skipped steps in the same run
  // Reads directly from the step's `output` column (the single source of truth),
  // not from workflow_step_comments which are a UI display feature only.
  let context: { step_title: string; output: string }[] = [];
  if (step.run_id) {
    const { data: priorSteps } = await ctx.supabase
      .from("task_workflow_steps")
      .select("id, title, step_order, output")
      .eq("run_id", step.run_id)
      .in("status", ["completed", "skipped"])
      .lt("step_order", step.step_order ?? 999999)
      .order("step_order", { ascending: true });

    if (priorSteps && priorSteps.length > 0) {
      context = priorSteps
        .filter((s) => s.output)
        .map((s) => ({ step_title: s.title, output: s.output! }));
    }
  }

  const expected_deliverables = updated.expected_deliverables ?? [];

  // Build an explicit instruction for Claude Code to switch identity before executing
  const matchedAgent = updated.bot_id
    ? available_agents.find((a) => a.bot_id === updated.bot_id)
    : null;

  const identityInstruction = matchedAgent
    ? `IMPORTANT: Before executing this step, you MUST call the set_agent_identity tool with agent_id "${matchedAgent.bot_id}" to switch to the ${matchedAgent.bot_name} (${matchedAgent.bot_role}) persona. This ensures your work is attributed correctly and you follow the agent's system prompt.`
    : `IMPORTANT: Before executing this step, you MUST call the set_agent_identity tool to assume an appropriate persona for the "${updated.agent_role}" role. Review the available_agents list and pick the best match by role, then call set_agent_identity with that agent's bot_id.`;

  const contextParts: string[] = [];

  if (context.length > 0) {
    const stepNames = context.map((c) => `"${c.step_title}"`).join(", ");
    contextParts.push(
      `CONTEXT CHAINING: The "context" array contains deliverables from ${context.length} completed prior step(s): ${stepNames}. ` +
      `You MUST explicitly reference and build upon these prior deliverables in your output. Specifically:\n` +
      `- Cite prior steps by name (e.g., "Building on the findings from [Step Name]...")\n` +
      `- Show how your work extends, refines, or implements what prior steps produced\n` +
      `- Do NOT repeat prior deliverables wholesale — reference them and add new value\n` +
      `- If a prior step's output conflicts with your analysis, call out the discrepancy explicitly`
    );
  }

  if (expected_deliverables.length > 0) {
    contextParts.push(
      `EXPECTED DELIVERABLES: You are expected to produce: ${expected_deliverables.join(", ")}.`
    );
  }

  if (updated.human_check_required) {
    contextParts.push(
      `HUMAN APPROVAL REQUIRED: This step requires human approval. After producing your deliverable and calling complete_step, you MUST STOP. Do NOT call approve_step yourself. Present your deliverable to the user and wait for them to explicitly instruct you to approve it.`
    );
  }

  contextParts.push(
    `DELIVERABLE: Pass your full deliverable as the "output" parameter of complete_step.`
  );

  contextParts.push(
    `TASK DESCRIPTION: After calling complete_step, call update_task to append a summary of your deliverable to the task description under a markdown heading.`
  );

  const instruction = [identityInstruction, ...contextParts].join("\n\n");

  return { done: false, step: updated, instruction, rework_instructions, available_agents, context, expected_deliverables };
}

// --- Complete Step ---

export const completeStepSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID"),
  output: z.string().max(50000).optional().describe("Step output or deliverable. This is stored on the step's `output` column and is how subsequent steps receive context — when the next step is claimed, all prior completed steps' outputs are passed in the `context` array. Also posted as a step comment for UI display."),
});

export async function completeStep(
  ctx: McpContext,
  params: z.infer<typeof completeStepSchema>
) {
  // Fetch current step
  const { data: step, error: fetchError } = await ctx.supabase
    .from("task_workflow_steps")
    .select("id, run_id, idea_id, human_check_required, status")
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
    .eq("status", "in_progress")
    .select("id, task_id, run_id, title, agent_role, status, output, completed_at")
    .maybeSingle();

  if (updateError) throw new Error(`Failed to complete step: ${updateError.message}`);
  if (!updated) throw new Error("Step is no longer in progress — it may have been modified by another agent");

  // Store output as a step comment for context chaining
  if (params.output && step.idea_id) {
    await ctx.supabase
      .from("workflow_step_comments")
      .insert({
        step_id: params.step_id,
        idea_id: step.idea_id,
        author_id: ctx.userId,
        type: "output",
        content: params.output,
      });
  }

  // Check if all steps in the run are done
  let runComplete = false;
  if (step.run_id && newStatus === "completed") {
    runComplete = await checkAndCompleteRun(ctx.supabase, step.run_id);
  }

  return {
    step: updated,
    run_complete: runComplete,
    status: newStatus,
    ...(newStatus === "awaiting_approval" && {
      message: "This step is now awaiting human approval. STOP here — do NOT call approve_step yourself. Present your output to the user and wait for them to explicitly instruct you to approve it.",
    }),
  };
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
    .in("status", ["in_progress", "awaiting_approval"])
    .select("id, task_id, run_id, title, agent_role, status, output")
    .maybeSingle();

  if (updateError) throw new Error(`Failed to fail step: ${updateError.message}`);
  if (!updated) throw new Error("Step is not in a state that can be failed (must be in_progress or awaiting_approval)");

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

// --- Skip Step ---

export const skipStepSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID (must be in pending status)"),
  reason: z.string().max(10000).optional().describe("Reason for skipping (e.g. 'Not applicable to this task')"),
});

export async function skipStep(
  ctx: McpContext,
  params: z.infer<typeof skipStepSchema>
) {
  const { data: step, error: fetchError } = await ctx.supabase
    .from("task_workflow_steps")
    .select("id, run_id, status")
    .eq("id", params.step_id)
    .single();

  if (fetchError || !step) throw new Error(`Step not found: ${params.step_id}`);
  if (step.status !== "pending") throw new Error(`Can only skip pending steps (current: ${step.status})`);

  const { data: updated, error: updateError } = await ctx.supabase
    .from("task_workflow_steps")
    .update({
      status: "skipped",
      completed_at: new Date().toISOString(),
      output: params.reason ?? "Skipped — not applicable to this task",
    })
    .eq("id", params.step_id)
    .eq("status", "pending")
    .select("id, task_id, run_id, title, agent_role, status, output, completed_at")
    .maybeSingle();

  if (updateError) throw new Error(`Failed to skip step: ${updateError.message}`);
  if (!updated) throw new Error("Step is no longer pending — it may have been claimed by another agent");

  // Check if all steps in the run are now resolved
  let runComplete = false;
  if (step.run_id) {
    runComplete = await checkAndCompleteRun(ctx.supabase, step.run_id);
  }

  return { step: updated, run_complete: runComplete };
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
  // Block bot callers — only humans can approve human-gated steps
  const { data: caller } = await ctx.supabase
    .from("users")
    .select("is_bot")
    .eq("id", ctx.userId)
    .single();

  if (caller?.is_bot) {
    throw new Error(
      "Only humans can approve workflow steps. This step requires human review — " +
      "do NOT call approve_step yourself. Stop and wait for a human to explicitly instruct you to approve."
    );
  }

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
    .eq("status", "awaiting_approval")
    .select("id, task_id, run_id, title, agent_role, status, output, completed_at")
    .maybeSingle();

  if (updateError) throw new Error(`Failed to approve step: ${updateError.message}`);
  if (!updated) throw new Error("Step is no longer awaiting approval — it may have been modified concurrently");

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
    runComplete = await checkAndCompleteRun(ctx.supabase, step.run_id);
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

// --- Rematch Workflow Agents ---

export const rematchWorkflowAgentsSchema = z.object({
  task_id: z.string().uuid().describe("The board task ID"),
});

export async function rematchWorkflowAgents(
  ctx: McpContext,
  params: z.infer<typeof rematchWorkflowAgentsSchema>
) {
  // Fetch pending steps where bot_id IS NULL and agent_role IS NOT NULL
  const { data: unmatchedSteps, error: stepsError } = await ctx.supabase
    .from("task_workflow_steps")
    .select("id, agent_role")
    .eq("task_id", params.task_id)
    .eq("status", "pending")
    .is("bot_id", null)
    .not("agent_role", "is", null);

  if (stepsError) throw new Error(`Failed to fetch unmatched steps: ${stepsError.message}`);

  if (!unmatchedSteps || unmatchedSteps.length === 0) {
    return { matched: 0, unmatched: 0, matches: {} };
  }

  // Fetch task to get idea_id
  const { data: task, error: taskError } = await ctx.supabase
    .from("board_tasks")
    .select("idea_id")
    .eq("id", params.task_id)
    .single();

  if (taskError || !task) throw new Error(`Task not found: ${params.task_id}`);

  // Fetch idea agent pool with bot profiles
  const { data: ideaAgents } = await ctx.supabase
    .from("idea_agents")
    .select("bot_id, bot:bot_profiles!idea_agents_bot_id_fkey(id, name, role)")
    .eq("idea_id", task.idea_id);

  const candidates = (ideaAgents ?? [])
    .map((entry) => {
      const bot = (entry as Record<string, unknown>).bot as Record<string, unknown> | null;
      return bot?.role && entry.bot_id
        ? { botId: entry.bot_id, role: String(bot.role) }
        : null;
    })
    .filter((c): c is { botId: string; role: string } => c !== null);

  const matchRole = buildRoleMatcher(candidates);

  let matched = 0;
  let unmatched = 0;
  const matches: Record<string, string> = {};

  for (const step of unmatchedSteps) {
    const role = step.agent_role!;
    const result = matchRole(role);

    if (result.botId) {
      await ctx.supabase
        .from("task_workflow_steps")
        .update({ bot_id: result.botId })
        .eq("id", step.id);

      matches[role] = result.botId;
      matched++;
    } else {
      unmatched++;
    }
  }

  return { matched, unmatched, matches };
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

// ============================================================
// Workflow Reset & Remove Tools
// ============================================================

// --- Reset Workflow ---

export const resetWorkflowSchema = z.object({
  task_id: z.string().uuid().describe("The board task ID whose active workflow should be reset"),
});

export async function resetWorkflow(
  ctx: McpContext,
  params: z.infer<typeof resetWorkflowSchema>
) {
  // Find the active run for this task
  const { data: run, error: runError } = await ctx.supabase
    .from("workflow_runs")
    .select("id")
    .eq("task_id", params.task_id)
    .not("status", "in", '("completed","failed")')
    .maybeSingle();

  if (runError) throw new Error(`Failed to find workflow run: ${runError.message}`);
  if (!run) throw new Error("No active workflow found on this task");

  // Reset all steps
  const { error: stepsError } = await ctx.supabase
    .from("task_workflow_steps")
    .update({
      status: "pending",
      output: null,
      started_at: null,
      completed_at: null,
      claimed_by: null,
    })
    .eq("run_id", run.id);

  if (stepsError) throw new Error(`Failed to reset steps: ${stepsError.message}`);

  // Reset run
  const { error: resetError } = await ctx.supabase
    .from("workflow_runs")
    .update({
      status: "pending",
      current_step: null,
      completed_at: null,
    })
    .eq("id", run.id);

  if (resetError) throw new Error(`Failed to reset workflow run: ${resetError.message}`);

  return { success: true, run_id: run.id, message: "Workflow reset — all steps are now pending" };
}

// --- Remove Workflow ---

export const removeWorkflowSchema = z.object({
  task_id: z.string().uuid().describe("The board task ID whose active workflow should be removed"),
});

export async function removeWorkflow(
  ctx: McpContext,
  params: z.infer<typeof removeWorkflowSchema>
) {
  // Find the active run for this task
  const { data: run, error: runError } = await ctx.supabase
    .from("workflow_runs")
    .select("id")
    .eq("task_id", params.task_id)
    .not("status", "in", '("completed","failed")')
    .maybeSingle();

  if (runError) throw new Error(`Failed to find workflow run: ${runError.message}`);
  if (!run) throw new Error("No active workflow found on this task");

  // Delete run — steps cascade via FK ON DELETE CASCADE
  const { error } = await ctx.supabase
    .from("workflow_runs")
    .delete()
    .eq("id", run.id);

  if (error) throw new Error(`Failed to remove workflow: ${error.message}`);

  return { success: true, run_id: run.id, message: "Workflow removed — all steps deleted" };
}

// ============================================================
// Auto-Rule Tools
// ============================================================

// --- List Workflow Auto Rules ---

export const listWorkflowAutoRulesSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function listWorkflowAutoRules(
  ctx: McpContext,
  params: z.infer<typeof listWorkflowAutoRulesSchema>
) {
  const { data, error } = await ctx.supabase
    .from("workflow_auto_rules")
    .select("*, workflow_templates(id, name), board_labels(id, name, color)")
    .eq("idea_id", params.idea_id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list auto rules: ${error.message}`);
  return data ?? [];
}

// --- Create Workflow Auto Rule ---

export const createWorkflowAutoRuleSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  label_id: z.string().uuid().describe("The board label ID that triggers this rule"),
  template_id: z.string().uuid().describe("The workflow template ID to apply when the label is added"),
  auto_run: z.boolean().optional().default(false).describe("Whether to auto-start the workflow run after applying (default: false)"),
});

export async function createWorkflowAutoRule(
  ctx: McpContext,
  params: z.infer<typeof createWorkflowAutoRuleSchema>
) {
  const { data, error } = await ctx.supabase
    .from("workflow_auto_rules")
    .insert({
      idea_id: params.idea_id,
      label_id: params.label_id,
      template_id: params.template_id,
      auto_run: params.auto_run,
    })
    .select("*, workflow_templates(id, name), board_labels(id, name, color)")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("An auto-rule already exists for this label. Update or delete the existing rule first.");
    }
    throw new Error(`Failed to create auto rule: ${error.message}`);
  }
  return data;
}

// --- Update Workflow Auto Rule ---

export const updateWorkflowAutoRuleSchema = z.object({
  rule_id: z.string().uuid().describe("The auto rule ID"),
  template_id: z.string().uuid().optional().describe("New workflow template ID"),
  auto_run: z.boolean().optional().describe("Whether to auto-start the workflow run after applying"),
});

export async function updateWorkflowAutoRule(
  ctx: McpContext,
  params: z.infer<typeof updateWorkflowAutoRuleSchema>
) {
  const patch: Record<string, unknown> = {};
  if (params.template_id !== undefined) patch.template_id = params.template_id;
  if (params.auto_run !== undefined) patch.auto_run = params.auto_run;

  if (Object.keys(patch).length === 0) {
    return { success: true, message: "No changes to apply" };
  }

  const { data, error } = await ctx.supabase
    .from("workflow_auto_rules")
    .update(patch)
    .eq("id", params.rule_id)
    .select("*, workflow_templates(id, name), board_labels(id, name, color)")
    .single();

  if (error) throw new Error(`Failed to update auto rule: ${error.message}`);
  return data;
}

// --- Delete Workflow Auto Rule ---

export const deleteWorkflowAutoRuleSchema = z.object({
  rule_id: z.string().uuid().describe("The auto rule ID to delete"),
});

export async function deleteWorkflowAutoRule(
  ctx: McpContext,
  params: z.infer<typeof deleteWorkflowAutoRuleSchema>
) {
  const { error } = await ctx.supabase
    .from("workflow_auto_rules")
    .delete()
    .eq("id", params.rule_id);

  if (error) throw new Error(`Failed to delete auto rule: ${error.message}`);
  return { success: true, rule_id: params.rule_id };
}

// --- Apply Auto Rule Retroactively ---

export const applyAutoRuleRetroactivelySchema = z.object({
  rule_id: z.string().uuid().describe("The auto rule ID to apply retroactively to already-labelled tasks"),
});

export async function applyAutoRuleRetroactively(
  ctx: McpContext,
  params: z.infer<typeof applyAutoRuleRetroactivelySchema>
) {
  // Fetch the rule with template info
  const { data: rule, error: ruleError } = await ctx.supabase
    .from("workflow_auto_rules")
    .select("id, idea_id, label_id, template_id")
    .eq("id", params.rule_id)
    .single();

  if (ruleError || !rule) throw new Error(`Auto rule not found: ${params.rule_id}`);

  // Find all non-archived tasks with the matching label
  const { data: labelledTasks, error: tasksError } = await ctx.supabase
    .from("board_task_labels")
    .select("task_id, board_tasks!inner(id, is_archived)")
    .eq("label_id", rule.label_id);

  if (tasksError) throw new Error(`Failed to find labelled tasks: ${tasksError.message}`);

  // Filter out archived tasks
  const taskIds = (labelledTasks ?? [])
    .filter((t) => {
      const task = (t as Record<string, unknown>).board_tasks as Record<string, unknown> | null;
      return task && !task.is_archived;
    })
    .map((t) => t.task_id);

  if (taskIds.length === 0) {
    return { applied: 0, skipped: 0, message: "No tasks found with the matching label" };
  }

  // Find tasks that already have active workflow runs
  const { data: activeRuns } = await ctx.supabase
    .from("workflow_runs")
    .select("task_id")
    .in("task_id", taskIds)
    .not("status", "in", '("completed","failed")');

  const tasksWithActiveRuns = new Set((activeRuns ?? []).map((r) => r.task_id));

  let applied = 0;
  let skipped = 0;

  for (const taskId of taskIds) {
    if (tasksWithActiveRuns.has(taskId)) {
      skipped++;
      continue;
    }

    try {
      await applyWorkflowTemplate(ctx, {
        task_id: taskId,
        template_id: rule.template_id,
      });
      applied++;
    } catch {
      // Task may have gotten a workflow between our check and apply — skip it
      skipped++;
    }
  }

  return { applied, skipped, total: taskIds.length };
}
