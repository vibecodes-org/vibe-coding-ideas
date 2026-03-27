-- Add workflow status indicator columns to board_tasks
-- These denormalized columns enable task cards to show workflow status at a glance
-- without needing to join task_workflow_steps at board fetch time.

ALTER TABLE board_tasks
  ADD COLUMN workflow_step_in_progress integer NOT NULL DEFAULT 0,
  ADD COLUMN workflow_step_failed integer NOT NULL DEFAULT 0,
  ADD COLUMN workflow_step_awaiting_approval integer NOT NULL DEFAULT 0,
  ADD COLUMN workflow_step_started_at timestamptz,
  ADD COLUMN workflow_active_step_title text;

-- Update the existing trigger to also maintain the new columns
CREATE OR REPLACE FUNCTION update_workflow_step_counts()
RETURNS trigger AS $$
DECLARE
  target_task_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_task_id := OLD.task_id;
  ELSE
    target_task_id := NEW.task_id;
  END IF;

  UPDATE board_tasks SET
    workflow_step_total = (
      SELECT count(*) FROM task_workflow_steps WHERE task_id = target_task_id
    ),
    workflow_step_completed = (
      SELECT count(*) FROM task_workflow_steps WHERE task_id = target_task_id AND status IN ('completed', 'skipped')
    ),
    workflow_step_in_progress = (
      SELECT count(*) FROM task_workflow_steps WHERE task_id = target_task_id AND status = 'in_progress'
    ),
    workflow_step_failed = (
      SELECT count(*) FROM task_workflow_steps WHERE task_id = target_task_id AND status = 'failed'
    ),
    workflow_step_awaiting_approval = (
      SELECT count(*) FROM task_workflow_steps WHERE task_id = target_task_id AND status = 'awaiting_approval'
    ),
    workflow_step_started_at = (
      SELECT min(started_at) FROM task_workflow_steps WHERE task_id = target_task_id AND status = 'in_progress'
    ),
    workflow_active_step_title = (
      SELECT title FROM task_workflow_steps
      WHERE task_id = target_task_id
        AND status IN ('failed', 'awaiting_approval', 'in_progress')
      ORDER BY
        CASE status
          WHEN 'failed' THEN 1
          WHEN 'awaiting_approval' THEN 2
          WHEN 'in_progress' THEN 3
        END
      LIMIT 1
    )
  WHERE id = target_task_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Backfill existing data
UPDATE board_tasks bt SET
  workflow_step_in_progress = (
    SELECT count(*) FROM task_workflow_steps WHERE task_id = bt.id AND status = 'in_progress'
  ),
  workflow_step_failed = (
    SELECT count(*) FROM task_workflow_steps WHERE task_id = bt.id AND status = 'failed'
  ),
  workflow_step_awaiting_approval = (
    SELECT count(*) FROM task_workflow_steps WHERE task_id = bt.id AND status = 'awaiting_approval'
  ),
  workflow_step_started_at = (
    SELECT min(started_at) FROM task_workflow_steps WHERE task_id = bt.id AND status = 'in_progress'
  ),
  workflow_active_step_title = (
    SELECT title FROM task_workflow_steps
    WHERE task_id = bt.id
      AND status IN ('failed', 'awaiting_approval', 'in_progress')
    ORDER BY
      CASE status
        WHEN 'failed' THEN 1
        WHEN 'awaiting_approval' THEN 2
        WHEN 'in_progress' THEN 3
      END
    LIMIT 1
  )
WHERE workflow_step_total > 0;
