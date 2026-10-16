# 2ecca8e9 — "Security: anyone can use up anyone's starter AI credits"

Planner step (Investigate and plan the fix), 16 Oct 2026.
**Touches auth and stored data (users.ai_starter_credits).** User-facing change: NO for every real path — signed-in users still spend their own credits exactly as before; only calls that charge somebody else, or come from the anon key, are refused.

## Reproduction (read-only, on the production catalogue)
Not exploited live (that would spend a real user's credit). Proven from the live function definition and grants instead (`pg_proc`, 16 Oct):
- `public.decrement_starter_credit(p_user_id uuid)`: `prosecdef = true`, `proconfig = null` (no pinned search_path), ACL `{=X/postgres, anon=X, authenticated=X, service_role=X}`. Body: `set_config('app.trusted_bot_operation','true',true)` then `UPDATE public.users SET ai_starter_credits = ai_starter_credits - 1 WHERE id = p_user_id AND ai_starter_credits > 0`. Nothing compares `p_user_id` with `auth.uid()`.
- So: `POST <supabase-url>/rest/v1/rpc/decrement_starter_credit` with only the public anon key and `{"p_user_id": "<any user id>"}` takes one credit from that user, as the table owner, with the privilege-escalation trigger switched off. User ids are not secret (they appear in public profile/feed data), so ten calls per user empties every account.
- `public.grant_starter_credits(p_user_id, p_credits)`: SECURITY DEFINER, no pinned search_path, ACL includes PUBLIC and anon. Its `is_super_admin` check on `auth.uid()` already refuses anon (auth.uid() is null), so it is not exploitable today; revoking anon and pinning search_path is defence in depth.

## Root cause
00064 created both functions as SECURITY DEFINER with Postgres's default EXECUTE-to-PUBLIC (and Supabase's default grants to anon/authenticated) and never restricted them. `decrement_starter_credit` took the target user as an argument and trusted it. 00108 made it worse in one way: it added the `app.trusted_bot_operation` bypass so the `prevent_privilege_escalation` trigger no longer undoes the write, so since 00108 the anonymous decrement actually sticks. Started: 00064 (function), effective since 00108.

Data: no way to tell abuse from normal use in the data. 2 of 38 non-bot users without a BYOK key have more credits gone than charged platform rows in `ai_usage_log`; the 00064 backfill and pre-`charged`-column history can explain both. No evidence of abuse, none ruling it out.

## Caller trace (every path to `decrement_starter_credit`)
Only caller: `decrementStarterCredit(supabase, userId)` in `src/lib/ai-helpers.ts`, reached through `chargeAiUsage` (skipped when `free` or BYOK) and `chargeAiUpfront`.

| Path | Client | userId | auth.uid() = userId? |
|---|---|---|---|
| `src/actions/ai.ts` (8 actions, via `requireAiAccess`) | cookie session (`@/lib/supabase/server`) | `user.id` from `getUser()` | yes |
| `src/actions/onboarding.ts` (2 calls) | cookie session | `user.id` | always `free: true`, never decrements |
| `src/app/api/ai/{enhance,generate-tasks,enhance-create}` | cookie session | `user.id` | yes |
| `ai-role-matching.ts` ← `idea-agents.ts` `rematchActiveWorkflows` (in `after()`) | **service role** | `user.id` of the signed-in caller | service role (exempt) |
| `ai-role-matching.ts` ← `idea-agents.ts` `getRoleCoverage` | cookie session | `user.id` | yes |
| `ai-role-matching.ts` ← `workflow-templates.ts` `applyWorkflowTemplateWithContext` / `rematchWorkflowAgentsWithClient` ← `applyWorkflowTemplate`, `rematchWorkflowAgents`, `resyncWorkflowTemplate`, `updateWorkflowTemplate`, `board.ts` `triggerAutoRulesForTasks` (onboarding, kits, import), `workflow-suggestions.ts` accept paths | cookie session | `user.id` | yes |
| `workflow-matching.ts` `adjudicateWorkflowMatch` ← `decideAutoRuleApplication` ← `workflow-helpers.ts` `checkAndApplyAutoRules` ← `board.ts` (3 label paths, adjudication may run in `after()` on the same client) | cookie session | `options.userId = user.id` | yes |
| MCP remote (`src/app/api/mcp/[[...transport]]/route.ts`): `apply_workflow_template`, `rematch_workflow_agents`, label/create_task auto-rules | per-request client with the caller's JWT (OAuth token, or a JWT minted for the API key's own user) | `ctx.ownerUserId ?? ctx.userId` = the JWT's user | yes |
| MCP stdio (`mcp-server/src/index.ts`) same tools | **service role** | `OWNER_USER_ID` / bot id | service role (exempt) |

