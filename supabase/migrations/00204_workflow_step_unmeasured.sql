-- A lasting record of "this step's cost couldn't be measured" (card 1117ac6b,
-- stage 2). Since stage 1, complete_step / fail_step on a Claude step require
-- either a usage report or a usage_unavailable reason, but the reason (and a
-- NO_TRANSCRIPT result) was only logged, and production logs drop after about
-- an hour. This keeps it against the step so the Token usage page can tell
-- "couldn't measure, and why" from "nothing was reported".
--
-- One row per finished attempt that ended without a cost row, so a step that
-- was sent back and redone keeps each attempt's outcome (same grain as
-- workflow_step_usage). Deliberately a separate table: a zero-token row in
-- workflow_step_usage would be read as a real $0 cost by every reader.
--
--   kind = unavailable   the session passed usage_unavailable (reason = its words)
--          no_transcript the usage command printed NO_TRANSCRIPT (reason = the
--                        detail after it, e.g. 'no-script', an agent id, or null)
--          unreadable    the usage line wasn't JSON / didn't match the shape
--          codex         a Codex step, which never reports its cost
--
-- Tables/columns/functions used (all exist; checked against 00196 / 00203):
--   task_workflow_steps.id, task_workflow_steps.idea_id, workflow_runs.id,
--   ideas.id, users.id, is_idea_team_member(uuid, uuid),
--   is_current_user_admin(), auth.uid().

CREATE TABLE workflow_step_unmeasured (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id uuid NOT NULL REFERENCES task_workflow_steps(id) ON DELETE CASCADE,
  run_id uuid REFERENCES workflow_runs(id) ON DELETE SET NULL,
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('completed', 'awaiting_approval', 'failed')),
  kind text NOT NULL CHECK (kind IN ('unavailable', 'no_transcript', 'unreadable', 'codex')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 300),
  reported_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflow_step_unmeasured_step_idx ON workflow_step_unmeasured (step_id);
CREATE INDEX workflow_step_unmeasured_idea_created_idx ON workflow_step_unmeasured (idea_id, created_at);

ALTER TABLE workflow_step_unmeasured ENABLE ROW LEVEL SECURITY;

-- Written by complete_step / fail_step, as the board member on the remote MCP
-- server or the service role on the stdio one. Same rule as step usage: the
-- step must belong to the board the row names, and a member reports only as
-- themselves.
CREATE POLICY "Team members can record unmeasured steps"
  ON workflow_step_unmeasured FOR INSERT
  WITH CHECK (
    is_idea_team_member(idea_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM task_workflow_steps s
      WHERE s.id = workflow_step_unmeasured.step_id AND s.idea_id = workflow_step_unmeasured.idea_id
    )
    AND (reported_by IS NULL OR reported_by = auth.uid())
  );

CREATE POLICY "Admins can read unmeasured steps"
  ON workflow_step_unmeasured FOR SELECT
  USING (is_current_user_admin());

CREATE POLICY "Team members can read their boards' unmeasured steps"
  ON workflow_step_unmeasured FOR SELECT
  USING (is_idea_team_member(idea_id, auth.uid()));

-- No UPDATE or DELETE policy: records are append-only.

COMMENT ON TABLE workflow_step_unmeasured IS
  'Why a finished workflow step attempt has no cost row: the usage_unavailable reason, a NO_TRANSCRIPT result, an unreadable report, or a Codex step (card 1117ac6b). Append-only. Counted separately from "missing" on the Admin Token usage page.';
