import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database";

/**
 * Resolve the caller's active agent identity — the bot they are currently
 * acting as, or null to act as the real (owner) user.
 *
 * Identity is attribution-only (workflow enforcement uses claim tokens) and
 * lives in ONE store: `mcp_agent_sessions`, keyed by (user_id, session_id).
 *  - Remote (HTTP) MCP: session_id derives from the caller's JWT — each
 *    connection gets a dedicated Supabase session (api/oauth/token), so
 *    concurrent connections never share a slot.
 *  - Local (stdio) MCP: a static per-install key (`stdio:<bot-user-id>`).
 *
 * Read fresh on every call — never cached in instance memory (serverless
 * instances fan out across requests). Returns the active bot id, or null if
 * none is set or the bot is inactive.
 */
export async function resolveActiveBotId(
  client: SupabaseClient<Database>,
  userId: string,
  sessionId: string
): Promise<string | null> {
  const { data } = await client
    .from("mcp_agent_sessions")
    .select("active_bot_id")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .maybeSingle();

  const activeBotId = data?.active_bot_id ?? null;
  if (!activeBotId) return null;

  // Defensively confirm the bot is still active (it may have been deactivated
  // after it was set as the active identity).
  const { data: bot } = await client
    .from("bot_profiles")
    .select("id, is_active")
    .eq("id", activeBotId)
    .maybeSingle();

  return bot?.is_active ? bot.id : null;
}
