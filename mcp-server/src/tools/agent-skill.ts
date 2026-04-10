import { z } from "zod";
import type { McpContext } from "../context";
import { generateSkillMd, parseSkillMd, skillFilename, inferRole } from "../lib/skill-md";

// --- Schemas ---

export const exportAgentSkillSchema = z.object({
  agent_id: z.string().uuid().describe("The bot profile ID to export as SKILL.md"),
});

export const importAgentSkillSchema = z.object({
  skill_md_content: z
    .string()
    .min(1)
    .max(50000)
    .describe("The full SKILL.md file content (YAML frontmatter + markdown body)"),
  idea_id: z
    .string()
    .uuid()
    .optional()
    .describe("If provided, allocate the created agent to this idea"),
});

// --- Handlers ---

export async function exportAgentSkill(
  ctx: McpContext,
  args: z.infer<typeof exportAgentSkillSchema>
) {
  const ownerId = ctx.ownerUserId ?? ctx.userId;

  // Allow export if owner OR if agent is published
  const { data: bot, error } = await ctx.supabase
    .from("bot_profiles")
    .select("id, name, role, system_prompt, bio, skills, owner_id, is_published")
    .eq("id", args.agent_id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!bot) throw new Error("Agent not found");
  if (bot.owner_id !== ownerId && !bot.is_published) {
    throw new Error("You can only export your own agents or published agents");
  }

  const skillMd = generateSkillMd(bot);
  const filename = skillFilename(bot.name);

  return { skill_md: skillMd, filename };
}

export async function importAgentSkill(
  ctx: McpContext,
  args: z.infer<typeof importAgentSkillSchema>
) {
  const ownerId = ctx.ownerUserId ?? ctx.userId;

  const parsed = parseSkillMd(args.skill_md_content);
  const role = inferRole(parsed);

  // Un-slugify the name for display: "qa-engineer" → "Qa Engineer"
  const displayName = parsed.name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  // Check for existing agent with same source_id (round-trip detection)
  if (parsed.metadata.source === "vibecodes" && parsed.metadata.source_id) {
    const { data: existing } = await ctx.supabase
      .from("bot_profiles")
      .select("id, name")
      .eq("id", parsed.metadata.source_id)
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (existing) {
      // Update existing agent
      const updates: Record<string, unknown> = {
        system_prompt: parsed.body || null,
      };
      if (role) updates.role = role;
      if (parsed.metadata.bio) updates.bio = parsed.metadata.bio.slice(0, 500);
      if (parsed.metadata.tags) {
        updates.skills = parsed.metadata.tags.slice(0, 10).map((s) => s.slice(0, 30));
      }

      const { error: updateErr } = await ctx.supabase
        .from("bot_profiles")
        .update(updates)
        .eq("id", existing.id)
        .eq("owner_id", ownerId);

      if (updateErr) throw new Error(updateErr.message);

      return {
        action: "updated",
        bot_id: existing.id,
        name: existing.name,
        message: `Updated existing agent "${existing.name}" from SKILL.md`,
      };
    }
  }

  // Create new agent
  const { data: botId, error: createErr } = await ctx.supabase.rpc("create_bot_user", {
    p_name: displayName,
    p_owner_id: ownerId,
    p_role: role,
    p_system_prompt: parsed.body || null,
    p_avatar_url: null,
  });

  if (createErr) throw new Error(createErr.message);

  // Set extended fields (with validation limits)
  const extras: Record<string, unknown> = {};
  if (parsed.metadata.bio) extras.bio = parsed.metadata.bio.slice(0, 500);
  if (parsed.metadata.tags && parsed.metadata.tags.length > 0) {
    extras.skills = parsed.metadata.tags.slice(0, 10).map((s) => s.slice(0, 30));
  }
  if (Object.keys(extras).length > 0) {
    await ctx.supabase
      .from("bot_profiles")
      .update(extras)
      .eq("id", botId)
      .eq("owner_id", ownerId);
  }

  // Optionally allocate to idea
  if (args.idea_id) {
    await ctx.supabase.from("idea_agents").insert({
      idea_id: args.idea_id,
      bot_id: botId,
      added_by: ownerId,
    });
  }

  // Fetch created profile
  const { data: profile } = await ctx.supabase
    .from("bot_profiles")
    .select("id, name, role, system_prompt, is_active, bio, skills")
    .eq("id", botId)
    .single();

  return {
    action: "created",
    bot_id: botId,
    profile,
    message: `Created agent "${displayName}" from SKILL.md`,
  };
}

// --- Get Agent Skill Content (progressive disclosure) ---

export const getAgentSkillContentSchema = z.object({
  skill_name: z
    .string()
    .min(1)
    .describe("Name of the skill to load full instructions for (from the available_skills list)"),
});

export async function getAgentSkillContent(
  ctx: McpContext,
  args: z.infer<typeof getAgentSkillContentSchema>
) {
  // ctx.userId is the active agent identity (set by set_agent_identity)
  const { data: skill, error } = await ctx.supabase
    .from("agent_skills")
    .select("name, description, content, category")
    .eq("bot_id", ctx.userId)
    .eq("name", args.skill_name)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!skill) {
    throw new Error(
      `Skill "${args.skill_name}" not found for the active agent. ` +
      `Make sure you've called set_agent_identity first and the skill name matches one from available_skills.`
    );
  }

  return {
    skill_name: skill.name,
    skill_description: skill.description,
    category: skill.category,
    instructions: skill.content,
  };
}
