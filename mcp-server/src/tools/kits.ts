import { z } from "zod";
import type { McpContext } from "../context";
import { VIBECODES_USER_ID } from "../constants";

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

  const kitIds = (data ?? []).map((k) => k.id);

  // Fetch workflow mappings for all kits
  let mappingsByKit = new Map<string, { label_name: string; template_name: string; step_count: number; is_primary: boolean }[]>();
  if (kitIds.length > 0) {
    const { data: mappings } = await ctx.supabase
      .from("kit_workflow_mappings")
      .select("kit_id, label_name, is_primary, template:workflow_library_templates!kit_workflow_mappings_workflow_library_template_id_fkey(name, steps)")
      .in("kit_id", kitIds);

    if (mappings) {
      for (const m of mappings as unknown[]) {
        const mapping = m as {
          kit_id: string;
          label_name: string;
          is_primary: boolean;
          template: { name: string; steps: unknown[] } | null;
        };
        if (!mapping.template) continue;
        const kitMappings = mappingsByKit.get(mapping.kit_id) ?? [];
        kitMappings.push({
          label_name: mapping.label_name,
          template_name: mapping.template.name,
          step_count: mapping.template.steps?.length ?? 0,
          is_primary: mapping.is_primary,
        });
        mappingsByKit.set(mapping.kit_id, kitMappings);
      }
    }
  }

  return (data ?? []).map((kit) => {
    const kitMappings = mappingsByKit.get(kit.id) ?? [];
    return {
      id: kit.id,
      name: kit.name,
      icon: kit.icon,
      description: kit.description,
      agent_role_count: (kit.agent_roles as AgentRole[])?.length ?? 0,
      label_count: (kit.label_presets as LabelPreset[])?.length ?? 0,
      has_workflow_template: !!kit.workflow_library_template_id || kitMappings.length > 0,
      workflow_mappings: kitMappings.length > 0 ? kitMappings : undefined,
    };
  });
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
    templatesImported: 0,
    triggersCreated: 0,
  };

  const ownerId = ctx.ownerUserId ?? ctx.userId;

  // 1. Clone agents (skip existing roles, reuse matching agents)
  if (agentRoles.length > 0) {
    const { data: existingBots } = await ctx.supabase
      .from("bot_profiles")
      .select("id, role")
      .eq("owner_id", ownerId);

    const existingBotsByRole = new Map(
      (existingBots ?? [])
        .filter((b) => b.role)
        .map((b) => [b.role!.toLowerCase(), b.id])
    );

    // Fetch library agents (admin-owned, published) to clone from
    const { data: libraryAgents } = await ctx.supabase
      .from("bot_profiles")
      .select("*")
      .eq("owner_id", VIBECODES_USER_ID)
      .eq("is_active", true)
      .eq("is_published", true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const libraryByRole = new Map<string, any>(
      (libraryAgents ?? [])
        .filter((b) => b.role)
        .map((b) => [b.role!.toLowerCase(), b])
    );

    const botIdsToAllocate: string[] = [];

    for (const agentRole of agentRoles) {
      const roleLower = agentRole.role?.toLowerCase();
      if (roleLower && existingBotsByRole.has(roleLower)) {
        botIdsToAllocate.push(existingBotsByRole.get(roleLower)!);
        result.agentsSkipped++;
        continue;
      }

      try {
        let newBotId: string | null = null;

        const libraryAgent = roleLower ? libraryByRole.get(roleLower) : null;
        if (libraryAgent) {
          const { data: clonedId } = await ctx.supabase.rpc("create_bot_user", {
            p_owner_id: ownerId,
            p_name: libraryAgent.name,
            p_role: libraryAgent.role,
            p_system_prompt: libraryAgent.system_prompt,
            p_avatar_url: libraryAgent.avatar_url,
          });
          if (clonedId) {
            await ctx.supabase
              .from("bot_profiles")
              .update({
                bio: libraryAgent.bio,
                skills: libraryAgent.skills,
                cloned_from: libraryAgent.id,
              })
              .eq("id", clonedId);
            newBotId = clonedId;
          }
        } else {
          const { data: botUser } = await ctx.supabase.rpc("create_bot_user", {
            p_owner_id: ownerId,
            p_name: agentRole.name_suggestion || agentRole.role,
            p_role: agentRole.role,
          });
          if (botUser) {
            newBotId = botUser;
            if (agentRole.skills && agentRole.skills.length > 0) {
              await ctx.supabase
                .from("bot_profiles")
                .update({ skills: agentRole.skills })
                .eq("id", botUser);
            }
          }
        }

        if (newBotId) {
          botIdsToAllocate.push(newBotId);
          result.agentsCreated++;
        }
      } catch {
        // Skip individual creation failures
      }
    }

    for (const botId of botIdsToAllocate) {
      try {
        await ctx.supabase.from("idea_agents").upsert({
          idea_id: params.idea_id,
          bot_id: botId,
          added_by: ownerId,
        }, { onConflict: "idea_id,bot_id", ignoreDuplicates: true });
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

  // 3. Import workflow templates from kit_workflow_mappings
  const { data: mappings } = await ctx.supabase
    .from("kit_workflow_mappings")
    .select("label_name, is_primary, workflow_library_template_id")
    .eq("kit_id", params.kit_id);

  if (mappings && mappings.length > 0) {
    // Fetch all board labels for this idea
    const { data: boardLabels } = await ctx.supabase
      .from("board_labels")
      .select("id, name")
      .eq("idea_id", params.idea_id);

    const labelsByName = new Map(
      (boardLabels ?? []).map((l) => [l.name.toLowerCase(), l.id])
    );

    // Deduplicate: group mappings by library template ID
    const templateToLabels = new Map<string, { labelName: string }[]>();
    for (const m of mappings) {
      const existing = templateToLabels.get(m.workflow_library_template_id) ?? [];
      existing.push({ labelName: m.label_name });
      templateToLabels.set(m.workflow_library_template_id, existing);
    }

    for (const [libTemplateId, labels] of templateToLabels) {
      try {
        const { data: libTemplate } = await ctx.supabase
          .from("workflow_library_templates")
          .select("*")
          .eq("id", libTemplateId)
          .eq("is_active", true)
          .maybeSingle();

        if (!libTemplate) continue;

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

        if (!newTemplate) continue;
        result.templatesImported++;

        for (const { labelName } of labels) {
          const labelId = labelsByName.get(labelName.toLowerCase());
          if (!labelId) continue;

          try {
            await ctx.supabase.from("workflow_auto_rules").insert({
              idea_id: params.idea_id,
              label_id: labelId,
              template_id: newTemplate.id,
            });
            result.triggersCreated++;
          } catch {
            // Skip duplicate auto-rules
          }
        }
      } catch {
        // Non-fatal
      }
    }
  } else if (kit.workflow_library_template_id) {
    // Fallback: old singular template flow
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
          result.templatesImported = 1;

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
              });
              result.triggersCreated = 1;
            }
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // 4. Set project_kit_id on the idea
  await ctx.supabase
    .from("ideas")
    .update({ project_kit_id: params.kit_id })
    .eq("id", params.idea_id);

  return { success: true, ...result };
}
