-- Codex model-tier task, FR-8 (telemetry). A step's self-reported "how it
-- actually ran" now includes a reasoning EFFORT level alongside the existing
-- executed_model, for BOTH agents (Nick's approval-gate note 2 — effort is a
-- separate stored field for Claude too, not just Codex). Do NOT widen the
-- 40-char model_used column for this — it's a distinct concept (a model, not
-- a reasoning-effort level) and conflating them would make "honored" checks
-- ambiguous. Mirrors 00135_step_executed_model.sql's shape (nullable text +
-- CHECK, self-reported/never-verified telemetry).
--
-- Also fixes a latent bug in the existing executed_model column: migration
-- 00135 added a CHECK restricting it to the 4 Claude aliases + 'other'/
-- 'unknown', but mcp-server/src/tools/workflows.ts's completeStepSchema (see
-- its "OQ1" comment) has documented model_used as free text ever since —
-- "a novel platform-default model family can be honestly self-reported" —
-- and that migration was never followed up with a constraint relaxation.
-- This went unnoticed for Claude-only aliases (which always satisfied the
-- old CHECK) but would hard-reject every Codex model id (e.g.
-- 'gpt-5.1-codex') at the database layer the moment an agent-aware step
-- reports one via complete_step/fail_step — replacing it here is required
-- for this task's FR-3/FR-8 to actually work end-to-end, not just an
-- unrelated cleanup.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS before every ADD CONSTRAINT, and
-- guard the ADD COLUMN so a re-run (e.g. after this file was reverted and
-- recreated) never errors.

ALTER TABLE task_workflow_steps
  DROP CONSTRAINT IF EXISTS task_workflow_steps_executed_model_check;

ALTER TABLE task_workflow_steps
  ADD CONSTRAINT task_workflow_steps_executed_model_check
  CHECK (executed_model IS NULL OR length(executed_model) <= 100);

ALTER TABLE task_workflow_steps
  ADD COLUMN IF NOT EXISTS reasoning_effort_used TEXT;

ALTER TABLE task_workflow_steps
  DROP CONSTRAINT IF EXISTS task_workflow_steps_reasoning_effort_used_check;

ALTER TABLE task_workflow_steps
  ADD CONSTRAINT task_workflow_steps_reasoning_effort_used_check
  CHECK (reasoning_effort_used IS NULL OR reasoning_effort_used IN ('low', 'medium', 'high', 'unknown'));

COMMENT ON COLUMN task_workflow_steps.reasoning_effort_used IS
  'Self-reported: the reasoning-effort level (low/medium/high, or "unknown") the step''s subagent/session actually ran with — Claude and Codex both carry an effort value now, not just a model. Paired with executed_model/tier_honored (00135_step_executed_model.sql): tier_honored now additionally requires the reported effort to match the resolved tier''s effort for the agent that ran the step (NULL when effort wasn''t reported — never a false "not honored" on that basis alone). Self-reported telemetry, never hard verification — see TIER_ADHERENCE_DISCLOSURE in src/lib/constants.ts.';
