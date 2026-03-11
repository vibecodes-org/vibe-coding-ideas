"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import {
  validateTitle,
  validateOptionalDescription,
  validateWorkflowTemplateSteps,
  validateUuid,
} from "@/lib/validation";
import type { WorkflowTemplateStep, Database } from "@/types/database";

async function requireAdmin() {
  const { user, supabase } = await requireAuth();
  const { data } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!data?.is_admin) throw new Error("Forbidden");
  return { user, supabase };
}

export async function listLibraryTemplates(activeOnly = false) {
  const { supabase } = await requireAuth();
  let query = supabase
    .from("workflow_library_templates")
    .select("*")
    .order("display_order", { ascending: true });
  if (activeOnly) {
    query = query.eq("is_active", true);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function createLibraryTemplate(
  name: string,
  description: string | null,
  steps: WorkflowTemplateStep[]
) {
  const { user, supabase } = await requireAdmin();
  const validName = validateTitle(name);
  const validDesc = validateOptionalDescription(description);
  const validSteps = validateWorkflowTemplateSteps(steps);

  // Get next display_order
  const { data: maxRow } = await supabase
    .from("workflow_library_templates")
    .select("display_order")
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.display_order ?? -1) + 1;

  const { error } = await supabase.from("workflow_library_templates").insert({
    name: validName,
    description: validDesc,
    steps: validSteps,
    display_order: nextOrder,
    created_by: user.id,
  });
  if (error) {
    if (error.code === "23505") throw new Error("A template with this name already exists");
    throw new Error(error.message);
  }
  revalidatePath("/admin");
}

export async function updateLibraryTemplate(
  id: string,
  updates: {
    name?: string;
    description?: string | null;
    steps?: WorkflowTemplateStep[];
    is_active?: boolean;
    display_order?: number;
  }
) {
  const { supabase } = await requireAdmin();
  validateUuid(id, "Template ID");

  type WLTUpdate = Database["public"]["Tables"]["workflow_library_templates"]["Update"];
  const patch: WLTUpdate = {};
  if (updates.name !== undefined) patch.name = validateTitle(updates.name);
  if (updates.description !== undefined)
    patch.description = validateOptionalDescription(updates.description);
  if (updates.steps !== undefined)
    patch.steps = validateWorkflowTemplateSteps(updates.steps);
  if (updates.is_active !== undefined) patch.is_active = updates.is_active;
  if (updates.display_order !== undefined) patch.display_order = updates.display_order;

  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from("workflow_library_templates")
    .update(patch)
    .eq("id", id);
  if (error) {
    if (error.code === "23505") throw new Error("A template with this name already exists");
    throw new Error(error.message);
  }
  revalidatePath("/admin");
}

export async function deleteLibraryTemplate(id: string) {
  const { supabase } = await requireAdmin();
  validateUuid(id, "Template ID");

  const { error } = await supabase
    .from("workflow_library_templates")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}
