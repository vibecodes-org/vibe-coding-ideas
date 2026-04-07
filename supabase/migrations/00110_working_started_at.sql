-- Add working_started_at to board_tasks for non-workflow in-progress indicator
-- Set when a bot is assigned to a task (without an active workflow), cleared on done/unassign
ALTER TABLE board_tasks ADD COLUMN IF NOT EXISTS working_started_at timestamptz;
