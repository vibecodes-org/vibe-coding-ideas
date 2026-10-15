-- What an agent can do (task 472d5672, stage 1): 'full' or 'read_only'.
--
-- Read-only is for reviewers and checkers. It reaches a session two ways: a
-- "## Tools" note appended to the persona when a step runs (never stored), and,
-- in the in-app Claude Code terminal, a `disallowedTools` entry on the agent's
-- session definition. Every existing agent starts on 'full', so nothing
-- changes for anyone until they pick Read-only.
--
-- Additive, with a default: safe to apply before the app that reads it ships.
-- Apply this BEFORE merging: claim_next_step selects the column, and every
-- claim fails if it is missing.

ALTER TABLE public.bot_profiles
  ADD COLUMN IF NOT EXISTS tool_access TEXT NOT NULL DEFAULT 'full'
  CHECK (tool_access IN ('full', 'read_only'));

COMMENT ON COLUMN public.bot_profiles.tool_access IS
  'full = can read and change code and files; read_only = told (and, in the in-app terminal, forced) not to create, edit or delete files. Used for reviewers and checkers.';
