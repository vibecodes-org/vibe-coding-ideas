-- Security fix (Phase 2 of the `public.users` PII hardening started in
-- 00151): stop the `authenticated` Postgres role from reading
-- `encrypted_anthropic_key` ciphertext at all — including a user's own row —
-- via any RLS-bound (anon-key + session) PostgREST/Supabase-JS client.
--
-- BUG: 9 call sites read `encrypted_anthropic_key` across 8 files. 7 of them
-- only test truthiness (`!!row.encrypted_anthropic_key`) to render a BYOK/
-- Platform badge — they never touch the ciphertext. Only `resolveAiProvider`
-- (src/lib/ai-helpers.ts) needs the raw value, to decrypt and construct an
-- Anthropic client. Every one of those 7 boolean-only reads still pulled the
-- full ciphertext into the RSC/action payload for no reason, widening the
-- blast radius of any RSC-payload leak (e.g. the profile-page bug fixed in
-- 00151) to include the encryption key material itself.
--
-- A blunt `revoke select on table ... from authenticated` with no
-- replacement would break every one of those 7 read sites outright: Supabase/
-- PostgREST fails the WHOLE query when a selected column isn't grantable,
-- not just that field. The worst case is
-- src/app/(main)/profile/[id]/page.tsx:104-109, which selects
-- encrypted_anthropic_key alongside notification_preferences,
-- default_board_columns, and model_tier_map for a user's OWN profile
-- settings — a bare revoke would null out `ownSettings` and silently
-- disappear the entire settings block from a user's own profile page.
--
-- FIX: add a `STORED` generated boolean column that carries only the
-- truthiness the 7 sites actually need, then take the ciphertext column out
-- of `authenticated`'s reach entirely. The app-side commit repoints all 7
-- boolean-only readers at `has_anthropic_key` and moves the one raw-value
-- read (`resolveAiProvider`) to a narrowly-scoped service-role client.
--
-- WHY A GENERATED COLUMN AND NOT A VIEW OR RPC:
--   - Same reasoning as 00151's column-grant choice: a view loses the FK
--     metadata PostgREST relies on for embedded-join call sites, and an RPC
--     would mean rewriting all 7 read sites' shapes instead of a single
--     string swap on 6 of them.
--   - `GENERATED ALWAYS ... STORED` materializes the boolean into the row at
--     write time. Reading the generated column is a normal column read of
--     `has_anthropic_key` — it does not, at read time, touch
--     `encrypted_anthropic_key`'s ACL at all. Postgres checks privileges
--     per accessed column; a query that never names
--     `encrypted_anthropic_key` never triggers its grant check, regardless
--     of what the generated column's defining expression references.
--   - The recomputation on INSERT/UPDATE (whenever a writer sets
--     `encrypted_anthropic_key`) happens inside the executor against the
--     row already being written, not through a fresh SELECT — so it needs
--     no SELECT privilege on the source column. `saveApiKey`/`removeApiKey`
--     (src/actions/profile.ts:85-127) do
--     `.update({ encrypted_anthropic_key: ... })` with no `.select()`
--     afterward; they keep working unchanged because UPDATE privilege on
--     that column is untouched below (only SELECT is revoked).
--
-- WHY THE REVOKE MUST BE TABLE-LEVEL, NOT `revoke select (encrypted_anthropic_key) ... from authenticated` ALONE:
-- Verified against prod (`select relacl from pg_class where relname='users'`):
-- `authenticated=arwdDxtm/postgres` — `authenticated` still holds
-- Supabase's bootstrap TABLE-LEVEL select grant (the `r` flag) on
-- `public.users`, untouched by 00151 (which only revoked `anon`'s).
-- Postgres ACL checks are a logical OR of table-level and column-level
-- grants: a role with table-level SELECT can read every column regardless
-- of any column-level REVOKE, because that REVOKE only removes a
-- column-level grant that, in this case, was never the thing granting
-- access in the first place. A bare
-- `revoke select (encrypted_anthropic_key) on public.users from authenticated`
-- would therefore be a silent no-op — the exact shape of bug this hotfix
-- exists to close. The working fix mirrors 00151's technique for `anon`:
-- revoke the table-level grant entirely, then re-grant column-level SELECT
-- on every column EXCEPT `encrypted_anthropic_key`.
--
-- WHY EVERY OTHER COLUMN IS SAFE TO RE-GRANT UNCHANGED: this migration only
-- removes `authenticated`'s access to ONE column that had a real, narrow
-- fix available (route the one legitimate reader through service-role
-- instead). It does not attempt the harder, tracked-separately Phase 2 from
-- 00151 (self-vs-other scoping for notification_preferences, model_tier_map,
-- is_admin/is_super_admin, ai_starter_credits, etc.) — column grants still
-- can't express "your own row only" for a role, and those columns have
-- load-bearing cross-user reads (notification fan-out, admin credits table)
-- that this migration doesn't touch. `is_super_admin` and `id` in
-- particular must stay granted: both are referenced in the "Super admins
-- can update any user" RLS policy's own USING/CHECK subquery
-- (`EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.is_super_admin)`),
-- which is evaluated with the querying role's own column privileges —
-- dropping either would break that policy for every authenticated write,
-- not just this fix's target.
--
-- WHY `anon` DOES NOT GET `has_anthropic_key`: audited every anon-reachable
-- `users` read (see 00151's header) — sitemap.ts (id, updated_at, is_bot)
-- and the OG-image author embed (full_name). Neither needs BYOK-key
-- truthiness. Anon's grant list is left exactly as 00151 set it.

alter table public.users
  add column has_anthropic_key boolean generated always as (encrypted_anthropic_key is not null) stored;

revoke select on table public.users from authenticated;

grant select (
  id,
  email,
  full_name,
  avatar_url,
  bio,
  github_username,
  contact_info,
  notification_preferences,
  default_board_columns,
  model_tier_map,
  is_admin,
  is_super_admin,
  is_bot,
  ai_enabled,
  has_anthropic_key,
  ai_daily_limit,
  ai_starter_credits,
  onboarding_completed_at,
  mcp_connected_at,
  created_at,
  updated_at
) on public.users to authenticated;
