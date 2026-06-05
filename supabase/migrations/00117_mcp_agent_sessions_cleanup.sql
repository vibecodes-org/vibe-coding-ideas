-- Weekly cleanup of stale per-connection agent-identity rows.
--
-- mcp_agent_sessions gains a row per MCP connection that sets an identity,
-- keyed by the connection's auth session. Connections churn (re-auths, token
-- rotations, parallel Claude Code instances) and rows for dead sessions linger.
-- Rows untouched for 30 days belong to long-dead sessions (token lifetime is
-- hours); active connections refresh updated_at on every set_agent_identity.
-- Supporting index: idx_mcp_agent_sessions_updated_at (created in 00115).
-- pg_cron extension enabled + granted in 00091.

SELECT cron.schedule(
  'cleanup-mcp-agent-sessions',
  '0 4 * * 0',  -- weekly, Sunday 04:00 UTC
  $$DELETE FROM mcp_agent_sessions WHERE updated_at < now() - interval '30 days'$$
);