**No path charges a different user while running as a signed-in user.** The two that charge "someone" not proven by the JWT both use the service role. In `ai_usage_log` the `role_matching` and `workflow_matching` rows exist (insert policy `auth.uid() = user_id`), which agrees with the after() adjudication path still carrying the user's JWT.

## Fix (migration 00197; planned as 00196, renumbered because master took 00196)
`supabase/migrations/00197_starter_credit_rpcs_require_caller.sql`, same pattern as PR #368's 00194:
- `decrement_starter_credit`: unless `auth.role() = 'service_role'`, raise 42501 when `auth.uid()` is null or `p_user_id IS DISTINCT FROM auth.uid()`. Body otherwise unchanged from production. `SET search_path = public`.
- `grant_starter_credits`: body unchanged (prod version, super-admin check), `SET search_path = public`.
- Both: `REVOKE EXECUTE ... FROM PUBLIC, anon`; `GRANT EXECUTE ... TO authenticated, service_role`.
- Signatures unchanged, so `src/types/database.ts` and callers need no change.

Checked on the live schema (read-only): `public.users(id, ai_starter_credits, is_super_admin)`, `set_config`, `auth.uid()`, `auth.role()` all exist. `supabase/migrations/.held` lists nothing.

## get_admin_platform_credit_stats — no leak, left alone
SECURITY INVOKER, `search_path = ''`, EXECUTE held by anon. It reads `public.ai_usage_log`, which has RLS enabled with SELECT policies `ai_usage_log_select_own` (`auth.uid() = user_id`) and `ai_usage_log_select_admin` (caller `is_admin`). Because it runs as the caller, anon gets zero rows (auth.uid() null) and a signed-in non-admin gets only their own aggregate — the same rows they can already select directly. Not changed (keeps this PR to the bug); revoking anon there would be cosmetic.

## Regression test
`src/lib/starter-credit-rpc-guard.test.ts` replays the migrations folder (same approach as PR #368's `bot-user-rpc-guard.test.ts`): the latest `decrement_starter_credit` must compare `p_user_id` with `auth.uid()`, refuse a null caller, exempt only `service_role`, pin search_path; both functions must end with anon/PUBLIC revoked and authenticated/service_role granted. Fails on master (latest definition is 00108, no check; never revoked). Live behaviour is proven by the DO-block dry run in the PR description (to be run by the release session; real-schema run still owed).

## Ruled out
- Changing callers to stop passing userId: the RPC would still be anon-callable; the database is the boundary.
- `p_user_id = auth.uid()` with no service-role exemption: breaks stdio MCP and `rematchActiveWorkflows`.

## Fix step (16 Oct 2026)
- Test first: `src/lib/starter-credit-rpc-guard.test.ts` failed 7 of 10 without the migration (caller check, null-caller refusal, service-role-only exemption, search_path x2, grants x2); 10/10 pass with it. Its migration-replay helpers are copied from PR #368's `bot-user-rpc-guard.test.ts` (that file isn't on master yet); worth sharing once both are merged.
- Migration `supabase/migrations/00197_starter_credit_rpcs_require_caller.sql` as planned. Both bodies are copied from prod's `pg_get_functiondef` with only the guard added to the decrement. No app code or type change.
- Full suite (4861 passed, 2 skipped), `tsc --noEmit` (app and mcp-server), mcp-server build and eslint (0 errors) pass.
- The prod dry-run DO block (in the PR description) was rehearsed on a stand-in schema in PGlite (Postgres 16 in WASM) with Supabase's own `auth.uid()`/`auth.role()` definitions: it ends `DRY RUN OK, rolled back: anon refused …; other refused …; no-sub refused …; own allowed; service role allowed; grant refused …`, and afterwards the old function and grants are still in place. With the other-user check removed it ends `DRY RUN FAILED: other-user decrement allowed`. Stand-in tables prove nothing about names; the real-schema run is still owed (release session).
- Release order: migration first, then merge (every caller on master already passes the guard; the PR changes no runtime code).
- Renumbered to 00197 (16 Oct): master took 00196 (`00196_workflow_step_usage`, PR #369, unrelated tables) after this branch was cut; master merged into the branch. PR #368's 00194 doesn't clash.
