"use server";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type TierAdherenceSummaryRow = Database["public"]["Views"]["workflow_tier_adherence"]["Row"];
export type TierAdherenceStepRow = Database["public"]["Views"]["workflow_tier_adherence_steps"]["Row"];

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
  return { supabase };
}

/**
 * P2c admin "Tier Adherence" card data (Design-Review CONDITION 3). Purely
 * read-only reporting over the two self-reported adherence views (migration
 * 00135) — no destructive ops, so gated the same as the rest of the admin
 * dashboard's reporting cards (is_admin), not is_super_admin.
 *
 * Both reads are bounded (order + limit) so this never becomes an unbounded
 * SELECT as adherence data accumulates over time.
 */
export async function getTierAdherenceReport(): Promise<{
  summary: TierAdherenceSummaryRow[];
  steps: TierAdherenceStepRow[];
}> {
  const { supabase } = await requireAdmin();

  const [{ data: summary, error: summaryError }, { data: steps, error: stepsError }] = await Promise.all([
    supabase
      .from("workflow_tier_adherence")
      .select("*")
      .order("week", { ascending: false })
      .limit(500),
    supabase
      .from("workflow_tier_adherence_steps")
      .select("*")
      .order("completed_at", { ascending: false })
      .limit(500),
  ]);

  if (summaryError) throw new Error(summaryError.message);
  if (stepsError) throw new Error(stepsError.message);

  return { summary: summary ?? [], steps: steps ?? [] };
}
