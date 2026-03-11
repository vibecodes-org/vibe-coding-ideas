-- Board-Level Workflows: idea-scoped templates, auto-rules, workflow runs, and workflow steps
-- Replaces checklists with a proper workflow step system. Templates live on the board, not on agents.

-- ============================================================
-- Part 1: Workflow Templates (idea-scoped, team-visible)
-- ============================================================

CREATE TABLE workflow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  steps jsonb NOT NULL DEFAULT '[]',
  usage_count integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members and public viewers can read workflow templates"
  ON workflow_templates FOR SELECT
  USING (
    is_idea_team_member(idea_id, auth.uid())
    OR (auth.uid() IS NOT NULL AND is_idea_public(idea_id))
  );

CREATE POLICY "Team members can create workflow templates"
  ON workflow_templates FOR INSERT
  WITH CHECK (is_idea_team_member(idea_id, auth.uid()));

CREATE POLICY "Team members can update workflow templates"
  ON workflow_templates FOR UPDATE
  USING (is_idea_team_member(idea_id, auth.uid()));

CREATE POLICY "Team members can delete workflow templates"
  ON workflow_templates FOR DELETE
  USING (is_idea_team_member(idea_id, auth.uid()));

CREATE INDEX idx_workflow_templates_idea_id ON workflow_templates(idea_id);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_workflow_template_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflow_template_updated_at_trigger
  BEFORE UPDATE ON workflow_templates
  FOR EACH ROW EXECUTE FUNCTION update_workflow_template_updated_at();

-- ============================================================
-- Part 2: Workflow Auto-Rules (label → template mapping)
-- ============================================================

CREATE TABLE workflow_auto_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES board_labels(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  auto_run boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(idea_id, label_id)
);

ALTER TABLE workflow_auto_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members and public viewers can read auto-rules"
  ON workflow_auto_rules FOR SELECT
  USING (
    is_idea_team_member(idea_id, auth.uid())
    OR (auth.uid() IS NOT NULL AND is_idea_public(idea_id))
  );

CREATE POLICY "Team members can create auto-rules"
  ON workflow_auto_rules FOR INSERT
  WITH CHECK (is_idea_team_member(idea_id, auth.uid()));

CREATE POLICY "Team members can update auto-rules"
  ON workflow_auto_rules FOR UPDATE
  USING (is_idea_team_member(idea_id, auth.uid()));

CREATE POLICY "Team members can delete auto-rules"
  ON workflow_auto_rules FOR DELETE
  USING (is_idea_team_member(idea_id, auth.uid()));

CREATE INDEX idx_workflow_auto_rules_idea_id ON workflow_auto_rules(idea_id);
CREATE INDEX idx_workflow_auto_rules_label_id ON workflow_auto_rules(label_id);

-- ============================================================
-- Part 3: Workflow Runs (tracks each application of a template to a task)
-- ============================================================

CREATE TABLE workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES board_tasks(id) ON DELETE CASCADE,
  template_id uuid REFERENCES workflow_templates(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed')),
  current_step integer NOT NULL DEFAULT 0,
  started_by uuid REFERENCES users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;

-- Get idea_id from task for RLS
CREATE OR REPLACE FUNCTION get_task_idea_id(p_task_id uuid)
RETURNS uuid AS $$
  SELECT idea_id FROM board_tasks WHERE id = p_task_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE POLICY "Team members and public viewers can read workflow runs"
  ON workflow_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM board_tasks bt
      WHERE bt.id = workflow_runs.task_id
      AND (
        is_idea_team_member(bt.idea_id, auth.uid())
        OR (auth.uid() IS NOT NULL AND is_idea_public(bt.idea_id))
      )
    )
  );

CREATE POLICY "Team members can create workflow runs"
  ON workflow_runs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM board_tasks bt
      WHERE bt.id = workflow_runs.task_id
      AND is_idea_team_member(bt.idea_id, auth.uid())
    )
  );

