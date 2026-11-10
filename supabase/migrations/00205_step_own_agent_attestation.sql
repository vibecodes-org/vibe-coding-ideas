-- Did this step really run in its own agent? (card 24936814)
--
-- Claude Code reports which agent made a board call (an http hook inside each
-- board agent's definition posts to /api/workflow/attest). The report is kept
-- on the step while it runs; complete_step / fail_step turn it into
-- ran_in_own_agent, which the step dialog shows. Evidence from Claude Code,
-- not proof.
--
--   attested_agent_type  the agent type that made the board call (e.g. vc-atlas-37e8ffb2-standard)
--   attested_agent_id    Claude Code's id for that agent run
--   attested_at          when the report arrived
--   ran_in_own_agent     confirmed | other_agent | not_confirmed | cant_confirm
--
-- Tables/columns used (all exist; checked against 00156 and 00200):
--   task_workflow_steps (adds four nullable columns; no policy change).
-- 00200_step_effort_override's replace-unstarted-run function copies template
-- columns by name only, so it does not need the new ones.

ALTER TABLE task_workflow_steps
  ADD COLUMN attested_agent_type text,
  ADD COLUMN attested_agent_id text,
  ADD COLUMN attested_at timestamptz,
  ADD COLUMN ran_in_own_agent text
    CHECK (ran_in_own_agent IN ('confirmed', 'other_agent', 'not_confirmed', 'cant_confirm'));

COMMENT ON COLUMN task_workflow_steps.attested_agent_type IS
  'Agent type Claude Code reported for a board call carrying this step''s work token. Cleared on every re-claim and reset.';
COMMENT ON COLUMN task_workflow_steps.attested_agent_id IS
  'Claude Code''s id for the agent run that made the reported call. Cleared with attested_agent_type.';
COMMENT ON COLUMN task_workflow_steps.attested_at IS
  'When the agent report arrived. Cleared with attested_agent_type.';
COMMENT ON COLUMN task_workflow_steps.ran_in_own_agent IS
  'Set at complete_step / fail_step: confirmed (the step''s own board agent reported in), other_agent (a different agent reported in), not_confirmed (no agent reported in), cant_confirm (Codex, or the claim named no board agent). NULL for steps finished before 00205.';
