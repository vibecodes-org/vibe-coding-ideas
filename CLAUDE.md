# VibeCodes - Project Guide

## Quick Reference

- **Dev server**: `npm run dev` (http://localhost:3000)
- **Build**: `npm run build`
- **Lint**: `npm run lint` — **Typecheck**: `npm run typecheck`
- **Test**: `npm run test` (Vitest) / `npm run test:watch` / `npm run test:e2e` (Playwright, also `:ui` / `:headed`)
- **Supabase**: `npm run supabase:start` / `:stop` / `:reset` / `:migrate` / `:studio`
- **Migration drift check**: `npm run check:migrations`

## Tech Stack

Exact versions live in `package.json`; the majors below are what this guide's patterns assume.

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui (New York, Zinc), Supabase (Auth, Postgres, Realtime, RLS), Vercel AI SDK v6 (`ai` + `@ai-sdk/anthropic` v3), mcp-handler (remote MCP + OAuth 2.1), xterm.js + node-pty (in-app terminal), Sentry, Resend, PostHog, Vitest v4 + Playwright, zod v4, @dnd-kit, sonner, vaul, next-themes (dark default), cmdk (command palette), react-markdown + rehype-highlight + remark-gfm, date-fns, lucide-react, @marsidev/react-turnstile

## Workflow Rules (MANDATORY)

### Board Task Workflow — BEFORE ANY IMPLEMENTATION
1. **Check the VibeCodes board** for a matching task (`get_my_tasks` or `get_board`)
2. **If task exists:** move it to "In Progress", read all comments (`get_task`) and add a comment. Assign it to yourself only if it has no workflow: on a workflow task, claiming a step records who does each step.
3. **If no task exists:** Proceed normally, consider creating one
4. **When finished:** Move to "Verify" with summary comment
5. **Post research/analysis as task comments** — preserve context for future sessions
6. **NEVER use raw SQL** for board ops — always use VibeCodes MCP tools

Applies even when resuming from context compaction or implementing a provided plan.

### This repo is public
It's on GitHub as vibecodes-org/vibe-coding-ideas. Never commit private board names, other accounts' data, agent prompts or a client's wording; refer to boards by id. Before a commit or push that mentions boards, list the owner's private boards live (read-only query) and check the diff names none of them.

### Push to Live = Move YOUR Task to Verify
After pushing, move only the specific task you worked on to "Verify" (or "Done"). NEVER batch-move other tasks in the Verify column — those belong to other contributors.

### Blocked Tasks
Move to "Blocked/Requires User Input" with a comment explaining why.

## Key Patterns (Bug Prevention)

### Supabase Types
- `src/types/database.ts` is **manually maintained** — each table MUST have `Row`, `Insert`, `Update`, AND `Relationships`
- Without `Relationships`, Supabase JS v2.95+ resolves insert/update/delete to `never`
- Use `.maybeSingle()` instead of `.single()` when row might not exist
- Reads stop at 1,000 rows without any error: page with `.range()` when a table can be bigger.
- `.update()` and `.delete()` return no rows and no count unless you chain `.select()`; don't let a test mock pretend otherwise.
- Large `.in(ids)` queries silently come back empty at scale: scope by the parent id (for example `idea_id`) instead.

### Next.js 16
- `params`, `searchParams`, `cookies()` are all `Promise` types — must `await`
- Server Actions in `src/actions/` with `"use server"`
- `redirect()` throws — re-throw errors with `digest` starting with `NEXT_REDIRECT` in client catch blocks
- All client catch blocks should `toast.error()` — never fail silently

### Mocks and new controls
A new control must match the existing controls of the same kind on the same screen: layout, labels, help line and save behaviour. That holds for both agents' versions of a setting (Claude and Codex) and for both screens, Settings and Admin. List every difference you keep as a decision for Nick. On 14 Oct 2026 a Claude effort control was mocked after the neighbouring Claude row instead of the Codex pair; the mismatch was approved, built and shipped (card fae2ce4f).

### Logging
- Use `logger.*` from `src/lib/logger.ts`, NOT `console.*`
- Structured JSON output; level via `LOG_LEVEL` env var (default: `warn` prod, `debug` dev)

**⚠️ Blank-env hazard**: Vercel "sensitive" env vars can silently store blank via
the CLI — this caused a full AI outage. Any `process.env.X ?? default` passes `""`
straight through; use `.trim() || default`. See `AI_MODEL` in `src/lib/ai-helpers.ts`
for the correct pattern.

## Database and Deployment

**Production database:** Supabase project `irqbqxspxxzvuczhujzg`. Agents may run read-only queries through the Supabase MCP `execute_sql`; keep each request under about 5,000 characters (larger ones are rejected).

**Prove a migration on the real schema:** Postgres checks table and column names inside a function body only when it runs, so check every table and column the migration uses against the live `information_schema` (read-only), and say in your output that the real-schema run is still owed.

- Branch from `master`, PR to `master`; there is no intermediate branch. `develop` IS DEAD: never target, merge to or promote through it (`docs/release-process.md` is stale on this). Nick tests on production (https://vibecodes.co.uk), not staging.
- Batching: every merge to `master` is one paid production build, so put same-scope fixes made within about an hour into one PR as separate commits. Ship at once when Nick is waiting, it fixes something broken now, it is release-coupled, or it is a different scope. Never hold a finished fix over an hour.
- Migrations: manual production trigger with an approval gate, forward-only (no rollbacks). Check `supabase/migrations/.held` before applying any "Apply migrations" card and never apply a held one.

## Procedures

### Adding shadcn/ui
`npx shadcn@latest add <name>` → `src/components/ui/` (don't edit manually, except `markdown.tsx`)

### Testing
- Write tests for all new pure logic, validators, parsers, utilities
- Tests co-located as `*.test.ts` / `*.test.tsx`
- E2E: `e2e/fixtures/constants.ts` for shared constants, `scopedTitle()` for unique data
- Scope locators to `page.getByRole("main")` to avoid strict mode violations
- E2E auth uses API-based login (service-role client) to bypass Turnstile CAPTCHA — not browser login
- CI matrix: Chrome + Mobile Chrome only (Firefox dropped)
- E2E specs live in per-area subfolders (`e2e/board/`, `e2e/auth/`, `e2e/ideas/`, …) — not flat in `e2e/`
- The guide pages (`src/app/guide/`) describe features in detail, counts and lists included. When a change alters any of that, search every guide page for the old wording and numbers.
- Run the full `npm run test` before pushing — the whole unit suite takes ~10s

## .vibecodes/ Config

```json
{ "ideaId": "...", "ideaTitle": "..." }
```

Auto-injects `idea_id` into MCP tool calls. Optional extra keys (`taskId`,
`botId`, `defaultColumn`) are supported but this repo's own config sets only the
two above. This project's `ideaId` is `62e57071-3645-422f-96c0-b2042e39e6dd`.

## Project Structure

`src/actions/` (server actions, one file per area), `src/app/` (App Router: `(auth)`, `(main)`, `api`, `guide`, `changelog`), `src/components/` (one directory per area; `board/` is the largest; `ui/` is shadcn, don't edit), `src/hooks/`, `src/lib/` (shared modules, `supabase/` clients, `terminal/`), `src/types/` (`database.ts` is manual), `mcp-server/src/`, `terminal/` (bridge, relay, helper, shared, test), `middleware.ts` at the REPO ROOT. Full tree: `.claude/rules/reference-structure.md`.

## Area rules

Area rules live in `.claude/rules/` and load when you open files in that area: terminal, workflows/MCP, database, AI, auth, board/templates, env, release. If you can't see one (Codex, or before opening files), read the matching file.
