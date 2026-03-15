-- Add claimed_by column to track who actually claimed/executed the step
-- This preserves bot_id as the pre-matched agent while recording the executor
ALTER TABLE task_workflow_steps
  ADD COLUMN claimed_by uuid REFERENCES users(id);
