-- Add active agent name column to board_tasks for display on task cards
ALTER TABLE board_tasks
  ADD COLUMN workflow_active_agent_name text;

-- Update trigger to also maintain the active agent name
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
    ),
    workflow_active_agent_name = (
      SELECT bp.name FROM task_workflow_steps tws
      JOIN bot_profiles bp ON bp.id = tws.bot_id
      WHERE tws.task_id = target_task_id
        AND tws.status = 'in_progress'
      ORDER BY tws.started_at DESC NULLS LAST
      LIMIT 1
    )
  WHERE id = target_task_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Backfill existing data
UPDATE board_tasks bt SET
  workflow_active_agent_name = (
    SELECT bp.name FROM task_workflow_steps tws
    JOIN bot_profiles bp ON bp.id = tws.bot_id
    WHERE tws.task_id = bt.id
      AND tws.status = 'in_progress'
    ORDER BY tws.started_at DESC NULLS LAST
    LIMIT 1
  )
WHERE workflow_step_in_progress > 0;
