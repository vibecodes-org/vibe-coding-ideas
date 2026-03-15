# Test Plan: `feature/board-level-workflows` Branch

## Scope Overview

This branch contains **4 distinct feature areas**:

1. **Onboarding Auto-Bootstrap** — new 3-step onboarding flow with automatic board setup
2. **Fuzzy Role Matching** — improved agent-to-step matching in workflow templates
3. **MCP: `update_discussion_reply` tool** — new tool for editing discussion replies
4. **Project Type on Ideas** — new field on idea create/edit forms

---

## 1. Onboarding Auto-Bootstrap

### 1.1 Database Migration (`00075_onboarding_auto_bootstrap.sql`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.1.1 | Column exists | Query `SELECT project_type FROM ideas LIMIT 1` | No error, returns null |
| 1.1.2 | Nullable for existing rows | Check existing ideas | All have `project_type = null` |
| 1.1.3 | Accepts valid values | `UPDATE ideas SET project_type = 'web_app' WHERE id = ...` | Succeeds |
| 1.1.4 | No enum constraint | `UPDATE ideas SET project_type = 'anything'` | Succeeds (UI-driven validation) |

### 1.2 Bootstrap Config (`src/lib/onboarding-bootstrap-config.ts`)

| # | Test | Expected |
|---|------|----------|
| 1.2.1 | All 6 project types defined | `PROJECT_TYPES.length === 6` |
| 1.2.2 | Every type has a BOOTSTRAP_MAP entry | No missing keys |
| 1.2.3 | `labels.length === templateNames.length` for each type | Auto-rule pairing works |
| 1.2.4 | All label colors are valid `LABEL_COLORS` values | No invalid colors |
| 1.2.5 | `isValidProjectType()` accepts valid keys | Returns `true` for `"web_app"`, `"other"` |
| 1.2.6 | `isValidProjectType()` rejects invalid keys | Returns `false` for `""`, `"invalid"` |

> **Status:** Covered by `onboarding-bootstrap-config.test.ts` (7 tests, all passing)

### 1.3 Server Action: `bootstrapOnboardingIdea`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.3.1 | Happy path — full pipeline | Call with valid data + existing featured team | Returns `BootstrapResult` with non-zero counts for all fields |
| 1.3.2 | Idea created with `project_type` | Check DB after bootstrap | `ideas.project_type` matches input |
| 1.3.3 | Board columns initialized | Check `board_columns` for idea | 6 default columns created |
| 1.3.4 | Agents cloned and allocated | Check `bot_profiles` and `idea_agents` | User has cloned bots, all allocated to idea |
| 1.3.5 | Templates imported | Check `workflow_templates` for idea | Templates matching config created |
| 1.3.6 | Labels created | Check `board_labels` for idea | Labels matching config (name + color) |
| 1.3.7 | Auto-rules created | Check `workflow_auto_rules` for idea | label[i] → template[i] pairing |
| 1.3.8 | Onboarding completed | Check `users.onboarding_completed_at` | Non-null after bootstrap |
| 1.3.9 | Team override (`teamId` param) | Pass explicit `teamId` | Uses override team, not config default |
| 1.3.10 | Missing featured team | Config references a team name that doesn't exist in DB | Pipeline continues; agents = 0, everything else still works |
| 1.3.11 | Invalid project type | Pass `"invalid"` as projectType | Throws "Invalid project type" |
| 1.3.12 | Empty title | Pass `""` as title | Throws validation error |
| 1.3.13 | Partial failure resilience | Template import fails (e.g., template not in library) | Other steps still complete; result reflects actual success counts |
| 1.3.14 | Duplicate agent allocation | User already has bots before bootstrap | `ON CONFLICT DO NOTHING` handles gracefully, no error |
| 1.3.15 | Unauthenticated user | No session | Redirects to `/login` |

### 1.4 Onboarding Dialog UI (3-step flow)

#### Step 0: Welcome

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.4.1 | Renders welcome content | Open onboarding dialog | See heading "Welcome to VibeCodes!", 3 feature cards |
| 1.4.2 | "Let's get started" advances | Click button | Moves to step 1 |
| 1.4.3 | "Skip for now" completes onboarding | Click skip | Dialog closes, `onboarding_completed_at` set |
| 1.4.4 | Step indicator shows 3 dots | Visual check | 3 dots, first highlighted |

