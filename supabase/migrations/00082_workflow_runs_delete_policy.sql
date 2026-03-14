-- Add missing DELETE policy for workflow_runs.
-- Without this, RLS silently blocks all deletes (the "Remove Workflow" UI action).

CREATE POLICY "Team members can delete workflow runs"
  ON workflow_runs FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM board_tasks bt
      WHERE bt.id = workflow_runs.task_id
      AND is_idea_team_member(bt.idea_id, auth.uid())
    )
  );
