import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database";
import { logger } from "../../src/lib/logger";

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

/** Orchestration modes a session can run workflow steps under. */
export type OrchestrationMode = "legacy" | "subagent";

/**
 * Resolve the session's orchestration mode (Phase II Slice 1) — how
 * claim_next_step should instruct the orchestrator to run a step.
 *
 * Per-session, like the active identity: stored on mcp_agent_sessions keyed by
 * (user_id, session_id), so flipping it in one connection never affects another.
 * Read fresh on every call (no instance cache). Fails SAFE: a missing row, NULL,
 * an unrecognised value, OR a query error all resolve to "legacy" (current
 * production behaviour).
 *
 * IMPORTANT: `userId` MUST be the OWNER id (`ctx.ownerUserId ?? ctx.userId`),
 * matching the write key in setOrchestrationMode. Passing the active bot's id
 * would read the wrong row and silently fall back to legacy.
 */
export async function resolveOrchestrationMode(
  client: SupabaseClient<Database>,
  userId: string,
  sessionId: string | undefined
): Promise<OrchestrationMode> {
  if (!sessionId) return "legacy";

  const { data, error } = await client
    .from("mcp_agent_sessions")
    .select("orchestration_mode")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) {
    // Fail safe to legacy, but don't do it silently — a DB blip dropping a
    // subagent-mode session back to legacy should be diagnosable.
    logger.warn("resolveOrchestrationMode query failed — defaulting to legacy", {
      error: error.message,
    });
    return "legacy";
  }

  return data?.orchestration_mode === "subagent" ? "subagent" : "legacy";
}
