# 23cecd8a — anyone can create, rename or delete an agent in someone else's name

Card: "Security: anyone can delete or create an agent in someone else's name" (task 23cecd8a-df55-492a-b50a-bbcf953072e2).
Run 68672096, "Bug Fix": Investigate and plan (Planner) → Fix → Code review → Verify and release summary.
Investigate step: 15 Oct 2026, Claude Code cloud session (re-claimed the stalled 06:52 claim).

**Touches auth.** No screens change. No stored data changes. A caller who passes an owner id that isn't their own now gets an error instead of success.

## Root cause (confirmed read-only on prod, 15 Oct)
`public.create_bot_user`, `public.delete_bot_user` and `public.update_bot_user` are SECURITY DEFINER (they run as `postgres`) and take the owner as an argument (`p_owner_id`). None of them compares it with `auth.uid()`. EXECUTE is held by `PUBLIC`, `anon`, `authenticated` and `service_role` (`proacl` = `{=X/postgres, …, anon=X/postgres, authenticated=X/postgres, …}`). Bot owner ids are readable. So anyone with the public anon key can:
- `delete_bot_user(<bot>, <its owner>)`: delete any agent except the default bot, through `auth.users` (cascades to `bot_profiles`, `agent_skills`, `idea_agents`).
- `create_bot_user(…, p_owner_id => <anyone>)`: create an agent that belongs to someone else.
- `update_bot_user(<bot>, <its owner>, name, avatar)`: rename or re-avatar anyone's agent. This one isn't on the card, but it has the same cause, so it's fixed with the other two.

The "owned by you" checks only compare two arguments that the caller supplies. The functions date from 00030/00034/00036 (Feb 2026). They have been open since then.

`admin_delete_bot_user(p_bot_id)` checks `public.users.is_admin` for `auth.uid()`. For anon, `auth.uid()` is NULL, so the check fails and the function raises. **The check holds.** Anon EXECUTE is still revoked, as defence in depth.

Not reproduced by actually deleting or creating anything in prod. The dry run of the fix (below) exercises the functions inside a transaction that always aborts.

## Callers (all keep working: each passes owner = the JWT's own user, or runs as service role)
- `src/actions/bots.ts`: createBot (owner `user.id`), updateBot → `update_bot_user` (owner `user.id`), deleteBot (owner `user.id`), cloneBotProfile (owner `user.id` from cloneAgent/featured team/kits). Server actions use the user's cookie session.
- `src/actions/kits.ts`: owner `user.id`, user session.
- `src/actions/admin-agents.ts`: `create_bot_user` with owner = `VIBECODES_USER_ID` (a0000000-…-0001, the platform account) after `requireAdmin()` (`users.is_admin`). It needs its own rule: **allowed when the owner is the platform account and the caller `is_admin`**. That matches `admin_delete_bot_user`'s existing rule, `is_admin` and not `is_super_admin`. Admin delete uses `admin_delete_bot_user`, which is unchanged apart from the grants.
- `src/lib/copy-agent-skills.ts`: rollback `delete_bot_user(newBot, ownerId)`, with the same owner the copy was created with.
- `mcp-server/src/tools/{bots,agent-skill,kits}.ts`: owner = `ctx.ownerUserId ?? ctx.userId`. In remote mode (OAuth and API key), both are the human and the client carries that human's JWT, so it matches `auth.uid()`. In stdio mode the client is service role, so `auth.role() = 'service_role'` lets it through.

## Fix (migration 00194_bot_user_rpcs_require_caller.sql)
- Recreate the three functions with the same signatures, defaults and bodies as prod, `SET search_path = public` (already pinned), plus one guard at the top: unless `auth.role() = 'service_role'`, raise 42501 if `auth.uid()` is NULL or `p_owner_id <> auth.uid()`. `create_bot_user` also allows owner = platform account when the caller `is_admin`.
- `REVOKE EXECUTE … FROM PUBLIC, anon` on create/update/delete/admin_delete, then `GRANT EXECUTE … TO authenticated, service_role`.
- No app code change is needed, and no type change (signatures unchanged).

Ruled out:
- Wrapping callers in app code instead. The hole is the database API itself, which is reachable directly with the anon key.
- Using `is_super_admin` for the admin path. The admin UI gates on `is_admin`, so that would break admins who aren't super admins.
- Allowing direct `postgres` sessions with no JWT. A direct DB connection is already all-powerful, but a NULL `auth.role()` is also what a forged/anonymous context looks like, so stay strict. Run as service role for manual fixes.

## Release order
**Migration first, then merge.** Every caller on current master already passes its own id, the platform id as an admin, or runs as service role, so the migration breaks nothing on master. The PR changes no runtime code, only the migration, the regression test and these notes, so merging after is safe too.

