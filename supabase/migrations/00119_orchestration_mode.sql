-- Phase II Slice 1: per-session orchestration mode toggle.
--
-- Adds an opt-in switch, scoped to the individual MCP connection, that selects
-- how workflow steps are run:
--   'legacy'   — one session role-plays each persona via set_agent_identity
--                (current production behaviour; the default).
--   'subagent' — claim_next_step instructs the orchestrator to spawn a fresh
--                subagent per step, with the persona as its real system prompt.
--
-- Stored on mcp_agent_sessions (keyed by user_id, session_id) so flipping it in
-- one Claude session never affects any other session. Anything unset or
-- unrecognised resolves to 'legacy' in code, so the safe path is the default.
ALTER TABLE mcp_agent_sessions
  ADD COLUMN orchestration_mode text NOT NULL DEFAULT 'legacy'
    CHECK (orchestration_mode IN ('legacy', 'subagent'));
