# Test Plan: `fix/workflow-improvements` Branch

## Scope Overview

This branch contains **3 feature areas**:

1. **Workflow UI Feature Flag** — hide all workflow UI behind `isAdmin` check
2. **Fuzzy Role Matching** — improved agent-to-step matching when applying workflow templates
3. **MCP: `update_discussion_reply` tool** — new tool for editing discussion replies

---

## 1. Workflow UI Feature Flag (`isAdmin`)

### 1.1 Workflows Tab (BoardPageTabs)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.1.1 | Admin sees Workflows tab | Log in as admin, visit any board | "Board" and "Workflows" tabs visible |
| 1.1.2 | Non-admin does NOT see Workflows tab | Log in as regular user, visit any board | Only board content, no tabs at all |
| 1.1.3 | Collaborator does NOT see Workflows tab | Log in as collaborator on someone's idea, visit board | No tabs visible |
| 1.1.4 | Guest (read-only) does NOT see Workflows tab | Log in, visit a public board you're not a member of | No tabs, guest banner shown |
| 1.1.5 | Admin can switch between tabs | Click Board → Workflows → Board | Both tabs render correctly, lazy-load works |

### 1.2 Task Workflow Section (TaskDetailDialog)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.2.1 | Admin sees workflow section | Log in as admin, open any task detail | Workflow section visible below description (separator + "Apply Workflow" CTA or active workflow) |
| 1.2.2 | Non-admin does NOT see workflow section | Log in as regular user, open any task detail | No workflow section — just description, then comments tab |
| 1.2.3 | Collaborator does NOT see workflow section | Log in as collaborator, open a task | No workflow section |
| 1.2.4 | Guest does NOT see workflow section | View a task on a public board | No workflow section |

### 1.3 Prop Threading Integrity

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.3.1 | Board page queries is_admin | Check network/server logs | User profile query includes `is_admin` field |
| 1.3.2 | isAdmin flows through component chain | Admin opens board → column → task card → task detail | Workflow UI visible at every level |
| 1.3.3 | Non-admin flow through component chain | Regular user opens board → column → task card → task detail | Workflow UI hidden at every level |

### 1.4 Edge Cases

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.4.1 | Existing workflow runs still visible to admin | Admin opens a task that already has a workflow run | Steps, progress bar, approve/retry buttons all work |
| 1.4.2 | Auto-rules still fire for admin boards | Admin adds a label with an auto-rule to a task | Workflow template auto-applied |
| 1.4.3 | Auto-rules don't fire for non-admin boards | Non-admin has no way to create auto-rules | No auto-rules exist, so trigger is inert |
| 1.4.4 | Server actions still callable (no crash) | Directly call `applyWorkflowTemplate` via dev tools | Action executes (server actions are not gated, only UI) |

---

## 2. Fuzzy Role Matching

### 2.1 Unit Tests (`src/lib/role-matching.test.ts` — 23 tests)

> **Status:** All passing. Run with `npm run test -- role-matching`

### 2.2 Manual Testing via Workflow Template Application

To test fuzzy matching end-to-end, you need:
- An idea with agents allocated (with various roles)
- A workflow template with steps that have roles

#### Setup

1. Log in as admin
2. Create or use an existing idea with a board
3. Allocate agents with these roles to the idea's pool:
   - "Developer"
   - "UI/UX Designer"
   - "QA Engineer"
   - "Product Manager"
4. Go to the Workflows tab and create a template (or use a library template)

#### Test Matrix

| # | Template Step Role | Agent Pool Roles | Expected Match | Match Tier |
|---|-------------------|-----------------|----------------|------------|
| 2.2.1 | "Developer" | Pool has "Developer" | Matches "Developer" agent | Exact |
| 2.2.2 | "developer" | Pool has "Developer" | Matches "Developer" agent (case-insensitive) | Exact |
| 2.2.3 | "Dev" | Pool has "Developer" | Matches "Developer" agent | Substring |
| 2.2.4 | "Senior Developer" | Pool has "Developer" | Matches "Developer" agent (pool role is substring of step role) | Substring |
| 2.2.5 | "UX Designer" | Pool has "UI/UX Designer" | Matches via word overlap ("designer" prefix match) | Word-overlap |
| 2.2.6 | "Design" | Pool has "UI/UX Designer" | Matches via word overlap ("design" is prefix of "designer") | Word-overlap |
| 2.2.7 | "Frontend Developer" | Pool has "Developer" | Matches "Developer" (substring: "developer" contained in step role) | Substring |
| 2.2.8 | "Astronaut" | Pool has no matching role | No match — step has null bot_id | None |
| 2.2.9 | "QA" | Pool has "QA Engineer" | No match — "QA" is only 2 chars, below min token length (3) for substring | None |
| 2.2.10 | "Quality Assurance" | Pool has "QA Engineer" | No match — no substring or word overlap with "QA Engineer" | None |
| 2.2.11 | "Product" | Pool has "Product Manager" | Matches via substring ("product" contained in "product manager") | Substring |

