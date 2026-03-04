"use server";

import { createClient } from "@/lib/supabase/server";

// ── Grant Starter Credits ───────────────────────────────────────────────

export async function grantStarterCredits(userId: string, credits: number) {
  if (!Number.isInteger(credits) || credits < 1 || credits > 100) {
    throw new Error("Credits must be an integer between 1 and 100");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Verify admin
  const { data: profile } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) throw new Error("Admin access required");

  const { error } = await supabase.rpc("grant_starter_credits", {
    p_user_id: userId,
    p_credits: credits,
  });

  if (error) throw new Error(error.message);
}
