"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { WorkflowTemplateStep } from "@/types/database";
import {
  validateWorkflowTemplateName,
  validateWorkflowTemplateSteps,
  validateOptionalDescription,
} from "@/lib/validation";
import { matchRolesWithAiOrFuzzy } from "@/lib/ai-role-matching";
import { propagateTemplateEdits } from "@/lib/workflow-helpers";
import { tierRank } from "@/lib/role-matching";

// ─── Templates ───

export async function listWorkflowTemplates(ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("workflow_templates")
    .select("*")
    .eq("idea_id", ideaId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return data;
}

export async function createWorkflowTemplate(
  ideaId: string,
  name: string,
  description: string | null,
  steps: WorkflowTemplateStep[]
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  name = validateWorkflowTemplateName(name);
  description = validateOptionalDescription(description);
  steps = validateWorkflowTemplateSteps(steps);

  const { data, error } = await supabase
    .from("workflow_templates")
    .insert({
      idea_id: ideaId,
      name,
      description,
      steps,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/board`);

  return data;
}

export async function updateWorkflowTemplate(
  templateId: string,
  updates: {
    name?: string;
    description?: string | null;
    steps?: WorkflowTemplateStep[];
  }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const patch: Record<string, unknown> = {};

  if (updates.name !== undefined) {
    patch.name = validateWorkflowTemplateName(updates.name);
  }
  if (updates.description !== undefined) {
    patch.description = validateOptionalDescription(updates.description);
  }
  if (updates.steps !== undefined) {
    patch.steps = validateWorkflowTemplateSteps(updates.steps);
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("No fields to update");
  }

  const { data, error } = await supabase
    .from("workflow_templates")
    .update(patch)
    .eq("id", templateId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  // Propagate step edits to pending steps in active workflow runs, then rematch
  if (updates.steps !== undefined) {
    const propagation = await propagateTemplateEdits(supabase, templateId, patch.steps as WorkflowTemplateStep[]);
    // Rematch bot_id on affected tasks (use internal variant — we already have auth)
    for (const taskId of propagation.affectedTaskIds) {
      try {
        await rematchWorkflowAgentsWithClient(supabase, user.id, taskId);
      } catch { /* fire-and-forget */ }
    }
  }

  revalidatePath(`/ideas/${data.idea_id}/board`);

  return data;
}

export async function deleteWorkflowTemplate(templateId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch idea_id for revalidation before deleting
  const { data: template } = await supabase
    .from("workflow_templates")
    .select("idea_id")
    .eq("id", templateId)
    .single();

  const { error } = await supabase
    .from("workflow_templates")
    .delete()
    .eq("id", templateId);

  if (error) throw new Error(error.message);

  if (template) {
    revalidatePath(`/ideas/${template.idea_id}/board`);
  }
}

export async function applyWorkflowTemplate(
  taskId: string,
  templateId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch the template
  const { data: template, error: templateError } = await supabase
    .from("workflow_templates")
    .select("*")
    .eq("id", templateId)
    .single();

  if (templateError || !template) {
    throw new Error("Template not found");
  }

  // Fetch the task to get idea_id
  const { data: task, error: taskError } = await supabase
    .from("board_tasks")
    .select("id, idea_id")
    .eq("id", taskId)
    .single();

  if (taskError || !task) {
    throw new Error("Task not found");
  }

  // Check for active runs on this task
  const { data: activeRun } = await supabase
    .from("workflow_runs")
    .select("id")
    .eq("task_id", taskId)
    .not("status", "in", '("completed","failed")')
    .maybeSingle();

  if (activeRun) {
    throw new Error(
      "This task already has an active workflow. Reset or remove it before applying a new one."
    );
  }

  // Create a workflow run
  const { data: run, error: runError } = await supabase
    .from("workflow_runs")
    .insert({
      task_id: taskId,
      template_id: templateId,
      status: "pending",
      started_by: user.id,
    })
    .select("*")
    .single();

  if (runError || !run) {
    throw new Error(runError?.message ?? "Failed to create workflow run");
  }

  // Fetch idea agent pool for auto-matching (include name for AI matching)
  const { data: poolAgents } = await supabase
    .from("idea_agents")
    .select("bot_id, bot_profiles!inner(id, name, role)")
    .eq("idea_id", task.idea_id);

  // Build agent candidates with names for AI role matching
  const candidates = (poolAgents ?? [])
    .map((agent) => {
      const profile = agent.bot_profiles as unknown as { id: string; name: string | null; role: string | null };
      return profile?.role ? { botId: agent.bot_id, name: profile.name ?? "", role: profile.role } : null;
    })
    .filter((c): c is { botId: string; name: string; role: string } => c !== null);

  // Collect unique step roles for matching
  const templateSteps = template.steps as WorkflowTemplateStep[];
  const stepRoles = [...new Set(templateSteps.map((s) => s.role).filter(Boolean))];

  // Match roles using AI (with fuzzy fallback)
  const roleMatches = await matchRolesWithAiOrFuzzy(supabase, user.id, stepRoles, candidates);

  // Create workflow steps from template steps
  const steps = templateSteps.map(
    (step, index) => {
      const match = step.role ? roleMatches[step.role] : undefined;
      return {
        task_id: taskId,
        idea_id: task.idea_id,
        run_id: run.id,
        title: step.title,
        description: step.description ?? null,
        agent_role: step.role,
        human_check_required: step.requires_approval ?? false,
        expected_deliverables: step.deliverables ?? [],
        position: index * 1000,
        step_order: index + 1,
        status: "pending" as const,
        bot_id: match?.botId ?? null,
        match_tier: match?.botId ? match.tier : null,
      };
    }
  );

  const { data: createdSteps, error: stepsError } = await supabase
    .from("task_workflow_steps")
    .insert(steps)
    .select("*");

  if (stepsError) {
    throw new Error(stepsError.message);
  }

  // Increment usage_count
  await supabase
    .from("workflow_templates")
    .update({ usage_count: template.usage_count + 1 })
    .eq("id", templateId);

  return { run, steps: createdSteps };
}

// ─── Rematch Agents ───

/**
 * Core rematch logic — accepts an authenticated Supabase client + userId.
 * Used by fire-and-forget callers that already have auth context.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rematchWorkflowAgentsWithClient(
  supabase: import("@supabase/supabase-js").SupabaseClient<any>,
  userId: string,
  taskId: string
) {
  // Fetch ALL pending steps with agent_role (not just bot_id IS NULL)
  const { data: pendingSteps, error: stepsError } = await supabase
    .from("task_workflow_steps")
    .select("id, agent_role, bot_id, match_tier")
    .eq("task_id", taskId)
    .eq("status", "pending")
    .not("agent_role", "is", null);

  if (stepsError) throw new Error(stepsError.message);

  if (!pendingSteps || pendingSteps.length === 0) {
    return { matched: 0, unmatched: 0, upgraded: 0, matches: {} as Record<string, string> };
  }

  // Fetch task to get idea_id
  const { data: task, error: taskError } = await supabase
    .from("board_tasks")
    .select("idea_id")
    .eq("id", taskId)
    .single();

  if (taskError || !task) throw new Error("Task not found");

  // Fetch idea agent pool (include name for AI matching)
  const { data: poolAgents } = await supabase
    .from("idea_agents")
    .select("bot_id, bot_profiles!inner(id, name, role)")
    .eq("idea_id", task.idea_id);

  const candidates = (poolAgents ?? [])
    .map((agent) => {
      const profile = agent.bot_profiles as unknown as {
        id: string;
        name: string | null;
        role: string | null;
      };
      return profile?.role
        ? { botId: agent.bot_id, name: profile.name ?? "", role: profile.role }
        : null;
    })
    .filter((c): c is { botId: string; name: string; role: string } => c !== null);

  // Collect unique step roles for matching
  const stepRoles = [...new Set(pendingSteps.map((s) => s.agent_role!))];

  // Match roles using AI (with fuzzy fallback) — returns tier info
  const roleMatches = await matchRolesWithAiOrFuzzy(supabase, userId, stepRoles, candidates);

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

      await supabase
        .from("task_workflow_steps")
        .update({ bot_id: newBotId, match_tier: newTier })
        .eq("id", step.id);

      matches[role] = newBotId;
      matched++;
    }
  }

  return { matched, unmatched, upgraded, matches };
}

/**
 * Public wrapper — creates its own auth context.
 * Used by MCP tools and direct server action callers.
 */
export async function rematchWorkflowAgents(taskId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  return rematchWorkflowAgentsWithClient(supabase, user.id, taskId);
}

// ─── Resync Template ───

export async function resyncWorkflowTemplate(templateId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch template with its steps
  const { data: template, error } = await supabase
    .from("workflow_templates")
    .select("id, idea_id, steps")
    .eq("id", templateId)
    .single();

  if (error || !template) throw new Error("Template not found");

  const steps = template.steps as WorkflowTemplateStep[];

  // Propagate edits to pending steps
  const propagation = await propagateTemplateEdits(supabase, templateId, steps);

  // Rematch bot_id on all affected tasks (use internal variant — we already have auth)
  let rematched = 0;
  for (const taskId of propagation.affectedTaskIds) {
    try {
      await rematchWorkflowAgentsWithClient(supabase, user.id, taskId);
      rematched++;
    } catch { /* continue on error */ }
  }

  revalidatePath(`/ideas/${template.idea_id}/board`);

  return {
    runsUpdated: propagation.runsUpdated,
    stepsUpdated: propagation.stepsUpdated,
    skippedStructuralMismatch: propagation.skippedStructuralMismatch,
    rematched,
  };
}

// ─── Auto-Rules ───

export async function listWorkflowAutoRules(ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("workflow_auto_rules")
    .select("*, workflow_templates(*), board_labels(*)")
    .eq("idea_id", ideaId);

  if (error) throw new Error(error.message);

  return data;
}

export async function createWorkflowAutoRule(
  ideaId: string,
  labelId: string,
  templateId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("workflow_auto_rules")
    .insert({
      idea_id: ideaId,
      label_id: labelId,
      template_id: templateId,
    })
    .select("*, workflow_templates(*), board_labels(*)")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(
        "This label already has an auto-rule. Remove the existing rule first."
      );
    }
    throw new Error(error.message);
  }

  revalidatePath(`/ideas/${ideaId}/board`);

  return data;
}

export async function updateWorkflowAutoRule(
  ruleId: string,
  updates: { template_id?: string }
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
    .from("workflow_auto_rules")
    .update(updates)
    .eq("id", ruleId)
    .select("*, workflow_templates(*), board_labels(*)")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${data.idea_id}/board`);

  return data;
}

export async function deleteWorkflowAutoRule(
  ruleId: string,
  options?: { removeRelatedWorkflows?: boolean }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch rule details for revalidation and optional workflow cleanup
  const { data: rule } = await supabase
    .from("workflow_auto_rules")
    .select("idea_id, label_id, template_id")
    .eq("id", ruleId)
    .single();

  // Remove related workflow runs if requested
  if (options?.removeRelatedWorkflows && rule) {
    // Find all tasks that have this label
    const { data: labeledTasks } = await supabase
      .from("board_task_labels")
      .select("task_id")
      .eq("label_id", rule.label_id);

    if (labeledTasks && labeledTasks.length > 0) {
      const taskIds = labeledTasks.map((t) => t.task_id);
      // Delete workflow runs for these tasks that match the rule's template
      // Steps and step comments cascade-delete automatically via FK ON DELETE CASCADE
      await supabase
        .from("workflow_runs")
        .delete()
        .in("task_id", taskIds)
        .eq("template_id", rule.template_id);
    }
  }

  const { error } = await supabase
    .from("workflow_auto_rules")
    .delete()
    .eq("id", ruleId);

  if (error) throw new Error(error.message);

  if (rule) {
    revalidatePath(`/ideas/${rule.idea_id}/board`);
  }
}

/**
 * Apply a workflow template to all tasks that have the matching label
 * but don't already have an active workflow run. Used for retroactive
 * application of auto-rules.
 */
export async function applyAutoRuleRetroactively(ruleId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch the rule
  const { data: rule, error: ruleError } = await supabase
    .from("workflow_auto_rules")
    .select("*")
    .eq("id", ruleId)
    .single();

  if (ruleError || !rule) throw new Error("Auto-rule not found");

  // Find all tasks with this label in this idea
  const { data: labelledTasks, error: ltError } = await supabase
    .from("board_task_labels")
    .select("task_id, board_tasks!inner(id, idea_id, archived)")
    .eq("label_id", rule.label_id)
    .eq("board_tasks.idea_id", rule.idea_id)
    .eq("board_tasks.archived", false);

  if (ltError) throw new Error(ltError.message);
  if (!labelledTasks || labelledTasks.length === 0) {
    return { applied: 0, skipped: 0 };
  }

  // Find tasks that already have active workflow runs
  const taskIds = labelledTasks.map((lt) => lt.task_id);
  const { data: activeRuns } = await supabase
    .from("workflow_runs")
    .select("task_id")
    .in("task_id", taskIds)
    .not("status", "in", '("completed","failed")');

  const activeTaskIds = new Set((activeRuns ?? []).map((r) => r.task_id));

  // Apply template to eligible tasks
  const eligibleTaskIds = taskIds.filter((id) => !activeTaskIds.has(id));

  let applied = 0;
  let skipped = activeTaskIds.size;

  for (const taskId of eligibleTaskIds) {
    try {
      await applyWorkflowTemplate(taskId, rule.template_id);
      applied++;
    } catch {
      skipped++;
    }
  }

  revalidatePath(`/ideas/${rule.idea_id}/board`);

  return { applied, skipped };
}
