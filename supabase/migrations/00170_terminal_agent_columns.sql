-- Codex support (docs/codex-terminal-requirements.md FR-4a/FR-5,
-- implementation slice 1) — two columns needed before any Codex launch can
-- be recorded or remembered. NOT applied to any database by this slice; a
-- forward-only migration file, applied by hand via the Supabase MCP later
-- per CLAUDE.md's "prod migrations" procedure.
--
-- 1. users.terminal_agent — the REMEMBERED agent pick (US-8/FR-4a), stored
--    per account so it follows the user across devices. Mirrors
--    users.terminal_model's storage MECHANISM (migration 00161) but, like
--    terminal_auto_accept (00162), is a closed set rather than free text —
--    there are exactly two legal values, so a CHECK constraint makes a third
--    value structurally impossible to store. Default 'claude': a user who
--    never touches the picker keeps launching Claude, unchanged (AC-1).
--    Every picker write updates this column; "Start with Claude Code
--    instead" (the escape hatch offered when Codex is refused or missing)
--    also flips it back to 'claude' — settled behaviour, see FR-4a.
--
-- 2. terminal_sessions.agent — which agent a SPECIFIC session actually ran
--    (FR-5), stamped once by the mint route from the launch request and
--    never changed after. NOT NULL DEFAULT 'claude' so every row that
--    predates this column reads as Claude, exactly like `status`'s own
--    default (migration 00141). This is deliberately a SEPARATE column from
--    users.terminal_agent: a user can change their remembered pick after a
--    session was minted without rewriting history for sessions already in
--    flight or ended.
--
-- Neither column needs an RLS change: users' existing self-only policies and
-- terminal_sessions' existing owner-only policies (00141) already cover any
-- column on those rows.
ALTER TABLE users
  ADD COLUMN terminal_agent text NOT NULL DEFAULT 'claude'
    CHECK (terminal_agent IN ('claude', 'codex'));

COMMENT ON COLUMN users.terminal_agent IS
  'Per-account remembered pick for the in-app terminal''s agent (docs/codex-terminal-requirements.md FR-4a). Default ''claude''. Updated on every picker choice; also flipped back to ''claude'' by the "Start with Claude Code instead" escape hatch. Follows the user across devices, unlike a session''s own terminal_sessions.agent.';

ALTER TABLE public.terminal_sessions
  ADD COLUMN agent text NOT NULL DEFAULT 'claude'
    CHECK (agent IN ('claude', 'codex'));

COMMENT ON COLUMN public.terminal_sessions.agent IS
  'Which agent this specific session ran (docs/codex-terminal-requirements.md FR-5). NOT NULL, default ''claude'' so pre-existing rows read as Claude. Stamped once by the mint route from the launch request; never changes after the row is created.';

-- Grant list update (mirrors 00165's column-scoped `authenticated` grant on
-- `users` — a column added after that migration is NOT reachable via
-- select("*")/embedded joins until it's explicitly granted, same failure
-- mode 00153's incident hotfix exists to prevent).
GRANT SELECT (terminal_agent) ON public.users TO authenticated;
