import { z } from "zod";
import type { McpContext } from "../context";

// --- Schemas ---

export const listBotsSchema = z.object({
  owner_id: z
    .string()
    .uuid()
    .optional()
    .describe("Filter by owner user ID. Defaults to current user."),
});

export const getBotPromptSchema = z.object({
  agent_id: z
    .string()
    .uuid()
    .optional()
    .describe("Agent ID to get prompt for. Defaults to active agent identity."),
});

export const setBotIdentitySchema = z.object({
  agent_id: z
    .string()
    .uuid()
    .optional()
    .describe("Agent ID to switch to. Omit both agent_id and agent_name to reset to default."),
  agent_name: z
    .string()
    .optional()
    .describe("Agent name to search for (if agent_id not provided)."),
});

export const createBotSchema = z.object({
  name: z.string().min(1).max(100).describe("Agent display name"),
  role: z.string().max(50).optional().describe("Agent role (e.g. Developer, QA Tester)"),
  system_prompt: z
    .string()
    .max(10000)
    .optional()
    .describe("System prompt for the agent persona"),
  avatar_url: z.string().url().optional().describe("Avatar URL for the agent"),
  bio: z.string().max(500).optional().describe("Short tagline/bio for the agent"),
  skills: z
    .array(z.string().max(30))
    .max(10)
    .optional()
    .describe("Capability tags (max 10, 30 chars each)"),
});

export const toggleAgentVoteSchema = z.object({
  bot_id: z.string().uuid().describe("The bot profile ID to vote on"),
});

export const cloneAgentSchema = z.object({
  bot_id: z.string().uuid().describe("The published bot profile ID to clone"),
});

export const publishAgentSchema = z.object({
  bot_id: z.string().uuid().describe("The bot profile ID to publish/unpublish"),
  is_published: z.boolean().describe("Whether to publish or unpublish"),
});

export const listCommunityAgentsSchema = z.object({
  search: z.string().optional().describe("Search in name, bio, and role"),
  role: z.string().optional().describe("Filter by role"),
  sort: z
    .enum(["popular", "newest", "most_cloned"])
    .optional()
    .default("popular")
    .describe("Sort order"),
  limit: z.number().min(1).max(50).optional().default(20).describe("Max results"),
});

export const listFeaturedTeamsSchema = z.object({
  include_inactive: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include inactive teams (admin only). Defaults to false."),
});

// --- Handlers ---

export async function listBots(
  ctx: McpContext,
  args: z.infer<typeof listBotsSchema>
) {
  const ownerId = args.owner_id ?? ctx.ownerUserId ?? ctx.userId;

  const { data, error } = await ctx.supabase
    .from("bot_profiles")
    .select("*, user:users!bot_profiles_id_fkey(avatar_url, full_name)")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((bot) => ({
    id: bot.id,
    name: bot.name,
    role: bot.role,
    system_prompt: bot.system_prompt,
    is_active: bot.is_active,
    bio: bot.bio,
    skills: bot.skills,
    is_published: bot.is_published,
    community_upvotes: bot.community_upvotes,
    times_cloned: bot.times_cloned,
    avatar_url: bot.avatar_url ?? (bot.user as any)?.avatar_url ?? null,
    created_at: bot.created_at,
  }));
}

