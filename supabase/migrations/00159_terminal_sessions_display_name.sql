-- User-set session name that sticks (card 3bf262ac — Nick couldn't tell
-- terminal sessions apart when resuming; see docs/design-terminal-session-naming.html).
--
-- Nullable, user-initiated — DIFFERENT semantics from the bridge-fed identity
-- columns already on this table (`machine_label`, `cwd`, `claude_session_id`,
-- see 00141/00157): those are set-never-clear and only ever written while a
-- row is `status = 'active'`. `display_name` is settable AND clearable
-- (empty/whitespace input clears it back to NULL — never `""`, so the auto
-- name can always be distinguished from "the user typed an empty string")
-- on rows in EITHER status. An ended row is exactly where Nick needs to
-- rename most (the Recent/resume list in the session chooser), so the PATCH
-- route's existing active-only filter is deliberately NOT applied to this
-- column — see src/app/api/terminal/session/[sid]/route.ts.
--
-- No RLS change needed: the owner-only policies from 00141_terminal_sessions
-- already cover every column on the row, this one included.
alter table public.terminal_sessions
  add column display_name text null;
