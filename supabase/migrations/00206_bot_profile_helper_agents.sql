-- Helper agents setting (card 9a308e9b, stage A): 'allowed' or 'blocked'.
--
-- 'blocked' (shown as "Works alone") switches off Claude Code's helper-starting
-- tool for the agent: a `disallowedTools` entry on its session definition and
-- saved agent file, plus one line in the persona's Tools note when a step runs.
-- Every existing agent starts on 'allowed', so nothing changes for anyone until
-- they pick Works alone.
--
-- Additive, with a default. Apply this BEFORE merging: claim_next_step selects
-- the column, and every claim fails if it is missing.

ALTER TABLE public.bot_profiles
  ADD COLUMN IF NOT EXISTS helper_agents TEXT NOT NULL DEFAULT 'allowed'
  CHECK (helper_agents IN ('allowed', 'blocked'));

COMMENT ON COLUMN public.bot_profiles.helper_agents IS
  'allowed = can start its own helper agents; blocked = Works alone: told (and, in Claude Code, forced) not to start helper agents. Claude only.';

-- The built-in builder, reviewer and tester (platform rows from 00190) start
-- new copies on Works alone. Only these three rows; existing copies on other
-- accounts, the Planner and Pipeline are left alone.
UPDATE public.bot_profiles
SET helper_agents = 'blocked'
WHERE id IN (
  'b0000000-0000-4000-a000-000000000001',
  'b0000000-0000-4000-a000-000000000008',
  'b0000000-0000-4000-a000-000000000004'
);
