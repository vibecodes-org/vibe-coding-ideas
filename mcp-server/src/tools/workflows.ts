import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import type { McpContext } from "../context";
import { matchRolesWithAiOrFuzzy } from "../../../src/lib/ai-role-matching";
import { checkAndCompleteRun, propagateTemplateEdits } from "../../../src/lib/workflow-helpers";
import { tierRank } from "../../../src/lib/role-matching";

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

  // Propagate step edits to pending steps in active workflow runs
  let propagation = null;
  if (params.steps !== undefined) {
    propagation = await propagateTemplateEdits(ctx.supabase, params.template_id, params.steps);
  }

  return { ...data, propagation };
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

  // Build agent candidates with names for AI role matching
  const candidates = (ideaAgents ?? [])
    .map((entry) => {
      const bot = (entry as Record<string, unknown>).bot as Record<string, unknown> | null;
      return bot?.role && entry.bot_id
        ? { botId: entry.bot_id, name: String(bot.name ?? ""), role: String(bot.role) }
        : null;
    })
    .filter((c): c is { botId: string; name: string; role: string } => c !== null);

  // Create workflow steps from template steps array
  const steps = (template.steps ?? []) as unknown as Array<Record<string, unknown>>;

  // Collect unique step roles for AI/fuzzy matching
  const stepRoles = [...new Set(
    steps.map((s) => (s.role ? String(s.role) : null)).filter((r): r is string => r !== null)
  )];

  // Match roles using AI (with fuzzy fallback)
  const agentMatches = await matchRolesWithAiOrFuzzy(ctx.supabase, actorId, stepRoles, candidates);

  const createdSteps: Record<string, unknown>[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const role = step.role ? String(step.role) : null;
    const match = role ? agentMatches[role] : undefined;
    const matchedBotId = match?.botId ?? null;

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
        match_tier: matchedBotId ? (match?.tier ?? null) : null,
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

  // Tier 2: Run-scoped fallback for intermediate cascade-reset steps.
  // These steps have no local failure/changes_requested comments but the run
  // has them on sibling steps from the cascade rejection.
  if (!rework_instructions && step.run_id) {
    const { data: runSteps } = await ctx.supabase
      .from("task_workflow_steps")
      .select("id")
      .eq("run_id", step.run_id);

    if (runSteps && runSteps.length > 0) {
      const stepIds = runSteps.map((s: { id: string }) => s.id);
      const { data: runComments } = await ctx.supabase
        .from("workflow_step_comments")
        .select("content, author_id, created_at, type")
        .in("step_id", stepIds)
        .in("type", ["failure", "changes_requested"])
        .order("created_at", { ascending: false })
        .limit(10);

      if (runComments && runComments.length > 0) {
        const latestFailure = runComments.find((c) => c.type === "failure");
        rework_instructions = {
          previous_failure_output: latestFailure?.content ?? null,
          changes_requested: runComments
            .filter((c) => c.type === "changes_requested")
            .map((c) => ({
              content: c.content,
              author_id: c.author_id,
              created_at: c.created_at,
            })),
        };
      }
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
  let context: { step_id: string; step_title: string; output: string }[] = [];
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
        .map((s) => ({ step_id: s.id, step_title: s.title, output: s.output! }));
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
    const deliverableLines = expected_deliverables.map((d: string) => {
      // Extract format hint from parenthetical like "Design document (HTML)"
      const formatMatch = d.match(/\(([^)]+)\)\s*$/);
      const formatNote = formatMatch
        ? ` — write this as a ${formatMatch[1]} file (not markdown).`
        : "";
      return `- ${d}${formatNote}`;
    });
    contextParts.push(
      `EXPECTED DELIVERABLES: You MUST produce the following:\n${deliverableLines.join("\n")}\n` +
      `Respect any format specified in parentheses (e.g. "(HTML)" means write a valid HTML file, not markdown).`
    );
  }

  if (updated.human_check_required) {
    contextParts.push(
      `HUMAN APPROVAL REQUIRED: This step requires human approval. After producing your deliverable and calling complete_step, you MUST STOP. Do NOT call approve_step yourself. Present your deliverable to the user and wait for them to explicitly instruct you to approve it.`
    );
  }

  if (context.length > 0) {
    const priorStepList = context.map((c) => `- "${c.step_title}" (step_id: ${c.step_id})`).join("\n");
    contextParts.push(
      `CASCADE REJECTION: If you find issues with prior work, use fail_step with reset_to_step_id to send work back to the responsible step instead of fixing it yourself. ` +
      `Prior steps:\n${priorStepList}`
    );
  }

  // Detect file-based format hints from deliverables
  const fileFormats = ["HTML", "JSON", "CSS", "SVG", "XML", "YAML", "CSV", "SQL"];
  const hasFileDeliverable = expected_deliverables.some((d: string) => {
    const formatMatch = d.match(/\(([^)]+)\)\s*$/);
    return formatMatch && fileFormats.some(f => formatMatch[1].toUpperCase().includes(f));
  });

  if (hasFileDeliverable) {
    contextParts.push(
      `DELIVERABLE: This step requires file-based output. For each deliverable with a format in parentheses (e.g. "(HTML)", "(JSON)"):\n` +
      `1. Write the file to the docs/ directory using a descriptive filename based on the step title (e.g. docs/design-review.html)\n` +
      `2. Pass a brief summary of what you produced + the file path as the "output" parameter of complete_step\n` +
      `3. Do NOT paste the full file content into the output parameter — it will be truncated and unreadable\n` +
      `The output parameter is for a summary and file path reference only.`
    );
  } else if (expected_deliverables.length > 0) {
    contextParts.push(
      `DELIVERABLE FORMAT: Choose the appropriate format based on task complexity:\n` +
      `- For substantial UI work (new pages, complex forms, multi-step flows, dashboards): write an HTML mockup to the docs/ directory and pass the file path + summary as the "output" parameter of complete_step\n` +
      `- For simple changes (adding a button, tweaking a dialog, small UI adjustments, config changes): pass a concise markdown description as the "output" parameter of complete_step\n` +
      `Use your judgement — prefer the lighter format unless visual review adds clear value.`
    );
  } else {
    contextParts.push(
      `DELIVERABLE: Pass your full deliverable as the "output" parameter of complete_step.`
    );
  }

  if (rework_instructions) {
    const reworkParts: string[] = [
      `⚠️ REWORK REQUIRED: This step was previously attempted and failed. Address the feedback below before proceeding.`,
    ];
    if (rework_instructions.previous_failure_output) {
      reworkParts.push(`Previous failure: ${rework_instructions.previous_failure_output}`);
    }
    for (const cr of rework_instructions.changes_requested) {
      reworkParts.push(`Feedback: ${cr.content}`);
    }
    contextParts.push(reworkParts.join("\n"));
  }

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
  // Fetch current step (include bot_id + agent_role for identity enforcement)
  const { data: step, error: fetchError } = await ctx.supabase
    .from("task_workflow_steps")
    .select("id, run_id, idea_id, human_check_required, status, bot_id, agent_role")
    .eq("id", params.step_id)
    .single();

  if (fetchError || !step) throw new Error(`Step not found: ${params.step_id}`);

  // Identity guard: reject if caller doesn't match the pre-matched agent
  if (step.bot_id && ctx.userId !== step.bot_id) {
    // Look up the expected agent's name for a helpful error message
    const { data: agent } = await ctx.supabase
      .from("bot_profiles")
      .select("name, role")
      .eq("user_id", step.bot_id)
      .maybeSingle();

    const agentName = agent?.name ?? "unknown";
    const agentRole = agent?.role ?? step.agent_role ?? "unknown";
    throw new Error(
      `Identity mismatch: this step is assigned to ${agentName} (${agentRole}). ` +
      `Call set_agent_identity with agent_id "${step.bot_id}" before completing this step.`
    );
  }

  // Determine new status: awaiting_approval if human check required, else completed
  const newStatus = step.human_check_required ? "awaiting_approval" : "completed";

  const updateFields: Record<string, unknown> = { status: newStatus, claimed_by: ctx.userId };
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
  output: z.string().max(10000).optional().describe(
    "Failure reason or error details (use `output`, not `reason`). Stored on the step's `output` column and auto-posted as a 'failure' comment. When cascade rejection is used and this step is re-claimed, this text is returned as `rework_instructions` to give the next agent context for retry."
  ),
  reset_to_step_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Cascade rejection: reset all steps from this step onward back to pending, allowing the workflow to be reworked from that point. The workflow run stays 'running' (not failed). Without this parameter, the workflow run is marked as 'failed' and stops entirely. Typically set to the ID of the step that produced the bad output."
    ),
});

