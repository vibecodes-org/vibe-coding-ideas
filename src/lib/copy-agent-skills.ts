// Copying an agent copies its filed skills (task d04408b0). The three clone
// routines (cloneBotProfile in src/actions/bots.ts, MCP clone_agent, MCP kit
// apply) used to copy the persona, bio and tags only, which is how a prompt
// citing a skill spread to copies that never owned it.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { logger } from "@/lib/logger";
import { SKILLS_READ_LIMIT } from "@/lib/fetch-agent-skills";

/**
 * Copy every skill of `sourceBotId` onto `newBotId` (a bot the caller owns,
 * created a moment ago). Skills keep their original created_at so the order
 * agents read them in is preserved (every skill is copied; the per-agent send
 * cap only applies when skills are sent to a step); the copy is a snapshot, so later edits to
 * the original don't flow through, same as the persona.
 *
 * If the copy fails, the half-made agent is deleted and the error is thrown:
 * a silently skill-less copy is exactly the bug this exists to prevent.
 * Returns how many skills were copied.
 */
export async function copyAgentSkills(
  supabase: SupabaseClient<Database>,
  sourceBotId: string,
  newBotId: string,
  ownerId: string,
): Promise<number> {
  try {
    const { data: skills, error: readError } = await supabase
      .from("agent_skills")
      .select("name, description, content, source_url, source_type, category, created_at")
      .eq("bot_id", sourceBotId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(SKILLS_READ_LIMIT);
    if (readError) throw new Error(readError.message);
    if (!skills || skills.length === 0) return 0;

    const { error: insertError } = await supabase
      .from("agent_skills")
      .insert(skills.map((skill) => ({ ...skill, bot_id: newBotId })));
    if (insertError) throw new Error(insertError.message);
    return skills.length;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("Copying an agent's skills failed; discarding the copy", {
      sourceBotId,
      newBotId,
      error: message,
    });
    const { error: cleanupError } = await supabase.rpc("delete_bot_user", {
      p_bot_id: newBotId,
      p_owner_id: ownerId,
    });
    if (cleanupError) {
      logger.error("Couldn't discard the agent copy left without its skills", {
        newBotId,
        error: cleanupError.message,
      });
    }
    throw new Error(`Couldn't copy the agent's skills: ${message}`);
  }
}
