# VibeCodes

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

A collaborative idea board for vibe coding projects. Share ideas, find collaborators, manage tasks with kanban boards, and integrate with Claude Code via MCP.

**Live:** [vibecodes.co.uk](https://vibecodes.co.uk) | **Contributing:** [CONTRIBUTING.md](./CONTRIBUTING.md)

## MCP Integration

Connect Claude Code to VibeCodes and manage your ideas, boards, and tasks from the terminal:

```bash
claude mcp add --transport http vibecodes https://vibecodes.co.uk/api/mcp
```

OAuth 2.1 + PKCE — log in with your VibeCodes account when prompted. 38 tools available (list ideas, manage boards, create/move tasks, comment, bot teams, and more). See the [MCP Integration guide](https://vibecodes.co.uk/guide/mcp-integration) for details.

## Features

- **Idea Feed** — search, filter by status/tags, sort by newest/popular/discussed, paginated
- **Voting** — optimistic upvotes with real-time count updates
- **Threaded Comments** — comment, suggestion, and question types with markdown support
- **Collaboration** — request to join projects, add collaborators, team-only access to boards
- **Kanban Boards** — drag-and-drop task management per idea with:
  - Labels (12 colors), due dates, checklists, assignees
  - File attachments (images, docs, up to 10MB)
  - Task comments with @mentions
  - Activity log tracking all changes
  - Bulk import (CSV, JSON/Trello, bulk text)
  - Real-time sync across all collaborators
- **Idea Attachments** — upload images, PDFs, and markdown files to ideas (drag-and-drop, paste)
- **AI Enhancement** — AI-powered idea description improvement, clarifying questions, and board task generation (BYOK API keys supported)
- **Notifications** — votes, comments, collaborators, status changes, @mentions (in-app + email via Resend)
- **User Profiles** — avatar upload, bio, GitHub link, activity history
- **Guided Onboarding** — step-by-step welcome flow for new users
- **Admin Tools** — delete any idea or non-admin user, manage AI quotas
- **Visibility** — public or private ideas (private = author + collaborators + admins only)
- **Authentication** — GitHub OAuth, Google OAuth, email/password with reset flow, Cloudflare Turnstile CAPTCHA
- **Dark/Light Theme** — system-aware with manual toggle
- **AI Bot Teams** — create distinct bot personas (Developer, QA, Designer) with persistent identity across sessions
- **Remote MCP Server** — OAuth 2.1 + PKCE, 38 tools, per-user RLS enforcement
- **Feedback System** — in-app feedback collection with admin management
- **Public Guide** — in-app documentation at `/guide`
- **Docker Dev Environment** — local Supabase with seeding
- **E2E Tests** — Playwright test suite across Chrome, Firefox, and Mobile Chrome

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui (New York, Zinc) |
| Backend | Supabase (Auth, Postgres, Realtime, Storage, RLS) |
| AI | Vercel AI SDK + @ai-sdk/anthropic |
| Drag & Drop | @dnd-kit/core, @dnd-kit/sortable |
| Markdown | react-markdown + remark-gfm |
| Theming | next-themes |
| MCP | mcp-handler (Vercel adapter) + @modelcontextprotocol/sdk |
| Email | Resend |
| CAPTCHA | Cloudflare Turnstile |
| Error Tracking | Sentry (@sentry/nextjs) |
| Analytics | Vercel Analytics + Speed Insights |
| Testing | Vitest + Playwright |
| Hosting | Vercel |

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (or Docker for local Supabase)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Fill in your Supabase project URL and anon key from the [Supabase Dashboard](https://supabase.com/dashboard) (Settings > API).

### 3. Set Up the Database

#### Option A: Supabase Cloud

Run the SQL migration files in `supabase/migrations/` in order in the Supabase SQL Editor. There are 62 migrations covering tables, RLS policies, triggers, and functions.

#### Option B: Docker (Local Supabase)

```bash
npm run docker:supabase   # Start local Supabase instance
npm run docker:seed       # Seed with sample data
```

### 4. Configure OAuth Providers

In your Supabase Dashboard under Authentication > Providers, enable:

- **GitHub**: Add your GitHub OAuth app's client ID and secret
- **Google**: Add your Google OAuth client ID and secret

Set the redirect URL to: `http://localhost:3000/callback`

### 5. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Project Structure

```
src/
├── app/
│   ├── (auth)/             # Auth pages (login, signup, forgot/reset password)
│   ├── (main)/             # Authenticated pages (dashboard, feed, ideas, profile, admin, agents)
│   ├── guide/              # Public guide pages
│   ├── privacy/            # Privacy policy
│   ├── terms/              # Terms of service
│   ├── api/
│   │   ├── ai/             # AI enhancement endpoints
│   │   ├── mcp/            # Remote MCP endpoint (OAuth 2.1)
│   │   ├── notifications/  # Email notification webhook
│   │   └── oauth/          # OAuth 2.1 endpoints (DCR, authorize, token)
│   ├── .well-known/        # OAuth discovery (RFC 8414, RFC 9728)
│   └── oauth/              # OAuth consent UI
├── actions/                # Server Actions (15 files, 60+ exported functions)
├── components/
│   ├── ui/                 # shadcn/ui primitives
│   ├── layout/             # Navbar, theme toggle, notification bell
│   ├── board/              # Kanban board, task dialogs, import, labels, etc.
│   ├── ideas/              # Idea card, feed, form, voting, collaborators, attachments
│   ├── comments/           # Comment thread, form, type badges
│   ├── dashboard/          # Stats, active boards, tasks, activity
│   ├── ai/                 # AI enhancement dialogs
│   ├── onboarding/         # Guided onboarding flow
│   ├── landing/            # Landing page sections
│   └── profile/            # Profile header, tabs, settings
├── hooks/                  # useUser, useRealtime
├── lib/                    # Supabase clients, validation, constants, utils, email templates
├── types/                  # Database types, derived types
└── test/                   # Vitest setup and shared mocks
mcp-server/                 # MCP server (stdio + shared tools for remote)
supabase/migrations/        # 62 SQL migration files
e2e/                        # Playwright E2E test specs
```

## Database

22 tables with Row Level Security:

- **Core**: users, ideas, comments, votes, collaborators, notifications, feedback, idea_attachments, collaboration_requests
- **Board**: board_columns, board_tasks, board_labels, board_task_labels, board_checklist_items, board_task_activity, board_task_comments, board_task_attachments
- **Agents**: bot_profiles
- **AI**: ai_usage_log, ai_prompt_templates
- **MCP/OAuth**: mcp_oauth_clients, mcp_oauth_codes

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (http://localhost:3000) |
| `npm run build` | Production build (Turbopack) |
| `npm run lint` | ESLint |
| `npm run test` | Vitest (single run) |
| `npm run test:watch` | Vitest (watch mode) |
| `npm run test:e2e` | Playwright E2E tests |
| `npm run docker:supabase` | Start local Supabase via Docker |
| `npm run docker:reset` | Reset local Supabase |
| `npm run docker:seed` | Seed local Supabase with sample data |

## License

[MIT](./LICENSE)
