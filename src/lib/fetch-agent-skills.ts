// The one read of an agent's skills for the Skills section (task d04408b0).
// claim_next_step and the in-app terminal's session-agents route both use it,
// so the two can't drift apart on order or cap: the section they build (and
// the match tag hashed from it) comes out identical for the same rows.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { SkillText } from "@/lib/skills-section";

/**
 * Hard ceiling on rows read in one go. Not the per-agent send cap
 * (MAX_SKILLS_PER_AGENT, applied in buildSkillsSection, which names the extras):
 * this only keeps the query bounded.
 */
export const SKILLS_READ_LIMIT = 1000;

/**
 * Skills for each bot in `botIds`, oldest first (id breaks ties so two skills
 * created in one statement always come back in the same order). Every id gets
 * an entry, empty when it has none. Throws if the read fails, so a caller never
 * mistakes an error for "this agent has no skills".
 */
export async function fetchAgentSkills(
  supabase: SupabaseClient<Database>,
  botIds: string[],
): Promise<Map<string, SkillText[]>> {
  const byBot = new Map<string, SkillText[]>(botIds.map((id) => [id, []]));
  if (botIds.length === 0) return byBot;

  const { data, error } = await supabase
    .from("agent_skills")
    .select("bot_id, name, content")
    .in("bot_id", botIds)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(SKILLS_READ_LIMIT);
  if (error) throw new Error(`Failed to read the agent's skills: ${error.message}`);

  for (const row of data ?? []) {
    byBot.get(row.bot_id)?.push({ name: row.name, content: row.content });
  }
  return byBot;
}
