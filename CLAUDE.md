# VibeCodes - Project Guide

## Quick Reference

- **Dev server**: `npm run dev` (http://localhost:3000)
- **Build**: `npm run build`
- **Lint**: `npm run lint`
- **Test**: `npm run test` (Vitest) / `npm run test:watch` / `npm run test:e2e` (Playwright)
- **Supabase**: `npm run supabase:start` / `npm run supabase:stop` / `npm run supabase:reset` / `npm run supabase:migrate`

## Tech Stack

Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui (New York, Zinc), Supabase (Auth, Postgres, Realtime, RLS), Vercel AI SDK (`ai` + `@ai-sdk/anthropic`), mcp-handler (remote MCP + OAuth 2.1), Sentry, Resend, PostHog, Vitest + Playwright, zod v4, @dnd-kit, sonner, vaul, next-themes (dark default), cmdk (command palette), react-markdown + rehype-highlight + remark-gfm, date-fns, lucide-react, @marsidev/react-turnstile

## Workflow Rules (MANDATORY)

### Board Task Workflow — BEFORE ANY IMPLEMENTATION
1. **Check the VibeCodes board** for a matching task (`get_my_tasks` or `get_board`)
2. **If task exists:** Reassign to yourself, move to "In Progress", read all comments (`get_task`), add a comment
3. **If no task exists:** Proceed normally, consider creating one
4. **When finished:** Move to "Verify" with summary comment
5. **Post research/analysis as task comments** — preserve context for future sessions
6. **NEVER use raw SQL** for board ops — always use VibeCodes MCP tools

Applies even when resuming from context compaction or implementing a provided plan.

### Push to Live = Move Verify to Done
After pushing, move ALL "Verify" tasks to "Done" on the VibeCodes board.

### Blocked Tasks
Move to "Blocked/Requires User Input" with a comment explaining why.

## Key Patterns (Bug Prevention)

### Supabase Types
- `src/types/database.ts` is **manually maintained** — each table MUST have `Row`, `Insert`, `Update`, AND `Relationships`
- Without `Relationships`, Supabase JS v2.95+ resolves insert/update/delete to `never`
- Use `.maybeSingle()` instead of `.single()` when row might not exist

### Next.js 16
- `params`, `searchParams`, `cookies()` are all `Promise` types — must `await`
- Server Actions in `src/actions/` with `"use server"`
- `redirect()` throws — re-throw errors with `digest` starting with `NEXT_REDIRECT` in client catch blocks
- All client catch blocks should `toast.error()` — never fail silently

### Concurrency Guards
- All workflow step mutations use `.eq("status", expected)` + `.maybeSingle()` — prevents concurrent claims/double-completions
- Same pattern used for collaboration requests (`.eq("status", "pending")`) and discussion conversion
- Shared `checkAndCompleteRun()` helper in `src/lib/workflow-helpers.ts`

### Identity Enforcement
- MCP `complete_step`/`fail_step` + server actions reject calls where user doesn't match `step.bot_id`
- Exception: `awaiting_approval` steps skip identity check (humans approve those)
- Steps with `bot_id = null` are not affected

### AI Access Resolution
- `resolveAiProvider()` in `src/lib/ai-helpers.ts`: BYOK key → platform key with credits → error
- `requireAiAccess()` for server actions (throws on failure), `getAiAccess()` for UI gating
- AI API routes use `maxDuration = 300` for Vercel function timeout

### Logging
- Use `logger.*` from `src/lib/logger.ts`, NOT `console.*`
- Structured JSON output; level via `LOG_LEVEL` env var (default: `warn` prod, `debug` dev)

### Auth & Middleware
- Middleware protects `/dashboard`, `/ideas`, `/members`, `/profile`, `/admin`, `/agents`, `/feed`
- Middleware excludes `.well-known`, `api/mcp`, `api/oauth`, `oauth`, `monitoring`, `sw.js`, `ingest`, `callback`
- `useUser()` hook for client-side auth state

### Board
- `BoardOpsContext` for optimistic UI — returns rollback functions
- Columns lazy-initialized on first visit; position gap: 1000
- `is_done_column` marks complete columns; dashboard excludes these + archived tasks
- Activity logged client-side via `logTaskActivity()` fire-and-forget

### Dashboard Activation
- `computeIsActivated()` in `src/lib/dashboard-activation.ts`
- Formula: `hasTasks (>=3) && (hasAgents || hasWorkflows || hasMcpConnection) && (hasUserActivity || hasMcpConnection)`
- Prevents premature graduation after onboarding auto-creates content via kits

### Workflow Orchestration
- Claude Code orchestrates: `claim_next_step` → `set_agent_identity` → execute → `complete_step` → loop
- `claim_next_step` returns `bot_id`, `available_agents`, `context` (prior step outputs), `rework_instructions`
- `human_check_required` routes to `awaiting_approval` instead of `completed`
- `fail_step` with `reset_to_step_id` enables cascade rejection back to any earlier step

## Database

40 tables with RLS (`supabase/migrations/`):
- **Core**: users, ideas, comments, collaborators, votes, notifications, feedback, idea_attachments
- **Board**: board_columns, board_tasks, board_labels, board_task_labels, board_checklist_items, board_task_activity, board_task_comments, board_task_attachments
- **Workflows**: workflow_templates, workflow_auto_rules, workflow_runs, task_workflow_steps, workflow_step_comments, workflow_library_templates
- **Discussions**: idea_discussions, idea_discussion_replies, discussion_votes, discussion_attachments
- **Agents**: bot_profiles, idea_agents, agent_votes, featured_teams, featured_team_agents
- **Project Kits**: project_kits, kit_workflow_mappings
- **AI**: ai_usage_log, ai_prompt_templates
- **MCP**: mcp_oauth_clients, mcp_oauth_codes, mcp_tool_log, mcp_tool_stats
- **Collaboration**: collaboration_requests

Board tables use `is_idea_team_member()` RLS function. `is_super_admin` separates destructive ops from general admin access.

## MCP Server

Two modes sharing 77 tools via `mcp-server/src/register-tools.ts`:
- **Local (stdio)**: `mcp-server/src/index.ts` — service-role client, bypasses RLS
- **Remote (HTTP)**: `src/app/api/mcp/[[...transport]]/route.ts` — OAuth 2.1 + PKCE, per-user RLS

Identity: `set_agent_identity` persists to DB (`users.active_bot_id`). `ctx.userId` = active identity, `ctx.ownerUserId` = real human. Must exclude MCP/OAuth paths from Next.js middleware.

## Environment Variables

```
# App
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_APP_URL
SUPABASE_SERVICE_ROLE_KEY, API_KEY_ENCRYPTION_KEY
NOTIFICATION_WEBHOOK_SECRET

# AI
ANTHROPIC_API_KEY, PLATFORM_AI_DAILY_LIMIT (default 50)

# Third-party
NEXT_PUBLIC_SENTRY_DSN, SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT
RESEND_API_KEY
NEXT_PUBLIC_TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY
NEXT_PUBLIC_POSTHOG_KEY

# Logging
LOG_LEVEL (default: warn prod, debug dev)

# MCP (stdio mode)
SUPABASE_URL, VIBECODES_BOT_ID, VIBECODES_OWNER_ID
```

## Deployment

See `docs/release-process.md` for full details.

| Environment | URL | Branch | Database |
|---|---|---|---|
| Local | http://localhost:3000 | any | Docker Supabase |
| Staging | https://staging.vibecodes.co.uk | `develop` | Staging Supabase project |
| Production | https://vibecodes.co.uk | `master` | Production Supabase project |

- Feature branches → PR to `develop` → PR to `master`
- Hotfixes branch directly from `master`
- Migrations: auto-apply staging on merge, manual production trigger with approval gate
- Migrations cannot be rolled back — only corrective forward migrations
- Monitoring: Sentry (source maps), Vercel Analytics + Speed Insights, PostHog (reverse-proxied via `/ingest`)

## Procedures

### Adding DB Tables
1. Migration in `supabase/migrations/`
2. Types in `src/types/database.ts` (include `Relationships`)
3. Export in `src/types/index.ts`

### Adding shadcn/ui
`npx shadcn@latest add <name>` → `src/components/ui/` (don't edit manually, except `markdown.tsx`)

### Testing
- Write tests for all new pure logic, validators, parsers, utilities
- Tests co-located as `*.test.ts` / `*.test.tsx`
- E2E: `e2e/fixtures/constants.ts` for shared constants, `scopedTitle()` for unique data
- Scope locators to `page.getByRole("main")` to avoid strict mode violations
- E2E auth uses API-based login (service-role client) to bypass Turnstile CAPTCHA — not browser login
- CI matrix: Chrome + Mobile Chrome only (Firefox dropped)
- 11 E2E spec files across auth, board, onboarding, and workflows

## .vibecodes/ Config

```json
{ "ideaId": "...", "ideaTitle": "...", "taskId": "...", "botId": "...", "defaultColumn": "..." }
```

Auto-injects `idea_id` into MCP tool calls from `.vibecodes/config.json`.

## Project Structure

```
src/
├── actions/       # 22 server action files ("use server")
├── app/           # Next.js App Router
│   ├── (auth)/    # Login, signup, password reset, callback
│   ├── (main)/    # Admin, agents, dashboard, feed, ideas, members, profile
│   ├── api/       # AI, health, MCP, notifications, OAuth
│   ├── guide/     # 9 help/guide pages
│   ├── changelog/ # Public changelog
│   └── ...        # Privacy, terms, feed.xml, .well-known
├── components/    # 20 directories, ~170 component files
│   ├── ui/        # shadcn/ui primitives (don't edit except markdown.tsx)
│   └── ...        # admin, agents, ai, board, comments, dashboard,
│                  # discussions, guide, ideas, kits, landing, layout,
│                  # members, onboarding, posthog, profile, pwa, shared
├── data/          # Static data (changelog entries)
├── hooks/         # Custom hooks (use-media-query, use-mentions,
│                  # use-realtime, use-scroll-to-hash, use-user)
├── lib/           # ~30 utility/helper modules + supabase/ client setup
├── test/          # Test utilities
└── types/         # database.ts (manual), index.ts
mcp-server/src/    # MCP server (shared tools, 22 tool files)
```