## Regression test
`src/lib/bot-user-rpc-guard.test.ts` replays every migration in order. It takes the LAST `CREATE OR REPLACE FUNCTION` of each of the three functions and asserts that it compares `p_owner_id` with `auth.uid()`, exempts only `service_role`, and pins search_path. It also asserts that the net EXECUTE grants leave anon/PUBLIC revoked on all four functions. Without 00194 it fails, because the latest bodies are 00055/00036/00038, which have no `auth.uid()`, and there is no revoke.

## Related, not fixed here (flag only)
- `decrement_starter_credit(p_user_id)` is SECURITY DEFINER, anon-executable, has no `auth.uid()` check and no pinned search_path. Anyone can burn anyone's starter AI credits. It's a different area (AI credits), so it's flagged on the card for Nick to decide on a follow-up card, not fixed here.
- `is_bot_owner` and `is_idea_team_member` take a user id but are read-only boolean helpers used by RLS. Low risk.

## Fix step (15 Oct 2026)
- Migration `supabase/migrations/00194_bot_user_rpcs_require_caller.sql`, as planned. Function bodies are copied from prod's `pg_get_functiondef` (not from old migration files) so nothing else changes. `admin_update_bot_user`'s real signature is `(uuid, text, text)` (checked in `pg_proc`).
- The test came first: `src/lib/bot-user-rpc-guard.test.ts` fails 12 of 18 without 00194, and 18/18 pass with it. Full suite (4796 tests), `tsc --noEmit`, mcp-server `tsc --noEmit` and eslint (0 errors) all pass.
- Every table and column the migration uses was checked against prod `information_schema` (auth.users: 12 cols; public.users: id, full_name, avatar_url, is_admin, is_bot; public.bot_profiles: id, owner_id, name, role, system_prompt, avatar_url). The anon/authenticated/service_role roles exist.
- Prod dry runs. Each was a single `DO` block ending in `RAISE EXCEPTION`, so nothing persisted. Afterwards `pg_proc` still showed the old bodies and ACLs.
  - B1: the new `create_bot_user` refuses anon, another signed-in user, and a non-admin creating a platform agent (3/3, errcode 42501). It allows own owner, an admin creating platform-owned, and service role.
  - B2: the new `update_bot_user` refuses anon and another user (2/2) and allows the owner. After the REVOKE/GRANT block, anon has no EXECUTE on any of the 5 functions, and authenticated and service_role do.
  - `delete_bot_user` could not be dry-run through the Supabase MCP: any request containing `DELETE FROM` waits for a human confirmation, and it timed out unanswered (twice). Its guard is the same code as `update_bot_user`'s, which B2 proved.
- No app code changed. Every caller already passes its own id, or the platform id as an admin, or runs as service role.
- Not done: a direct "connect with the anon key and POST /rpc/delete_bot_user" check against the live API. The `has_function_privilege` checks cover the same thing at the database level.

## Fix step, resumed after a container restart (15 Oct 2026, evening)
- Merged master (85fccbc, which brings 00195_step_model_unavailable, already applied in prod). 00194 is applied after 00195 in time. That's fine: `check:migrations` matches repo files to prod's `schema_migrations` by name, not by order, and 00194 touches nothing 00195 does.
- Re-checked prod read-only: the three function bodies still match the ones copied into 00194 (apart from the new guard), search_path is pinned, EXECUTE is still held by PUBLIC/anon. No other database function calls the three RPCs.
- Re-checked every caller on current master: `src/actions/bots.ts`, `kits.ts`, `admin-agents.ts`, `src/lib/copy-agent-skills.ts`, `mcp-server/src/tools/{bots,agent-skill,kits}.ts`. Remote MCP builds a per-request client with the human's JWT and owner = that human; stdio is service role. All pass the new guard.
- `bot-user-rpc-guard.test.ts`: 12 of 18 fail with 00194 moved out of the folder, 18/18 pass with it. Full suite 4869 passed (2 skipped), `tsc --noEmit` clean in both the app and mcp-server, eslint 0 errors.

## Review and release (16 Oct 2026)
- Code review passed in an independent cloud session. It re-ran the test (12 of 18 fail without 00194) and found no blocking issues.
- Prod dry run of the new `create_bot_user`, `update_bot_user` and all the REVOKE/GRANT lines: a single DO block that reached its RAISE EXCEPTION, so nothing persisted. It refused anon, a caller with no JWT, a user acting for another user, a non-admin creating a platform agent, and an admin updating another user's agent. It allowed own create/update, an admin creating a platform agent, and service role. Afterwards anon has EXECUTE on none of the 5 functions.
- `delete_bot_user` again can't be dry-run through the Supabase MCP. Any statement containing `DELETE FROM` waits for a human to confirm it.
