-- Surface the attached workflow's template name on board_tasks so task cards
-- can label the workflow chip (idle state) without an extra per-card query.
-- Denormalized + trigger-maintained, mirroring the existing workflow_step_* columns.
ALTER TABLE board_tasks
  ADD COLUMN workflow_template_name text;

-- Extend the existing step-count trigger to also maintain the template name.
-- The name is resolved from the task's active (not completed/failed) workflow
-- run -> template. Steps are inserted/deleted alongside runs, so this trigger
-- (which fires on task_workflow_steps changes) sees the name appear and clear
-- in step with the counts it already maintains.
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
    ),
    workflow_template_name = (
      SELECT wt.name FROM workflow_runs wr
      JOIN workflow_templates wt ON wt.id = wr.template_id
      WHERE wr.task_id = target_task_id
        AND wr.status NOT IN ('completed', 'failed')
      ORDER BY wr.created_at DESC
      LIMIT 1
    )
  WHERE id = target_task_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Backfill existing tasks that currently have an active run.
UPDATE board_tasks bt SET
  workflow_template_name = (
    SELECT wt.name FROM workflow_runs wr
    JOIN workflow_templates wt ON wt.id = wr.template_id
    WHERE wr.task_id = bt.id
      AND wr.status NOT IN ('completed', 'failed')
    ORDER BY wr.created_at DESC
    LIMIT 1
  )
WHERE workflow_step_total > 0;
