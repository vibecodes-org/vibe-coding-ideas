"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateBio, validateSkills } from "@/lib/validation";
import type { BotProfile, FeaturedTeamWithAgents } from "@/types";

export async function createBot(
  name: string,
  role: string | null,
  systemPrompt: string | null,
  avatarUrl: string | null,
  bio?: string | null,
  skills?: string[]
): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  if (!name.trim()) throw new Error("Agent name is required");
  if (name.length > 100) throw new Error("Agent name must be 100 characters or less");

  const validatedBio = validateBio(bio ?? null);
  const validatedSkills = validateSkills(skills ?? []);

  const { data, error } = await supabase.rpc("create_bot_user", {
    p_name: name.trim(),
    p_owner_id: user.id,
    p_role: role?.trim() || null,
    p_system_prompt: systemPrompt?.trim() || null,
    p_avatar_url: avatarUrl?.trim() || null,
  });

  if (error) throw new Error(error.message);

  const botId = data as string;

  // Set bio/skills via follow-up UPDATE (RPC doesn't know about new columns)
  if (validatedBio || validatedSkills.length > 0) {
    const extras: Record<string, unknown> = {};
    if (validatedBio) extras.bio = validatedBio;
    if (validatedSkills.length > 0) extras.skills = validatedSkills;

    await supabase
      .from("bot_profiles")
      .update(extras)
      .eq("id", botId)
      .eq("owner_id", user.id);
  }

  revalidatePath(`/profile/${user.id}`);
  revalidatePath("/agents");
  return botId;
}

export async function updateBot(
  botId: string,
  updates: {
    name?: string;
    role?: string | null;
    system_prompt?: string | null;
    avatar_url?: string | null;
    is_active?: boolean;
    bio?: string | null;
    skills?: string[];
    is_published?: boolean;
  }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  if (updates.name !== undefined) {
    if (!updates.name.trim()) throw new Error("Agent name is required");
    if (updates.name.length > 100)
      throw new Error("Agent name must be 100 characters or less");
  }

  // Update bot_profiles
  const profileUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) profileUpdates.name = updates.name.trim();
  if (updates.role !== undefined) profileUpdates.role = updates.role?.trim() || null;
  if (updates.system_prompt !== undefined)
    profileUpdates.system_prompt = updates.system_prompt?.trim() || null;
  if (updates.avatar_url !== undefined)
    profileUpdates.avatar_url = updates.avatar_url?.trim() || null;
  if (updates.is_active !== undefined) profileUpdates.is_active = updates.is_active;
  if (updates.bio !== undefined) profileUpdates.bio = validateBio(updates.bio ?? null);
  if (updates.skills !== undefined) profileUpdates.skills = validateSkills(updates.skills ?? []);
  if (updates.is_published !== undefined) profileUpdates.is_published = updates.is_published;

  if (Object.keys(profileUpdates).length > 0) {
    const { error } = await supabase
      .from("bot_profiles")
      .update(profileUpdates)
      .eq("id", botId)
      .eq("owner_id", user.id);

    if (error) throw new Error(error.message);
  }

  // Sync users.full_name / avatar_url via SECURITY DEFINER RPC
  // (RLS on users only allows auth.uid() = id, so direct updates silently fail)
  if (updates.name !== undefined || updates.avatar_url !== undefined) {
    const { error: syncError } = await supabase.rpc("update_bot_user", {
      p_bot_id: botId,
      p_owner_id: user.id,
      p_name: updates.name !== undefined ? updates.name.trim() : null,
      p_avatar_url: updates.avatar_url !== undefined ? (updates.avatar_url?.trim() || null) : null,
    });

    if (syncError) throw new Error(syncError.message);
  }

  revalidatePath(`/profile/${user.id}`);
  revalidatePath("/agents");
  revalidatePath(`/agents/${botId}`);
  revalidatePath("/ideas");
}

