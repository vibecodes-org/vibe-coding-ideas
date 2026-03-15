-- Add expected_deliverables column to task_workflow_steps
-- Stores what each step is expected to produce (e.g. "HTML mockups", "requirements doc")
ALTER TABLE task_workflow_steps
  ADD COLUMN IF NOT EXISTS expected_deliverables text[] NOT NULL DEFAULT '{}';
