-- Per-user Claude Code starting effort for in-app terminal sessions
-- (task 18a37612). Sessions start with `claude --effort <level>`.
--
-- Resolution order at launch: this column -> the site default an admin sets
-- (platform_settings key terminal_effort_default, no migration needed) ->
-- nothing (today's behaviour, Claude Code decides).
--
-- NULL           -> use the site default, else send nothing.
-- low|medium|high|xhigh|max -> start at that level, on fresh AND resumed
--                   Claude launches. Never Codex.
--
-- No CHECK constraint, matching users.terminal_codex_effort:
-- validation lives in the app and the bridge, so a new level never needs a
-- migration.
--
-- public.users uses column-level SELECT grants (00165). Without the GRANT
-- below, every authenticated read naming this column fails, which would drop
-- the whole terminal-settings read in the session mint route.
ALTER TABLE public.users
  ADD COLUMN terminal_effort text;

COMMENT ON COLUMN public.users.terminal_effort IS
  'Per-user Claude Code starting effort for in-app terminal sessions (low|medium|high|xhigh|max). NULL = use the site default (platform_settings.terminal_effort_default), else send nothing. Applies to fresh and resumed Claude launches; never Codex.';

GRANT SELECT (terminal_effort) ON public.users TO authenticated;
