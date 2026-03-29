# UX Redesign — Manual Test Script

Verifies implementations against `docs/ux-redesign-proposals.html` (P1–P5).

**Prerequisites:**
- Dev server running (`npm run dev` on http://localhost:3000)
- Two accounts: one "activated" user (has ideas, tasks, agents) and one fresh/new user
- Access to Supabase dashboard (to toggle `mcp_connected_at` if needed)

---

## P1: Project Kits — Idea Archetypes

### TC-1.1: Kit selector on Create Idea page
1. Log in as any user
2. Navigate to `/ideas/new`
3. **Verify:** A "What kind of project is this?" selector is visible with 6 options:
   - Web Application, Mobile App, API / Backend, Design System, AI / ML Project, Custom
4. **Verify:** Each non-Custom kit shows badge pills with step count and role count (e.g. "7 steps", "5 roles")
5. **Verify:** Custom kit does NOT show step/role counts

### TC-1.2: Kit selection and preview
1. On `/ideas/new`, click "Web Application"
2. **Verify:** The card becomes selected (highlighted border/background)
3. **Verify:** A kit preview appears showing:
   - Agent team roles (e.g. Full Stack Engineer, UX Designer, etc.)
   - Workflow steps (numbered sequence)
   - Board labels (colour-coded pills like Bug, Feature, Enhancement)
   - Auto-rule description
4. Click "Web Application" again
5. **Verify:** It deselects (toggles off) and the preview disappears

### TC-1.3: Custom kit has no preview
1. Select "Custom"
2. **Verify:** No agent/workflow/label preview is shown — just the selection state

### TC-1.4: Kit selector in onboarding (compact mode)
1. Start the onboarding wizard as a fresh user (see P2 tests below)
2. Navigate to the "Your Project" step (Step 3 of 6)
3. **Verify:** The project type selector appears in compact mode (smaller cards, inline layout)
4. **Verify:** Selecting a kit shows a compact preview summary (e.g. "3 agents, 4-step workflow, 5 labels")

---

## P2: Golden Path — Onboarding Wizard

### TC-2.1: Fresh user gets onboarding dialog
1. Log in as a fresh user (no `onboarding_completed_at` set)
2. **Verify:** An onboarding dialog opens automatically
3. **Verify:** The dialog CANNOT be closed by:
   - Pressing Escape
   - Clicking outside the dialog
4. **Verify:** A step indicator shows 6 dots at the bottom

### TC-2.2: Step 0 — Welcome
1. **Verify:** Heading says "Welcome to VibeCodes"
2. **Verify:** Three value-prop cards are shown:
   - "Describe your idea" (AI refines your vision)
   - "Get a ready-made board" (Tasks, workflows, agents)
   - "Agents do the work" (Via Claude Code + MCP) — **this must mention MCP, not just "autonomously"**
3. **Verify:** "Let's get started" button is visible
4. **Verify:** "Skip for now" link is visible
5. Click "Let's get started"

### TC-2.3: Step 1 — Profile
1. **Verify:** Label says "Step 2 of 6"
2. **Verify:** Fields present: Display name, Bio (optional), GitHub username (optional)
3. **Verify:** "Continue" button and "Skip this step" link are visible
4. **Verify:** Back arrow navigates to Welcome step
5. Click "Skip this step"

### TC-2.4: Step 2 — Your Project
1. **Verify:** Label says "Step 3 of 6"
2. **Verify:** Fields present:
   - Project name (required)
   - Description (optional, with AI enhance option)
   - Project type selector (compact, all 6 types)
   - Public/Private visibility toggle
3. **Verify:** Selecting a project type shows a compact kit preview
4. **Verify:** "Create my project" (or "Create & Generate Board") CTA is visible
5. **Verify:** Submitting without a project name shows a validation toast
6. Enter a test project name, select "Web Application", click the create CTA

### TC-2.5: Step 3 — Board generated
1. **Verify:** Shows a success state with:
   - Agent count badge (e.g. "5 agents allocated")
   - Workflow applied badge
   - List of generated tasks
2. **Verify:** "Go to my board" button navigates to `/ideas/{id}/board`
3. **Verify:** "Finish and go to dashboard" option is available

### TC-2.6: Step 4 — MCP Setup
1. **Verify:** Heading mentions "Connect Claude Code"
2. **Verify:** Explanation of WHY MCP matters is shown (amber callout box)
3. **Verify:** Terminal block shows the `claude mcp add vibecodes https://vibecodes.co.uk/api/mcp` command
4. **Verify:** "Copy command" button works and shows "Copied!" feedback
5. **Verify:** "Skip for now" / "I'll do this later" option is available

### TC-2.7: Step 5 — Completion
1. **Verify:** Confetti animation plays
2. **Verify:** Summary stats shown (tasks, agents, workflows)
3. **Verify:** "Go to your board" is the primary CTA
4. **Verify:** "Go to dashboard" is the secondary option

---

## P3: MCP as First-Class Activation Step

### TC-3.1: MCP banner on dashboard (not connected)
1. Log in as a user with `mcp_connected_at = NULL` in the database
2. Go to `/dashboard`
3. **Verify:** An amber MCP banner is visible with:
   - Title: "Your agents are waiting — connect Claude Code"
   - Description mentioning agent/task counts
   - Terminal block with the MCP command
   - "Copy command" button
   - "Learn more" link pointing to `/guide/mcp-integration`
4. **Verify:** The banner has a dismiss (X) button

### TC-3.2: MCP banner dismissal (sessionStorage)
1. Click the X button on the MCP banner
2. **Verify:** Banner disappears
3. Refresh the page (F5)
4. **Verify:** Banner reappears (sessionStorage clears on tab close, not refresh)
5. Close the tab entirely, reopen `/dashboard` in a new tab
6. **Verify:** Banner is visible again (sessionStorage was cleared)

### TC-3.3: MCP banner hidden when connected
1. In Supabase, set `mcp_connected_at = NOW()` for your user
2. Refresh `/dashboard`
3. **Verify:** MCP banner is NOT shown anywhere on the page

### TC-3.4: MCP banner on board page
1. Set `mcp_connected_at = NULL` again
2. Navigate to any idea's board page (`/ideas/{id}/board`)
3. **Verify:** An MCP banner is shown (either full or compact variant depending on agent allocation state)
4. **Verify:** It contains the MCP command and a way to copy it

### TC-3.5: MCP banner NOT dismissable on first-run dashboard
1. As a non-activated user viewing the first-run dashboard
2. **Verify:** The MCP CTA card does NOT have an X dismiss button (per `dismissable={false}`)

---

## P4: Cross-Feature Connective Tissue

### TC-4.1: Board nudge — no workflows
1. Create/find an idea with board tasks but NO workflow templates
2. Go to `/ideas/{id}/board`
3. **Verify:** A violet nudge banner appears:
   - Title: "Automate your tasks with workflows"
   - "Set up workflows" action linking to `?tab=workflows`
4. Click dismiss (X)
5. **Verify:** Banner disappears
6. Refresh the page
7. **Verify:** Banner reappears (uses sessionStorage, not localStorage)

### TC-4.2: Board nudge — workflows but no agents
1. On an idea with workflow templates but NO agents allocated to the idea pool
2. Go to `/ideas/{id}/board`
3. **Verify:** An emerald nudge banner appears:
   - Title: "Your workflows need agents"
   - "Add agents" action linking to `?tab=agents`

### TC-4.3: Board nudge — agents but no MCP
1. On an idea with agents allocated but `mcp_connected_at = NULL`
2. Go to `/ideas/{id}/board`
3. **Verify:** A compact MCP connection banner appears (instead of a NudgeBanner)

### TC-4.4: Post-generation nudge
1. Generate tasks via AI on a board (use the AI Generate button)
2. **Verify:** An amber nudge banner appears after generation:
   - Title: "Tasks generated! Set up workflows to automate them"
   - "Set up workflows" action

### TC-4.5: Help links — board page
1. Go to any idea's board page
2. **Verify:** A small (?) help icon link is visible in the board header area
3. **Verify:** Hovering shows "Learn more" tooltip
4. **Verify:** Clicking navigates to `/guide/kanban-boards`

### TC-4.6: Help links — workflows tab
1. Go to `?tab=workflows` on any board
2. **Verify:** A (?) help icon links to `/guide/workflows`

### TC-4.7: Help links — agents tab
1. Go to `?tab=agents` on any board
2. **Verify:** A (?) help icon links to `/guide/ai-agent-teams`

### TC-4.8: Help links — other locations
Check for (?) help links in these additional locations:
- [ ] Discussions section → `/guide/discussions`
- [ ] MCP banners → `/guide/mcp-integration` (via "Learn more" link)
- [ ] Any other feature headers that have them

### TC-4.9: Guide hub page
1. Navigate to `/guide`
2. **Verify:** 9 section cards are displayed:
   - Getting Started, Ideas & Voting, Collaboration, Discussions, Kanban Boards, MCP Integration, Workflows, AI Agent Teams, Admin
3. **Verify:** Each card has an icon, title, and description
4. **Verify:** Clicking a card navigates to the correct section page

### TC-4.10: Guide page navigation
1. Go to `/guide/getting-started`
2. **Verify:** "Back to Guide" link at the top navigates to `/guide`
3. **Verify:** "Next" button at the bottom navigates to the next section
4. Navigate through all 9 guide pages checking prev/next links work correctly

---

## P5: First-Run Dashboard

### TC-5.1: First-run dashboard renders for non-activated users
1. Log in as a user who does NOT meet activation criteria:
   - Activation = `hasTasks (>=3) AND (hasAgents OR hasWorkflows OR hasMcpConnection) AND (hasUserActivity OR hasMcpConnection)`
2. Clear localStorage: `localStorage.removeItem("first-run-dashboard-dismissed")`
3. Go to `/dashboard`
4. **Verify:** First-run dashboard is shown (NOT the standard stats-card dashboard)
5. **Verify:** Welcome header says "Welcome back, {name}"

### TC-5.2: Setup progress tracker
1. On the first-run dashboard
2. **Verify:** "Your Setup Progress" section shows:
   - 5 sequential steps: Account, Idea, Board, MCP, First task
   - A progress bar (violet, width proportional to completed steps)
   - Completed steps show green checkmark circles
   - Current step shows amber numbered circle
   - Future steps show grey numbered circles
3. **Verify:** Steps are sequentially gated (a later step only shows as done if ALL prior steps are done)

### TC-5.3: Project card
1. **If user has an idea:** Verify the card shows:
   - Idea title with "Go to board" link
   - Task/agent/workflow count badges
   - Mini board preview with column headers and task titles
2. **If user has no ideas:** Verify an empty state with "Create your first idea" link to `/ideas/new`

### TC-5.4: MCP CTA card
1. **If MCP not connected:** Verify an amber card shows:
   - Title: "Next: Connect Claude Code"
   - Description explaining agents need MCP
   - Terminal block with the `claude mcp add vibecodes ...` command
   - "Copy command" button (verify clipboard feedback)
   - NO dismiss X button (non-dismissable on first-run)

### TC-5.5: Agent team sidebar
1. **If user has agents:** Verify the sidebar shows:
   - Up to 3 agent avatars with name and role
   - "Manage" link to `/agents`
   - "+N more agents" if more than 3
2. **If no agents:** Verify "Create your first agent" link to `/agents`

### TC-5.6: Quick links sidebar
1. **Verify** links to:
   - MCP Integration Guide (`/guide/mcp-integration`)
   - How Workflows Work (`/guide/workflows`)
   - Browse Community Agents (`/agents?tab=community`)
   - Invite Collaborators (to idea page, only shown if user has an idea)

### TC-5.7: Switch to full dashboard
1. Click "Switch to full dashboard" button
2. **Verify:** Standard dashboard with stats cards appears immediately
3. Refresh the page
4. **Verify:** Standard dashboard persists (localStorage override saved)
5. Clear localStorage: `localStorage.removeItem("first-run-dashboard-dismissed")`
6. Refresh
7. **Verify:** First-run dashboard appears again

### TC-5.8: Activated user always sees standard dashboard
1. Log in as a fully activated user (3+ tasks, agents/workflows, board activity)
2. Clear localStorage override
3. Go to `/dashboard`
4. **Verify:** Standard dashboard is shown (stats cards, collapsible sections)
5. **Verify:** "Switch to full dashboard" button is NOT present

### TC-5.9: SSR — no blank page flash
1. Hard-refresh the first-run dashboard (Ctrl+Shift+R)
2. **Verify:** Content renders immediately on load — no blank white page flash before the first-run content appears

---

## Cross-Proposal Checks

### TC-X.1: MCP command consistency
Compare the MCP command shown in these locations — they should all match:
- [ ] Onboarding Step 4 (MCP Setup)
- [ ] Dashboard MCP banner
- [ ] Board page MCP banner
- [ ] First-run dashboard MCP CTA card

Expected command: `claude mcp add vibecodes https://vibecodes.co.uk/api/mcp`

> **Note:** The guide page (`/guide/mcp-integration`) uses a different, more detailed command format (`claude mcp add -s user --transport http vibecodes-remote ...`). This is intentional — the simplified command is for quick setup, the guide has the full syntax.

### TC-X.2: Nudge banner colour variants
Across all nudge banners encountered, verify the colour scheme matches the design spec:
- **Violet:** Workflow-related nudges
- **Emerald:** Agent-related nudges
- **Amber:** Post-generation nudges, MCP-related
- **Cyan:** Not currently used in board nudges (reserved for rationale callouts in spec)
- **Default:** Idea-level nudges (e.g. "Add AI agents to this idea")

### TC-X.3: Mobile responsiveness
Repeat the following tests on a mobile viewport (375px width):
- [ ] TC-1.1: Kit selector should stack vertically
- [ ] TC-2.2: Onboarding welcome cards should stack
- [ ] TC-3.1: MCP banner should be readable, dismiss button accessible
- [ ] TC-5.1: First-run dashboard should use single-column layout

---

## Test Results

| Test | Pass/Fail | Notes |
|------|-----------|-------|
| TC-1.1 | | |
| TC-1.2 | | |
| TC-1.3 | | |
| TC-1.4 | | |
| TC-2.1 | | |
| TC-2.2 | | |
| TC-2.3 | | |
| TC-2.4 | | |
| TC-2.5 | | |
| TC-2.6 | | |
| TC-2.7 | | |
| TC-3.1 | | |
| TC-3.2 | | |
| TC-3.3 | | |
| TC-3.4 | | |
| TC-3.5 | | |
| TC-4.1 | | |
| TC-4.2 | | |
| TC-4.3 | | |
| TC-4.4 | | |
| TC-4.5 | | |
| TC-4.6 | | |
| TC-4.7 | | |
| TC-4.8 | | |
| TC-4.9 | | |
| TC-4.10 | | |
| TC-5.1 | | |
| TC-5.2 | | |
| TC-5.3 | | |
| TC-5.4 | | |
| TC-5.5 | | |
| TC-5.6 | | |
| TC-5.7 | | |
| TC-5.8 | | |
| TC-5.9 | | |
| TC-X.1 | | |
| TC-X.2 | | |
| TC-X.3 | | |
