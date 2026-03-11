"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { WorkflowTemplateStep } from "@/types/database";
import {
  validateWorkflowTemplateName,
  validateWorkflowTemplateSteps,
  validateOptionalDescription,
} from "@/lib/validation";

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

  // Fetch idea agent pool for auto-matching
  const { data: poolAgents } = await supabase
    .from("idea_agents")
    .select("bot_id, bot_profiles!inner(id, role)")
    .eq("idea_id", task.idea_id);

  // Build a role -> bot_id map for auto-assignment
  const roleToBot = new Map<string, string>();
  if (poolAgents) {
    for (const agent of poolAgents) {
      const profile = agent.bot_profiles as unknown as { id: string; role: string | null };
      if (profile?.role) {
        const roleLower = profile.role.toLowerCase();
        if (!roleToBot.has(roleLower)) {
          roleToBot.set(roleLower, agent.bot_id);
        }
      }
    }
  }

  // Create workflow steps from template steps
  const steps = (template.steps as WorkflowTemplateStep[]).map(
    (step, index) => ({
      task_id: taskId,
      idea_id: task.idea_id,
      run_id: run.id,
      title: step.title,
      description: step.description ?? null,
      agent_role: step.role,
      human_check_required: step.requires_approval ?? false,
      position: index * 1000,
      step_order: index + 1,
      status: "pending" as const,
      bot_id: roleToBot.get(step.role.toLowerCase()) ?? null,
    })
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

  revalidatePath(`/ideas/${task.idea_id}/board`);

  return { run, steps: createdSteps };
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
  templateId: string,
  autoRun: boolean = false
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
      auto_run: autoRun,
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
  updates: { template_id?: string; auto_run?: boolean }
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

export async function deleteWorkflowAutoRule(ruleId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch idea_id for revalidation before deleting
  const { data: rule } = await supabase
    .from("workflow_auto_rules")
    .select("idea_id")
    .eq("id", ruleId)
    .single();

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
