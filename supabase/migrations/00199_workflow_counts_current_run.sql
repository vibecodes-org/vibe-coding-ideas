-- Board card counters count only the card's live (newest) workflow run.
-- The rule MUST match pickCurrentRunKey in src/lib/workflow-current-run.ts:
-- newest run by its latest step created_at; ties go to the larger run id.
-- Change both together.
CREATE OR REPLACE FUNCTION public.workflow_live_run_id(p_task_id uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT run_id FROM task_workflow_steps
  WHERE task_id = p_task_id
  GROUP BY run_id
  ORDER BY max(created_at) DESC NULLS LAST, run_id DESC NULLS LAST
  LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.workflow_live_run_id(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION update_workflow_step_counts()
RETURNS trigger AS $$
DECLARE
  target_task_id uuid;
  live uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_task_id := OLD.task_id;
  ELSE
    target_task_id := NEW.task_id;
  END IF;

  live := workflow_live_run_id(target_task_id);

  UPDATE board_tasks SET
    workflow_step_total = (
      SELECT count(*) FROM task_workflow_steps
      WHERE task_id = target_task_id AND run_id IS NOT DISTINCT FROM live
    ),
    workflow_step_completed = (
      SELECT count(*) FROM task_workflow_steps
      WHERE task_id = target_task_id AND run_id IS NOT DISTINCT FROM live
        AND status IN ('completed', 'skipped')
    ),
    workflow_step_in_progress = (
      SELECT count(*) FROM task_workflow_steps
      WHERE task_id = target_task_id AND run_id IS NOT DISTINCT FROM live
        AND status = 'in_progress'
    ),
    workflow_step_failed = (
      SELECT count(*) FROM task_workflow_steps
      WHERE task_id = target_task_id AND run_id IS NOT DISTINCT FROM live
        AND status = 'failed'
    ),
    workflow_step_awaiting_approval = (
      SELECT count(*) FROM task_workflow_steps
      WHERE task_id = target_task_id AND run_id IS NOT DISTINCT FROM live
        AND status = 'awaiting_approval'
    ),
    workflow_step_started_at = (
      SELECT min(started_at) FROM task_workflow_steps
      WHERE task_id = target_task_id AND run_id IS NOT DISTINCT FROM live
        AND status = 'in_progress'
    ),
    workflow_active_step_title = (
      SELECT title FROM task_workflow_steps
      WHERE task_id = target_task_id AND run_id IS NOT DISTINCT FROM live
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
      WHERE tws.task_id = target_task_id AND tws.run_id IS NOT DISTINCT FROM live
        AND tws.status = 'in_progress'
      ORDER BY tws.started_at DESC NULLS LAST
      LIMIT 1
    ),
    workflow_template_name = (
      SELECT wt.name FROM workflow_runs wr
      JOIN workflow_templates wt ON wt.id = wr.template_id
      WHERE wr.id = live
        AND wr.status NOT IN ('completed', 'failed')
    )
  WHERE id = target_task_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- One-off recount for cards that have more than one run. Only cards whose
-- values change are touched, and their updated_at is left alone (lists sort
-- by it), so the stamping trigger is switched off for the statement.
ALTER TABLE board_tasks DISABLE TRIGGER set_board_tasks_updated_at;

WITH live AS (
  SELECT t.id AS task_id, workflow_live_run_id(t.id) AS run_id
  FROM board_tasks t
  -- Only cards with more than one run can have inflated numbers. Single-run
  -- cards are left alone (their stored template name is a separate, older drift).
  WHERE (SELECT count(DISTINCT s.run_id) FROM task_workflow_steps s WHERE s.task_id = t.id) > 1
), calc AS (
  SELECT
    l.task_id,
    l.run_id,
    count(*)::int AS total,
    count(*) FILTER (WHERE s.status IN ('completed', 'skipped'))::int AS done,
    count(*) FILTER (WHERE s.status = 'in_progress')::int AS inprog,
    count(*) FILTER (WHERE s.status = 'failed')::int AS failed,
    count(*) FILTER (WHERE s.status = 'awaiting_approval')::int AS awaiting,
    min(s.started_at) FILTER (WHERE s.status = 'in_progress') AS started,
    (
      SELECT s2.title FROM task_workflow_steps s2
      WHERE s2.task_id = l.task_id AND s2.run_id IS NOT DISTINCT FROM l.run_id
        AND s2.status IN ('failed', 'awaiting_approval', 'in_progress')
      ORDER BY CASE s2.status WHEN 'failed' THEN 1 WHEN 'awaiting_approval' THEN 2 WHEN 'in_progress' THEN 3 END
      LIMIT 1
    ) AS active_title,
    (
      SELECT bp.name FROM task_workflow_steps s3
      JOIN bot_profiles bp ON bp.id = s3.bot_id
      WHERE s3.task_id = l.task_id AND s3.run_id IS NOT DISTINCT FROM l.run_id
        AND s3.status = 'in_progress'
      ORDER BY s3.started_at DESC NULLS LAST
      LIMIT 1
    ) AS active_agent,
    (
      SELECT wt.name FROM workflow_runs wr
      JOIN workflow_templates wt ON wt.id = wr.template_id
      WHERE wr.id = l.run_id AND wr.status NOT IN ('completed', 'failed')
    ) AS template_name
  FROM live l
  JOIN task_workflow_steps s ON s.task_id = l.task_id AND s.run_id IS NOT DISTINCT FROM l.run_id
  GROUP BY l.task_id, l.run_id
)
UPDATE board_tasks bt SET
  workflow_step_total = c.total,
  workflow_step_completed = c.done,
  workflow_step_in_progress = c.inprog,
  workflow_step_failed = c.failed,
  workflow_step_awaiting_approval = c.awaiting,
  workflow_step_started_at = c.started,
  workflow_active_step_title = c.active_title,
  workflow_active_agent_name = c.active_agent,
  workflow_template_name = c.template_name
FROM calc c
WHERE c.task_id = bt.id
  AND (
    bt.workflow_step_total, bt.workflow_step_completed, bt.workflow_step_in_progress,
    bt.workflow_step_failed, bt.workflow_step_awaiting_approval, bt.workflow_step_started_at,
    bt.workflow_active_step_title, bt.workflow_active_agent_name, bt.workflow_template_name
  ) IS DISTINCT FROM (
    c.total, c.done, c.inprog, c.failed, c.awaiting, c.started,
    c.active_title, c.active_agent, c.template_name
  );

ALTER TABLE board_tasks ENABLE TRIGGER set_board_tasks_updated_at;
