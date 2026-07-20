-- In-app terminal multi-session registry (stage 3, docs/design-terminal-multi-session-popout.html §9).
--
-- The relay is opaque and per-session (one Durable Object per sid) — it has no
-- notion of "all of a user's terminals". This table is the best-effort registry
-- the mint route, cap/rate-limit checks, and the "My sessions" panel read/write
-- against. It is deliberately NOT the source of truth for whether a relay
-- session is actually alive (the relay is) — see R2 in the design doc: rows can
-- drift (a relay session can end without this row being told), which is why the
-- mint route REAPS expired rows before trusting the count (see route.ts).
--
-- `expires_at` is set by the mint route to created_at + 4h, mirroring the
-- relay's own max-duration horizon (terminal/relay/src/pairing.js →
-- DEFAULT_MAX_MS) — a session can never legitimately still be "active" past
-- that wall-clock point, so the reap step can safely mark it ended without
-- ever having to ask the relay.
CREATE TABLE public.terminal_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sid text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  idea_id uuid NOT NULL REFERENCES public.ideas(id) ON DELETE CASCADE,
  task_id uuid NULL,
  task_title text NULL,
  machine_label text NULL,
  cwd text NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at timestamptz DEFAULT now() NOT NULL,
  ended_at timestamptz NULL,
  expires_at timestamptz NOT NULL
);

-- RLS: every row is owner-only. The mint route, end route, and My-sessions list
-- all run through the per-user Supabase client (createClient() from
-- @/lib/supabase/server, cookie-scoped) so these policies are the actual
-- enforcement — never raw SQL, per CLAUDE.md. The service-role client (used
-- nowhere in this feature today, but potentially by future admin tooling)
-- bypasses RLS automatically and needs no explicit policy.
ALTER TABLE public.terminal_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own terminal sessions"
  ON public.terminal_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own terminal sessions"
  ON public.terminal_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own terminal sessions"
  ON public.terminal_sessions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own terminal sessions"
  ON public.terminal_sessions FOR DELETE
  USING (auth.uid() = user_id);

-- The mint route's cap/rate-limit reads and the My-sessions list both filter
-- on (user_id, status) — this is the one index that matters.
CREATE INDEX idx_terminal_sessions_user_status ON public.terminal_sessions(user_id, status);
