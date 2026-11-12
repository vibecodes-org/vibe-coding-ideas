-- The "start the next card" offer shown at the foot of a terminal tab
-- (card 7c728159). When a card's whole workflow has finished, the session calls
-- the offer_next_card tool; the tool writes one row here for that session, and
-- the terminal panel (listening live) shows a bar in that session's tab.
--
-- One row per session (sid is the key), so a second offer replaces the first.
-- Kept apart from terminal_sessions on purpose: that table holds each session's
-- key and is not published for live updates; this one holds only titles.
--
-- status: 'offered' (bar shown), 'dismissed' (hidden by the user),
--         'started' (the next card was opened in its own tab).
-- Written by the board tool (service role) and by the owner's own browser
-- (dismiss / started). Owner-only RLS, as terminal_sessions.

create table public.terminal_session_offers (
  sid text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  finished_task_id uuid not null,
  finished_task_title text not null,
  next_task_id uuid,
  next_task_title text,
  agent text not null default 'claude',
  still_working_on integer not null default 0,
  status text not null default 'offered' check (status in ('offered', 'dismissed', 'started')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index terminal_session_offers_user_updated_idx
  on public.terminal_session_offers (user_id, updated_at desc);

alter table public.terminal_session_offers enable row level security;

create policy "Users can read own terminal session offers"
  on public.terminal_session_offers for select
  using ((select auth.uid()) = user_id);

create policy "Users can insert own terminal session offers"
  on public.terminal_session_offers for insert
  with check ((select auth.uid()) = user_id);

create policy "Users can update own terminal session offers"
  on public.terminal_session_offers for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own terminal session offers"
  on public.terminal_session_offers for delete
  using ((select auth.uid()) = user_id);

alter publication supabase_realtime add table public.terminal_session_offers;
