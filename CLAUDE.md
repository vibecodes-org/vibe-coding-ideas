# VibeCodes - Project Guide

## Quick Reference

- **Dev server**: `npm run dev` (http://localhost:3000)
- **Build**: `npm run build`
- **Lint**: `npm run lint`
- **Test**: `npm run test` (Vitest) / `npm run test:watch` / `npm run test:e2e` (Playwright)
- **Supabase**: `npm run supabase:start` / `npm run supabase:stop` / `npm run supabase:reset` / `npm run supabase:migrate`

## Tech Stack

Next.js 16 (App Router), TypeScript, Tailwind CSS v4 (`@import "tailwindcss"`), shadcn/ui (New York, Zinc), Supabase (Auth, Postgres, Realtime, RLS), next-themes (dark default), @dnd-kit (kanban), sonner (toasts), Vitest + Playwright, Vercel AI SDK (`ai` + `@ai-sdk/anthropic`), mcp-handler (remote MCP + OAuth 2.1), Sentry (`@sentry/nextjs` for error tracking), Resend (email notifications), Vercel Analytics + Speed Insights

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
- Foreign key joins: `users!ideas_author_id_fkey(*)`

### Next.js 16
- `params`, `searchParams`, `cookies()` are all `Promise` types — must `await`
- Server Actions in `src/actions/` with `"use server"`
- `redirect()` throws — re-throw errors with `digest` starting with `NEXT_REDIRECT` in client catch blocks
- All client catch blocks should `toast.error()` — never fail silently
- Error boundaries (`error.tsx`) report to Sentry via `Sentry.captureException()`; root uses `global-error.tsx`

### Auth
- Middleware protects `/dashboard`, `/ideas`, `/profile`, `/admin`, `/agents`
- Middleware excludes `.well-known`, `api/mcp`, `api/oauth`, `oauth`, `monitoring`, `sw.js`
- `useUser()` hook for client-side auth state
- OAuth (GitHub + Google) + email/password with forgot/reset flow + Cloudflare Turnstile CAPTCHA

### Board
- `BoardOpsContext` (`board-context.tsx`) for optimistic UI — returns rollback functions
- Board columns lazy-initialized on first visit; uses `users.default_board_columns` preference or defaults ("Backlog", "To Do", "Blocked/Requires User Input", "In Progress", "Verify", "Done")
- `board_columns.is_done_column` marks complete columns; dashboard excludes these + archived tasks
- Activity logged client-side via `logTaskActivity()` fire-and-forget
- Position calculation: `MAX(position) + 1000` in target column
- Public boards have read-only guest access; non-team guests see `GuestBoardBanner` with option to request collaboration

### Board Workflows
- **Templates**: `workflow_templates` table (idea-scoped) — reusable step sequences with role, description, approval gates
- **Auto-Rules**: `workflow_auto_rules` table — maps labels to templates; Postgres trigger on `board_task_labels` INSERT auto-applies template when a task gets a matching label
- **Workflow Runs**: `workflow_runs` tracks each application of a template to a task (pending → running → paused → completed → failed)
- **Task Workflow Steps**: `task_workflow_steps` replaces old checklists — steps have status lifecycle (pending → in_progress → completed/failed/awaiting_approval), agent_role, bot_id, output, human_check_required
- **Step Comments**: `workflow_step_comments` for inter-agent communication (types: comment, output, failure, approval, changes_requested)
- **Claude Code as Orchestrator**: No designated orchestrator agent — Claude Code reads steps via `claim_next_step`, assumes agent personas per step's `agent_role`, executes, calls `complete_step`, loops
- **Role-based Auto-Matching**: When applying a template, agents from the idea's pool are auto-matched to steps by role (case-insensitive)
- **Template Library**: `workflow_library_templates` DB table (admin-managed) — seeded with 7 built-in templates; admin CRUD via `/admin?tab=templates` (`AdminTemplatesDashboard` + `TemplateEditorDialog`); `ImportTemplateLibraryDialog` fetches active templates from DB; RLS: all authenticated SELECT, admin-only write
- **Board UI**: `BoardPageTabs` wraps board in tabs (Board / Workflows); `WorkflowsTab` for template CRUD + auto-rules + library import + onboarding guidance; `CreateTemplateDialog` for new templates; `TaskWorkflowSection` in task detail dialog shows live workflow steps with status badges, progress bar, realtime updates, inline approve/retry buttons, and "Apply Workflow" CTA when no workflow exists; `StepDetailDialog` shows step description, output, comments, timestamps, and action buttons (start/complete/approve/reject/retry); `getRoleBadgeClasses` shared between components
- **Approval gates**: Both MCP `complete_step` tool and `completeWorkflowStep` server action respect `human_check_required` — routes to `awaiting_approval` instead of `completed`
- **Cascade rejection**: `failWorkflowStep` server action and MCP `fail_step` tool accept optional `reset_to_step_id` — resets all steps from target onward back to `pending`, enabling reviewers to send work back to any earlier step in the pipeline
- **Rework instructions**: MCP `claim_next_step` returns `rework_instructions` (previous failure output + `changes_requested` comments) when claiming a step that was previously failed, giving agents context for retry
- **Agent match feedback**: `TaskWorkflowSection` shows a warning banner when pending steps have roles with no matching agent in the idea's pool
- Server actions in `src/actions/workflow.ts` (step lifecycle) and `src/actions/workflow-templates.ts` (template CRUD + auto-rules)
- MCP tools: 12 tools in `mcp-server/src/tools/workflows.ts` — template CRUD, apply, claim_next_step, complete_step, fail_step, approve_step, get_step_context, add_step_comment, get_step_comments

### Idea Agent Pool
- `idea_agents` junction table: `(idea_id, bot_id, added_by)` with `UNIQUE(idea_id, bot_id)`
- Team members allocate their active bots to an idea's shared pool; all team members can assign pooled bots to tasks
- RLS: team members + public viewers SELECT; team members INSERT own active bots; adder or idea author DELETE
- Trigger on collaborator removal: cleans up all bots that collaborator allocated
- Trigger on agent removal: unassigns bot from all tasks in that idea
- Server actions in `src/actions/idea-agents.ts`: `allocateAgent`, `removeIdeaAgent`
- UI: `IdeaAgentsSection` component on idea detail page (between Collaborators and Description)
- Board dropdown groups pooled agents by owner name instead of flat "My Agents"
- MCP tools: `allocate_agent`, `remove_idea_agent`, `list_idea_agents` in `mcp-server/src/tools/idea-agents.ts`

### Agents Hub
- `/agents` page is tabbed: "My Agents" + "Community" tabs via `AgentsHub` component
- `bot_profiles` extended with `bio`, `skills` (text[]), `is_published`, `community_upvotes`, `times_cloned`, `cloned_from` (FK → self)
- `agent_votes` table for community upvotes with trigger-based denormalization to `bot_profiles.community_upvotes`
- Publishing is opt-in (`is_published`); published agents always show their system prompt; `is_published` filtered at query level (RLS unchanged)
- Clone = independent copy; `cloned_from` FK for provenance only, no live sync
- Featured teams stored in DB (`featured_teams` + `featured_team_agents` junction table); admin-managed via `/admin?tab=teams`
- `addFeaturedTeam(teamId)` clones each team agent into user's account, skipping duplicate roles
- Agent profile pages at `/agents/[id]` — private if not published (except owner); shows stats, skills, prompt display, contributing ideas
- Components in `src/components/agents/`: agents-hub, my-agents-grid, agent-card, create-agent-dialog, edit-agent-dialog, empty-state, community-tab, featured-teams, agent-vote-button, clone-agent-button, agent-profile
- Admin components in `src/components/admin/`: admin-agents-dashboard, create-admin-agent-dialog, admin-teams-dashboard, team-editor-dialog, user-credits-table
- Server actions in `src/actions/bots.ts`: createBot (extended with bio/skills), updateBot (extended with bio/skills/is_published), toggleAgentVote, cloneAgent, addFeaturedTeam
- Admin actions in `src/actions/admin-agents.ts`: createAdminAgent, updateAdminAgent, deleteAdminAgent, createFeaturedTeam, updateFeaturedTeam, deleteFeaturedTeam, toggleFeaturedTeamActive, setTeamAgents
- VibeCodes system user (`VIBECODES_USER_ID` in constants.ts) owns admin agents; admin agents auto-published
- MCP tools: `toggle_agent_vote`, `clone_agent`, `publish_agent`, `list_community_agents`, `list_featured_teams` in `mcp-server/src/tools/bots.ts`
- Avatar upload reuses `avatars` bucket; path: `avatars/{botId}/avatar`, upload after RPC returns bot ID
- `create_bot_user` RPC untouched; new columns set via follow-up UPDATE

### Collaboration Requests
- `collaboration_requests` table with `pending`/`accepted`/`declined` status enum
- Users request access → author accepts/rejects from idea detail page (`pending-requests.tsx`)
- Actions: `requestCollaboration`, `withdrawRequest`, `respondToRequest`, `leaveCollaboration` in `src/actions/collaborators.ts`
- Guards against concurrent responses via `.eq("status", "pending")`

### Discussions
- `idea_discussions` + `idea_discussion_replies` + `discussion_votes` + `discussion_attachments` tables for titled, threaded planning conversations per idea
- Four statuses: `open` → `resolved` (concluded), `ready_to_convert` (queued for agent), or `converted` (promoted to board task)
- Pinnable threads, denormalized `reply_count` + `attachment_count` + `last_activity_at` + `upvotes` via triggers
- `board_tasks.discussion_id` back-links converted discussions to their resulting tasks
- `ideas.discussion_count` denormalized via trigger
- Routes: `/ideas/[id]/discussions` (list), `/ideas/[id]/discussions/[discussionId]` (thread), `/ideas/[id]/discussions/new`
- Server actions in `src/actions/discussions.ts`: createDiscussion, updateDiscussion, deleteDiscussion, createDiscussionReply, updateDiscussionReply, deleteDiscussionReply, toggleDiscussionVote, markReadyToConvert, convertDiscussionToTask
- `convertDiscussionToTask` uses status guard (`.in("status", [...])`) to prevent concurrent conversion, with orphaned task cleanup on failure
- `deleteDiscussion` cleans up storage files from `discussion-attachments` bucket before cascade delete
- RLS: team members can write; authenticated users can read public idea discussions
- Notification types: `discussion`, `discussion_reply`, `discussion_mention` (trigger-based); controlled by `discussions` notification preference (falls back to `comments`)
- **Discussion Attachments**: `discussion_attachments` table with `discussion-attachments` private storage bucket; storage path `{ideaId}/{discussionId}/{uuid}.{ext}`; same allowed types as idea attachments (images, PDF, Markdown, HTML); `DiscussionAttachmentsSection` component in discussion thread; client-side upload via Supabase JS with Realtime, drag-and-drop, paste handling; denormalized `attachment_count` on `idea_discussions`

### Idea Attachments
- `idea_attachments` table with `idea-attachments` private storage bucket (signed URLs for access)
- Client-side upload/download/delete via Supabase JS (no server actions) — same pattern as board task attachments
- Storage path: `{ideaId}/{uuid}.{ext}`; storage.objects RLS uses `is_idea_team_member()` check
- `IdeaAttachmentsSection` component between Description and Comments on idea detail page
- Upload: drag-and-drop, paste images, file picker; optimistic insert (`.select().single()` on insert)
- Realtime subscription for cross-user updates; file extension fallback for MIME type validation (browsers report `.md` as `text/plain`)
- RLS: team members insert, uploader or author delete, public idea viewers can read
- Cleanup on idea deletion in `src/actions/ideas.ts` (removes from both `idea-attachments` and `task-attachments` buckets)

### Email Notifications
- `/api/notifications/email` webhook endpoint, verified via `NOTIFICATION_WEBHOOK_SECRET`
- Triggered by Supabase pg_net webhook on notification inserts
- Sends via Resend API for high-signal types (comment, collaborator, status_change, task_mention, discussion, discussion_reply)
- Respects `users.email_notifications` preference; skips bot users
- Template: `src/lib/email-template.ts` (`buildEmailHtml`)

### AI Starter Credits
- New users get 10 lifetime AI credits (`users.ai_starter_credits`, default 10)
- `resolveAiProvider()` in `src/lib/ai-helpers.ts`: shared access resolution for both server actions and API routes — BYOK key → platform key with credits → error. Returns discriminated union `{ ok: true, anthropic, keyType } | { ok: false, error, status }`
- `requireAiAccess()` in `src/actions/ai.ts` wraps `resolveAiProvider()` for server actions (throws on failure)
- `getAiAccess()` returns `{ canUseAi, hasByokKey, starterCredits }` for UI gating — `canUseAi` means BYOK or credits available, `hasByokKey` means user has their own Anthropic API key
- `getPlatformAnthropicProvider()` in `src/lib/ai-helpers.ts` uses `ANTHROPIC_API_KEY` env var
- `decrement_starter_credit` RPC atomically decrements; `grant_starter_credits` RPC is admin-only
- Onboarding enhance is a separate freebie — doesn't deduct credits
- Daily safety cap: `PLATFORM_AI_DAILY_LIMIT` env var (default 50) prevents abuse
- Credit badge shown on AI Generate button when `!hasByokKey && starterCredits > 0`
- Admin credits dashboard (`/admin?tab=credits`): view/grant credits via `UserCreditsTable` component

### Validation
- `src/lib/validation.ts` — all server actions validate before DB ops
- Limits: title 200, description 50K, comment 5K, discussion body 10K, discussion reply 5K, bio 500, tags 50 chars / 10 max, skills 30 chars / 10 max, team name 200, team description 1K
- Idea/discussion attachments: 10 MB per file, 10 files per idea/discussion, allowed types: images (png/jpg/gif/webp/svg), PDF, Markdown, HTML

## Database

37 tables with RLS (`supabase/migrations/`):
- **Core**: users, ideas, comments, collaborators, votes, notifications, feedback, idea_attachments
- **Board**: board_columns, board_tasks, board_labels, board_task_labels, board_task_activity, board_task_comments, board_task_attachments
- **Workflows**: workflow_templates, workflow_auto_rules, workflow_runs, task_workflow_steps, workflow_step_comments, workflow_library_templates
- **Discussions**: idea_discussions, idea_discussion_replies, discussion_votes, discussion_attachments
- **Agents**: bot_profiles, idea_agents, agent_votes, featured_teams, featured_team_agents
- **AI**: ai_usage_log, ai_prompt_templates
- **MCP/OAuth**: mcp_oauth_clients, mcp_oauth_codes
- **Collaboration**: collaboration_requests

Key columns:
- `users.is_bot`, `users.is_admin`, `users.ai_daily_limit` (default 10), `users.ai_enabled`, `users.ai_starter_credits` (default 10, lifetime), `users.default_board_columns`, `users.email_notifications`, `users.active_bot_id`, `users.encrypted_anthropic_key`
- `ideas.visibility` (public/private) enforced by RLS
- Denormalized counts on ideas (upvotes, comment_count, collaborator_count, discussion_count, attachment_count) via triggers
- `admin_delete_user` RPC cascades from auth.users; `admin_delete_bot_user` + `admin_update_bot_user` RPCs for admin agent management
- Board tables use `is_idea_team_member()` RLS function

## Server Actions (src/actions/)

21 files, 117 exported functions:
- `ideas.ts` — create, update, updateStatus, updateIdeaFields (partial inline edit), delete
- `board.ts` — columns (init, CRUD, reorder), tasks (CRUD, move, archive), labels (CRUD, assign), task comments (create, update, delete)
- `workflow.ts` — createWorkflowStep, updateWorkflowStep, deleteWorkflowStep, startWorkflowStep, completeWorkflowStep, failWorkflowStep, approveWorkflowStep, retryWorkflowStep, addStepComment, deleteStepComment
- `workflow-templates.ts` — listWorkflowTemplates, createWorkflowTemplate, updateWorkflowTemplate, deleteWorkflowTemplate, applyWorkflowTemplate, listWorkflowAutoRules, createWorkflowAutoRule, updateWorkflowAutoRule, deleteWorkflowAutoRule
- `collaborators.ts` — requestCollaboration, withdrawRequest, respondToRequest, leaveCollaboration, addCollaborator, removeCollaborator
- `ai.ts` — enhanceIdeaDescription, generateClarifyingQuestions, enhanceIdeaWithContext, applyEnhancedDescription, generateBoardTasks, enhanceTaskDescription, enhanceDiscussionBody, getAiAccess, hasApiKey (deprecated)
- `comments.ts` — create, incorporate, delete, update
- `votes.ts` — toggleVote
- `notifications.ts` — markNotificationsRead, markAllNotificationsRead, updateNotificationPreferences
- `profile.ts` — updateProfile, updateDefaultBoardColumns, saveApiKey, removeApiKey
- `bots.ts` — createBot, updateBot, deleteBot, listMyBots, toggleAgentVote, cloneAgent, addFeaturedTeam
- `admin-agents.ts` — createAdminAgent, updateAdminAgent, deleteAdminAgent, createFeaturedTeam, updateFeaturedTeam, deleteFeaturedTeam, toggleFeaturedTeamActive, setTeamAgents
- `admin-templates.ts` — listLibraryTemplates, createLibraryTemplate, updateLibraryTemplate, deleteLibraryTemplate
- `admin.ts` — grantStarterCredits
- `users.ts` — deleteUser (admin only)
- `prompt-templates.ts` — list, create, delete
- `discussions.ts` — createDiscussion, updateDiscussion, deleteDiscussion, createDiscussionReply, updateDiscussionReply, deleteDiscussionReply, toggleDiscussionVote, markReadyToConvert, convertDiscussionToTask
- `feedback.ts` — submitFeedback, updateFeedbackStatus, deleteFeedback
- `idea-agents.ts` — allocateAgent, removeIdeaAgent, setOrchestrationAgent
- `onboarding.ts` — completeOnboarding, enhanceOnboardingDescription, generateOnboardingClarifyingQuestions, enhanceOnboardingWithContext

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_APP_URL
SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, API_KEY_ENCRYPTION_KEY
NOTIFICATION_WEBHOOK_SECRET
```

## Deployment

See `docs/release-process.md` for full details.

### Environments

| Environment | URL | Branch | Database |
|---|---|---|---|
| Local | http://localhost:3000 | any | Docker Supabase |
| Staging | https://staging.vibecodes.co.uk | `develop` | Staging Supabase project |
| Production | https://vibecodes.co.uk | `master` | Production Supabase project |

### Branching (Git Flow Lite)
- Feature branches → PR to `develop` (staging) → PR to `master` (production)
- Hotfixes branch directly from `master`
- Vercel auto-deploys: Preview for `develop`, Production for `master`

### Database Migrations
- **Staging**: auto-applied via CI when migrations merge to `develop` (`supabase db push`)
- **Production**: manual trigger via `workflow_dispatch` with approval gate (GitHub Environment `production`)
- **PR validation**: naming convention, non-empty check, destructive keyword warnings — posts summary comment
- Flow: feature branch → `develop` (staging DB, auto) → `master` (production DB, manual trigger)
- Migrations cannot be rolled back — only corrective forward migrations
- Required secrets: `SUPABASE_ACCESS_TOKEN`, `STAGING_PROJECT_REF`, `PROD_PROJECT_REF`
- GitHub Environment `Production` with required reviewer (`nicholasmball`) gates production deploys
- `migration-failure` label used for auto-created failure issues

### CI & Monitoring
- **CI**: GitHub Actions E2E tests (`.github/workflows/e2e.yml`) — 3-browser matrix (Desktop Chrome, Desktop Firefox, Mobile Chrome)
- **CI**: GitHub Actions database migrations (`.github/workflows/migrations.yml`) — auto-apply staging, manual production, PR validation
- **Monitoring**: Sentry (`@sentry/nextjs` with source maps), Vercel Analytics + Speed Insights
- E2E runs on all PRs to both `develop` and `master` but doesn't block Vercel deployment

## Adding DB Tables

1. Migration in `supabase/migrations/`
2. Types in `src/types/database.ts` (include `Relationships`)
3. Export in `src/types/index.ts`
4. Run via Supabase MCP or SQL Editor

## Adding shadcn/ui: `npx shadcn@latest add <name>` → `src/components/ui/` (don't edit manually, except `markdown.tsx`)

## MCP Server

Two modes sharing 78 tools via `mcp-server/src/register-tools.ts` + `McpContext` DI:
- **Local (stdio)**: `mcp-server/src/index.ts` — service-role client, bypasses RLS
- **Remote (HTTP)**: `src/app/api/mcp/[[...transport]]/route.ts` — OAuth 2.1 + PKCE, per-user RLS

Default agent: `a0000000-0000-4000-a000-000000000001` (`bot@vibecodes.local`)

Identity: `set_agent_identity` persists to DB (`users.active_bot_id`). `VIBECODES_BOT_ID` env var overrides on startup. `ctx.userId` = active identity, `ctx.ownerUserId` = real human (for votes, notifications, idea authorship).

Remote endpoint: `https://vibecodes.co.uk/api/mcp` — must exclude MCP/OAuth paths from Next.js middleware.

## .vibecodes/ Config

```json
{ "ideaId": "...", "ideaTitle": "...", "taskId": "...", "botId": "...", "defaultColumn": "..." }
```

Auto-inject `idea_id` into MCP tool calls from `.vibecodes/config.json`.

## Testing Convention

Write tests for all new pure logic, validators, parsers, utilities. Tests co-located as `*.test.ts`. Component changes verified via build + manual testing. Currently 24 unit test files (19 in `src/` + 5 in `mcp-server/src/`) and 43 E2E spec files across 21 directories.

### E2E Test Conventions
- Shared constants in `e2e/fixtures/constants.ts`: `EXPECT_TIMEOUT` (15s)
- `getTestUserId()` helper in `e2e/fixtures/test-data.ts` for user lookups
- `scopedTitle()` for unique test data (replaces `[E2E]` prefix)
- Scope locators to `page.getByRole("main")` to avoid Playwright strict mode violations from sidebar matches
- Playwright config: `fullyParallel: false`, `retries: 0` locally (2 in CI), `expect.timeout: 5_000` default
