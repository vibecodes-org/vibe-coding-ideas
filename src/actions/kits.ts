"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { allocateAllAgents } from "./idea-agents";
import { cloneBotProfile } from "./bots";
import { applyAutoRuleRetroactively } from "./workflow-templates";
import { BOT_ROLE_TEMPLATES, VIBECODES_USER_ID } from "@/lib/constants";
import { generatePromptFromFields } from "@/lib/prompt-builder";
import type { Database } from "@/types/database";
import type { BotProfile } from "@/types";

type ProjectKit = Database["public"]["Tables"]["project_kits"]["Row"];
type AgentRole = {
  role: string;
  name_suggestion: string;
  skills?: string[];
  system_prompt_template?: string;
};
type LabelPreset = { name: string; color: string };

export async function getActiveKits(): Promise<ProjectKit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_kits")
    .select("*")
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectKit[];
}

export type WorkflowMapping = {
  label_name: string;
  template_name: string;
  template_step_count: number;
  template_steps: { title: string; requires_approval?: boolean }[];
  is_primary: boolean;
};

export type KitWithSteps = ProjectKit & {
  workflow_steps: { title: string; requires_approval?: boolean }[];
  workflow_mappings: WorkflowMapping[];
};

export async function getActiveKitsWithSteps(): Promise<KitWithSteps[]> {
  const supabase = await createClient();

  // Fetch kits with their old singular template (backwards compat)
  const { data, error } = await supabase
    .from("project_kits")
    .select("*, workflow_library_template:workflow_library_templates!project_kits_workflow_library_template_id_fkey(steps)")
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error) throw new Error(error.message);

  const kits = ((data ?? []) as unknown[]).map((row) => {
    const kit = row as ProjectKit & {
      workflow_library_template: { steps: { title: string; requires_approval?: boolean }[] } | null;
    };
    return {
      ...kit,
      workflow_steps: kit.workflow_library_template?.steps ?? [],
      workflow_mappings: [] as WorkflowMapping[],
    };
  }) as KitWithSteps[];

  // Fetch all kit_workflow_mappings with template details
  const kitIds = kits.map((k) => k.id);
  if (kitIds.length > 0) {
    const { data: mappings } = await supabase
      .from("kit_workflow_mappings")
      .select("kit_id, label_name, is_primary, workflow_library_template_id, template:workflow_library_templates!kit_workflow_mappings_workflow_library_template_id_fkey(name, steps)")
      .in("kit_id", kitIds);

    if (mappings && mappings.length > 0) {
      const mappingsByKit = new Map<string, WorkflowMapping[]>();
      for (const m of mappings as unknown[]) {
        const mapping = m as {
          kit_id: string;
          label_name: string;
          is_primary: boolean;
          template: { name: string; steps: { title: string; requires_approval?: boolean }[] } | null;
        };
        if (!mapping.template) continue;

        const kitMappings = mappingsByKit.get(mapping.kit_id) ?? [];
        kitMappings.push({
          label_name: mapping.label_name,
          template_name: mapping.template.name,
          template_step_count: mapping.template.steps?.length ?? 0,
          template_steps: mapping.template.steps ?? [],
          is_primary: mapping.is_primary,
        });
        mappingsByKit.set(mapping.kit_id, kitMappings);
      }

      for (const kit of kits) {
        const kitMappings = mappingsByKit.get(kit.id);
        if (kitMappings && kitMappings.length > 0) {
          kit.workflow_mappings = kitMappings;
          // Use the primary template's steps as the main workflow_steps (backwards compat)
          const primary = kitMappings.find((m) => m.is_primary);
          if (primary) {
            kit.workflow_steps = primary.template_steps;
          }
        }
      }
    }
  }

  return kits;
}

export interface ApplyKitResult {
  agentsCreated: number;
  agentsSkipped: number;
  labelsCreated: number;
  templatesImported: number;
  triggersCreated: number;
  // Backwards compat
  templateImported: boolean;
  autoRuleCreated: boolean;
}

