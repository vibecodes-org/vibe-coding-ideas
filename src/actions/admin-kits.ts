"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type ProjectKit = Database["public"]["Tables"]["project_kits"]["Row"];
type ProjectKitInsert = Database["public"]["Tables"]["project_kits"]["Insert"];
type ProjectKitUpdate = Database["public"]["Tables"]["project_kits"]["Update"];

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: profile } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) throw new Error("Admin access required");
  return { supabase, user };
}

export async function listAllKits(): Promise<ProjectKit[]> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("project_kits")
    .select("*")
    .order("display_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectKit[];
}

export async function createKit(
  kit: Omit<ProjectKitInsert, "id" | "created_at" | "updated_at">
): Promise<ProjectKit> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("project_kits")
    .insert(kit)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  return data as ProjectKit;
}

export async function updateKit(
  id: string,
  updates: Omit<ProjectKitUpdate, "id" | "created_at" | "updated_at">
): Promise<ProjectKit> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("project_kits")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  return data as ProjectKit;
}

export async function deleteKit(id: string): Promise<void> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("project_kits")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}
