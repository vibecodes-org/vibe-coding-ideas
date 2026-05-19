-- GitHub OAuth App integration: store per-user encrypted access tokens so
-- ideas can browse/create GitHub repos directly from the app.
--
-- Two tables:
--   user_github_connections — long-lived encrypted token, one per user
--   github_oauth_states     — short-lived CSRF state for the OAuth round-trip

create table user_github_connections (
  user_id                 uuid        primary key references users(id) on delete cascade,
  github_user_id          bigint      not null unique,
  github_login            text        not null,
  github_avatar_url       text,
  encrypted_access_token  text        not null,
  scopes                  text[]      not null default '{}',
  connected_at            timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table user_github_connections enable row level security;

-- Users can read their own connection row and delete it (disconnect).
-- Inserts/updates only happen via the OAuth callback route using the
-- service-role client, so no INSERT/UPDATE policies are needed here.
create policy "Users read own github connection"
  on user_github_connections
  for select
  using (auth.uid() = user_id);

create policy "Users delete own github connection"
  on user_github_connections
  for delete
  using (auth.uid() = user_id);

-- Short-lived state rows for the OAuth round-trip (CSRF + return_to mapping).
-- A row is created when the user initiates connect, then deleted on callback
-- (or expired via the created_at check on use).
create table github_oauth_states (
  state       text        primary key,
  user_id     uuid        not null references users(id) on delete cascade,
  return_to   text        not null,
  created_at  timestamptz not null default now()
);

alter table github_oauth_states enable row level security;

-- No client-side access to states — only the callback route (service role)
-- reads/deletes them. RLS is enabled with no policies to deny all client access.

create index github_oauth_states_created_at_idx
  on github_oauth_states (created_at);
