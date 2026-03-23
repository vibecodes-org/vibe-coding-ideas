import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import type { McpContext } from "../context";
import { rematchWorkflowAgents } from "./workflows";

/**
 * Find all tasks in an idea with active workflow runs and rematch their steps.
 * Fire-and-forget — errors are logged but don't propagate.
 */
async function rematchActiveWorkflows(ctx: McpContext, ideaId: string) {
  try {
    const { data: activeRuns } = await ctx.supabase
      .from("workflow_runs")
      .select("task_id, board_tasks!inner(idea_id)")
      .eq("board_tasks.idea_id", ideaId)
      .not("status", "in", '("completed","failed")');

    if (!activeRuns || activeRuns.length === 0) return;

    const taskIds = [...new Set(activeRuns.map((r) => r.task_id))];

    for (const taskId of taskIds) {
      try {
        await rematchWorkflowAgents(ctx, { task_id: taskId });
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

// --- Allocate Agent ---

export const allocateAgentSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  bot_id: z.string().uuid().describe("The bot profile ID to allocate"),
});

export async function allocateAgent(
  ctx: McpContext,
  params: z.infer<typeof allocateAgentSchema>
) {
  const { error } = await ctx.supabase.from("idea_agents").insert({
    idea_id: params.idea_id,
    bot_id: params.bot_id,
    added_by: ctx.ownerUserId ?? ctx.userId,
  });

  // Ignore unique constraint violation (already allocated)
  if (error && error.code !== "23505") {
    throw new Error(`Failed to allocate agent: ${error.message}`);
  }

  // R1: Rematch all active workflows to find better matches
  await rematchActiveWorkflows(ctx, params.idea_id);

  return { success: true, idea_id: params.idea_id, bot_id: params.bot_id };
}

// --- Remove Idea Agent ---

export const removeIdeaAgentSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  bot_id: z.string().uuid().describe("The bot profile ID to remove"),
});

export async function removeIdeaAgent(
  ctx: McpContext,
  params: z.infer<typeof removeIdeaAgentSchema>
) {
  // Delete triggers DB trigger that clears bot_id + match_tier on pending steps (R3)
  const { error } = await ctx.supabase
    .from("idea_agents")
    .delete()
    .eq("idea_id", params.idea_id)
    .eq("bot_id", params.bot_id);

  if (error) throw new Error(`Failed to remove idea agent: ${error.message}`);

  // R2: Rematch all active workflows to find replacements from remaining pool
  await rematchActiveWorkflows(ctx, params.idea_id);

  return { success: true, idea_id: params.idea_id, bot_id: params.bot_id };
}

// --- Allocate All Agents ---

export const allocateAllAgentsSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  bot_ids: z.array(z.string().uuid()).optional()
    .describe("Specific bot IDs to allocate. If omitted, allocates all of the owner's unallocated active bots."),
});

export async function allocateAllAgents(
  ctx: McpContext,
  params: z.infer<typeof allocateAllAgentsSchema>
) {
  const ownerId = ctx.ownerUserId ?? ctx.userId;

  let idsToAllocate: string[];

  if (params.bot_ids && params.bot_ids.length > 0) {
    idsToAllocate = params.bot_ids;
  } else {
    // Get owner's active bots
    const { data: userBots } = await ctx.supabase
      .from("bot_profiles")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("is_active", true);

    if (!userBots || userBots.length === 0) {
      return { success: true, added: 0, idea_id: params.idea_id };
    }

    // Get already-allocated bots
    const { data: existing } = await ctx.supabase
      .from("idea_agents")
      .select("bot_id")
      .eq("idea_id", params.idea_id);

    const allocatedIds = new Set((existing ?? []).map((e) => e.bot_id));
    idsToAllocate = userBots.map((b) => b.id).filter((id) => !allocatedIds.has(id));
  }

  if (idsToAllocate.length === 0) {
    return { success: true, added: 0, idea_id: params.idea_id };
  }

  const rows = idsToAllocate.map((botId) => ({
    idea_id: params.idea_id,
    bot_id: botId,
    added_by: ownerId,
  }));

  const { error } = await ctx.supabase
    .from("idea_agents")
    .upsert(rows, { onConflict: "idea_id,bot_id", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Failed to allocate agents: ${error.message}`);
  }

  // Single rematch for all agents
  await rematchActiveWorkflows(ctx, params.idea_id);

  return { success: true, added: idsToAllocate.length, idea_id: params.idea_id };
}

// --- List Idea Agents ---

export const listIdeaAgentsSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function listIdeaAgents(
  ctx: McpContext,
  params: z.infer<typeof listIdeaAgentsSchema>
) {
  const { data, error } = await ctx.supabase
    .from("idea_agents")
    .select("bot_id, added_by, created_at, bot:bot_profiles!idea_agents_bot_id_fkey(id, name, role, avatar_url, is_active, owner_id), adder:users!idea_agents_added_by_fkey(id, full_name)")
    .eq("idea_id", params.idea_id)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to list idea agents: ${error.message}`);

  return (data ?? []).map((row) => {
    const bot = (row as Record<string, unknown>).bot as Record<string, unknown> | null;
    const adder = (row as Record<string, unknown>).adder as Record<string, unknown> | null;
    return {
      bot_id: row.bot_id,
      bot_name: bot?.name ?? null,
      bot_role: bot?.role ?? null,
      bot_avatar_url: bot?.avatar_url ?? null,
      is_active: bot?.is_active ?? false,
      owner_id: bot?.owner_id ?? null,
      added_by: row.added_by,
      added_by_name: adder?.full_name ?? null,
      allocated_at: row.created_at,
    };
  });
}
