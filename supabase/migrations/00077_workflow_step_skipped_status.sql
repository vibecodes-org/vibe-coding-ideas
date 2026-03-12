-- Add 'skipped' status to task_workflow_steps
-- Allows agents/users to skip steps that aren't applicable to a task

-- 1. Update the CHECK constraint to include 'skipped'
ALTER TABLE task_workflow_steps
  DROP CONSTRAINT IF EXISTS task_workflow_steps_status_check;

ALTER TABLE task_workflow_steps
  ADD CONSTRAINT task_workflow_steps_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'awaiting_approval', 'skipped'));

-- 2. Update the step count trigger to count skipped steps as completed (resolved)
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
    workflow_step_total = (SELECT count(*) FROM task_workflow_steps WHERE task_id = target_task_id),
    workflow_step_completed = (SELECT count(*) FROM task_workflow_steps WHERE task_id = target_task_id AND status IN ('completed', 'skipped'))
  WHERE id = target_task_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
