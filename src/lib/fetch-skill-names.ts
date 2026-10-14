// Names only of each agent's skills, for the one-line summaries (agent cards,
// profile pop-up, workflow steps). Same order as fetch-agent-skills.ts: oldest
// first, id as the tie-break.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { chunkIds } from "@/lib/db-helpers";
import { validateUuid } from "@/lib/validation";
import { SKILLS_READ_LIMIT } from "@/lib/fetch-agent-skills";

/**
 * bot id -> skill names. Every id gets an entry, empty when it has none. Throws
 * if a read fails, so an error never shows up as "No skills".
 */
export async function fetchSkillNamesByBot(
  supabase: SupabaseClient<Database>,
  botIds: readonly string[],
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = Object.fromEntries(botIds.map((id) => [id, []]));
  for (const chunk of chunkIds(botIds)) {
    const { data, error } = await supabase
      .from("agent_skills")
      .select("bot_id, name")
      .in("bot_id", chunk)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(SKILLS_READ_LIMIT);
    if (error) throw new Error(`Failed to read the agent's skills: ${error.message}`);
    for (const row of data ?? []) out[row.bot_id]?.push(row.name);
  }
  return out;
}

export const MAX_SKILL_NAME_LOOKUP = 50;

/** Validates and de-duplicates the ids sent to the skill-names lookup. Throws on a bad id or more than 50. */
export function normalizeBotIdList(botIds: readonly string[]): string[] {
  if (!Array.isArray(botIds)) throw new Error("Agent ids must be a list");
  const unique = [...new Set(botIds)];
  if (unique.length > MAX_SKILL_NAME_LOOKUP) {
    throw new Error(`At most ${MAX_SKILL_NAME_LOOKUP} agents at a time`);
  }
  return unique.map((id) => validateUuid(id, "Agent ID"));
}