export async function applyKit(
  ideaId: string,
  kitId: string
): Promise<ApplyKitResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Fetch the kit
  const { data: kit, error: kitError } = await supabase
    .from("project_kits")
    .select("*")
    .eq("id", kitId)
    .eq("is_active", true)
    .maybeSingle();

  if (kitError) throw new Error(kitError.message);
  if (!kit) throw new Error("Kit not found or inactive");

  const agentRoles = (kit.agent_roles ?? []) as AgentRole[];
  const labelPresets = (kit.label_presets ?? []) as LabelPreset[];
  const result: ApplyKitResult = {
    agentsCreated: 0,
    agentsSkipped: 0,
    labelsCreated: 0,
    templatesImported: 0,
    triggersCreated: 0,
    templateImported: false,
    autoRuleCreated: false,
  };

  // 1. Clone agents from kit roles (skip existing roles, reuse matching agents)
  if (agentRoles.length > 0) {
    const { data: existingBots } = await supabase
      .from("bot_profiles")
      .select("id, role")
      .eq("owner_id", user.id);

    const existingBotsByRole = new Map(
      (existingBots ?? [])
        .filter((b) => b.role)
        .map((b) => [b.role!.toLowerCase(), b.id])
    );

    // Fetch library agents (admin-owned, published) to clone from
    const { data: libraryAgents } = await supabase
      .from("bot_profiles")
      .select("*")
      .eq("owner_id", VIBECODES_USER_ID)
      .eq("is_active", true)
      .eq("is_published", true);

    const libraryByRole = new Map(
      (libraryAgents ?? [])
        .filter((b) => b.role)
        .map((b) => [b.role!.toLowerCase(), b as unknown as BotProfile])
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
        const libraryAgent = roleLower ? libraryByRole.get(roleLower) : null;
        let newBotId: string | null = null;

        if (libraryAgent) {
          newBotId = await cloneBotProfile(supabase, libraryAgent, user.id);
        } else {
          const template = BOT_ROLE_TEMPLATES.find(
            (t) => t.role.toLowerCase() === roleLower
          );
          const systemPrompt = template?.structured
            ? generatePromptFromFields(template.role, template.structured)
            : template?.prompt ?? null;

          const { data: botUser } = await supabase.rpc("create_bot_user", {
            p_owner_id: user.id,
            p_name: agentRole.name_suggestion || agentRole.role,
            p_role: agentRole.role,
            p_system_prompt: systemPrompt,
          });

          if (botUser) {
            newBotId = botUser;
            if (agentRole.skills && agentRole.skills.length > 0) {
              await supabase
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

    if (botIdsToAllocate.length > 0) {
      try {
        await allocateAllAgents(ideaId, botIdsToAllocate);
      } catch {
        // Non-fatal
      }
    }
  }

  // 2. Create board labels (skip existing)
  if (labelPresets.length > 0) {
    const { data: existingLabels } = await supabase
      .from("board_labels")
      .select("name")
      .eq("idea_id", ideaId);

    const existingLabelNames = new Set(
      (existingLabels ?? []).map((l) => l.name.toLowerCase())
    );

    for (const preset of labelPresets) {
      if (existingLabelNames.has(preset.name.toLowerCase())) continue;

      try {
        await supabase.from("board_labels").insert({
          idea_id: ideaId,
          name: preset.name,
          color: preset.color,
        });
        result.labelsCreated++;
      } catch {
        // Skip individual label creation failures
      }
    }
  }

  // 3. Import workflow templates from kit_workflow_mappings
  const createdRuleIds: string[] = [];
  const { data: mappings } = await supabase
    .from("kit_workflow_mappings")
    .select("label_name, is_primary, workflow_library_template_id")
    .eq("kit_id", kitId);

  if (mappings && mappings.length > 0) {
    // Fetch all board labels for this idea (needed for auto-rule creation)
    const { data: boardLabels } = await supabase
      .from("board_labels")
      .select("id, name")
      .eq("idea_id", ideaId);

    const labelsByName = new Map(
      (boardLabels ?? []).map((l) => [l.name.toLowerCase(), l.id])
    );

    // Deduplicate: group mappings by library template ID
    const templateToLabels = new Map<string, { labelName: string; isPrimary: boolean }[]>();
    for (const m of mappings) {
      const existing = templateToLabels.get(m.workflow_library_template_id) ?? [];
      existing.push({ labelName: m.label_name, isPrimary: m.is_primary });
      templateToLabels.set(m.workflow_library_template_id, existing);
    }

    // Import each unique library template once, create auto-rules for all its labels
    for (const [libTemplateId, labels] of templateToLabels) {
      try {
        const { data: libTemplate } = await supabase
          .from("workflow_library_templates")
          .select("*")
          .eq("id", libTemplateId)
          .eq("is_active", true)
          .maybeSingle();

        if (!libTemplate) continue;

        const { data: newTemplate } = await supabase
          .from("workflow_templates")
          .insert({
            idea_id: ideaId,
            name: libTemplate.name,
            description: libTemplate.description,
            steps: libTemplate.steps,
            created_by: user.id,
          })
          .select("id")
          .single();

        if (!newTemplate) continue;
        result.templatesImported++;

        // Create auto-rules for each label that maps to this template
        for (const { labelName, isPrimary } of labels) {
          const labelId = labelsByName.get(labelName.toLowerCase());
          if (!labelId) continue;

          try {
            const { data: newRule } = await supabase.from("workflow_auto_rules").insert({
              idea_id: ideaId,
              label_id: labelId,
              template_id: newTemplate.id,
            }).select("id").single();
            result.triggersCreated++;
            if (newRule) createdRuleIds.push(newRule.id);
            // Backwards compat: mark first trigger
            if (isPrimary) {
              result.templateImported = true;
              result.autoRuleCreated = true;
            }
          } catch {
            // Skip duplicate auto-rules
          }
        }
      } catch {
        // Non-fatal
      }
    }
  } else if (kit.workflow_library_template_id) {
    // Fallback: old singular template flow for kits without mappings
    try {
      const { data: libTemplate } = await supabase
        .from("workflow_library_templates")
        .select("*")
        .eq("id", kit.workflow_library_template_id)
        .eq("is_active", true)
        .maybeSingle();

      if (libTemplate) {
        const { data: newTemplate } = await supabase
          .from("workflow_templates")
          .insert({
            idea_id: ideaId,
            name: libTemplate.name,
            description: libTemplate.description,
            steps: libTemplate.steps,
            created_by: user.id,
          })
          .select("id")
          .single();

        if (newTemplate) {
          result.templateImported = true;
          result.templatesImported = 1;

          if (kit.auto_rule_label) {
            const { data: matchingLabel } = await supabase
              .from("board_labels")
              .select("id")
              .eq("idea_id", ideaId)
              .ilike("name", kit.auto_rule_label)
              .maybeSingle();

            if (matchingLabel) {
              const { data: newRule } = await supabase.from("workflow_auto_rules").insert({
                idea_id: ideaId,
                label_id: matchingLabel.id,
                template_id: newTemplate.id,
              }).select("id").single();
              result.autoRuleCreated = true;
              result.triggersCreated = 1;
              if (newRule) createdRuleIds.push(newRule.id);
            }
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // 4. Set project_kit_id on the idea
  await supabase
    .from("ideas")
    .update({ project_kit_id: kitId })
    .eq("id", ideaId);

  // 5. Retroactively apply auto-rules to existing tasks that already have matching labels
  if (createdRuleIds.length > 0) {
    await Promise.allSettled(
      createdRuleIds.map((ruleId) => applyAutoRuleRetroactively(ruleId))
    );
  }

  revalidatePath(`/ideas/${ideaId}`);
  revalidatePath(`/ideas/${ideaId}/board`);

  return result;
}
