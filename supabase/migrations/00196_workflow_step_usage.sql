-- Token use per workflow step attempt, for the admin step report's cost
-- column (card ba37039b).
--
-- After a step's subagent returns, the orchestrating session totals that
-- subagent's Claude Code transcript (src/lib/step-cost/usage-command.ts) and
-- passes the totals to complete_step / fail_step as `usage`. One row per
-- model per attempt: a step that was sent back and redone gets a row for each
-- attempt, because that is what the run really cost.
--
-- Tokens are stored, not money: the report prices them from the table in
-- src/lib/step-cost/pricing.ts when it is read, so a price change applies to
-- every past row. Self-reported by the orchestrator, like executed_model;
-- VibeCodes does not verify it. output_estimated is true when the output
-- count was estimated from text length (Claude Code saves output counts
-- before a call finishes).

CREATE TABLE workflow_step_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id uuid NOT NULL REFERENCES task_workflow_steps(id) ON DELETE CASCADE,
  run_id uuid REFERENCES workflow_runs(id) ON DELETE SET NULL,
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('completed', 'awaiting_approval', 'failed')),
  model text NOT NULL CHECK (char_length(model) <= 80),
  calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_5m_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_write_5m_tokens >= 0),
  cache_write_1h_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_write_1h_tokens >= 0),
  output_estimated boolean NOT NULL DEFAULT true,
  reported_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflow_step_usage_step_idx ON workflow_step_usage (step_id);
CREATE INDEX workflow_step_usage_idea_created_idx ON workflow_step_usage (idea_id, created_at);
CREATE INDEX workflow_step_usage_created_idx ON workflow_step_usage (created_at);

ALTER TABLE workflow_step_usage ENABLE ROW LEVEL SECURITY;

-- Written by complete_step / fail_step: as the board member running the
-- workflow on the remote MCP server, as the service role on the stdio one.
-- The step must belong to the board the row names, and a member can only
-- report as themselves, so nobody can charge cost to another board's step.
CREATE POLICY "Team members can record step usage"
  ON workflow_step_usage FOR INSERT
  WITH CHECK (
    is_idea_team_member(idea_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM task_workflow_steps s
      WHERE s.id = workflow_step_usage.step_id AND s.idea_id = workflow_step_usage.idea_id
    )
    AND (reported_by IS NULL OR reported_by = auth.uid())
  );

-- Read only by the admin report.
CREATE POLICY "Admins can read step usage"
  ON workflow_step_usage FOR SELECT
  USING (is_current_user_admin());

COMMENT ON TABLE workflow_step_usage IS
  'Token use per workflow step attempt and model, self-reported by the orchestrating session from its subagent transcript (card ba37039b). Priced at read time by src/lib/step-cost/pricing.ts.';