CREATE POLICY "Team members can update workflow runs"
  ON workflow_runs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM board_tasks bt
      WHERE bt.id = workflow_runs.task_id
      AND is_idea_team_member(bt.idea_id, auth.uid())
    )
  );

CREATE INDEX idx_workflow_runs_task_id ON workflow_runs(task_id);
CREATE INDEX idx_workflow_runs_template_id ON workflow_runs(template_id);

-- ============================================================
-- Part 4: Task Workflow Steps (replaces checklists)
-- ============================================================

-- Drop old checklist infrastructure
DROP TRIGGER IF EXISTS checklist_counts_trigger ON board_checklist_items;
DROP FUNCTION IF EXISTS update_checklist_counts();
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'board_checklist_items') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE board_checklist_items;
  END IF;
END $$;
DROP TABLE IF EXISTS board_checklist_items;

-- Replace checklist columns with workflow step columns
ALTER TABLE board_tasks
  DROP COLUMN IF EXISTS checklist_total,
  DROP COLUMN IF EXISTS checklist_done,
  ADD COLUMN workflow_step_total integer NOT NULL DEFAULT 0,
  ADD COLUMN workflow_step_completed integer NOT NULL DEFAULT 0;

CREATE TABLE task_workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES board_tasks(id) ON DELETE CASCADE,
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  run_id uuid REFERENCES workflow_runs(id) ON DELETE CASCADE,
  bot_id uuid REFERENCES users(id),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'awaiting_approval')),
  position integer NOT NULL DEFAULT 0,
  step_order integer,
  agent_role text,
  output text,
  human_check_required boolean NOT NULL DEFAULT false,
  comment_count integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE task_workflow_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view workflow steps for public ideas or team members"
  ON task_workflow_steps FOR SELECT
  USING (
    is_idea_team_member(idea_id, auth.uid())
    OR (auth.uid() IS NOT NULL AND is_idea_public(idea_id))
  );

CREATE POLICY "Team members can insert workflow steps"
  ON task_workflow_steps FOR INSERT
  WITH CHECK (is_idea_team_member(idea_id, auth.uid()));

CREATE POLICY "Team members can update workflow steps"
  ON task_workflow_steps FOR UPDATE
  USING (is_idea_team_member(idea_id, auth.uid()));

CREATE POLICY "Team members can delete workflow steps"
  ON task_workflow_steps FOR DELETE
  USING (is_idea_team_member(idea_id, auth.uid()));

CREATE INDEX idx_workflow_steps_task_id ON task_workflow_steps(task_id);
CREATE INDEX idx_workflow_steps_idea_id ON task_workflow_steps(idea_id);
CREATE INDEX idx_workflow_steps_run_id ON task_workflow_steps(run_id);

-- Trigger: maintain workflow step counts on board_tasks
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
    workflow_step_completed = (SELECT count(*) FROM task_workflow_steps WHERE task_id = target_task_id AND status = 'completed')
  WHERE id = target_task_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER workflow_step_counts_trigger
  AFTER INSERT OR UPDATE OR DELETE ON task_workflow_steps
  FOR EACH ROW EXECUTE FUNCTION update_workflow_step_counts();

-- Trigger: auto-update updated_at on workflow steps
CREATE OR REPLACE FUNCTION update_workflow_step_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflow_step_updated_at_trigger
  BEFORE UPDATE ON task_workflow_steps
  FOR EACH ROW EXECUTE FUNCTION update_workflow_step_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE task_workflow_steps;
ALTER TABLE task_workflow_steps REPLICA IDENTITY FULL;

-- ============================================================
-- Part 5: Workflow Step Comments (inter-agent communication)
-- ============================================================

