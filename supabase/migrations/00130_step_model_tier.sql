-- P2: Per-step model tiering.
-- Adds an advisory `model_tier` hint to workflow steps. The orchestrator uses it
-- to decide which Claude model runs a step's subagent. Purely advisory — it never
-- blocks execution. Default is NULL (= "Auto", orchestrator decides). Additive,
-- nullable, no backfill.

ALTER TABLE task_workflow_steps
  ADD COLUMN model_tier TEXT;

ALTER TABLE task_workflow_steps
  ADD CONSTRAINT task_workflow_steps_model_tier_check
  CHECK (model_tier IS NULL OR model_tier IN ('frontier', 'standard', 'cheap'));

COMMENT ON COLUMN task_workflow_steps.model_tier IS
  'Advisory per-step model tier hint (frontier | standard | cheap). NULL = Auto — the orchestrator picks the model. Never blocks execution.';
