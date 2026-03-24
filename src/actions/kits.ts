"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { allocateAllAgents } from "./idea-agents";
import type { Database } from "@/types/database";

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

export interface ApplyKitResult {
  agentsCreated: number;
  agentsSkipped: number;
  labelsCreated: number;
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
    templateImported: false,
    autoRuleCreated: false,
  };

  // 1. Clone agents from kit roles (skip existing roles)
  if (agentRoles.length > 0) {
    const { data: existingBots } = await supabase
      .from("bot_profiles")
      .select("role")
      .eq("owner_id", user.id);

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
        const { data: botUser } = await supabase.rpc("create_bot_user", {
          owner_id: user.id,
          bot_name: agentRole.name_suggestion || agentRole.role,
          bot_role: agentRole.role,
        });

        if (botUser) {
          // Update with skills if provided
          if (agentRole.skills && agentRole.skills.length > 0) {
            await supabase
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

    // 5. Allocate all created agents to the idea
    if (createdBotIds.length > 0) {
      try {
        await allocateAllAgents(ideaId, createdBotIds);
      } catch {
        // Non-fatal — agents exist but allocation failed
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

  // 3. Import workflow template from library
  if (kit.workflow_library_template_id) {
    try {
      const { data: libTemplate } = await supabase
        .from("workflow_library_templates")
        .select("*")
        .eq("id", kit.workflow_library_template_id)
        .eq("is_active", true)
        .maybeSingle();

      if (libTemplate) {
        // Create a local workflow template from the library template
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

          // 4. Create auto-rule linking label to template
          if (kit.auto_rule_label) {
            // Find or create the label
            const { data: matchingLabel } = await supabase
              .from("board_labels")
              .select("id")
              .eq("idea_id", ideaId)
              .ilike("name", kit.auto_rule_label)
              .maybeSingle();

            if (matchingLabel) {
              await supabase.from("workflow_auto_rules").insert({
                idea_id: ideaId,
                label_id: matchingLabel.id,
                template_id: newTemplate.id,
                created_by: user.id,
              });
              result.autoRuleCreated = true;
            }
          }
        }
      }
    } catch {
      // Non-fatal — template import failed
    }
  }

  // 6. Set project_kit_id on the idea
  await supabase
    .from("ideas")
    .update({ project_kit_id: kitId })
    .eq("id", ideaId);

  revalidatePath(`/ideas/${ideaId}`);
  revalidatePath(`/ideas/${ideaId}/board`);

  return result;
}
