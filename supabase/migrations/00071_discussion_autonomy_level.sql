-- Add autonomy_level to idea_discussions for controlling how many human
-- checkpoints the orchestrator inserts when converting to a task.
--
-- Level 1: Full Oversight — human checkpoint after every agent step
-- Level 2: Key Checkpoints — human review after major deliverables (default)
-- Level 3: Review on Completion — single human sign-off at the end
-- Level 4: Fully Autonomous — no human steps

ALTER TABLE idea_discussions
  ADD COLUMN autonomy_level integer NOT NULL DEFAULT 2
    CHECK (autonomy_level BETWEEN 1 AND 4);