export async function deleteBot(botId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase.rpc("delete_bot_user", {
    p_bot_id: botId,
    p_owner_id: user.id,
  });

  if (error) throw new Error(error.message);

  revalidatePath(`/profile/${user.id}`);
  revalidatePath("/agents");
}

export async function listMyBots(): Promise<BotProfile[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("bot_profiles")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []) as BotProfile[];
}

export async function toggleAgentVote(botId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: existingVote } = await supabase
    .from("agent_votes")
    .select()
    .eq("bot_id", botId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingVote) {
    const { error } = await supabase
      .from("agent_votes")
      .delete()
      .eq("bot_id", botId)
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("agent_votes").insert({
      bot_id: botId,
      user_id: user.id,
    });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/agents");
  revalidatePath(`/agents/${botId}`);
}

/**
 * Clone a bot profile: create via RPC, copy extended fields, set provenance,
 * and atomically increment the source's times_cloned counter.
 * Returns the new bot's ID.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cloneBotProfile(
  supabase: any,
  source: BotProfile,
  ownerId: string
): Promise<string> {
  const { data: newBotId, error: createError } = await supabase.rpc("create_bot_user", {
    p_name: source.name,
    p_owner_id: ownerId,
    p_role: source.role,
    p_system_prompt: source.system_prompt,
    p_avatar_url: source.avatar_url,
  });

  if (createError) throw new Error(createError.message);

  // Set extended fields + provenance, and atomically increment source counter
  await Promise.all([
    supabase
      .from("bot_profiles")
      .update({
        bio: source.bio,
        skills: source.skills,
        cloned_from: source.id,
      })
      .eq("id", newBotId)
      .eq("owner_id", ownerId),
    supabase.rpc("increment_times_cloned", { p_bot_id: source.id }),
  ]);

  return newBotId as string;
}

export async function cloneAgent(botId: string): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: source, error: fetchError } = await supabase
    .from("bot_profiles")
    .select("*")
    .eq("id", botId)
    .eq("is_published", true)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);
  if (!source) throw new Error("Agent not found or not published");

  const newBotId = await cloneBotProfile(supabase, source as BotProfile, user.id);

  revalidatePath("/agents");
  return newBotId;
}

export async function addFeaturedTeam(
  teamId: string
): Promise<{ created: string[]; skipped: string[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: team, error: teamError } = await supabase
    .from("featured_teams")
    .select("*, agents:featured_team_agents(*, bot:bot_profiles(*))")
    .eq("id", teamId)
    .eq("is_active", true)
    .maybeSingle();

  if (teamError) throw new Error(teamError.message);
  if (!team) throw new Error("Team not found");

  const typedTeam = team as unknown as FeaturedTeamWithAgents;

  const { data: existingBots } = await supabase
    .from("bot_profiles")
    .select("role")
    .eq("owner_id", user.id);

  const existingRoles = new Set(
    (existingBots ?? []).map((b) => b.role?.toLowerCase())
  );

  const created: string[] = [];
  const skipped: string[] = [];

  for (const entry of typedTeam.agents) {
    const bot = entry.bot;
    const role = bot.role ?? "";

    if (role && existingRoles.has(role.toLowerCase())) {
      skipped.push(role);
      continue;
    }

    try {
      await cloneBotProfile(supabase, bot as unknown as BotProfile, user.id);
      created.push(role || bot.name);
    } catch {
      // Skip individual clone failures
    }
  }

  revalidatePath("/agents");
  return { created, skipped };
}

export type AgentProfileData = {
  bot: BotProfile & {
    owner: { id: string; full_name: string | null; avatar_url: string | null };
  };
  isOwner: boolean;
  hasVoted: boolean;
  tasks: Array<{
    id: string;
    title: string;
    archived: boolean;
    board_columns: { title: string; is_done_column: boolean; idea_id: string };
  }>;
  completedTaskCount: number;
  contributingIdeas: Array<{ id: string; title: string; assignedCount: number }>;
  recentActivity: Array<{
    id: string;
    action: string;
    details: Record<string, string> | null;
    created_at: string;
    taskTitle: string;
  }>;
  clonedFromBot: { id: string; name: string } | null;
};

export async function getAgentProfile(
  botId: string
): Promise<AgentProfileData | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Fetch bot profile with owner
  const { data: bot, error } = await supabase
    .from("bot_profiles")
    .select("*, owner:users!bot_profiles_owner_id_fkey(id, full_name, avatar_url)")
    .eq("id", botId)
    .maybeSingle();

  if (error || !bot) return null;

  const isOwner = bot.owner_id === user.id;
  if (!bot.is_published && !isOwner) return null;

  const typedBot = bot as BotProfile & {
    owner: { id: string; full_name: string | null; avatar_url: string | null };
  };

  // Run all independent queries in parallel
  const [
    { data: voteData },
    { data: activeTasks },
    { count: completedCount },
    { data: ideaAgentData },
    { data: recentActivity },
    clonedFromBot,
  ] = await Promise.all([
    // Check if current user has voted
    supabase
      .from("agent_votes")
      .select("id")
      .eq("bot_id", botId)
      .eq("user_id", user.id)
      .maybeSingle(),
    // Fetch active (non-done, non-archived) tasks
    supabase
      .from("board_tasks")
      .select("id, title, archived, board_columns!inner(title, is_done_column, idea_id)")
      .eq("assignee_id", botId)
      .eq("archived", false)
      .limit(20),
    // Count completed tasks (using inner join so the filter works)
    supabase
      .from("board_tasks")
      .select("id, board_columns!inner(is_done_column)", { count: "exact", head: true })
      .eq("assignee_id", botId)
      .eq("board_columns.is_done_column", true),
    // Fetch ideas this agent is allocated to
    supabase
      .from("idea_agents")
      .select("idea_id, ideas!inner(id, title)")
      .eq("bot_id", botId)
      .limit(10),
    // Fetch recent activity
    supabase
      .from("board_task_activity")
      .select("id, action, details, created_at, board_tasks!inner(title, board_columns!inner(idea_id))")
      .eq("user_id", botId)
      .order("created_at", { ascending: false })
      .limit(5),
    // Cloned from info
    typedBot.cloned_from
      ? supabase
          .from("bot_profiles")
          .select("id, name")
          .eq("id", typedBot.cloned_from)
          .maybeSingle()
          .then(({ data }) => data)
      : Promise.resolve(null),
  ]);

  const tasks = (activeTasks ?? []) as Array<{
    id: string;
    title: string;
    archived: boolean;
    board_columns: { title: string; is_done_column: boolean; idea_id: string };
  }>;

  const currentlyAssigned = tasks.filter((t) => !t.board_columns.is_done_column);

  const contributingIdeas = (ideaAgentData ?? []).map((ia) => ({
    id: (ia.ideas as { id: string; title: string }).id,
    title: (ia.ideas as { id: string; title: string }).title,
  }));

  const ideaTaskCounts: Record<string, number> = {};
  for (const task of currentlyAssigned) {
    const ideaId = task.board_columns.idea_id;
    ideaTaskCounts[ideaId] = (ideaTaskCounts[ideaId] ?? 0) + 1;
  }

  const contributingIdeasWithAssignment = contributingIdeas.map((idea) => ({
    ...idea,
    assignedCount: ideaTaskCounts[idea.id] ?? 0,
  }));

  return {
    bot: typedBot,
    isOwner,
    hasVoted: !!voteData,
    tasks: currentlyAssigned,
    completedTaskCount: completedCount ?? 0,
    contributingIdeas: contributingIdeasWithAssignment,
    recentActivity: (recentActivity ?? []).map((a) => ({
      id: a.id,
      action: a.action,
      details: a.details as Record<string, string> | null,
      created_at: a.created_at,
      taskTitle: (a.board_tasks as { title: string }).title,
    })),
    clonedFromBot,
  };
}

