-- Prevent multiple active workflow runs on the same task.
-- Only one non-terminal (not completed/failed) run is allowed per task.
CREATE UNIQUE INDEX idx_unique_active_workflow_run
  ON workflow_runs (task_id)
  WHERE status NOT IN ('completed', 'failed');
