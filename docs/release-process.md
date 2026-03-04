# VibeCodes Release Process — Git Flow Lite (Option B)

This document explains the branching strategy, release workflow, and local development setup for VibeCodes. It's written for someone who uses Claude Code for all coding work and wants to understand how code gets from an idea to production.

---

## Table of Contents

1. [The Big Picture](#the-big-picture)
2. [One-Time Setup](#one-time-setup)
3. [Docker Development Environment](#docker-development-environment)
4. [Day-to-Day Workflows](#day-to-day-workflows)
5. [Database Migrations](#database-migrations)
6. [Quick Reference](#quick-reference)

---

## The Big Picture

We use two permanent branches:

| Branch | Purpose | Deploys to | Who merges here |
|--------|---------|------------|-----------------|
| `master` | Production — what users see | `vibecodes.co.uk` | Only from `develop` (or hotfixes) |
| `develop` | Staging — integration testing | `staging.vibecodes.co.uk` | Feature branches via PRs |

```
feature/cool-thing ──PR──► develop ──PR──► master
                            │                │
                     staging site      production site
```

**Why two branches?** AI agents and humans work on features in parallel. `develop` is where all that work comes together and gets tested before going live. If something breaks, it breaks on staging — not in production.

---

## One-Time Setup (Completed)

All setup steps below have been completed. This section is kept as a reference for how the infrastructure was configured.

### 1. Create the develop branch ✅

```bash
git checkout master
git pull origin master
git checkout -b develop
git push -u origin develop
```

### 2. Tag the current release ✅

Tagged as `v1.0.0` on master.

```bash
git tag v1.0.0
git push origin v1.0.0
```

### 3. Configure Vercel staging deployment ✅

- Domain `staging.vibecodes.co.uk` added in Vercel dashboard (Settings → Domains), linked to the `develop` branch
- DNS CNAME record for `staging.vibecodes.co.uk` points to Vercel (`76.76.21.21`)
- Staging is behind Vercel Deployment Protection (team members only)

Deployments:
- Pushes to `master` → deploy to `vibecodes.co.uk` (production)
- Pushes to `develop` → deploy to `staging.vibecodes.co.uk` (staging)

### 4. Staging Supabase project ✅

The staging/test Supabase project is **`vibecodes-test`** (project ID: `zndmozhgtuerxvkuktdh`). This is also used by the E2E test suite.

| Project | Supabase Name | Purpose |
|---------|--------------|---------|
| Production | `vibe-coding-ideas` (`irqbqxspxxzvuczhujzg`) | Live site — `vibecodes.co.uk` |
| Staging/Test | `vibecodes-test` (`zndmozhgtuerxvkuktdh`) | Staging site + E2E tests |

**Important**: When new migrations are merged into `develop`, they must be **manually applied** to `vibecodes-test` before the feature will work on staging. See [Database Migrations](#database-migrations) below.

### 5. Staging environment variables on Vercel ✅

Vercel Preview environment variables point at the `vibecodes-test` Supabase project:

- `NEXT_PUBLIC_SUPABASE_URL` → staging Supabase URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → staging anon key
- `SUPABASE_SERVICE_ROLE_KEY` → staging service role key
- `NEXT_PUBLIC_APP_URL` → `https://staging.vibecodes.co.uk`

Production environment variables point at `vibe-coding-ideas` (the production Supabase project).

### 6. Branch protection on GitHub ✅

**`master`:**
- Require pull request reviews (1 approval, dismiss stale, require code owner review)
- Require status checks: `e2e-tests (Desktop Chrome)`, `e2e-tests (Desktop Firefox)`, `e2e-tests (Mobile Chrome)`
- No force pushes, no deletions

**`develop`:**
- Require pull request reviews (1 approval, dismiss stale, require code owner review)
- Enforce for admins
- No force pushes, no deletions

### 7. E2E workflow ✅

E2E tests trigger on pushes to `master` and PRs to `master`. The `develop` branch was removed from E2E triggers to save CI minutes — features are tested via PRs to master instead.

---

## Docker Development Environment

Docker runs a full local Supabase stack (database, auth, storage, realtime) on your machine. The Next.js app runs normally with `npm run dev` — Docker only replaces the cloud Supabase.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- Node.js 18+ and npm

### First-time setup

```bash
# 1. Start all Supabase services (database, auth, API gateway, studio, etc.)
npm run docker:supabase

# 2. Wait ~30 seconds for services to start, then apply all migrations + create test users
npm run docker:seed

# 3. Create a .env.local file for local development
```

Create `.env.local` with these values (they match the Docker defaults):

```env
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
NEXT_PUBLIC_APP_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
API_KEY_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
```

```bash
# 4. Start the Next.js dev server
npm run dev
```

### Local URLs

| Service | URL | Purpose |
|---------|-----|---------|
| App | http://localhost:3000 | Your Next.js app |
| Supabase API | http://localhost:54321 | API gateway (Kong) |
| Supabase Studio | http://localhost:54323 | Visual database manager |
| Postgres | localhost:54322 | Direct DB connection |

### Test accounts (created by seed script)

| Account | Email | Password |
|---------|-------|----------|
| Admin | `admin@example.com` | `AdminPass123` |
| Guest | `guest@example.com` | `GuestPass123` |

### Common Docker commands

```bash
npm run docker:supabase   # Start all services
npm run docker:down        # Stop all services
npm run docker:reset       # Full reset: wipe data, recreate, re-seed
npm run docker:seed        # Re-run migrations + create users (without wiping)
npm run docker:studio      # Open Supabase Studio in browser
```

### Troubleshooting

- **Services won't start**: Make sure Docker Desktop is running. Check with `docker ps`.
- **Seed script fails**: Services may not be ready yet. Wait 30 seconds and try `npm run docker:seed` again.
- **Port conflicts**: If ports 54321-54323 are in use, stop other Supabase instances first.
- **Want a fresh start**: Run `npm run docker:reset` — this wipes all data and starts clean.

---

## Day-to-Day Workflows

### Building a new feature

This is the most common workflow. You want to add something new (e.g. a discussions feature, a UI improvement, a new API endpoint).

```
1. Start from develop
   git checkout develop
   git pull origin develop

2. Create a feature branch
   git checkout -b feat/discussions

3. Do your work (with Claude Code)
   - Write code, test locally
   - Commit as you go

4. Push and create a PR targeting develop
   git push -u origin feat/discussions
   gh pr create --base develop --title "Add discussions feature"

5. PR gets reviewed, E2E tests run
   - Fix any issues

6. Merge PR into develop
   - Staging site updates automatically
   - Test on staging.vibecodes.co.uk

7. When ready for production, create a PR from develop → master
   gh pr create --base master --head develop --title "Release: discussions feature"

8. Merge to master
   - Production site updates automatically
   - Tag the release: git tag v1.1.0 && git push origin v1.1.0
```

### Quick bug fix on production (hotfix)

Something is broken in production and needs fixing NOW. This bypasses the normal flow.

```
1. Branch from master (not develop)
   git checkout master
   git pull origin master
   git checkout -b fix/broken-login

2. Fix the bug

3. PR targeting master
   git push -u origin fix/broken-login
   gh pr create --base master --title "Fix broken login"

4. Merge to master → production is fixed

5. Cherry-pick the fix into develop so it's not lost
   git checkout develop
   git pull origin develop
   git cherry-pick <commit-hash>
   git push origin develop
```

### Things like what we did today (small fixes, env var changes)

Today we pushed small fixes directly to master (PostHog localhost skip, feature flags disable, AI rate limiting). Under the new process, these would go through `develop` first:

```
1. git checkout develop && git pull
2. git checkout -b fix/posthog-localhost
3. Make the fix
4. git push && create PR → develop
5. Test on staging
6. PR develop → master when ready
```

**Exception**: If it's truly urgent and production is broken (like the PostHog carriage return issue), use the hotfix flow above.

### Releasing accumulated work

When `develop` has several features/fixes that have been tested on staging and you're ready to push them all live:

```
1. Make sure develop is up to date
   git checkout develop
   git pull origin develop

2. Create a release PR
   gh pr create --base master --head develop \
     --title "Release v1.2.0" \
     --body "## Changes\n- Feature A\n- Feature B\n- Bug fix C"

3. Review the PR (it shows everything that's changed since last release)

4. Merge to master

5. Tag it
   git checkout master
   git pull origin master
   git tag v1.2.0
   git push origin v1.2.0
```

### Working with Claude Code

The workflow with Claude Code doesn't change much. When you start a session:

1. Tell Claude Code which branch to work on: "switch to develop and create a feature branch for X"
2. Claude Code does the work, commits locally
3. You review and ask Claude Code to push and create a PR
4. After PR is merged to develop, verify on staging
5. When ready, ask Claude Code to create the develop → master PR

---

## Database Migrations

Supabase migrations are forward-only SQL files. They can't be rolled back easily, so they need extra care.

### How migrations flow through branches

```
Feature branch → develop (staging DB, auto-applied) → master (production DB, manual trigger)
```

1. **Write the migration** in your feature branch (e.g. `supabase/migrations/00060_add_discussions.sql`)
2. **Test locally** with Docker (`npm run docker:reset` applies all migrations)
3. **Open a PR to develop** → CI validates naming, checks for destructive statements, posts a summary comment
4. **Merge to develop** → CI auto-applies the migration to the staging Supabase project via `supabase db push`
5. **Verify on staging** — check the schema looks right in Supabase Studio
6. **Merge to master** → migration is NOT auto-applied to production (see below)
7. **Apply to production** → manually trigger the workflow (see next section)

### Applying migrations

**Staging** — fully automated. When a PR containing new `supabase/migrations/*.sql` files merges to `develop`, the `Database Migrations` GitHub Actions workflow detects the new files and runs `supabase db push` against the staging project. If it fails, a GitHub issue with the `migration-failure` label is created.

**Production** — manual trigger with approval gate:

1. Go to **Actions → Database Migrations → Run workflow**
2. Select the `master` branch
3. Set **Target environment** to `production`
4. Optionally enable **Dry run** to preview without applying
5. Click **Run workflow**
6. A reviewer must approve the run (configured via the `production` GitHub Environment)

You can also manually trigger against staging the same way (useful for re-runs or catching up).

### Required secrets

These must be set in **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Description | Where to get it |
|--------|-------------|-----------------|
| `SUPABASE_ACCESS_TOKEN` | Personal access token for the Supabase CLI | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) |
| `STAGING_PROJECT_REF` | Staging project reference ID | Supabase Dashboard → Settings → General |
| `PROD_PROJECT_REF` | Production project reference ID | Supabase Dashboard → Settings → General |

You also need a GitHub Environment called `Production` with **required reviewers** enabled (Settings → Environments). A `migration-failure` label must also exist for failure issue tracking.

### PR validation

When a PR to `develop` or `master` contains new migration files, the workflow:

- Checks naming convention (`NNNNN_description.sql`)
- Checks files are non-empty
- Warns on destructive keywords (`DROP TABLE`, `TRUNCATE`, `DELETE FROM`)
- Posts a summary comment on the PR (updates on re-push)
- Fails the check if any file has naming/empty errors

### Avoiding migration conflicts

If two people create migrations at the same time, the filenames might clash (e.g. both create `00060_*.sql`). To avoid this:

- **Coordinate on the next number** — with a small team, just check what the latest migration is before creating yours
- **Or use timestamps**: `20260301_add_discussions.sql` instead of `00060_add_discussions.sql`

### Rolling back a bad migration

If a migration breaks something:
1. **Don't panic** — the app might still work if it's an additive change (new table, new column)
2. Write a **new migration** that reverses the change (e.g. drop the table, remove the column)
3. Push it through the normal flow (or hotfix if production is broken)

You cannot "undo" a migration — you can only go forward with a corrective migration.

---

## Quick Reference

### Branch naming

| Prefix | Use for | Example |
|--------|---------|---------|
| `feat/` | New features | `feat/discussions` |
| `fix/` | Bug fixes | `fix/broken-login` |
| `docs/` | Documentation | `docs/api-guide` |
| `refactor/` | Code cleanup | `refactor/board-context` |
| `chore/` | Maintenance | `chore/update-deps` |

### Key commands

```bash
# Start local dev
npm run docker:supabase && npm run docker:seed   # Start Supabase (first time)
npm run dev                                        # Start Next.js

# Day-to-day
git checkout develop && git pull                   # Start from latest develop
git checkout -b feat/my-feature                    # Create feature branch
gh pr create --base develop                        # Open PR to develop
gh pr create --base master --head develop          # Release to production

# Hotfix
git checkout master && git pull                    # Start from production
git checkout -b fix/urgent-thing                   # Create hotfix branch
gh pr create --base master                         # PR straight to production

# After tagging
git tag v1.x.0 && git push origin v1.x.0          # Tag a release
```

### URLs

| Environment | URL | Branch | Database |
|-------------|-----|--------|----------|
| Local | http://localhost:3000 | any | Docker Supabase |
| Staging | https://staging.vibecodes.co.uk | `develop` | Staging Supabase |
| Production | https://vibecodes.co.uk | `master` | Production Supabase |

### Decision tree: which workflow?

```
Is production broken RIGHT NOW?
  ├─ Yes → Hotfix (branch from master)
  └─ No → Is this a quick fix or a feature?
           ├─ Quick fix → Feature branch → PR to develop → test → PR to master
           └─ Feature → Feature branch → PR to develop → test → PR to master
```

The only difference between a quick fix and a feature is size — the process is the same. Only hotfixes skip `develop`.
