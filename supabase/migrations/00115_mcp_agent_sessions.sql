-- Per-connection MCP agent identity.
--
-- Previously the active agent identity was stored in a single column
-- (users.active_bot_id), keyed only by the human user. Multiple concurrent MCP
-- connections authenticated as the same user (e.g. several Claude Code sessions,
-- each working a different idea board) therefore CLOBBERED each other's identity:
-- set_agent_identity in one session overwrote the value every other session read
-- back in complete_step, causing spurious identity-mismatch resets.
--
-- This table scopes the active identity to the individual connection. The remote
-- (HTTP) MCP keys rows by (user_id, session_id) where session_id is derived from
-- the caller's JWT (the Supabase `session_id` claim, with a token hash fallback),
-- so concurrent sessions never share a slot. The local stdio MCP has no session
-- and continues to use users.active_bot_id.

CREATE TABLE mcp_agent_sessions (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id    text NOT NULL,
  active_bot_id uuid REFERENCES bot_profiles(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, session_id)
);

-- Supports periodic cleanup of stale sessions by age.
CREATE INDEX idx_mcp_agent_sessions_updated_at ON mcp_agent_sessions (updated_at);

ALTER TABLE mcp_agent_sessions ENABLE ROW LEVEL SECURITY;

-- A user may only read/write their own session identity rows. The service-role
-- client (used for tool-log attribution) bypasses RLS.
CREATE POLICY "Users manage own agent sessions"
  ON mcp_agent_sessions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
