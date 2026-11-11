-- How an in-app terminal session's agent ended (card 4cd8270f).
--
-- Until now a session the bridge ended on purpose was recorded only as the
-- relay's "bridge_ended", so an agent killed from outside (signal 9) looked
-- exactly like a clean quit. The bridge now reports how the agent stopped and
-- the relay passes a short, bounded detail ("signal 9", "code 1") to
-- /api/terminal/session/closed, which saves it here.
--
-- Nullable: null for every older row, every clean quit, and every other way a
-- session ends. Written only by that service-role callback, at the moment the
-- row moves to `ended`.
--
-- No RLS change needed: the owner-only policies from 00141_terminal_sessions
-- already cover every column on the row, this one included.
alter table public.terminal_sessions
  add column end_detail text null;