#### Step 1: Create Idea

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.4.5 | Project type grid renders | Arrive at step 1 | 3x2 grid with 6 project types (icons + labels) |
| 1.4.6 | Selecting a type highlights it | Click "Web App" | Card gets colored border/background |
| 1.4.7 | Team suggestion appears | Select any project type | Team card slides in below with avatar stack |
| 1.4.8 | Team matches config | Select "API / Backend" | Shows "Platform & Infrastructure" team |
| 1.4.9 | "Change" team override | Click "Change" then pick different team | Team card updates, popover closes |
| 1.4.10 | Changing project type resets team override | Select type A, change team, then select type B | Team resets to auto-suggestion for type B |
| 1.4.11 | Title input required | Click "Create & Set Up Board" with empty title | Toast error "Give your idea a title" |
| 1.4.12 | Project type required | Fill title but no type selected | Button disabled (no project type) |
| 1.4.13 | Tags toggle on/off | Click tags | Tags toggle selection state |
| 1.4.14 | AI Enhance works | Fill title then click Enhance | Spinner shows, description updated on success |
| 1.4.15 | AI Enhance without title | Click Enhance with empty title | Toast error "Add a title first..." |
| 1.4.16 | Back button works | Click back arrow | Returns to step 0 |
| 1.4.17 | "I'll do this later" skips | Click skip | Advances to success, completes onboarding |

#### Bootstrap Progress (between step 1 and 2)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.4.18 | Progress animation shows | Submit form | See gear icon, "Setting up your board..." heading |
| 1.4.19 | Checklist items animate | Watch during bootstrap | Items transition: pending, active (spinner), done (checkmark) |
| 1.4.20 | Progress bar fills | Watch during bootstrap | Bar fills from 0% to 100% |
| 1.4.21 | Auto-advances to success | Wait for completion | Automatically moves to step 2 |

#### Step 2: Success

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.4.22 | Confetti animation | Arrive at success | Confetti particles visible |
| 1.4.23 | "Your board is ready!" heading | After bootstrap | Heading shows (not "You're all set!") |
| 1.4.24 | 4 stat cards show correct counts | After bootstrap | Agents, Templates, Auto-rules, Columns match actual |
| 1.4.25 | "View Your Board" links correctly | Click primary CTA | Navigates to `/ideas/{ideaId}/board` |
| 1.4.26 | MCP command copy works | Click copy button | Clipboard contains `claude mcp add vibecodes ...` |
| 1.4.27 | "Go to Dashboard" works | Click secondary link | Dialog closes, dashboard shown |
| 1.4.28 | Skip flow success | Skipped idea creation | Shows "You're all set!" heading, no stat cards, "Go to Dashboard" primary |

### 1.5 Project Type Selector Component

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.5.1 | No team popover if only 1 team | DB has 1 featured team | No "Change" button shown |
| 1.5.2 | Popover lists all teams | Click "Change" with multiple teams | All featured teams in dropdown |
| 1.5.3 | Current team highlighted in popover | Open popover | Auto-suggested team has bg highlight |

---

## 2. Fuzzy Role Matching

### 2.1 `buildRoleMatcher` / `matchRoleToAgent` (`src/lib/role-matching.ts`)

| # | Test | Expected |
|---|------|----------|
| 2.1.1 | Exact match (case-insensitive) | `"Developer"` matches `"developer"` with tier `"exact"` |
| 2.1.2 | Substring match | `"Dev"` matches `"Developer"` with tier `"substring"` |
| 2.1.3 | Reverse substring | `"Senior Developer"` matches `"Developer"` with tier `"substring"` |
| 2.1.4 | Word overlap with prefix | `"UX Designer"` matches `"UI/UX Design"` with tier `"word-overlap"` |
| 2.1.5 | No match returns null | `"Astronaut"` with no matching agents returns `{ botId: null, tier: "none" }` |
| 2.1.6 | Empty role returns null | `""` returns `{ botId: null, tier: "none" }` |
| 2.1.7 | Empty candidates list | Any role returns `{ botId: null, tier: "none" }` |
| 2.1.8 | First match wins within tier | Two agents with same normalized role: first candidate's botId returned |
| 2.1.9 | Min 3-char token filtering | Short tokens like `"QA"` filtered from word overlap |

> **Status:** Covered by `role-matching.test.ts` (23 tests, all passing)

### 2.2 Integration: `applyWorkflowTemplate` (server action)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 2.2.1 | Exact role match assigns bot | Apply template with step role "Developer", agent pool has "Developer" | Step gets correct `bot_id` |
| 2.2.2 | Fuzzy match assigns bot | Template step "Dev", agent pool has "Developer" | Step gets matched via substring |
| 2.2.3 | No match leaves null | Template step "Astronaut", no matching agent | `bot_id` is null |

### 2.3 Integration: MCP `apply_workflow_template`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 2.3.1 | Same fuzzy matching via MCP | Call `apply_workflow_template` via MCP | Uses `buildRoleMatcher`, same behavior as server action |

---

## 3. MCP: `update_discussion_reply` Tool

### 3.1 Tool Registration

| # | Test | Expected |
|---|------|----------|
| 3.1.1 | Tool registered | 67 tools registered (was 66) |
| 3.1.2 | Tool name in expected list | `"update_discussion_reply"` in tool names |

> **Status:** Covered by `register-tools.test.ts` (updated, passing)

