-- Security fix (re-applies the Phase 2 hotfix from 00152, incident-rolled-back
-- by 00153): stop the `authenticated` Postgres role from reading every OTHER
-- user's `encrypted_anthropic_key` ciphertext, email, contact_info,
-- is_admin/is_super_admin, and credit balances via a direct PostgREST call.
--
-- WHAT HAPPENED: 00152 revoked `authenticated`'s table-level SELECT on
-- `public.users` and re-granted an explicit column list (everything except
-- `encrypted_anthropic_key`). 14 hours later, ~9-11 app call sites doing
-- `select("*")` or an embedded `users!fkey(*)` join against `users` broke
-- silently — Postgres requires whole-row SELECT privilege to expand a
-- wildcard, a column-level grant does NOT satisfy that, no matter how many
-- of the requested columns are actually granted. supabase-js doesn't throw
-- on a PostgREST permission error, and those call sites did `data ?? []`
-- without checking `.error`, so pages returned HTTP 200 with silently empty
-- data (empty ideas list, empty dashboard). 00153 was the incident rollback:
-- `grant select on table public.users to authenticated` — restoring the
-- wide-open table-level grant and reopening the hole it was meant to close.
-- It has stood, unpatched, in production since.
--
-- WHY IT'S SAFE TO RE-APPLY NOW: every wildcard `select("*")` and embedded
-- `users!fkey(*)`/`users(*)` join against `users` outside `ai-helpers.ts` has
-- been found and narrowed to an explicit column list in this same change —
-- see `src/lib/users-select-guard.test.ts` (both its ALLOWLIST and
-- EMBEDDED_WILDCARD_ALLOWLIST are now empty, i.e. the guard actively enforces
-- "no wildcard reads of `users`" repo-wide). That was the actual root cause
-- of the 00153 incident, not the column-grant technique itself — a
-- column-scoped grant was always the right mechanism (see 00151/00152's
-- headers for why a self-only RLS policy or a view don't work here: 273/298
-- rows are bots with no `auth.uid()` match, and a view loses the FK metadata
-- PostgREST needs for embedded joins).
--
-- COLUMN LIST: every column of `public.users` as of this migration EXCEPT
-- `encrypted_anthropic_key`, verified directly against the live schema
-- (`information_schema.columns`), not copied from 00152's now-stale list —
-- three columns (`terminal_model`, `terminal_auto_accept`, `feed_preferences`)
-- were added to the table after 00152 shipped and were never explicitly
-- granted; they've only been reachable at all because of 00153's blanket
-- table-level grant. This migration is the first time they get an explicit,
-- reviewed column grant.
--
-- `has_anthropic_key` (the `GENERATED ALWAYS AS (encrypted_anthropic_key IS
-- NOT NULL) STORED` column from 00152) is included — reading it never
-- touches `encrypted_anthropic_key`'s own ACL (Postgres checks privileges
-- per accessed column, not per the generating expression's dependencies).
--
-- `resolveAiProvider()` (src/lib/ai-helpers.ts) is the one legitimate reader
-- of the raw ciphertext; it already routes through a narrowly-scoped
-- service-role client (bypasses RLS/grants entirely) for a session-derived
-- single-row lookup, unaffected by this revoke.
--
-- OUT OF SCOPE (unchanged by this migration): the `anon` role's grants
-- (already locked down by 00151) and RLS policies on `users` (row-blind by
-- design — bot rows have no `auth.uid()` match, see 00151/00152 headers for
-- why self-only RLS isn't viable here). Self-vs-other column scoping for the
-- remaining cross-user-readable sensitive columns (notification_preferences,
-- model_tier_map, ai_starter_credits, ai_daily_limit, is_admin/
-- is_super_admin) is still tracked separately — column grants are role-wide,
-- not row-aware, and can't express "your own row only"; that needs a
-- follow-up schema change, not this hotfix.

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
  feed_preferences,
  model_tier_map,
  terminal_model,
  terminal_auto_accept,
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
