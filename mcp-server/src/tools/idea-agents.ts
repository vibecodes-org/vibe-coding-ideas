import { z } from "zod";
import type { McpContext } from "../context";

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
  const { error } = await ctx.supabase
    .from("idea_agents")
    .delete()
    .eq("idea_id", params.idea_id)
    .eq("bot_id", params.bot_id);

  if (error) throw new Error(`Failed to remove idea agent: ${error.message}`);
  return { success: true, idea_id: params.idea_id, bot_id: params.bot_id };
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
