"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { importTemplateWithLabel } from "@/actions/workflow-templates";
import type { WorkflowTemplateStep } from "@/types/database";

export async function saveToMyTemplates(
  templateId: string,
  ideaId: string,
  name?: string,
  description?: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Fetch the source template
  const { data: template, error: templateError } = await supabase
    .from("workflow_templates")
    .select("*")
    .eq("id", templateId)
    .eq("idea_id", ideaId)
    .single();

  if (templateError || !template) throw new Error("Template not found");

  // Fetch the idea title for source_idea_title
  const { data: idea } = await supabase
    .from("ideas")
    .select("title")
    .eq("id", ideaId)
    .single();

  // Check for auto-rule to carry over suggested label
  const { data: autoRules } = await supabase
    .from("workflow_auto_rules")
    .select("*, board_labels(*)")
    .eq("template_id", templateId)
    .eq("idea_id", ideaId)
    .limit(1);

  const suggestedLabel = autoRules?.[0]?.board_labels;

  const { data, error } = await supabase
    .from("user_workflow_templates")
    .insert({
      user_id: user.id,
      name: name || template.name,
      description: description ?? template.description,
      steps: template.steps,
      source_idea_id: ideaId,
      source_idea_title: idea?.title ?? null,
      suggested_label_name: suggestedLabel?.name ?? null,
      suggested_label_color: suggestedLabel?.color ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/board`);
  return data;
}

export async function listMyTemplates() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("user_workflow_templates")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteMyTemplate(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("user_workflow_templates")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function importFromMyTemplate(
  userTemplateId: string,
  ideaId: string,
  autoWire: boolean
): Promise<{ templateId: string; labelId?: string; autoRuleId?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: myTemplate, error } = await supabase
    .from("user_workflow_templates")
    .select("*")
    .eq("id", userTemplateId)
    .single();

  if (error || !myTemplate) throw new Error("Personal template not found");

  return importTemplateWithLabel(
    ideaId,
    {
      name: myTemplate.name,
      description: myTemplate.description,
      steps: myTemplate.steps as WorkflowTemplateStep[],
      suggested_label_name: myTemplate.suggested_label_name,
      suggested_label_color: myTemplate.suggested_label_color,
    },
    autoWire
  );
}

export async function isTemplateSaved(
  templateId: string,
  ideaId: string
): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Fetch the source template name to match against
  const { data: template } = await supabase
    .from("workflow_templates")
    .select("name, steps")
    .eq("id", templateId)
    .eq("idea_id", ideaId)
    .single();

  if (!template) return false;

  // Check if user already has a template with matching name
  const { data: existing } = await supabase
    .from("user_workflow_templates")
    .select("id")
    .eq("name", template.name)
    .limit(1);

  return (existing?.length ?? 0) > 0;
}
