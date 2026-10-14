import { z } from "zod";
import type { McpContext } from "../context";
import { parseSkillMd, inferRole } from "../lib/skill-md";
import { toolAccessFromFrontmatter } from "../../../src/lib/agent-tool-access";

// --- Schemas ---

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

const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Handlers ---

export async function importAgentSkill(
  ctx: McpContext,
  args: z.infer<typeof importAgentSkillSchema>
) {
  const ownerId = ctx.ownerUserId ?? ctx.userId;

  const parsed = parseSkillMd(args.skill_md_content);
  const role = inferRole(parsed);
  // The file's tool settings (`metadata.tool_access`, or a Claude Code style
  // `tools:` / `disallowedTools:`). A file that says nothing leaves an existing
  // agent's setting alone rather than resetting it to full access.
  const toolAccess = toolAccessFromFrontmatter({
    tools: parsed.tools,
    disallowedTools: parsed.disallowedTools,
    metadataToolAccess: parsed.metadata.tool_access,
  });
  const statesToolAccess =
    parsed.metadata.tool_access !== undefined || parsed.tools !== undefined || parsed.disallowedTools !== undefined;

  // Un-slugify the name for display: "qa-engineer" → "Qa Engineer"
  const displayName = parsed.name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  // Check for existing agent with same source_id (round-trip detection)
  if (parsed.metadata.source === "vibecodes" && parsed.metadata.source_id) {
    // A partial id used to match nothing and quietly create a duplicate agent.
    if (!FULL_UUID.test(parsed.metadata.source_id)) {
      throw new Error(
        `source_id "${parsed.metadata.source_id}" is not a complete agent id (expected the full 36-character uuid, e.g. 8-4-4-4-12 hex digits). ` +
          `Nothing was created or changed. Give the full id, or remove source and source_id to create a new agent.`
      );
    }
    const { data: existing, error: lookupErr } = await ctx.supabase
      .from("bot_profiles")
      .select("id, name")
      .eq("id", parsed.metadata.source_id)
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (lookupErr) throw new Error(lookupErr.message);

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
      if (statesToolAccess) updates.tool_access = toolAccess;

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
  if (toolAccess !== "full") extras.tool_access = toolAccess;
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
    .select("id, name, role, system_prompt, is_active, bio, skills, tool_access")
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
    .describe("Name of the skill to re-read (as named in the agent's Skills section)"),
  agent_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Optional bot_id of the agent that owns the skill — the step's bot_id when loading a skill for a " +
      "workflow step. Preferred for orchestrators/subagents. Omit it to resolve against ctx.userId " +
      "(a stdio install's configured identity; back-compatible)."
    ),
});

export async function getAgentSkillContent(
  ctx: McpContext,
  args: z.infer<typeof getAgentSkillContentSchema>
) {
  // Resolve the owning bot: an explicit agent_id lets a caller (e.g. a
  // subagent executing a workflow step) load skills directly; otherwise fall
  // back to ctx.userId (a stdio install's configured identity — back-compatible).
  const botId = args.agent_id ?? ctx.userId;

  const { data: skill, error } = await ctx.supabase
    .from("agent_skills")
    .select("name, description, content, category")
    .eq("bot_id", botId)
    .eq("name", args.skill_name)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!skill) {
    throw new Error(
      args.agent_id
        ? `Skill "${args.skill_name}" not found for agent ${args.agent_id}. ` +
          `Check the skill name matches one in the agent's Skills section, and that agent_id is the step's bot_id.`
        : `Skill "${args.skill_name}" not found. ` +
          `Pass agent_id (the bot whose skill you're loading) and check the name against the agent's Skills section.`
    );
  }

  return {
    skill_name: skill.name,
    skill_description: skill.description,
    category: skill.category,
    instructions: skill.content,
  };
}
