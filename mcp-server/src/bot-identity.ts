import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database";

/**
 * Resolve a user's active agent identity from the DB (`users.active_bot_id`) —
 * the single source of truth, written by the `set_agent_identity` tool.
 *
 * This MUST be called per request and NEVER cached in instance memory. The
 * remote (HTTP) MCP runs on serverless instances that fan out across requests,
 * so any in-memory cache of the active bot goes stale the moment a later tool
 * call lands on a different instance. That was the cause of spurious
 * `complete_step`/`fail_step` identity-mismatch resets: `set_agent_identity`
 * persisted the new bot to the DB, but a follow-up `complete_step` on another
 * instance read a stale cached identity instead of the DB.
 *
 * Returns the active bot id, or `null` if no bot is set or the configured bot is
 * inactive — in which case the caller acts as the real (owner) user.
 */
export async function resolveActiveBotId(
  client: SupabaseClient<Database>,
  realUserId: string
): Promise<string | null> {
  const { data: userRow } = await client
    .from("users")
    .select("active_bot_id")
    .eq("id", realUserId)
    .maybeSingle();

  if (!userRow?.active_bot_id) return null;

  // Defensively confirm the bot is still active (it may have been deactivated
  // after it was set as the active identity).
  const { data: bot } = await client
    .from("bot_profiles")
    .select("id, is_active")
    .eq("id", userRow.active_bot_id)
    .maybeSingle();

  return bot?.is_active ? bot.id : null;
}