export async function failStep(
  ctx: McpContext,
  params: z.infer<typeof failStepSchema>
) {
  // Fetch current step to get run_id, step_order, status, and bot_id for identity check
  const { data: step, error: fetchError } = await ctx.supabase
    .from("task_workflow_steps")
    .select("id, run_id, step_order, idea_id, bot_id, agent_role, status")
    .eq("id", params.step_id)
    .single();

  if (fetchError || !step) throw new Error(`Step not found: ${params.step_id}`);

  // Identity guard: reject if caller doesn't match the pre-matched agent
  // Skip for awaiting_approval steps — humans reject those regardless of bot_id
  if (step.bot_id && step.status !== "awaiting_approval" && ctx.userId !== step.bot_id) {
    const { data: agent } = await ctx.supabase
      .from("bot_profiles")
      .select("name, role")
      .eq("user_id", step.bot_id)
      .maybeSingle();

    const agentName = agent?.name ?? "unknown";
    const agentRole = agent?.role ?? step.agent_role ?? "unknown";
    throw new Error(
      `Identity mismatch: this step is assigned to ${agentName} (${agentRole}). ` +
      `Call set_agent_identity with agent_id "${step.bot_id}" before failing this step.`
    );
  }

  const updateFields: Record<string, unknown> = {
    status: "failed",
    completed_at: new Date().toISOString(),
  };
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

  // Auto-create a failure comment so the output is preserved as a comment
  // (especially important before cascade wipes the step's output column)
  if (params.output) {
    await ctx.supabase.from("workflow_step_comments").insert({
      step_id: params.step_id,
      idea_id: step.idea_id,
      author_id: ctx.userId,
      type: "failure",
      content: params.output,
    });
  }

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
      // Snapshot outputs from steps that will be wiped — preserves work history as comments
      const { data: stepsWithOutput } = await ctx.supabase
        .from("task_workflow_steps")
        .select("id, output, claimed_by")
        .eq("run_id", step.run_id)
        .neq("id", params.step_id)
        .gte("step_order", targetStep.step_order ?? 0)
        .not("output", "is", null);

      if (stepsWithOutput?.length) {
        await ctx.supabase.from("workflow_step_comments").insert(
          stepsWithOutput.map((s) => ({
            step_id: s.id,
            idea_id: step.idea_id,
            author_id: s.claimed_by || ctx.userId,
            type: "output" as const,
            content: s.output!,
          }))
        );
      }

      const { data: resetSteps } = await ctx.supabase
        .from("task_workflow_steps")
        .update({
          status: "pending",
          output: null,
          started_at: null,
          completed_at: null,
          claimed_by: null,
        })
        .eq("run_id", step.run_id)
        .gte("step_order", targetStep.step_order ?? 0)
        .select("id");

      stepsReset = resetSteps?.length ?? 0;

      // Propagate rework context to the cascade target step
      if (stepsReset > 0) {
        await ctx.supabase.from("workflow_step_comments").insert({
          step_id: params.reset_to_step_id,
          idea_id: step.idea_id,
          author_id: ctx.userId,
          type: "changes_requested",
          content: params.output || "Rework required — step was rejected and sent back for revision.",
        });
      }
    }
  }

  // Mark the run as running (cascade continues) or failed (no cascade)
  if (step.run_id) {
    await ctx.supabase
      .from("workflow_runs")
      .update({ status: params.reset_to_step_id ? "running" : "failed" })
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

// --- Update Step (pending only) ---

export const updateStepSchema = z.object({
  step_id: z.string().uuid().describe("The workflow step ID (must be in pending status)"),
  title: z.string().min(1).max(200).optional().describe("New step title"),
  description: z.string().max(5000).nullable().optional().describe("New description (null to clear)"),
  agent_role: z.string().max(100).nullable().optional().describe("New agent role (null to clear)"),
  human_check_required: z.boolean().optional().describe("Whether human approval is required after completion"),
  expected_deliverables: z.array(z.string().max(200)).max(20).nullable().optional()
    .describe("Expected deliverables (null to clear)"),
});

export async function updateStep(
  ctx: McpContext,
  params: z.infer<typeof updateStepSchema>
) {
  const patch: Record<string, unknown> = {};
  if (params.title !== undefined) patch.title = params.title;
  if (params.description !== undefined) patch.description = params.description;
  if (params.agent_role !== undefined) patch.agent_role = params.agent_role;
  if (params.human_check_required !== undefined) patch.human_check_required = params.human_check_required;
  if (params.expected_deliverables !== undefined) patch.expected_deliverables = params.expected_deliverables ?? [];

  if (Object.keys(patch).length === 0) {
    throw new Error("No fields to update — provide at least one field to change");
  }

  const { data: updated, error } = await ctx.supabase
    .from("task_workflow_steps")
    .update(patch)
    .eq("id", params.step_id)
    .eq("status", "pending")
    .select("id, task_id, run_id, title, description, agent_role, human_check_required, expected_deliverables, status")
    .maybeSingle();

  if (error) throw new Error(`Failed to update step: ${error.message}`);
  if (!updated) throw new Error("Step not found or is no longer pending — only pending steps can be edited");

  return updated;
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
      "Only humans can approve workflow steps. Your current identity is a bot. " +
      "If the human user has explicitly instructed you to approve this step, " +
      "first call set_agent_identity with no agent_id/agent_name to reset to the human (owner) identity, " +
      "then call approve_step again. Do NOT approve without explicit human instruction."
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
      logger.warn("Failed to insert approval comment", { error: commentError.message, stepId: params.step_id });
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
  // Fetch ALL pending steps with agent_role (not just bot_id IS NULL)
  const { data: pendingSteps, error: stepsError } = await ctx.supabase
    .from("task_workflow_steps")
    .select("id, agent_role, bot_id, match_tier")
    .eq("task_id", params.task_id)
    .eq("status", "pending")
    .not("agent_role", "is", null);

  if (stepsError) throw new Error(`Failed to fetch pending steps: ${stepsError.message}`);

  if (!pendingSteps || pendingSteps.length === 0) {
    return { matched: 0, unmatched: 0, upgraded: 0, matches: {} };
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
        ? { botId: entry.bot_id, name: String(bot.name ?? ""), role: String(bot.role) }
        : null;
    })
    .filter((c): c is { botId: string; name: string; role: string } => c !== null);

  // Collect unique step roles for AI/fuzzy matching
  const stepRoles = [...new Set(pendingSteps.map((s) => s.agent_role!))];

  // Match roles using AI (with fuzzy fallback) — returns tier info
  const matchUserId = ctx.ownerUserId ?? ctx.userId;
  const roleMatches = await matchRolesWithAiOrFuzzy(ctx.supabase, matchUserId, stepRoles, candidates);

  let matched = 0;
  let unmatched = 0;
  let upgraded = 0;
  const matches: Record<string, string> = {};

  for (const step of pendingSteps) {
    const role = step.agent_role!;
    const newMatch = roleMatches[role];
    const newBotId = newMatch?.botId ?? null;
    const newTier = newMatch?.tier ?? "none";

    if (!newBotId) {
      if (!step.bot_id) unmatched++;
      continue;
    }

    const oldTierRank = tierRank(step.match_tier);
    const newTierRank = tierRank(newTier);

    // Only update if: no existing match, or new match is strictly better tier
    if (!step.bot_id || newTierRank > oldTierRank) {
      if (step.bot_id) upgraded++;

      await ctx.supabase
        .from("task_workflow_steps")
        .update({ bot_id: newBotId, match_tier: newTier })
        .eq("id", step.id);

      matches[role] = newBotId;
      matched++;
    }
  }

  return { matched, unmatched, upgraded, matches };
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
});

export async function updateWorkflowAutoRule(
  ctx: McpContext,
  params: z.infer<typeof updateWorkflowAutoRuleSchema>
) {
  const patch: Record<string, unknown> = {};
  if (params.template_id !== undefined) patch.template_id = params.template_id;

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