export async function getBotPrompt(
  ctx: McpContext,
  args: z.infer<typeof getBotPromptSchema>
) {
  const botId = args.agent_id ?? ctx.userId;

  const { data, error } = await ctx.supabase
    .from("bot_profiles")
    .select("id, name, role, system_prompt")
    .eq("id", botId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Agent profile not found");

  return data;
}

export async function setBotIdentity(
  ctx: McpContext,
  args: z.infer<typeof setBotIdentitySchema>,
  onIdentityChange: (botId: string | null) => void
) {
  const persistUserId = ctx.ownerUserId ?? ctx.userId;

  // Reset to default if neither provided
  if (!args.agent_id && !args.agent_name) {
    onIdentityChange(null);

    // Persist null to DB
    await ctx.supabase
      .from("users")
      .update({ active_bot_id: null })
      .eq("id", persistUserId);

    return {
      active_bot: null,
      instruction:
        "Identity reset to default. You are no longer acting as a specific agent persona. " +
        "Stop following any previous agent system prompt and return to your normal behavior. " +
        "This change has been persisted and will survive reconnections.",
    };
  }

  let botId = args.agent_id;

  // Look up by name if no ID provided
  if (!botId && args.agent_name) {
    const { data, error } = await ctx.supabase
      .from("bot_profiles")
      .select("id, name, is_active")
      .ilike("name", args.agent_name)
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error(`No agent found with name "${args.agent_name}"`);
    botId = data.id;
  }

  // Fetch the bot profile
  const { data: bot, error } = await ctx.supabase
    .from("bot_profiles")
    .select("id, name, role, system_prompt, is_active")
    .eq("id", botId!)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!bot) throw new Error("Agent not found");
  if (!bot.is_active) throw new Error("Agent is inactive. Activate it first.");

  onIdentityChange(bot.id);

  // Persist to DB
  await ctx.supabase
    .from("users")
    .update({ active_bot_id: bot.id })
    .eq("id", persistUserId);

  const result: Record<string, unknown> = {
    active_bot: {
      id: bot.id,
      name: bot.name,
      role: bot.role,
    },
  };

  if (bot.system_prompt) {
    result.system_prompt = bot.system_prompt;
    result.instruction =
      `You are now acting as "${bot.name}"${bot.role ? ` (${bot.role})` : ""}. ` +
      `All your actions (comments, task updates, activity) will be attributed to this agent. ` +
      `This identity has been persisted and will survive reconnections. ` +
      `IMPORTANT: You MUST follow the system_prompt above for the rest of this session. ` +
      `It defines your persona, behavior, and how you should approach tasks.`;
  } else {
    result.instruction =
      `You are now acting as "${bot.name}"${bot.role ? ` (${bot.role})` : ""}. ` +
      `All your actions (comments, task updates, activity) will be attributed to this agent. ` +
      `This identity has been persisted and will survive reconnections.`;
  }

  return result;
}

export async function createBot(
  ctx: McpContext,
  args: z.infer<typeof createBotSchema>
) {
  const ownerId = ctx.ownerUserId ?? ctx.userId;

  const { data, error } = await ctx.supabase.rpc("create_bot_user", {
    p_name: args.name,
    p_owner_id: ownerId,
    p_role: args.role ?? null,
    p_system_prompt: args.system_prompt ?? null,
    p_avatar_url: args.avatar_url ?? null,
  });

  if (error) throw new Error(error.message);

  // Set extended fields via follow-up UPDATE
  const extras: Record<string, unknown> = {};
  if (args.bio) extras.bio = args.bio.trim();
  if (args.skills && args.skills.length > 0) {
    extras.skills = args.skills.map((s) => s.trim().toLowerCase());
  }
  if (Object.keys(extras).length > 0) {
    await ctx.supabase
      .from("bot_profiles")
      .update(extras)
      .eq("id", data)
      .eq("owner_id", ownerId);
  }

  // Fetch the created profile
  const { data: profile } = await ctx.supabase
    .from("bot_profiles")
    .select("id, name, role, system_prompt, is_active, avatar_url, bio, skills, is_published")
    .eq("id", data)
    .single();

  return profile;
}

