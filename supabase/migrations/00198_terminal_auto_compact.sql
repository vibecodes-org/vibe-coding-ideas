-- Per-user memory limit (auto-compact window) for in-app terminal sessions
-- (task 5e654dd1). New and resumed sessions start with
-- `claude --autocompact <N>` / `codex -c model_auto_compact_token_limit=<N>`.
--
-- Resolution order at launch, separately per agent: this column -> the site
-- default an admin sets (platform_settings keys terminal_auto_compact_default
-- and terminal_codex_auto_compact_default) -> nothing (the agent decides).
--
-- NULL -> use the site default, else send nothing.
-- integer -> that many tokens (the app offers fixed steps; the launch path
--            accepts any whole number from 100000 to 1000000).
--
-- No CHECK constraint, matching users.terminal_effort: validation lives in
-- the app and the bridge, so a new step never needs a migration.
--
-- public.users uses column-level SELECT grants (00165). Without the GRANT
-- below, every authenticated read naming these columns fails.
ALTER TABLE public.users
  ADD COLUMN terminal_auto_compact integer,
  ADD COLUMN terminal_codex_auto_compact integer;

COMMENT ON COLUMN public.users.terminal_auto_compact IS
  'Per-user Claude Code memory limit (auto-compact window, tokens) for in-app terminal sessions. NULL = use the site default (platform_settings.terminal_auto_compact_default), else send nothing. Applies to fresh and resumed Claude launches.';
COMMENT ON COLUMN public.users.terminal_codex_auto_compact IS
  'Per-user Codex memory limit (model_auto_compact_token_limit, tokens) for in-app terminal sessions. NULL = use the site default (platform_settings.terminal_codex_auto_compact_default), else send nothing.';

GRANT SELECT (terminal_auto_compact, terminal_codex_auto_compact) ON public.users TO authenticated;

-- Claude's site default is 300,000 from day one. There is deliberately no
-- Codex row: Codex keeps its own size (about 245,000 on today's models).
INSERT INTO public.platform_settings (key, value)
VALUES ('terminal_auto_compact_default', '{"window":300000}'::jsonb)
ON CONFLICT (key) DO NOTHING;
