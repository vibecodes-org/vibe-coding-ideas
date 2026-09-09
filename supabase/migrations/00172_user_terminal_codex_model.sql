-- Independent Codex terminal starting pair. NULL inherits the administrator's
-- Standard-tier Codex pair; the existing machine-default sentinel omits both.
ALTER TABLE public.users
  ADD COLUMN terminal_codex_model text,
  ADD COLUMN terminal_codex_effort text;

COMMENT ON COLUMN public.users.terminal_codex_model IS
  'Per-user Codex terminal model. NULL inherits the platform Standard Codex pair; __machine_default__ omits Codex model and effort flags.';
COMMENT ON COLUMN public.users.terminal_codex_effort IS
  'Reasoning effort paired atomically with users.terminal_codex_model. NULL unless a complete explicit Codex terminal pair is stored.';

GRANT SELECT (terminal_codex_model, terminal_codex_effort) ON public.users TO authenticated;
