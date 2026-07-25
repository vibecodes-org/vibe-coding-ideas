-- Records how faithfully the orchestrator SELF-REPORTS its subagent used the
-- persona_prompt embedded in claim_next_step. Telemetry, not verification —
-- VibeCodes never inspects the spawned system prompt (no hash; Phase II boundary).
-- Additive, nullable, no backfill. NULL != false.
--
-- persona_used / persona_honored mirror the existing executed_model /
-- tier_honored pair (00135_step_executed_model.sql) — same shape, same
-- self-reported-not-enforced posture.
--
-- skills_used (Nick's amendment on the approved design): the names of the
-- skills the executing subagent actually loaded via get_agent_skill_content
-- for this step, self-reported alongside persona_used/model_used on the same
-- complete_step/fail_step call. NULL = not reported; empty array = explicitly
-- none loaded (a step can have available_skills and legitimately use none).

ALTER TABLE task_workflow_steps
  ADD COLUMN persona_used TEXT,
  ADD COLUMN persona_honored BOOLEAN,
  ADD COLUMN skills_used TEXT[];

ALTER TABLE task_workflow_steps
  ADD CONSTRAINT task_workflow_steps_persona_used_check
  CHECK (persona_used IS NULL OR persona_used IN ('verbatim', 'adapted', 'none'));

COMMENT ON COLUMN task_workflow_steps.persona_used IS
  'Self-reported via complete_step/fail_step persona_used param: verbatim|adapted|none. NULL = not reported. Never verified.';
COMMENT ON COLUMN task_workflow_steps.persona_honored IS
  'Derived: verbatim -> true, adapted|none -> false, omitted -> NULL. NULL != false. Self-reported, not enforced.';
COMMENT ON COLUMN task_workflow_steps.skills_used IS
  'Self-reported via complete_step/fail_step skills_used param: names of the skills whose content was actually loaded for this step. NULL = not reported. Empty array = explicitly none loaded. Never verified.';
