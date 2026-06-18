-- Mismatched-workflow suggestions (hybrid keyword + AI matching)
-- When an auto-rule matches a task but the workflow template looks wrong for it,
-- we record a `workflow_suggestions` row instead of silently applying. The owner
-- resolves it with Keep / Replace / Remove. DB-backed so it survives reload (US-4)
-- and is delivered over Realtime when the async AI verdict lands (§1b of the UX doc).

CREATE TABLE workflow_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES board_tasks(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES board_labels(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES workflow_auto_rules(id) ON DELETE SET NULL,
  suggested_template_id uuid REFERENCES workflow_templates(id),
  recommended_template_id uuid REFERENCES workflow_templates(id),
  replacement_template_id uuid REFERENCES workflow_templates(id),
  status text NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'accepted', 'replaced', 'dismissed')),
  source text NOT NULL DEFAULT 'heuristic'
    CHECK (source IN ('ai', 'heuristic')),
  ai_confidence numeric,
  reason text,
  detected_categories jsonb,
  adjudication_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id)
);

-- One open suggestion per (task, label) — closed suggestions don't block new ones.
CREATE UNIQUE INDEX idx_workflow_suggestions_open_unique
  ON workflow_suggestions(task_id, label_id)
  WHERE status = 'suggested';

CREATE INDEX idx_workflow_suggestions_task_id ON workflow_suggestions(task_id);
CREATE INDEX idx_workflow_suggestions_idea_status ON workflow_suggestions(idea_id, status);

ALTER TABLE workflow_suggestions ENABLE ROW LEVEL SECURITY;

-- RLS mirrors workflow_auto_rules: gated by is_idea_team_member(idea_id).
CREATE POLICY "Team members and public viewers can read workflow suggestions"
  ON workflow_suggestions FOR SELECT
  USING (
    is_idea_team_member(idea_id, auth.uid())
    OR (auth.uid() IS NOT NULL AND is_idea_public(idea_id))
  );

CREATE POLICY "Team members can create workflow suggestions"
  ON workflow_suggestions FOR INSERT
  WITH CHECK (is_idea_team_member(idea_id, auth.uid()));

CREATE POLICY "Team members can update workflow suggestions"
  ON workflow_suggestions FOR UPDATE
  USING (is_idea_team_member(idea_id, auth.uid()));

CREATE POLICY "Team members can delete workflow suggestions"
  ON workflow_suggestions FOR DELETE
  USING (is_idea_team_member(idea_id, auth.uid()));

-- Realtime: the async AI verdict (§1b) resolves the "checking fit…" micro-state
-- in place on any open board.
ALTER PUBLICATION supabase_realtime ADD TABLE workflow_suggestions;
ALTER TABLE workflow_suggestions REPLICA IDENTITY FULL;

-- Allow the new "workflow_matching" AI action type to be logged in ai_usage_log.
ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_action_type_check;
ALTER TABLE ai_usage_log ADD CONSTRAINT ai_usage_log_action_type_check CHECK (action_type IN (
    'enhance_description',
    'generate_questions',
    'enhance_with_context',
    'generate_board_tasks',
    'enhance_task_description',
    'enhance_discussion_body',
    'enhance_create_description',
    'role_matching',
    'workflow_matching'
));
