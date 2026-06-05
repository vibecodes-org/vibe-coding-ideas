-- Retire users.active_bot_id (introduced in 00037) — agent identity now lives
-- solely in mcp_agent_sessions, keyed per connection (remote: JWT session;
-- stdio: static per-install key). Identity is attribution-only since the
-- claim-token release (00116); no production code reads this column anymore.
--
-- SEQUENCING: apply ONLY AFTER the code deploy that removed all readers is
-- live (otherwise old in-flight instances selecting the column will 500).

ALTER TABLE users DROP COLUMN IF EXISTS active_bot_id;
