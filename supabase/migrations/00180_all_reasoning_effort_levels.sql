-- Offer ALL reasoning-effort levels, not just low/medium/high (Nick, 8 Oct
-- 2026). Claude Code's ladder is low/medium/high/xhigh/max; Codex's is
-- minimal/low/medium/high/xhigh. 00171 limited the self-reported
-- reasoning_effort_used to the old 3-level placeholder, so a step that ran at
-- (say) xhigh or max would be rejected at the database layer on
-- complete_step/fail_step. Widen the CHECK to the union of both ladders.
--
-- Widening only — every existing value still passes. Idempotent.

ALTER TABLE task_workflow_steps
  DROP CONSTRAINT IF EXISTS task_workflow_steps_reasoning_effort_used_check;

ALTER TABLE task_workflow_steps
  ADD CONSTRAINT task_workflow_steps_reasoning_effort_used_check
  CHECK (reasoning_effort_used IS NULL OR reasoning_effort_used IN ('minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'unknown'));

COMMENT ON COLUMN task_workflow_steps.reasoning_effort_used IS
  'Self-reported: the reasoning-effort level the step''s subagent/session actually ran with — Claude: low/medium/high/xhigh/max; Codex: minimal/low/medium/high/xhigh; or "unknown". Paired with executed_model/tier_honored (00135_step_executed_model.sql): tier_honored additionally requires the reported effort to match the resolved tier''s effort for the agent that ran the step (NULL when effort wasn''t reported — never a false "not honored" on that basis alone). Self-reported telemetry, never hard verification — see TIER_ADHERENCE_DISCLOSURE in src/lib/constants.ts.';
