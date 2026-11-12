-- A lasting record of what each in-app terminal session went through
-- (card f4be2981, stage 2).
--
-- On 12 Nov 2026 a Wi-Fi switch left two live sessions showing "ended" in the
-- browser, Resume refused and Reconnect doing nothing, and none of it could be
-- diagnosed: the browser logged only to its own console, the relay keeps no
-- logs, and the Mac helper has no log file. Every part of the chain now
-- reports the moments that matter (a link dropping, a reconnect attempt, a
-- close code, which screen was shown and why, which button was pressed) to
-- /api/terminal/session/events, which writes them here.
--
-- source: who saw it ('browser', 'relay', 'bridge' or 'server').
-- at:     when it happened by that part's own clock (a browser that was
--         offline sends its queue later; created_at is when it arrived).
-- detail: a small JSON object, capped in size by the route.
--
-- Written only by that route with the service role. The owner can read their
-- own rows; nobody else can. Rows older than 30 days are trimmed by the route.

create table public.terminal_session_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  sid text not null,
  source text not null check (source in ('browser', 'relay', 'bridge', 'server')),
  event text not null check (char_length(event) between 1 and 64),
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null,
  created_at timestamptz not null default now()
);

create index terminal_session_events_sid_at_idx on public.terminal_session_events (sid, at);
create index terminal_session_events_user_at_idx on public.terminal_session_events (user_id, at);

alter table public.terminal_session_events enable row level security;

create policy "Users can read own terminal session events"
  on public.terminal_session_events for select
  using ((select auth.uid()) = user_id);
