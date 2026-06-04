import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database";

export interface McpContext {
  supabase: SupabaseClient<Database>;
  userId: string;
  ownerUserId?: string;
  /**
   * Per-connection identifier for the remote (HTTP) MCP, derived from the
   * caller's JWT. When set, agent identity is scoped to this session
   * (mcp_agent_sessions) so concurrent connections don't clobber each other.
   * Undefined for the local stdio MCP, which uses users.active_bot_id.
   */
  sessionId?: string;
}
