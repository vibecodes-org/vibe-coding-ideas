-- Card 1553d11e: remember which model and effort a step's claim asked for.
--
-- claim_next_step works the model out live from the user's settings. Whether
-- the step then "followed the setting" used to be judged against the settings
-- at completion time, so a change made while the step ran could flip the
-- verdict. The claim now saves what it asked for, and completion judges
-- against that.
--
-- Both nullable, no backfill: older steps keep the live comparison. Free text,
-- length-capped, not enum-constrained (mirrors executed_model, migration
-- 00171): a new model family needs no schema change.

ALTER TABLE task_workflow_steps
  ADD COLUMN IF NOT EXISTS directed_model TEXT,
  ADD COLUMN IF NOT EXISTS directed_effort TEXT;

ALTER TABLE task_workflow_steps
  DROP CONSTRAINT IF EXISTS task_workflow_steps_directed_model_check;

ALTER TABLE task_workflow_steps
  ADD CONSTRAINT task_workflow_steps_directed_model_check
  CHECK (directed_model IS NULL OR length(directed_model) <= 100);

ALTER TABLE task_workflow_steps
  DROP CONSTRAINT IF EXISTS task_workflow_steps_directed_effort_check;

ALTER TABLE task_workflow_steps
  ADD CONSTRAINT task_workflow_steps_directed_effort_check
  CHECK (directed_effort IS NULL OR length(directed_effort) <= 100);

COMMENT ON COLUMN task_workflow_steps.directed_model IS
  'The model the claim directed for this step (after any model-unavailable switch), saved at claim time. complete_step and fail_step judge tier_honored against it instead of the settings live at completion. NULL on steps claimed before this column existed, on Auto steps, and when the best-effort write failed.';

COMMENT ON COLUMN task_workflow_steps.directed_effort IS
  'The reasoning effort the claim directed for this step, saved with directed_model.';
