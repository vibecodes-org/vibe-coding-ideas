-- No-repo launch folder: persist the agent-self-reported absolute path of an
-- idea's local project directory, keyed per user + per machine (hostname).
--
-- The browser can never read a folder's absolute path, so the launched local
-- Claude Code session reports its own `pwd` back via the record_project_path
-- MCP tool. Subsequent launches inject the stored path as the deep link's cwd
-- so no-repo projects start in the right folder (keeping CLAUDE.md/.mcp.json
-- and resume history attributed correctly).
--
-- Privacy/ownership (Design Review change #4): a path row is bound to the REAL
-- human (owner_user_id), never the active bot identity, and is readable/writable
-- ONLY by that human — NOT idea team members, NOT the acting bot. RLS enforces
-- `auth.uid() = owner_user_id` for every operation.

create table idea_project_paths (
  id             uuid        primary key default gen_random_uuid(),
  idea_id        uuid        not null references ideas(id) on delete cascade,
  owner_user_id  uuid        not null references users(id) on delete cascade,
  hostname       text        not null,
  absolute_path  text        not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- One stored path per idea, per human, per machine. The MCP tool upserts on
  -- this key so re-launches (self-heal) overwrite a moved/renamed folder.
  unique (idea_id, owner_user_id, hostname)
);

-- The web read query filters by (idea_id, owner_user_id); index it.
create index idea_project_paths_idea_owner_idx
  on idea_project_paths (idea_id, owner_user_id);

-- Keep updated_at fresh on upsert/update (shared fn from 00001_create_users.sql).
create trigger idea_project_paths_updated_at
  before update on idea_project_paths
  for each row execute function update_updated_at();

alter table idea_project_paths enable row level security;

-- Owner-only access (the real human). Deliberately NOT scoped to idea team
-- membership and NOT to the active bot — a machine path is personal to the
-- human on that machine.
create policy "Owner reads own project paths"
  on idea_project_paths
  for select
  using (auth.uid() = owner_user_id);

create policy "Owner inserts own project paths"
  on idea_project_paths
  for insert
  with check (auth.uid() = owner_user_id);

create policy "Owner updates own project paths"
  on idea_project_paths
  for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

create policy "Owner deletes own project paths"
  on idea_project_paths
  for delete
  using (auth.uid() = owner_user_id);
