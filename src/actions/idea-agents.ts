"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient as createServerClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { validateUuid } from "@/lib/validation";
import { matchRolesWithAiOrFuzzy, type AiRoleMatchAgent } from "@/lib/ai-role-matching";
import { tierRank } from "@/lib/role-matching";
import { logger } from "@/lib/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Create a service-role Supabase client for background tasks.
 * Unlike the cookie-based server client, this survives after the response is sent.
 */
function createServiceRoleClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Find all tasks in an idea with active workflow runs and rematch their steps.
 * Fire-and-forget — accepts pre-authenticated client to avoid session loss.
 */
async function rematchActiveWorkflows(
  supabase: SupabaseClient<Database>,
  userId: string,
  ideaId: string
) {
  try {
    // 1. Fetch ALL pending steps with agent_role across the entire idea in one query
    const { data: allSteps, error: stepsError } = await supabase
      .from("task_workflow_steps")
      .select("id, task_id, agent_role, bot_id, match_tier, status")
      .eq("idea_id", ideaId)
      .eq("status", "pending")
      .not("agent_role", "is", null);

    if (stepsError || !allSteps || allSteps.length === 0) return;

    // 2. Fetch the idea's agent pool once
    const { data: poolAgents } = await supabase
      .from("idea_agents")
      .select("bot_id, bot_profiles!inner(id, name, role)")
      .eq("idea_id", ideaId);

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

    if (candidates.length === 0) return;

    // 3. Collect unique roles across ALL steps — one AI call for all of them
    const uniqueRoles = [...new Set(allSteps.map((s) => s.agent_role!))];
    const roleMatches = await matchRolesWithAiOrFuzzy(supabase, userId, uniqueRoles, candidates);

    // 4. Apply matches to all steps in parallel
    let matched = 0;
    const updates: Promise<unknown>[] = [];

    for (const step of allSteps) {
      const role = step.agent_role!;
      const newMatch = roleMatches[role];
      const newBotId = newMatch?.botId ?? null;
      const newTier = newMatch?.tier ?? "none";

      if (!newBotId) continue;

      const oldTierRank = tierRank(step.match_tier);
      const newTierRank = tierRank(newTier);

      // Only update if: no existing match, or new match is strictly better tier
      if (!step.bot_id || newTierRank > oldTierRank) {
        matched++;
        updates.push(
          Promise.resolve(
            supabase
              .from("task_workflow_steps")
              .update({ bot_id: newBotId, match_tier: newTier })
              .eq("id", step.id)
          )
        );
      }
    }

    if (updates.length > 0) {
      await Promise.all(updates);
      logger.info("Rematch completed for idea", { ideaId, matched, total: allSteps.length });
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

  // Rematch all active workflows in the background via after() — runs after the
  // response is sent. Uses service-role client because the cookie-based client's
  // auth context is stale after the response is sent.
  after(() => rematchActiveWorkflows(createServiceRoleClient(), user.id, validIdeaId));
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

  // Rematch all active workflows in the background via after() — runs after the
  // response is sent, so the delete is committed and visible to the rematch query
  after(() => rematchActiveWorkflows(createServiceRoleClient(), user.id, validIdeaId));
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

  // Rematch all active workflows in the background via after() — runs after the
  // response is sent, so the upsert is committed and visible to the rematch query
  after(() => rematchActiveWorkflows(createServiceRoleClient(), user.id, validIdeaId));

  return { added: idsToAllocate.length };
}

export interface RoleCoverageResult {
  role: string;
  covered: boolean;
  matchedAgentName: string | null;
  matchedAgentRole: string | null;
  matchTier: string | null;
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

  // Check for existing manual assignments in the DB first
  const { data: manualSteps } = await supabase
    .from("task_workflow_steps")
    .select("agent_role, bot_id, match_tier")
    .eq("idea_id", validIdeaId)
    .eq("status", "pending")
    .eq("match_tier", "manual")
    .not("bot_id", "is", null);

  const manualOverrides = new Map<string, string>();
  for (const step of manualSteps ?? []) {
    if (step.agent_role && step.bot_id) {
      manualOverrides.set(step.agent_role, step.bot_id);
    }
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
    // Manual overrides take precedence
    const manualBotId = manualOverrides.get(role);
    if (manualBotId) {
      const agent = agentLookup.get(manualBotId);
      return {
        role,
        covered: true,
        matchedAgentName: agent?.name ?? null,
        matchedAgentRole: agent?.role ?? null,
        matchTier: "manual",
      };
    }

    const match = matches[role];
    const agent = match?.botId ? agentLookup.get(match.botId) : null;
    return {
      role,
      covered: !!match?.botId,
      matchedAgentName: agent?.name ?? null,
      matchedAgentRole: agent?.role ?? null,
      matchTier: match?.botId ? match.tier : null,
    };
  });

  // Sort: uncovered first, then alphabetical
  coverage.sort((a, b) => {
    if (a.covered !== b.covered) return a.covered ? 1 : -1;
    return a.role.localeCompare(b.role);
  });

  return coverage;
}

/**
 * Manually assign an agent to all pending workflow steps with a given role.
 * Sets match_tier = "manual" (rank 5) so auto-rematching won't override it.
 */
export async function setManualRoleMatch(
  ideaId: string,
  role: string,
  botId: string
): Promise<{ updatedCount: number }> {
  const validIdeaId = validateUuid(ideaId, "Idea ID");
  const validBotId = validateUuid(botId, "Bot ID");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("task_workflow_steps")
    .update({ bot_id: validBotId, match_tier: "manual" })
    .eq("idea_id", validIdeaId)
    .eq("agent_role", role)
    .eq("status", "pending")
    .select("id");

  if (error) throw new Error(error.message);
  return { updatedCount: data?.length ?? 0 };
}

/**
 * Clear manual override for a role — resets bot_id and match_tier on all
 * pending steps with that role, then triggers rematching.
 */
export async function clearManualRoleMatch(
  ideaId: string,
  role: string
): Promise<{ clearedCount: number }> {
  const validIdeaId = validateUuid(ideaId, "Idea ID");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("task_workflow_steps")
    .update({ bot_id: null, match_tier: null })
    .eq("idea_id", validIdeaId)
    .eq("agent_role", role)
    .eq("status", "pending")
    .eq("match_tier", "manual")
    .select("id");

  if (error) throw new Error(error.message);
  return { clearedCount: data?.length ?? 0 };
}
