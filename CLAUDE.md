# VibeCodes - Project Guide

## Quick Reference

- **Dev server**: `npm run dev` (http://localhost:3000)
- **Build**: `npm run build`
- **Lint**: `npm run lint` — **Typecheck**: `npm run typecheck`
- **Test**: `npm run test` (Vitest) / `npm run test:watch` / `npm run test:e2e` (Playwright, also `:ui` / `:headed`)
- **Supabase**: `npm run supabase:start` / `:stop` / `:reset` / `:migrate` / `:studio`
- **Migration drift check**: `npm run check:migrations`

## Tech Stack

Next.js 16.1.6 (App Router), React 19.2, TypeScript, Tailwind CSS v4, shadcn/ui (New York, Zinc), Supabase (Auth, Postgres, Realtime, RLS), Vercel AI SDK v6 (`ai` + `@ai-sdk/anthropic` v3), mcp-handler (remote MCP + OAuth 2.1), xterm.js + node-pty (in-app terminal), Sentry, Resend, PostHog, Vitest v4 + Playwright, zod v4, @dnd-kit, sonner, vaul, next-themes (dark default), cmdk (command palette), react-markdown + rehype-highlight + remark-gfm, date-fns, lucide-react, @marsidev/react-turnstile

## Workflow Rules (MANDATORY)

### Board Task Workflow — BEFORE ANY IMPLEMENTATION
1. **Check the VibeCodes board** for a matching task (`get_my_tasks` or `get_board`)
2. **If task exists:** Reassign to yourself, move to "In Progress", read all comments (`get_task`), add a comment
3. **If no task exists:** Proceed normally, consider creating one
4. **When finished:** Move to "Verify" with summary comment
5. **Post research/analysis as task comments** — preserve context for future sessions
6. **NEVER use raw SQL** for board ops — always use VibeCodes MCP tools

Applies even when resuming from context compaction or implementing a provided plan.

### Push to Live = Move YOUR Task to Verify
After pushing, move only the specific task you worked on to "Verify" (or "Done"). NEVER batch-move other tasks in the Verify column — those belong to other contributors.

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
- MCP `complete_step`/`fail_step` verify the step's `claim_token`; completion is attributed to `step.bot_id` regardless of the caller's connection identity
- Agent-voiced comments require the step's live `work_token`; rejected tokens log a structured warn (the attribution-anomaly signal)
- `approve_step`/rejection of `awaiting_approval` steps are human-gated (no claim token needed; bot identities blocked)
- Steps with `bot_id = null` are not affected

### AI Access Resolution
- `resolveAiProvider()` in `src/lib/ai-helpers.ts`: BYOK key → platform key with credits → error
- `requireAiAccess()` for server actions (throws on failure), `getAiAccess()` for UI gating
- AI API routes use `maxDuration = 300` for Vercel function timeout

**Model update cadence**: to change the model, set `ANTHROPIC_MODEL` (or bump the default `AI_MODEL` in `src/lib/ai-helpers.ts:12` — currently `claude-sonnet-5` — which also drives `WORKFLOW_MATCHING_MODEL`). Before flipping, verify the resolved key(s) accept the new id via a real prod call that produces an `ai_usage_log` row — on the platform key AND a BYOK key (we were burned by a Haiku swap the account key rejected).

### In-App Terminal (largest active workstream — most current board cards)

Runs Claude Code in the browser, against the user's **own machine**. Three
processes, bytes forwarded verbatim end to end:

```
claude --[node-pty PTY]--> BRIDGE --ws--> RELAY (CF Worker + DO) --ws--> BROWSER (xterm.js)
        (user's machine)   terminal/bridge   terminal/relay              terminal-dock.tsx
```

- **`terminal/`** (outside `src/`): `bridge/` (local Node + node-pty), `relay/`
  (Cloudflare Worker, one Durable Object per session, pairs exactly one bridge
  leg to one browser leg, enforces single-attach, never parses stream content),
  `helper/` (the installable Mac app users download), `shared/`, `test/`, and
  `RUN.md` — read RUN.md before touching any of it.
- **`src/lib/terminal/`** — 26 modules. The pure logic lives here and is where
  tests go: `entry-decision.ts` (reconnect vs chooser vs mint), `chooser-data.ts`
  (dedupe, 48h recent window, per-task matching), `session-registry.ts`,
  `session-cap.ts`, `session-reap.ts`, `helper-version.ts` / `helper-update-flow.ts`,
  `relay-budget.ts`, `machine-identity.ts`, `deep-link.ts`.
- **`src/components/board/terminal-*.tsx`** — 8 components. `terminal-dock.tsx`
  is the orchestrator (tabs, chooser, overlays, pop-out) and is by far the most
  intricate; `terminal-session-view.tsx` owns one xterm instance.
- **API**: `src/app/api/terminal/` — `session` (mint), `session/[sid]`,
  `session/list`, `session/end`, `session/closed`, `session/reattach`,
  `helper/status`, `helper/command`. Excluded from middleware (does its own
  `supabase.auth.getUser()`).
- **Auth**: app and relay share `TERMINAL_SESSION_SECRET` (HMAC-SHA256) to sign
  short-lived, owner-bound session tokens. Never in code.

**Rules learned the hard way (each one is a fixed bug — don't regress them):**
- **Never trap the user in a dialog.** Launch dialogs were built undismissable
  on the theory that a fired launch must resolve to one outcome. Nothing is
  minted until a click, so backing out is always free and must always be
  possible — close button, Escape and outside-click, all modes.
- Swapping the dock body tears down the xterm instance, socket and scrollback —
  only use an overlay when a **live** tab genuinely needs protecting; otherwise
  render in the panel.
- A popped-out tab reports a misleading status (mid-preemption) while very much
  alive elsewhere — never read it as ended or errored.
- Sessions with no recorded folder can't be resumed; hide them from the chooser
  but keep them in the internal reconnect check.
- **The recorded project folder is always the MAIN checkout, never a worktree.**
  A second concurrent in-app session runs in `<repo>/.claude/worktrees/<id>`
  (`claude --worktree`); its `pwd` must never be stored as the project folder.
  `stripClaudeWorktreeSuffix` collapses it on every write AND read path
  (self-heals poisoned rows). Only isolate when the mint route says another
  session is already live on the board (`isolate: true`) — the first/only
  session works in the main folder. Never tell a session to `cd` between the
  two. Don't add words to the compact prompt's protected head: the realistic
  repo-backed launch link is within ~5 chars of its cap (deep-link.test.ts).
- **The browser launch link never drops the folder to make the prompt fit.**
  `buildBoundedDeepLink` is called with `cwdPolicy: "keep"` from
  `use-terminal-session.ts`: the prompt degrades around `cwd=` (directory echo
  → full work step → compact work step → head only), and a folder that can't
  fit at all refuses to launch (toast). The old ladder dropped `cwd=` on a
  long-titled board; the bridge then spawned claude at `/` (a helper-forked
  process's cwd), the prompt said "cd in first", and the agent cd'd into and
  *recorded* another project's checkout as that board's folder (29 Aug 2026).
  The terminal-window (claude-cli://) launch keeps the default "degrade" ladder.

### Logging
- Use `logger.*` from `src/lib/logger.ts`, NOT `console.*`
- Structured JSON output; level via `LOG_LEVEL` env var (default: `warn` prod, `debug` dev)

### Auth & Middleware
- `middleware.ts` lives at the **repo root**, not in `src/`; the protected-path list it calls into is in `src/lib/supabase/middleware.ts`
- Protected: `/dashboard`, `/ideas`, `/members`, `/profile`, `/admin`, `/agents` (**not** `/feed` — that is public)
- Matcher excludes `.well-known`, `api/mcp`, `api/oauth`, `api/terminal`, `oauth`, `callback`, `monitoring`, `ingest`, `sw.js`, static assets
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
- Claude Code orchestrates: `claim_next_step` → spawn persona subagent (hand it the `work_token`) → execute → `complete_step` with `claim_token` → loop
- `claim_next_step` returns `claim_token` (single-use, completion), `work_token` (multi-use, agent-voiced comments), `bot_id`, `available_agents`, `context` (prior step outputs), `rework_instructions`
- Comments posted with `work_token` are authored as the step's agent; without it, as the human; invalid/retired tokens are rejected with an actionable error
- `human_check_required` routes to `awaiting_approval` instead of `completed`
- `fail_step` with `reset_to_step_id` enables cascade rejection back to any earlier step
- Completion is attributed to the step's `bot_id` via the claim token; both token hashes are cleared together on complete/fail/reset/approve

### Personal Template Library
- Users can save per-idea workflow templates to `user_workflow_templates` for reuse across boards
- "Save to My Templates" button on template detail header (emerald styled, transitions to "Saved")
- Unified "Add Template" dialog with 3 tabs: My Templates / Platform Templates / Create New
- Smart default tab: opens on "My Templates" if user has saved templates, else "Platform Templates"
- Single "+" button in workflows sidebar replaces old book + plus icons
- Server actions in `src/actions/user-templates.ts`: save, list, delete, isTemplateSaved, importFromMyTemplate
- Copy-based: templates are copied, not referenced — no cross-idea dependencies

## Database

**159 migrations** in `supabase/migrations/`. `src/types/database.ts` types **48** tables:

- **Core**: users, ideas, comments, collaborators, votes, notifications, feedback, idea_attachments
- **Board**: board_columns, board_tasks, board_labels, board_task_labels, board_task_activity, board_task_comments, board_task_attachments
- **Workflows**: workflow_templates, workflow_auto_rules, workflow_runs, task_workflow_steps, workflow_step_comments, workflow_library_templates, user_workflow_templates, workflow_suggestions
- **Discussions**: idea_discussions, idea_discussion_replies, discussion_votes, discussion_attachments
- **Agents**: bot_profiles, idea_agents, agent_votes, agent_skills, featured_teams, featured_team_agents
- **Terminal**: idea_project_paths (recorded project folder per idea + machine)
- **AI**: ai_usage_log, ai_prompt_templates, idea_role_match_cache, platform_settings
- **MCP**: mcp_oauth_clients, mcp_oauth_codes, mcp_tool_log, mcp_tool_stats, mcp_agent_sessions (retired with `set_agent_identity`; dropped in the pending Phase B task ec2bde45)
- **User/integration**: user_api_keys, user_github_connections, github_oauth_states, pending_uploads
- **Collaboration**: collaboration_requests

Board tables use `is_idea_team_member()` RLS function. `is_super_admin` separates destructive ops from general admin access.

### ⚠️ Tables that exist in the DB but are MISSING from `database.ts`

`database.ts` is hand-maintained, and it has drifted. These are created by migrations but have no typed entry, so any query against them resolves to `never` — add the full `Row`/`Insert`/`Update`/`Relationships` block before using them:

`terminal_sessions` (migrations 00141, 00157 — the in-app terminal's own session store), `project_kits`, `kit_workflow_mappings`, `bot_profile_prompt_backups`.

(`board_checklist_items` also appears in migrations but was later dropped — it is correctly absent, don't re-add it.)

## MCP Server

Two modes sharing **85 tools** via `mcp-server/src/register-tools.ts` (21 tool files in `mcp-server/src/tools/`):

Usage steering (shipped Aug 2026, task b3b9be67): `mcp-server/src/steering-copy.ts` single-sources the "board data is live — call the tool again, never re-parse earlier output" copy; both transports pass it as the MCP server-level `instructions`, the three board read tools (`get_board`/`get_task`/`get_my_tasks`) carry it in their descriptions, and their responses are stamped via `jsonResult(data, { live: true })` with `generated_at` (first key) + `_reminder` (last key). Tool calls are logged to `mcp_tool_log` with `session_id` (migration 00160; admin queries documented in the migration comments).
- **Local (stdio)**: `mcp-server/src/index.ts` — service-role client, bypasses RLS
- **Remote (HTTP)**: `src/app/api/mcp/[[...transport]]/route.ts` — OAuth 2.1 + PKCE, per-user RLS

Identity: completion attribution flows from the `claim_token`, comment voice from the `work_token` (both minted by `claim_next_step`); `set_agent_identity` is a deprecation-error stub (Phase B removes it — see task ec2bde45). `ctx.userId` = the authenticated human (stdio: the configured `VIBECODES_BOT_ID`), `ctx.ownerUserId` = real human. Must exclude MCP/OAuth paths from Next.js middleware.

## Environment Variables

```
# App
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_APP_URL
SUPABASE_SERVICE_ROLE_KEY, API_KEY_ENCRYPTION_KEY
NOTIFICATION_WEBHOOK_SECRET

# AI
ANTHROPIC_API_KEY, ANTHROPIC_MODEL, PLATFORM_AI_DAILY_LIMIT (default 50)

# Third-party
NEXT_PUBLIC_SENTRY_DSN, SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT
RESEND_API_KEY
NEXT_PUBLIC_TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY
NEXT_PUBLIC_POSTHOG_KEY

# Logging
LOG_LEVEL (default: warn prod, debug dev)

# GitHub integration
GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET

# In-app terminal
TERMINAL_SESSION_SECRET          # HMAC secret shared with the relay — never in code
NEXT_PUBLIC_TERMINAL_ENABLED     # feature flag (removal tracked by card 139c633c)
NEXT_PUBLIC_TERMINAL_RELAY_URL, NEXT_PUBLIC_TERMINAL_SESSION_CAP
TERMINAL_SESSION_CAP, TERMINAL_MINT_RATE_LIMIT, TERMINAL_HELPER_VERSION
TERMINAL_DAILY_BUDGET, TERMINAL_BUDGET_SOFT_PCT, TERMINAL_ASSUMED_REQUESTS_PER_SESSION

# MCP (stdio mode)
SUPABASE_URL, VIBECODES_BOT_ID, VIBECODES_BOT_USER_ID, VIBECODES_OWNER_ID
```

**⚠️ Blank-env hazard**: Vercel "sensitive" env vars can silently store blank via
the CLI — this caused a full AI outage. Any `process.env.X ?? default` passes `""`
straight through; use `.trim() || default`. See `AI_MODEL` in `ai-helpers.ts:12`
for the correct pattern.

## Deployment

See `docs/release-process.md` for full details.

| Environment | URL | Branch | Database |
|---|---|---|---|
| Local | http://localhost:3000 | any | Docker Supabase |
| Production | https://vibecodes.co.uk | `master` | Production Supabase project |

**Branch from `master`, PR to `master`. There is no intermediate branch.**

`develop` IS DEAD — do not target it, do not merge to it, do not "promote" through
it. Its last commit was 18 March 2026; it now sits 751 commits behind `master`
with 4 orphaned commits of its own. Every PR since March has gone feature branch
→ `master` directly. `docs/release-process.md` still documents the old two-branch
flow and is stale on this point (it half-admits it: "features are tested via PRs
to master instead"). CI workflow files still *list* `develop` as a trigger — that
is vestigial, not a signal that it's live.

Staging (`staging.vibecodes.co.uk`) is not part of the flow either; its database
is known-broken — see the board card "Recreate staging database properly (via
Supabase Branching off prod)".

### Batching Merges

Every merge to `master` triggers one paid production build — cost scales with
merge *count*, not diff size. Batch same-area fixes (same conventional-commit
scope) when nobody is waiting: if you're about to open a second PR in the same
scope within about an hour of the first, and neither is urgent, put them in
one PR as separate commits instead.

Ship immediately, no batching, when: Nick is waiting to test it live; it fixes
something broken for users right now or reverts a regression; it's
release-coupled (helper version bump, relay deploy, migration); or it's a
different scope from the fix you're already holding. Never sit on a finished
fix more than an hour waiting for a batch-mate — when in doubt, ship it.

- Migrations: manual production trigger with approval gate (the develop→staging
  auto-apply path in `migrations.yml` no longer fires, since nothing lands on
  `develop`)
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
- **22 E2E spec files**, in per-area subfolders (`e2e/board/`, `e2e/auth/`, `e2e/ideas/`, …) — not flat in `e2e/`
- Current unit suite: **3,137 tests across 189 files** — run the full `npm run test` before pushing; it takes ~10s

## .vibecodes/ Config

```json
{ "ideaId": "...", "ideaTitle": "..." }
```

Auto-injects `idea_id` into MCP tool calls. Optional extra keys (`taskId`,
`botId`, `defaultColumn`) are supported but this repo's own config sets only the
two above. This project's `ideaId` is `62e57071-3645-422f-96c0-b2042e39e6dd`.

## Project Structure

```
src/
├── actions/       # 30 server action files ("use server")
├── app/           # Next.js App Router
│   ├── (auth)/    # Login, signup, password reset, callback
│   ├── (main)/    # Admin, agents, dashboard, feed, ideas, members, profile
│   ├── api/       # AI, health, MCP, notifications, OAuth
│   ├── guide/     # 12 help/guide pages (incl. launching-claude-code, project-kits)
│   ├── changelog/ # Public changelog
│   └── ...        # Privacy, terms, feed.xml, .well-known
├── components/    # 20 directories, ~228 component files (board/ alone has 56)
│   ├── ui/        # shadcn/ui primitives (don't edit except markdown.tsx)
│   └── ...        # admin, agents, ai, auth, board, comments, dashboard,
│                  # discussions, guide, ideas, kits, landing, layout,
│                  # members, onboarding, posthog, profile, pwa, shared
├── data/          # Static data (changelog entries)
├── hooks/         # 11 hooks (use-media-query, use-mentions, use-realtime,
│                  # use-scroll-to-hash, use-user, use-debounced-save,
│                  # use-keyboard-shortcut, use-now, use-platform-model-defaults,
│                  # use-viewer-model-tier-map, use-launch-path-pin-migration)
├── lib/           # 47 top-level modules + supabase/ client setup
│                  # + terminal/ (26 modules — see In-App Terminal above)
├── test/          # Test utilities
└── types/         # database.ts (manual), index.ts
mcp-server/src/    # MCP server (85 tools across 21 tool files)
terminal/          # bridge / relay / helper / shared / test — see In-App Terminal
middleware.ts      # at the REPO ROOT, not in src/
```
