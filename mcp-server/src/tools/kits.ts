import { z } from "zod";
import type { McpContext } from "../context";

// --- List Kits ---

export const listKitsSchema = z.object({});

type AgentRole = { role: string; name_suggestion?: string; skills?: string[] };
type LabelPreset = { name: string; color: string };

export async function listKits(ctx: McpContext) {
  const { data, error } = await ctx.supabase
    .from("project_kits")
    .select("id, name, icon, description, agent_roles, label_presets, workflow_library_template_id")
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error) throw new Error(`Failed to list kits: ${error.message}`);

  return (data ?? []).map((kit) => ({
    id: kit.id,
    name: kit.name,
    icon: kit.icon,
    description: kit.description,
    agent_role_count: (kit.agent_roles as AgentRole[])?.length ?? 0,
    label_count: (kit.label_presets as LabelPreset[])?.length ?? 0,
    has_workflow_template: !!kit.workflow_library_template_id,
  }));
}

// --- Apply Kit ---

export const applyKitSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID to apply the kit to"),
  kit_id: z.string().uuid().describe("The project kit ID to apply"),
});

export async function applyKitMcp(
  ctx: McpContext,
  params: z.infer<typeof applyKitSchema>
) {
  // Verify team membership (author, collaborator, or pooled agent)
  const { data: idea } = await ctx.supabase
    .from("ideas")
    .select("author_id")
    .eq("id", params.idea_id)
    .maybeSingle();
  if (!idea) throw new Error("Idea not found");

  const isAuthor = idea.author_id === ctx.userId;
  let isTeamMember = isAuthor;
  if (!isTeamMember) {
    const { data: collab } = await ctx.supabase
      .from("collaborators")
      .select("id")
      .eq("idea_id", params.idea_id)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    isTeamMember = !!collab;
  }
  if (!isTeamMember) {
    const { data: agent } = await ctx.supabase
      .from("idea_agents")
      .select("bot_id")
      .eq("idea_id", params.idea_id)
      .eq("bot_id", ctx.userId)
      .maybeSingle();
    isTeamMember = !!agent;
  }
  if (!isTeamMember) throw new Error("You must be a team member to apply a kit");

  // Fetch the kit
  const { data: kit, error: kitError } = await ctx.supabase
    .from("project_kits")
    .select("*")
    .eq("id", params.kit_id)
    .eq("is_active", true)
    .maybeSingle();

  if (kitError) throw new Error(`Failed to fetch kit: ${kitError.message}`);
  if (!kit) throw new Error("Kit not found or inactive");

  const agentRoles = (kit.agent_roles ?? []) as AgentRole[];
  const labelPresets = (kit.label_presets ?? []) as LabelPreset[];
  const result = {
    agentsCreated: 0,
    agentsSkipped: 0,
    labelsCreated: 0,
    templateImported: false,
    autoRuleCreated: false,
  };

  const ownerId = ctx.ownerUserId ?? ctx.userId;

  // 1. Clone agents (skip existing roles)
  if (agentRoles.length > 0) {
    const { data: existingBots } = await ctx.supabase
      .from("bot_profiles")
      .select("role")
      .eq("owner_id", ownerId);

    const existingRoles = new Set(
      (existingBots ?? []).map((b) => b.role?.toLowerCase())
    );

    const createdBotIds: string[] = [];

    for (const agentRole of agentRoles) {
      if (agentRole.role && existingRoles.has(agentRole.role.toLowerCase())) {
        result.agentsSkipped++;
        continue;
      }

      try {
        const { data: botUser } = await ctx.supabase.rpc("create_bot_user", {
          p_owner_id: ownerId,
          p_name: agentRole.name_suggestion || agentRole.role,
          p_role: agentRole.role,
        });

        if (botUser) {
          if (agentRole.skills && agentRole.skills.length > 0) {
            await ctx.supabase
              .from("bot_profiles")
              .update({ skills: agentRole.skills })
              .eq("id", botUser);
          }
          createdBotIds.push(botUser);
          result.agentsCreated++;
        }
      } catch {
        // Skip individual creation failures
      }
    }

    // Allocate created agents to the idea
    for (const botId of createdBotIds) {
      try {
        await ctx.supabase.from("idea_agents").insert({
          idea_id: params.idea_id,
          bot_id: botId,
          added_by: ownerId,
        });
      } catch {
        // Skip duplicates
      }
    }
  }

  // 2. Create board labels (skip existing)
  if (labelPresets.length > 0) {
    const { data: existingLabels } = await ctx.supabase
      .from("board_labels")
      .select("name")
      .eq("idea_id", params.idea_id);

    const existingLabelNames = new Set(
      (existingLabels ?? []).map((l) => l.name.toLowerCase())
    );

    for (const preset of labelPresets) {
      if (existingLabelNames.has(preset.name.toLowerCase())) continue;
      try {
        await ctx.supabase.from("board_labels").insert({
          idea_id: params.idea_id,
          name: preset.name,
          color: preset.color,
        });
        result.labelsCreated++;
      } catch {
        // Skip individual failures
      }
    }
  }

  // 3. Import workflow template
  if (kit.workflow_library_template_id) {
    try {
      const { data: libTemplate } = await ctx.supabase
        .from("workflow_library_templates")
        .select("*")
        .eq("id", kit.workflow_library_template_id)
        .eq("is_active", true)
        .maybeSingle();

      if (libTemplate) {
        const { data: newTemplate } = await ctx.supabase
          .from("workflow_templates")
          .insert({
            idea_id: params.idea_id,
            name: libTemplate.name,
            description: libTemplate.description,
            steps: libTemplate.steps,
            created_by: ownerId,
          })
          .select("id")
          .single();

        if (newTemplate) {
          result.templateImported = true;

          // 4. Create auto-rule
          if (kit.auto_rule_label) {
            const { data: matchingLabel } = await ctx.supabase
              .from("board_labels")
              .select("id")
              .eq("idea_id", params.idea_id)
              .ilike("name", kit.auto_rule_label)
              .maybeSingle();

            if (matchingLabel) {
              await ctx.supabase.from("workflow_auto_rules").insert({
                idea_id: params.idea_id,
                label_id: matchingLabel.id,
                template_id: newTemplate.id,
                created_by: ownerId,
              });
              result.autoRuleCreated = true;
            }
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // 5. Set project_kit_id on the idea
  await ctx.supabase
    .from("ideas")
    .update({ project_kit_id: params.kit_id })
    .eq("id", params.idea_id);

  return { success: true, ...result };
}
