-- Add priority field to board_tasks
-- Valid values: low, medium, high, urgent (default: medium)
ALTER TABLE public.board_tasks
  ADD COLUMN priority text NOT NULL DEFAULT 'medium'
  CONSTRAINT board_tasks_priority_check CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
