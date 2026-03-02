"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { VIBECODES_USER_ID } from "@/lib/constants";
import {
  validateBio,
  validateSkills,
  validateTeamName,
  validateTeamDescription,
} from "@/lib/validation";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!data?.is_admin) throw new Error("Not authorized");
  return { supabase, user };
}

export async function createAdminAgent(
  name: string,
  role: string | null,
  systemPrompt: string | null,
  avatarUrl: string | null,
  bio?: string | null,
  skills?: string[]
): Promise<string> {
  const { supabase } = await requireAdmin();

  if (!name.trim()) throw new Error("Agent name is required");
  if (name.length > 100) throw new Error("Agent name must be 100 characters or less");

  const validatedBio = validateBio(bio ?? null);
  const validatedSkills = validateSkills(skills ?? []);

  const { data, error } = await supabase.rpc("create_bot_user", {
    p_name: name.trim(),
    p_owner_id: VIBECODES_USER_ID,
    p_role: role?.trim() || null,
    p_system_prompt: systemPrompt?.trim() || null,
    p_avatar_url: avatarUrl?.trim() || null,
  });

  if (error) throw new Error(error.message);

  const botId = data as string;

  // Set extended fields — auto-published
  const extras: Record<string, unknown> = {
    is_published: true,
  };
  if (validatedBio) extras.bio = validatedBio;
  if (validatedSkills.length > 0) extras.skills = validatedSkills;

  await supabase
    .from("bot_profiles")
    .update(extras)
    .eq("id", botId)
    .eq("owner_id", VIBECODES_USER_ID);

  revalidatePath("/admin");
  revalidatePath("/agents");
  return botId;
}

export async function updateAdminAgent(
  botId: string,
  updates: {
    name?: string;
    role?: string | null;
    system_prompt?: string | null;
    avatar_url?: string | null;
    bio?: string | null;
    skills?: string[];
  }
) {
  const { supabase } = await requireAdmin();

  if (updates.name !== undefined) {
    if (!updates.name.trim()) throw new Error("Agent name is required");
    if (updates.name.length > 100) throw new Error("Agent name must be 100 characters or less");
  }

  // Update bot_profiles
  const profileUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) profileUpdates.name = updates.name.trim();
  if (updates.role !== undefined) profileUpdates.role = updates.role?.trim() || null;
  if (updates.system_prompt !== undefined)
    profileUpdates.system_prompt = updates.system_prompt?.trim() || null;
  if (updates.avatar_url !== undefined)
    profileUpdates.avatar_url = updates.avatar_url?.trim() || null;
  if (updates.bio !== undefined) profileUpdates.bio = validateBio(updates.bio ?? null);
  if (updates.skills !== undefined) profileUpdates.skills = validateSkills(updates.skills ?? []);

  if (Object.keys(profileUpdates).length > 0) {
    const { error } = await supabase
      .from("bot_profiles")
      .update(profileUpdates)
      .eq("id", botId)
      .eq("owner_id", VIBECODES_USER_ID);

    if (error) throw new Error(error.message);
  }

  // Sync users.full_name / avatar_url via admin RPC
  if (updates.name !== undefined || updates.avatar_url !== undefined) {
    const { error: syncError } = await supabase.rpc("admin_update_bot_user", {
      p_bot_id: botId,
      p_name: updates.name !== undefined ? updates.name.trim() : null,
      p_avatar_url: updates.avatar_url !== undefined ? (updates.avatar_url?.trim() || null) : null,
    });

    if (syncError) throw new Error(syncError.message);
  }

  revalidatePath("/admin");
  revalidatePath("/agents");
  revalidatePath(`/agents/${botId}`);
}

export async function deleteAdminAgent(botId: string) {
  const { supabase } = await requireAdmin();

  const { error } = await supabase.rpc("admin_delete_bot_user", {
    p_bot_id: botId,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePath("/agents");
}

// --- Featured Teams ---

export async function createFeaturedTeam(
  name: string,
  icon: string,
  description: string | null,
  agents: { botId: string; displayDescription: string | null; displayOrder: number }[]
): Promise<string> {
  const { supabase, user } = await requireAdmin();

  const validatedName = validateTeamName(name);
  const validatedDesc = validateTeamDescription(description);

  // Get max display_order for positioning
  const { data: maxOrderData } = await supabase
    .from("featured_teams")
    .select("display_order")
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (maxOrderData?.display_order ?? 0) + 1;

  const { data: team, error } = await supabase
    .from("featured_teams")
    .insert({
      name: validatedName,
      icon: icon.trim() || "🚀",
      description: validatedDesc,
      display_order: nextOrder,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  // Insert team agents
  if (agents.length > 0) {
    const agentRows = agents.map((a) => ({
      team_id: team.id,
      bot_id: a.botId,
      display_description: a.displayDescription?.trim() || null,
      display_order: a.displayOrder,
    }));

    const { error: agentsError } = await supabase
      .from("featured_team_agents")
      .insert(agentRows);

    if (agentsError) throw new Error(agentsError.message);
  }

  revalidatePath("/admin");
  revalidatePath("/agents");
  return team.id;
}

export async function updateFeaturedTeam(
  teamId: string,
  updates: {
    name?: string;
    icon?: string;
    description?: string | null;
    display_order?: number;
  }
) {
  const { supabase } = await requireAdmin();

  const teamUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) teamUpdates.name = validateTeamName(updates.name);
  if (updates.icon !== undefined) teamUpdates.icon = updates.icon.trim() || "🚀";
  if (updates.description !== undefined)
    teamUpdates.description = validateTeamDescription(updates.description);
  if (updates.display_order !== undefined) teamUpdates.display_order = updates.display_order;

  if (Object.keys(teamUpdates).length > 0) {
    const { error } = await supabase
      .from("featured_teams")
      .update(teamUpdates)
      .eq("id", teamId);

    if (error) throw new Error(error.message);
  }

  revalidatePath("/admin");
  revalidatePath("/agents");
}

export async function deleteFeaturedTeam(teamId: string) {
  const { supabase } = await requireAdmin();

  const { error } = await supabase
    .from("featured_teams")
    .delete()
    .eq("id", teamId);

  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePath("/agents");
}

export async function toggleFeaturedTeamActive(teamId: string) {
  const { supabase } = await requireAdmin();

  // Fetch current state
  const { data: team, error: fetchError } = await supabase
    .from("featured_teams")
    .select("is_active")
    .eq("id", teamId)
    .single();

  if (fetchError) throw new Error(fetchError.message);

  const { error } = await supabase
    .from("featured_teams")
    .update({ is_active: !team.is_active })
    .eq("id", teamId);

  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePath("/agents");
}

export async function setTeamAgents(
  teamId: string,
  agents: { botId: string; displayDescription: string | null; displayOrder: number }[]
) {
  const { supabase } = await requireAdmin();

  // Delete existing team agents
  const { error: deleteError } = await supabase
    .from("featured_team_agents")
    .delete()
    .eq("team_id", teamId);

  if (deleteError) throw new Error(deleteError.message);

  // Re-insert with new order
  if (agents.length > 0) {
    const agentRows = agents.map((a) => ({
      team_id: teamId,
      bot_id: a.botId,
      display_description: a.displayDescription?.trim() || null,
      display_order: a.displayOrder,
    }));

    const { error: insertError } = await supabase
      .from("featured_team_agents")
      .insert(agentRows);

    if (insertError) throw new Error(insertError.message);
  }

  revalidatePath("/admin");
  revalidatePath("/agents");
}
