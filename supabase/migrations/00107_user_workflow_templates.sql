-- Personal workflow template library: users can save per-idea templates
-- for reuse across boards.

CREATE TABLE user_workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  steps JSONB NOT NULL,
  source_idea_id UUID REFERENCES ideas(id) ON DELETE SET NULL,
  source_idea_title TEXT,
  suggested_label_name TEXT,
  suggested_label_color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for efficient per-user listing
CREATE INDEX idx_user_workflow_templates_user_id ON user_workflow_templates(user_id);

-- RLS: users can only see/manage their own templates
ALTER TABLE user_workflow_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own templates"
  ON user_workflow_templates
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