CREATE TABLE workflow_step_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id uuid NOT NULL REFERENCES task_workflow_steps(id) ON DELETE CASCADE,
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'comment'
    CHECK (type IN ('comment', 'output', 'failure', 'approval', 'changes_requested')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_step_comments_step_id ON workflow_step_comments(step_id);

ALTER TABLE workflow_step_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can read step comments"
  ON workflow_step_comments FOR SELECT
  USING (
    is_idea_team_member(idea_id, auth.uid())
    OR (auth.uid() IS NOT NULL AND is_idea_public(idea_id))
  );

CREATE POLICY "Team members can insert step comments"
  ON workflow_step_comments FOR INSERT
  WITH CHECK (is_idea_team_member(idea_id, auth.uid()) AND auth.uid() = author_id);

CREATE POLICY "Authors can delete own step comments"
  ON workflow_step_comments FOR DELETE
  USING (auth.uid() = author_id);

-- Trigger: denormalized comment count on steps
CREATE OR REPLACE FUNCTION update_step_comment_count()
RETURNS trigger AS $$
DECLARE
  target_step_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_step_id := OLD.step_id;
  ELSE
    target_step_id := NEW.step_id;
  END IF;

  UPDATE task_workflow_steps SET
    comment_count = (SELECT count(*) FROM workflow_step_comments WHERE step_id = target_step_id)
  WHERE id = target_step_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER step_comment_count_trigger
  AFTER INSERT OR DELETE ON workflow_step_comments
  FOR EACH ROW EXECUTE FUNCTION update_step_comment_count();

-- Trigger: auto-update updated_at on step comments
CREATE OR REPLACE FUNCTION update_step_comment_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER step_comment_updated_at_trigger
  BEFORE UPDATE ON workflow_step_comments
  FOR EACH ROW EXECUTE FUNCTION update_step_comment_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE workflow_step_comments;
ALTER TABLE workflow_step_comments REPLICA IDENTITY FULL;

-- ============================================================
-- Part 6: Auto-rule trigger (label assignment → auto-apply template)
-- ============================================================

CREATE OR REPLACE FUNCTION auto_apply_workflow_on_label()
RETURNS trigger AS $$
DECLARE
  v_rule workflow_auto_rules%ROWTYPE;
  v_idea_id uuid;
  v_run_id uuid;
  v_step jsonb;
  v_position integer := 0;
  v_step_order integer := 0;
BEGIN
  -- Get the idea_id from the task
  SELECT idea_id INTO v_idea_id FROM board_tasks WHERE id = NEW.task_id;
  IF v_idea_id IS NULL THEN RETURN NEW; END IF;

  -- Check for a matching auto-rule
  SELECT * INTO v_rule
  FROM workflow_auto_rules
  WHERE idea_id = v_idea_id
    AND label_id = NEW.label_id
    AND auto_run = true;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Don't apply if task already has an active workflow run
  IF EXISTS (
    SELECT 1 FROM workflow_runs
    WHERE task_id = NEW.task_id
    AND status NOT IN ('completed', 'failed')
  ) THEN RETURN NEW; END IF;

  -- Create the workflow run
  INSERT INTO workflow_runs (task_id, template_id, status)
  VALUES (NEW.task_id, v_rule.template_id, 'pending')
  RETURNING id INTO v_run_id;

  -- Create workflow steps from template
  FOR v_step IN
    SELECT * FROM jsonb_array_elements(
      (SELECT steps FROM workflow_templates WHERE id = v_rule.template_id)
    )
  LOOP
    v_position := v_position + 1000;
    v_step_order := v_step_order + 1;

    INSERT INTO task_workflow_steps (
      task_id, idea_id, run_id, title, description, agent_role,
      human_check_required, position, step_order
    ) VALUES (
      NEW.task_id,
      v_idea_id,
      v_run_id,
      v_step->>'title',
      v_step->>'description',
      v_step->>'role',
      COALESCE((v_step->>'requires_approval')::boolean, false),
      v_position,
      v_step_order
    );
  END LOOP;

  -- Increment usage count
  UPDATE workflow_templates SET usage_count = usage_count + 1
  WHERE id = v_rule.template_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_auto_apply_workflow_on_label
  AFTER INSERT ON board_task_labels
  FOR EACH ROW EXECUTE FUNCTION auto_apply_workflow_on_label();