### 3.2 Functional Tests

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 3.2.1 | Update own reply | Call with valid `reply_id`, `discussion_id`, new `content` | Returns updated reply with new content |
| 3.2.2 | Cannot update others' replies | Call with another user's reply_id | Error: "Reply not found or you don't have permission" |
| 3.2.3 | Invalid reply_id | Non-existent UUID | Error |
| 3.2.4 | Content validation | Empty content or >5000 chars | Zod validation error |

---

## 4. Project Type on Ideas (Main App)

### 4.1 Create Idea Form (`/ideas/new`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 4.1.1 | Project type picker renders | Visit create idea page | Select dropdown with 6 options visible |
| 4.1.2 | Submission with project type | Select "Web App", fill form, submit | Idea created with `project_type = 'web_app'` |
| 4.1.3 | Submission without project type | Leave unselected, fill form, submit | Idea created with `project_type = null` |
| 4.1.4 | Hidden input carries value | Select type, inspect form | Hidden input `name="project_type"` has correct value |

### 4.2 Edit Idea Form (`/ideas/{id}/edit`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 4.2.1 | Pre-populates existing value | Edit idea with `project_type = 'api_backend'` | Dropdown shows "API / Backend" selected |
| 4.2.2 | Pre-populates null | Edit idea with no project type | Dropdown shows placeholder |
| 4.2.3 | Can change project type | Change selection, save | Updated in DB |
| 4.2.4 | Can clear project type | Select a type then... | (Note: Select doesn't support clearing — acceptable limitation) |

### 4.3 `updateIdeaFields` (inline editing)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 4.3.1 | Accepts project_type in partial update | Call with `{ project_type: 'mobile_app' }` | Updated in DB |
| 4.3.2 | Validates project type | Call with `{ project_type: 'invalid' }` | Stored as `null` (validation normalizes) |

### 4.4 Server Action Validation

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 4.4.1 | `createIdea` — valid type saved | FormData with `project_type=web_app` | Saved correctly |
| 4.4.2 | `createIdea` — invalid type becomes null | FormData with `project_type=banana` | Stored as `null` |
| 4.4.3 | `updateIdea` — type updated | FormData with new project_type | Updated in DB |

---

## 5. Generate Tasks Banner (`src/components/board/generate-tasks-banner.tsx`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 5.1 | Shows when board is empty + author | Visit board with 0 tasks as author | Banner visible with "Generate Tasks with AI" CTA |
| 5.2 | Hidden when tasks exist | Board has 1 or more tasks | Banner not rendered |
| 5.3 | Hidden for non-authors | Visit as collaborator/guest | Banner not rendered |
| 5.4 | Dismiss persists | Click "X" then refresh page | Banner stays hidden (localStorage) |
| 5.5 | Different per idea | Dismiss on idea A then visit idea B | Banner visible on idea B |

> **Note:** Banner component is created but not yet wired into the board page. The existing `BoardEmptyState` already covers the AI generate CTA for empty boards. Integration is a future enhancement.

---

## 6. Cross-Cutting / Regression

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 6.1 | Existing tests pass | `npm run test` | 510/510 pass (27 files) |
| 6.2 | Build succeeds | `npm run build` | No type errors, clean compile |
| 6.3 | Existing onboarding still works | Complete onboarding without bootstrap (skip path) | `onboarding_completed_at` set, no errors |
| 6.4 | Existing `createIdeaFromOnboarding` unbroken | Still exported, still callable | Works as before (used by legacy paths) |
| 6.5 | `cloneBotProfile` export doesn't break callers | `addFeaturedTeam` and `cloneAgent` still work | Both use `cloneBotProfile` internally, no change in behavior |
| 6.6 | Existing workflow template apply still works | Apply template via UI | Role matching now uses `buildRoleMatcher` — same results for exact matches, better for fuzzy |
| 6.7 | MCP tool count correct | MCP connection registers tools | 67 tools (was 66) |
| 6.8 | Migration applies cleanly | `supabase db push` | No errors on fresh DB |

---

## Test Environment Requirements

- **Local Supabase** running with migration `00075` applied
- **Featured teams** seeded in DB (at least "Full Stack Starter" with agents)
- **Library templates** seeded in DB (at least "Feature Development", "Bug Fix")
- **Fresh user** without `onboarding_completed_at` (for onboarding flow tests)

## Automated Test Coverage

| Area | File | Tests |
|------|------|-------|
| Bootstrap config | `src/lib/onboarding-bootstrap-config.test.ts` | 7 |
| Role matching | `src/lib/role-matching.test.ts` | 23 |
| MCP tool registration | `mcp-server/src/register-tools.test.ts` | 12 |
| Onboarding actions | `src/actions/onboarding.test.ts` | 13 |

**Total automated:** 55 tests covering this branch's changes (within 510 total)

**Manual testing required:** Onboarding UI flow (1.4.x), project type in forms (4.1-4.2), MCP functional tests (3.2.x)
