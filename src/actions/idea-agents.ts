"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateUuid } from "@/lib/validation";
import { rematchWorkflowAgents } from "@/actions/workflow-templates";
import { matchRolesWithAiOrFuzzy, type AiRoleMatchAgent } from "@/lib/ai-role-matching";
import { logger } from "@/lib/logger";

/**
 * Find all tasks in an idea with active workflow runs and rematch their steps.
 * Fire-and-forget — errors are logged but don't propagate.
 */
async function rematchActiveWorkflows(ideaId: string) {
  try {
    const supabase = await createClient();

    // Find tasks with active workflow runs in this idea
    const { data: activeRuns } = await supabase
      .from("workflow_runs")
      .select("task_id, board_tasks!inner(idea_id)")
      .eq("board_tasks.idea_id", ideaId)
      .not("status", "in", '("completed","failed")');

    if (!activeRuns || activeRuns.length === 0) return;

    // Dedupe task IDs
    const taskIds = [...new Set(activeRuns.map((r) => r.task_id))];

    for (const taskId of taskIds) {
      try {
        await rematchWorkflowAgents(taskId);
      } catch (err) {
        logger.warn("Rematch failed for task during agent pool change", {
          taskId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.warn("Failed to rematch active workflows after agent pool change", {
      ideaId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function allocateAgent(ideaId: string, botId: string) {
  const validIdeaId = validateUuid(ideaId, "Idea ID");
  const validBotId = validateUuid(botId, "Bot ID");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { error } = await supabase.from("idea_agents").insert({
    idea_id: validIdeaId,
    bot_id: validBotId,
    added_by: user.id,
  });

  // Ignore unique constraint violation (already allocated)
  if (error && error.code !== "23505") {
    throw new Error("Failed to allocate agent");
  }

  revalidatePath(`/ideas/${ideaId}`);
  revalidatePath(`/ideas/${ideaId}/board`);

  // R1: Rematch all active workflows — fire-and-forget (don't block UI)
  rematchActiveWorkflows(validIdeaId).catch(() => {});
}

export async function removeIdeaAgent(ideaId: string, botId: string) {
  const validIdeaId = validateUuid(ideaId, "Idea ID");
  const validBotId = validateUuid(botId, "Bot ID");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  // Delete triggers DB trigger that clears bot_id + match_tier on pending steps (R3)
  const { error } = await supabase
    .from("idea_agents")
    .delete()
    .eq("idea_id", validIdeaId)
    .eq("bot_id", validBotId);

  if (error) {
    throw new Error("Failed to remove agent");
  }

  revalidatePath(`/ideas/${ideaId}`);
  revalidatePath(`/ideas/${ideaId}/board`);

  // R2: Rematch all active workflows — fire-and-forget (don't block UI)
  rematchActiveWorkflows(validIdeaId).catch(() => {});
}

export async function allocateAllAgents(ideaId: string, botIds?: string[]) {
  const validIdeaId = validateUuid(ideaId, "Idea ID");
  const validBotIds = botIds?.map((id) => validateUuid(id, "Bot ID"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  // If no specific botIds, fetch all user's unallocated active bots
  let idsToAllocate: string[];

  if (validBotIds && validBotIds.length > 0) {
    idsToAllocate = validBotIds;
  } else {
    // Get user's active bots
    const { data: userBots } = await supabase
      .from("bot_profiles")
      .select("id")
      .eq("owner_id", user.id)
      .eq("is_active", true);

    if (!userBots || userBots.length === 0) {
      return { added: 0 };
    }

    // Get already-allocated bots for this idea
    const { data: existing } = await supabase
      .from("idea_agents")
      .select("bot_id")
      .eq("idea_id", validIdeaId);

    const allocatedIds = new Set((existing ?? []).map((e) => e.bot_id));
    idsToAllocate = userBots.map((b) => b.id).filter((id) => !allocatedIds.has(id));
  }

  if (idsToAllocate.length === 0) {
    return { added: 0 };
  }

  // Batch insert with ON CONFLICT DO NOTHING
  const rows = idsToAllocate.map((botId) => ({
    idea_id: validIdeaId,
    bot_id: botId,
    added_by: user.id,
  }));

  const { error } = await supabase
    .from("idea_agents")
    .upsert(rows, { onConflict: "idea_id,bot_id", ignoreDuplicates: true });

  if (error) {
    throw new Error("Failed to allocate agents");
  }

  revalidatePath(`/ideas/${ideaId}`);
  revalidatePath(`/ideas/${ideaId}/board`);

  // Single rematch for all agents — fire-and-forget (don't block UI)
  rematchActiveWorkflows(validIdeaId).catch(() => {});

  return { added: idsToAllocate.length };
}

export interface RoleCoverageResult {
  role: string;
  covered: boolean;
  matchedAgentName: string | null;
  matchedAgentRole: string | null;
}

export async function getRoleCoverage(
  ideaId: string,
  agentPool: { botId: string; name: string; role: string }[]
): Promise<RoleCoverageResult[]> {
  const validIdeaId = validateUuid(ideaId, "Idea ID");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Fetch workflow templates to extract unique step roles
  const { data: templates } = await supabase
    .from("workflow_templates")
    .select("steps")
    .eq("idea_id", validIdeaId);

  const templateRoles = new Set<string>();
  for (const tmpl of templates ?? []) {
    const steps = tmpl.steps as { role?: string }[];
    for (const step of steps ?? []) {
      if (step.role) templateRoles.add(step.role);
    }
  }

  if (templateRoles.size === 0 || agentPool.length === 0) {
    return [];
  }

  // Use the same matching algorithm as workflow step assignment
  const candidates: AiRoleMatchAgent[] = agentPool.filter((a) => a.role);
  const stepRoles = Array.from(templateRoles);
  const matches = await matchRolesWithAiOrFuzzy(supabase, user.id, stepRoles, candidates);

  // Build botId → agent details lookup
  const agentLookup = new Map(
    agentPool.map((a) => [a.botId, { name: a.name, role: a.role }])
  );

  const coverage: RoleCoverageResult[] = stepRoles.map((role) => {
    const match = matches[role];
    const agent = match?.botId ? agentLookup.get(match.botId) : null;
    return {
      role,
      covered: !!match?.botId,
      matchedAgentName: agent?.name ?? null,
      matchedAgentRole: agent?.role ?? null,
    };
  });

  // Sort: uncovered first, then alphabetical
  coverage.sort((a, b) => {
    if (a.covered !== b.covered) return a.covered ? 1 : -1;
    return a.role.localeCompare(b.role);
  });

  return coverage;
}
