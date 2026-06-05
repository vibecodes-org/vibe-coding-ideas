import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database";

export interface McpContext {
  supabase: SupabaseClient<Database>;
  userId: string;
  ownerUserId?: string;
  /**
   * Per-connection identifier scoping agent identity (mcp_agent_sessions) so
   * concurrent connections don't clobber each other. Remote (HTTP) MCP derives
   * it from the caller's JWT; stdio uses a static per-install key. Set by every
   * transport's context builder.
   */
  sessionId?: string;
}
