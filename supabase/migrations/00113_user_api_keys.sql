-- User API keys for non-OAuth MCP clients (e.g. Codex)
-- Keys are stored as SHA-256 hashes; plaintext is shown only once at creation.

create table user_api_keys (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references users(id) on delete cascade,
  name        text        not null,
  key_hash    text        not null unique,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at  timestamptz
);

alter table user_api_keys enable row level security;

-- Users can only see and manage their own keys
create policy "Users manage own API keys"
  on user_api_keys
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
