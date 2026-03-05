-- Add 'archived' to the discussion status check constraint
ALTER TABLE idea_discussions
  DROP CONSTRAINT IF EXISTS idea_discussions_status_check;

ALTER TABLE idea_discussions
  ADD CONSTRAINT idea_discussions_status_check
  CHECK (status IN ('open', 'resolved', 'ready_to_convert', 'converted', 'archived'));