#### How to Verify Matches

**Option A: Via UI (Admin)**
1. Apply a workflow template to a task
2. Open the task detail → workflow section
3. Check each step — if an agent avatar/name appears next to the step, it matched
4. If the step shows just the role name with no agent, it didn't match

**Option B: Via MCP**
1. Use `apply_workflow_template` MCP tool with `task_id` and `template_id`
2. Response includes `agent_matches` object showing role → bot_id mappings
3. `null` values indicate no match

**Option C: Via Database**
1. After applying a template, query: `SELECT step_order, agent_role, bot_id FROM task_workflow_steps WHERE task_id = '{task_id}' ORDER BY step_order`
2. Check `bot_id` is populated for expected matches and null for non-matches

### 2.3 Integration: Server Action (`applyWorkflowTemplate`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 2.3.1 | Apply template via UI | Admin: open task → Apply Workflow → select template | Steps created with correct agent assignments |
| 2.3.2 | Verify fuzzy matches | Check steps after apply | Agents matched per fuzzy rules (not just exact) |
| 2.3.3 | Warning banner for unmatched roles | Apply template with roles that don't match any agent | Yellow warning banner in TaskWorkflowSection listing unmatched roles |

### 2.4 Integration: MCP `apply_workflow_template`

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 2.4.1 | Apply via MCP | Call `apply_workflow_template` with task_id and template_id | Returns success with `agent_matches` |
| 2.4.2 | Fuzzy matching via MCP | Template has "Dev" role, pool has "Developer" | `agent_matches` shows "Dev" → bot_id of Developer agent |
| 2.4.3 | No match via MCP | Template has role with no matching agent | `agent_matches` shows role → null |

---

## 3. MCP: `update_discussion_reply` Tool

### 3.1 Tool Registration

| # | Test | Expected |
|---|------|----------|
| 3.1.1 | Tool registered | 67 tools total (was 66) |
| 3.1.2 | Tool name in list | `"update_discussion_reply"` appears in tool listing |

> **Status:** Covered by `register-tools.test.ts` (updated, passing)

### 3.2 Functional Tests

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 3.2.1 | Update own reply | Call with valid `reply_id`, `discussion_id`, new `content` | Returns updated reply with new content and `updated_at` |
| 3.2.2 | Cannot update others' replies | Call with another user's reply_id | Error: "Reply not found or you don't have permission to edit it" |
| 3.2.3 | Invalid reply_id | Non-existent UUID | Error |
| 3.2.4 | Empty content | `content: ""` | Zod validation error (min 1 char) |
| 3.2.5 | Content too long | Content > 5000 chars | Zod validation error (max 5000) |
| 3.2.6 | Reply content persists | Update reply, then fetch discussion | Reply shows updated content |

### 3.3 MCP Tool Call Examples

```json
// Update a reply
{
  "reply_id": "uuid-of-reply",
  "discussion_id": "uuid-of-discussion",
  "content": "Updated reply content with **markdown** support"
}
```

---

## 4. Cross-Cutting / Regression

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 4.1 | All tests pass | `npm run test` | 503/503 pass (26 files) |
| 4.2 | Build succeeds | `npm run build` | No type errors, clean compile |
| 4.3 | Existing board functionality | Create tasks, move, assign, label | All board ops work normally |
| 4.4 | Non-admin board UX unchanged | Regular user visits board | Identical experience to before (no visible workflow elements) |
| 4.5 | Admin workflow functionality | Admin creates template, applies to task, approves steps | Full workflow lifecycle works |
| 4.6 | MCP tool count | Connect MCP client | 67 tools registered |
| 4.7 | Existing role matching (exact) unbroken | Apply template where roles match exactly | Same behavior as before — exact matches still work |

---

## Test Environment Requirements

- **Admin user** with `is_admin = true` (for workflow UI testing)
- **Regular user** without admin flag (for feature flag verification)
- **Idea with agents** allocated (various roles for fuzzy matching tests)
- **Workflow templates** created or available from library
- **MCP client** connected (for MCP tool tests)

## Automated Test Coverage

| Area | File | Tests |
|------|------|-------|
| Role matching | `src/lib/role-matching.test.ts` | 23 |
| MCP tool registration | `mcp-server/src/register-tools.test.ts` | 12 |

**Total automated:** 35 tests covering this branch's changes (within 503 total)

**Manual testing required:** Feature flag verification (1.x), fuzzy matching end-to-end (2.2.x, 2.3.x), MCP functional tests (3.2.x)
