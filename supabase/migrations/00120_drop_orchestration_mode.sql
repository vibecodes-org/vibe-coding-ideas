-- Retire the per-session orchestration toggle (task bd13ee8f).
--
-- Subagent orchestration is now the ONLY mode: claim_next_step always returns
-- the subagent instruction, and the set_orchestration_mode tool +
-- resolveOrchestrationMode reader have been removed. Nothing in the codebase
-- references this column any more.
--
-- TWO-PHASE: deploy the column-free code FIRST, then apply this drop. (The
-- reverse of adding it — the live code must already not read/write the column.)
ALTER TABLE mcp_agent_sessions
  DROP COLUMN IF EXISTS orchestration_mode;
