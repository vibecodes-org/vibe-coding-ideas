import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database";

/**
 * Resolve the caller's active agent identity — the bot they are currently
 * acting as, or null to act as the real (owner) user.
 *
 * Identity is read fresh from the DB on every call (never cached in instance
 * memory): the remote MCP runs on stateless serverless instances that fan out
 * across requests, so a cached value goes stale on a different instance.
 *
 * Scoping depends on transport:
 *  - Remote (HTTP): `sessionId` is set (derived from the caller's JWT). Identity
 *    is per-connection, stored in `mcp_agent_sessions` keyed by
 *    (user_id, session_id). This isolates concurrent connections that
 *    authenticate as the same user, so they cannot clobber each other.
 *  - Local (stdio): `sessionId` is undefined. Identity is the legacy
 *    per-user `users.active_bot_id`.
 *
 * Returns the active bot id, or null if none is set or the bot is inactive.
 */
export async function resolveActiveBotId(
  client: SupabaseClient<Database>,
  userId: string,
  sessionId?: string
): Promise<string | null> {
  let activeBotId: string | null = null;

  if (sessionId) {
    const { data } = await client
      .from("mcp_agent_sessions")
      .select("active_bot_id")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .maybeSingle();
    activeBotId = data?.active_bot_id ?? null;
  } else {
    const { data } = await client
      .from("users")
      .select("active_bot_id")
      .eq("id", userId)
      .maybeSingle();
    activeBotId = data?.active_bot_id ?? null;
  }

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
