-- Per-user opt-in: start in-app terminal Claude Code sessions with Remote
-- Control on (`claude --remote-control`), so the same live session can be
-- continued from the Claude app or claude.ai/code (task 5c8969cc). Mirrors
-- users.terminal_auto_accept (00162): a plain boolean, per-user only, no
-- platform-wide default, no admin surface.
--
-- FALSE (default) -> launches are byte-identical to before this column.
-- TRUE            -> the bridge adds the fixed literal `--remote-control`
--                    immediately after `claude` on Claude Code launches (new,
--                    and resumed while REMOTE_CONTROL_APPLIES_TO_RESUME is
--                    true — see src/lib/terminal/remote-control-mode.ts).
--                    Never Codex. Never carries any user text.
--
-- public.users uses column-level SELECT grants (00165). Without the GRANT
-- below, every authenticated read naming this column fails — which would
-- silently drop the whole terminal-settings read in the session mint route
-- and hide the Settings "Model Tiers" row.
ALTER TABLE public.users
  ADD COLUMN terminal_remote_control boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.terminal_remote_control IS
  'Per-user opt-in: in-app terminal Claude Code sessions launch with claude --remote-control when true. Default false. Never applies to Codex. No platform-wide default — see src/lib/terminal/remote-control-mode.ts.';

GRANT SELECT (terminal_remote_control) ON public.users TO authenticated;
