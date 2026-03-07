-- Add human validation checkpoint support to workflow steps

-- 1. Add step_type column (agent steps require bot_id, human steps don't)
ALTER TABLE task_workflow_steps
  ADD COLUMN step_type text NOT NULL DEFAULT 'agent'
    CHECK (step_type IN ('agent', 'human'));

-- 2. Make bot_id nullable for human steps
ALTER TABLE task_workflow_steps
  ALTER COLUMN bot_id DROP NOT NULL;

-- 3. Add constraint: agent steps must have bot_id, human steps must not
ALTER TABLE task_workflow_steps
  ADD CONSTRAINT workflow_step_type_bot_check
    CHECK (
      (step_type = 'agent' AND bot_id IS NOT NULL)
      OR (step_type = 'human' AND bot_id IS NULL)
    );

-- 4. Add 'approved' and 'changes_requested' comment types for human review
-- (existing types: 'comment', 'output', 'failure')
-- We add an 'approval' type for the review action comment
ALTER TABLE workflow_step_comments
  DROP CONSTRAINT IF EXISTS workflow_step_comments_type_check;

ALTER TABLE workflow_step_comments
  ADD CONSTRAINT workflow_step_comments_type_check
    CHECK (type IN ('comment', 'output', 'failure', 'approval', 'changes_requested'));
