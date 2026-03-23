-- Migration: Add match_tier column to task_workflow_steps
--
-- Tracks the quality tier of role-based agent matching so that
-- rematch can upgrade poor matches when better-fit agents are added.
-- Also extends the idea_agent removal trigger to clear bot_id + match_tier
-- on pending workflow steps.

-- ============================================================================
-- 1. Add match_tier column
-- ============================================================================

ALTER TABLE task_workflow_steps
  ADD COLUMN match_tier text;

COMMENT ON COLUMN task_workflow_steps.match_tier IS
  'Quality tier of role-based agent match: exact, ai, substring, word-overlap. NULL = unmatched or legacy.';

-- ============================================================================
-- 2. Extend bot removal trigger to also clear workflow step assignments
-- ============================================================================

CREATE OR REPLACE FUNCTION unassign_bot_on_idea_agent_remove()
RETURNS trigger AS $$
BEGIN
  -- Clear task assignee (original behaviour)
  UPDATE board_tasks
  SET assignee_id = NULL
  WHERE idea_id = OLD.idea_id
    AND assignee_id = OLD.bot_id;

  -- Clear bot_id + match_tier on PENDING workflow steps (R3)
  UPDATE task_workflow_steps
  SET bot_id = NULL, match_tier = NULL
  WHERE idea_id = OLD.idea_id
    AND bot_id = OLD.bot_id
    AND status = 'pending';

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