export async function toggleAgentVote(
  ctx: McpContext,
  args: z.infer<typeof toggleAgentVoteSchema>
) {
  const userId = ctx.ownerUserId ?? ctx.userId;

  const { data: existing } = await ctx.supabase
    .from("agent_votes")
    .select("id")
    .eq("bot_id", args.bot_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    const { error } = await ctx.supabase
      .from("agent_votes")
      .delete()
      .eq("bot_id", args.bot_id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { voted: false };
  } else {
    const { error } = await ctx.supabase.from("agent_votes").insert({
      bot_id: args.bot_id,
      user_id: userId,
    });
    if (error) throw new Error(error.message);
    return { voted: true };
  }
}

export async function cloneAgent(
  ctx: McpContext,
  args: z.infer<typeof cloneAgentSchema>
) {
  const ownerId = ctx.ownerUserId ?? ctx.userId;

  // Fetch published source bot
  const { data: source, error: fetchErr } = await ctx.supabase
    .from("bot_profiles")
    .select("*")
    .eq("id", args.bot_id)
    .eq("is_published", true)
    .maybeSingle();

  if (fetchErr) throw new Error(fetchErr.message);
  if (!source) throw new Error("Agent not found or not published");

  // Create clone
  const { data: newId, error: createErr } = await ctx.supabase.rpc("create_bot_user", {
    p_name: source.name,
    p_owner_id: ownerId,
    p_role: source.role,
    p_system_prompt: source.system_prompt,
    p_avatar_url: source.avatar_url,
  });

  if (createErr) throw new Error(createErr.message);

  // Set extended fields + provenance, and atomically increment source counter
  await Promise.all([
    ctx.supabase
      .from("bot_profiles")
      .update({
        bio: source.bio,
        skills: source.skills,
        cloned_from: args.bot_id,
      })
      .eq("id", newId)
      .eq("owner_id", ownerId),
    ctx.supabase.rpc("increment_times_cloned", { p_bot_id: args.bot_id }),
  ]);

  return { cloned_bot_id: newId, source_name: source.name };
}

export async function publishAgent(
  ctx: McpContext,
  args: z.infer<typeof publishAgentSchema>
) {
  const ownerId = ctx.ownerUserId ?? ctx.userId;

  const updates: Record<string, unknown> = {
    is_published: args.is_published,
  };

  const { error } = await ctx.supabase
    .from("bot_profiles")
    .update(updates)
    .eq("id", args.bot_id)
    .eq("owner_id", ownerId);

  if (error) throw new Error(error.message);
  return { success: true, is_published: args.is_published };
}

export async function listCommunityAgents(
  ctx: McpContext,
  args: z.infer<typeof listCommunityAgentsSchema>
) {
  let query = ctx.supabase
    .from("bot_profiles")
    .select("id, name, role, bio, skills, community_upvotes, times_cloned, avatar_url, created_at, owner:users!bot_profiles_owner_id_fkey(id, full_name)")
    .eq("is_published", true);

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,bio.ilike.%${args.search}%,role.ilike.%${args.search}%`
    );
  }
  if (args.role) {
    query = query.ilike("role", args.role);
  }

  switch (args.sort) {
    case "newest":
      query = query.order("created_at", { ascending: false });
      break;
    case "most_cloned":
      query = query.order("times_cloned", { ascending: false });
      break;
    default:
      query = query.order("community_upvotes", { ascending: false });
  }

  const { data, error } = await query.limit(args.limit ?? 20);
  if (error) throw new Error(error.message);

  return data ?? [];
}

export async function listFeaturedTeams(
  ctx: McpContext,
  args: z.infer<typeof listFeaturedTeamsSchema>
) {
  let query = ctx.supabase
    .from("featured_teams")
    .select(
      "id, name, icon, description, display_order, is_active, created_at, agents:featured_team_agents(id, display_description, display_order, bot:bot_profiles(id, name, role, avatar_url, bio))"
    )
    .order("display_order", { ascending: true });

  if (!args.include_inactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((team) => ({
    ...team,
    agents: ((team.agents as unknown[]) ?? []).sort(
      (a: unknown, b: unknown) =>
        ((a as { display_order?: number }).display_order ?? 0) -
        ((b as { display_order?: number }).display_order ?? 0)
    ),
  }));
}
