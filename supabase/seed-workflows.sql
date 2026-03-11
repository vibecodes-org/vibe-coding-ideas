-- Seed workflow demo data for local development.
-- Run AFTER seed.sql (which creates users, agents, and the seed idea).
--
-- Execute: psql -h localhost -p 54322 -U postgres -d postgres -f supabase/seed-workflows.sql
-- Or via Supabase MCP: execute_sql with this file's contents.

-- ============================================================================
-- UUIDs (deterministic for idempotency)
-- ============================================================================

-- Existing entities
-- Admin user:       a1111111-1111-4111-a111-111111111111
-- Product Owner:    a3333333-3333-4333-a333-333333333333
-- Atlas (Dev):      b0000000-0000-4000-a000-000000000001
-- Pixel (FE):       b0000000-0000-4000-a000-000000000002
-- Forge (BE):       b0000000-0000-4000-a000-000000000003
-- Sentinel (QA):    b0000000-0000-4000-a000-000000000004
-- Seed idea:        b1111111-1111-4111-b111-111111111111

-- New UUIDs for this seed (prefix: d for demo)
-- Board columns:    d0000000-0000-4000-a000-0000000000c1..c6
-- Board labels:     d0000000-0000-4000-a000-0000000000b1..b5
-- Board tasks:      d0000000-0000-4000-a000-000000000001..03
-- Templates:        d0000000-0000-4000-a000-000000000t01..t07
-- Auto-rules:       d0000000-0000-4000-a000-000000000r01..r04
-- Workflow runs:    d0000000-0000-4000-a000-000000000w01
-- Workflow steps:   d0000000-0000-4000-a000-00000000s001..s004
-- Step comments:    d0000000-0000-4000-a000-00000000m001..m002

BEGIN;

-- ============================================================================
-- 1. Board Columns (lazy-init equivalent)
-- ============================================================================

INSERT INTO board_columns (id, idea_id, title, position, is_done_column) VALUES
  ('d0000000-0000-4000-a000-0000000000c1', 'b1111111-1111-4111-b111-111111111111', 'Backlog',                       0, false),
  ('d0000000-0000-4000-a000-0000000000c2', 'b1111111-1111-4111-b111-111111111111', 'To Do',                      1000, false),
  ('d0000000-0000-4000-a000-0000000000c3', 'b1111111-1111-4111-b111-111111111111', 'Blocked/Requires User Input', 2000, false),
  ('d0000000-0000-4000-a000-0000000000c4', 'b1111111-1111-4111-b111-111111111111', 'In Progress',                3000, false),
  ('d0000000-0000-4000-a000-0000000000c5', 'b1111111-1111-4111-b111-111111111111', 'Verify',                     4000, false),
  ('d0000000-0000-4000-a000-0000000000c6', 'b1111111-1111-4111-b111-111111111111', 'Done',                       5000, true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 2. Agent Pool — allocate 5 bots to the seed idea
-- ============================================================================

INSERT INTO idea_agents (idea_id, bot_id, added_by) VALUES
  ('b1111111-1111-4111-b111-111111111111', 'a3333333-3333-4333-a333-333333333333', 'a1111111-1111-4111-a111-111111111111'),  -- Product Owner
  ('b1111111-1111-4111-b111-111111111111', 'b0000000-0000-4000-a000-000000000001', 'a1111111-1111-4111-a111-111111111111'),  -- Atlas
  ('b1111111-1111-4111-b111-111111111111', 'b0000000-0000-4000-a000-000000000002', 'a1111111-1111-4111-a111-111111111111'),  -- Pixel
  ('b1111111-1111-4111-b111-111111111111', 'b0000000-0000-4000-a000-000000000003', 'a1111111-1111-4111-a111-111111111111'),  -- Forge
  ('b1111111-1111-4111-b111-111111111111', 'b0000000-0000-4000-a000-000000000004', 'a1111111-1111-4111-a111-111111111111')   -- Sentinel
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. Board Labels (5)
-- ============================================================================

INSERT INTO board_labels (id, idea_id, name, color) VALUES
  ('d0000000-0000-4000-a000-0000000000b1', 'b1111111-1111-4111-b111-111111111111', 'Feature',     'blue'),
  ('d0000000-0000-4000-a000-0000000000b2', 'b1111111-1111-4111-b111-111111111111', 'Bug',         'red'),
  ('d0000000-0000-4000-a000-0000000000b3', 'b1111111-1111-4111-b111-111111111111', 'Enhancement', 'emerald'),
  ('d0000000-0000-4000-a000-0000000000b4', 'b1111111-1111-4111-b111-111111111111', 'Design',      'violet'),
  ('d0000000-0000-4000-a000-0000000000b5', 'b1111111-1111-4111-b111-111111111111', 'Spike',       'amber')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. Demo Tasks (3 in "To Do", 1 will move to "In Progress" later)
-- ============================================================================

INSERT INTO board_tasks (id, idea_id, column_id, title, description, position) VALUES
  (
    'd0000000-0000-4000-a000-000000000001',
    'b1111111-1111-4111-b111-111111111111',
    'd0000000-0000-4000-a000-0000000000c2',  -- To Do
    'Add theme toggle component',
    E'Create a toggle switch in the settings page that allows users to switch between light, dark, and system themes.\n\n## Acceptance Criteria\n- Toggle persists across sessions\n- Supports light, dark, and system modes\n- Uses next-themes under the hood\n- Accessible via keyboard',
    1000
  ),
  (
    'd0000000-0000-4000-a000-000000000002',
    'b1111111-1111-4111-b111-111111111111',
    'd0000000-0000-4000-a000-0000000000c2',  -- To Do (will be moved to In Progress below)
    'Fix contrast issue on settings page',
    E'The settings page has a contrast issue where certain labels are hard to read in dark mode.\n\n## Steps to Reproduce\n1. Open settings page in dark mode\n2. Look at form field labels — they appear as dark gray on near-black background\n\n## Expected\nLabels should use a lighter shade for sufficient contrast (WCAG AA 4.5:1 minimum).',
    2000
  ),
  (
    'd0000000-0000-4000-a000-000000000003',
    'b1111111-1111-4111-b111-111111111111',
    'd0000000-0000-4000-a000-0000000000c2',  -- To Do
    'Research CSS custom properties for theming',
    E'Investigate whether CSS custom properties (variables) would be a better foundation for our theming system than Tailwind''s built-in dark mode.\n\n## Questions to Answer\n- Performance impact of CSS variables vs Tailwind classes?\n- Can we support dynamic theme creation at runtime?\n- What does the migration path look like?\n- Are there accessibility implications?',
    3000
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 5. Workflow Templates (7)
-- ============================================================================

INSERT INTO workflow_templates (id, idea_id, name, description, steps, created_by) VALUES
  -- 1. Feature Development
  (
    'd0000000-0000-4000-a000-000000000101',
    'b1111111-1111-4111-b111-111111111111',
    'Feature Development',
    'End-to-end feature delivery from requirements through QA to sign-off.',
    '[
      {"title": "Requirements", "description": "Gather and document requirements, define acceptance criteria, and estimate scope.", "role": "Product Owner", "requires_approval": false},
      {"title": "UX Design", "description": "Create wireframes and interaction flows based on the requirements.", "role": "UX Designer", "requires_approval": false},
      {"title": "Design Review", "description": "Review proposed designs against requirements and provide approval or feedback.", "role": "Product Owner", "requires_approval": true},
      {"title": "Implementation", "description": "Build the feature with tests following project conventions.", "role": "Full Stack Developer", "requires_approval": false},
      {"title": "QA Testing", "description": "Verify the implementation meets acceptance criteria and test edge cases.", "role": "QA Engineer", "requires_approval": false},
      {"title": "Final Sign-off", "description": "Confirm the feature is ready for release.", "role": "Product Owner", "requires_approval": true}
    ]'::jsonb,
    'a1111111-1111-4111-a111-111111111111'
  ),
  -- 2. Bug Fix
  (
    'd0000000-0000-4000-a000-000000000102',
    'b1111111-1111-4111-b111-111111111111',
    'Bug Fix',
    'Structured bug resolution from reproduction through verification.',
    '[
      {"title": "Reproduce & Investigate", "description": "Confirm the bug, identify root cause, and document reproduction steps.", "role": "QA Engineer", "requires_approval": false},
      {"title": "Implement Fix", "description": "Fix the root cause and add regression tests.", "role": "Full Stack Developer", "requires_approval": false},
      {"title": "Verify Fix", "description": "Confirm the fix resolves the issue without regressions.", "role": "QA Engineer", "requires_approval": false},
      {"title": "Regression Check", "description": "Final sign-off that the fix is complete and no side-effects remain.", "role": "Product Owner", "requires_approval": true}
    ]'::jsonb,
    'a1111111-1111-4111-a111-111111111111'
  ),
  -- 3. Technical Spike
  (
    'd0000000-0000-4000-a000-000000000103',
    'b1111111-1111-4111-b111-111111111111',
    'Technical Spike',
    'Time-boxed research to answer technical questions and recommend a path forward.',
    '[
      {"title": "Define Research Questions", "description": "Clarify what needs to be answered and set a time-box.", "role": "Product Owner", "requires_approval": false},
      {"title": "Research & Prototype", "description": "Investigate options, build prototypes, and gather data.", "role": "Full Stack Developer", "requires_approval": false},
      {"title": "Write Recommendation", "description": "Document findings, trade-offs, and a recommended approach.", "role": "Full Stack Developer", "requires_approval": false},
      {"title": "Review & Decide", "description": "Review the recommendation and decide on next steps.", "role": "Product Owner", "requires_approval": true}
    ]'::jsonb,
    'a1111111-1111-4111-a111-111111111111'
  ),
  -- 4. Design Review
  (
    'd0000000-0000-4000-a000-000000000104',
    'b1111111-1111-4111-b111-111111111111',
    'Design Review',
    'Audit existing UX, propose improvements, implement, and verify visually.',
    '[
      {"title": "Audit Current UX", "description": "Review the current user experience and identify pain points.", "role": "UX Designer", "requires_approval": false},
      {"title": "Create Design Proposals", "description": "Produce design options with mockups and rationale.", "role": "UX Designer", "requires_approval": true},
      {"title": "Implement Approved Design", "description": "Build the approved design with pixel-perfect accuracy.", "role": "Frontend Engineer", "requires_approval": false},
      {"title": "Visual QA", "description": "Verify the implementation matches the approved design across viewports.", "role": "QA Engineer", "requires_approval": false}
    ]'::jsonb,
    'a1111111-1111-4111-a111-111111111111'
  ),
  -- 5. Idea Validation
  (
    'd0000000-0000-4000-a000-000000000105',
    'b1111111-1111-4111-b111-111111111111',
    'Idea Validation',
    'Validate a product idea through market research and user insights before committing resources.',
    '[
      {"title": "Market Research", "description": "Analyse the market landscape, identify trends, and assess demand.", "role": "Product Owner", "requires_approval": false},
      {"title": "Competitor Analysis", "description": "Review competing solutions, identify gaps and differentiators.", "role": "Product Owner", "requires_approval": false},
      {"title": "User Interview Synthesis", "description": "Compile user interview findings and extract key insights.", "role": "UX Designer", "requires_approval": false},
      {"title": "Go/No-Go Decision", "description": "Review all evidence and decide whether to proceed.", "role": "Product Owner", "requires_approval": true}
    ]'::jsonb,
    'a1111111-1111-4111-a111-111111111111'
  ),
  -- 6. Product Launch
  (
    'd0000000-0000-4000-a000-000000000106',
    'b1111111-1111-4111-b111-111111111111',
    'Product Launch',
    'Coordinate a product launch from pre-launch checks through post-launch review.',
    '[
      {"title": "Pre-launch Checklist", "description": "Verify all launch prerequisites: tests passing, docs updated, monitoring configured.", "role": "Product Owner", "requires_approval": false},
      {"title": "Marketing Assets", "description": "Create launch announcements, screenshots, and promotional materials.", "role": "UX Designer", "requires_approval": false},
      {"title": "Launch Approval", "description": "Final go/no-go decision for the launch.", "role": "Product Owner", "requires_approval": true},
      {"title": "Post-launch Metrics Review", "description": "Review key metrics 48 hours after launch and document lessons learned.", "role": "Product Owner", "requires_approval": false}
    ]'::jsonb,
    'a1111111-1111-4111-a111-111111111111'
  ),
  -- 7. Client Project
  (
    'd0000000-0000-4000-a000-000000000107',
    'b1111111-1111-4111-b111-111111111111',
    'Client Project',
    'End-to-end client engagement from brief through delivery and handoff.',
    '[
      {"title": "Brief & Requirements", "description": "Gather client brief, clarify requirements, and document constraints.", "role": "Product Owner", "requires_approval": false},
      {"title": "Proposal & Scope", "description": "Draft proposal with scope, timeline, and cost estimate for client approval.", "role": "Product Owner", "requires_approval": true},
      {"title": "Execute", "description": "Implement the agreed scope following project standards.", "role": "Full Stack Developer", "requires_approval": false},
      {"title": "Client Review", "description": "Present deliverables to client for review and feedback.", "role": "Product Owner", "requires_approval": true},
      {"title": "Deliver & Handoff", "description": "Package final deliverables, documentation, and handoff notes.", "role": "Product Owner", "requires_approval": false}
    ]'::jsonb,
    'a1111111-1111-4111-a111-111111111111'
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 6. Auto-Rules (4 label → template triggers)
-- ============================================================================

INSERT INTO workflow_auto_rules (id, idea_id, label_id, template_id, auto_run) VALUES
  ('d0000000-0000-4000-a000-000000000201', 'b1111111-1111-4111-b111-111111111111',
   'd0000000-0000-4000-a000-0000000000b1', 'd0000000-0000-4000-a000-000000000101', true),   -- Feature → Feature Development
  ('d0000000-0000-4000-a000-000000000202', 'b1111111-1111-4111-b111-111111111111',
   'd0000000-0000-4000-a000-0000000000b2', 'd0000000-0000-4000-a000-000000000102', true),   -- Bug → Bug Fix
  ('d0000000-0000-4000-a000-000000000203', 'b1111111-1111-4111-b111-111111111111',
   'd0000000-0000-4000-a000-0000000000b5', 'd0000000-0000-4000-a000-000000000103', true),   -- Spike → Technical Spike
  ('d0000000-0000-4000-a000-000000000204', 'b1111111-1111-4111-b111-111111111111',
   'd0000000-0000-4000-a000-0000000000b4', 'd0000000-0000-4000-a000-000000000104', false)   -- Design → Design Review (manual)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 7. Live Workflow Demo — Bug Fix on "Fix contrast issue" task
-- ============================================================================

-- Move the contrast task to "In Progress"
UPDATE board_tasks
SET column_id = 'd0000000-0000-4000-a000-0000000000c4'  -- In Progress
WHERE id = 'd0000000-0000-4000-a000-000000000002';

-- Create the workflow run
INSERT INTO workflow_runs (id, task_id, template_id, status, current_step, started_by, started_at) VALUES
  (
    'd0000000-0000-4000-a000-000000000301',
    'd0000000-0000-4000-a000-000000000002',   -- contrast task
    'd0000000-0000-4000-a000-000000000102',   -- Bug Fix template
    'running',
    2,  -- currently on step 2
    'a1111111-1111-4111-a111-111111111111',
    now() - interval '2 hours'
  )
ON CONFLICT (id) DO NOTHING;

-- Create the 4 Bug Fix workflow steps
INSERT INTO task_workflow_steps (id, task_id, idea_id, run_id, bot_id, title, description, status, position, step_order, agent_role, human_check_required, output, started_at, completed_at) VALUES
  -- Step 1: Reproduce (completed by Sentinel)
  (
    'd0000000-0000-4000-a000-000000000401',
    'd0000000-0000-4000-a000-000000000002',
    'b1111111-1111-4111-b111-111111111111',
    'd0000000-0000-4000-a000-000000000301',
    'b0000000-0000-4000-a000-000000000004',  -- Sentinel (QA)
    'Reproduce & Investigate',
    'Confirm the bug, identify root cause, and document reproduction steps.',
    'completed',
    1000, 1, 'QA Engineer', false,
    E'## Bug Confirmed\n\nReproduced on dark mode. The form field labels use `text-gray-600` which has a contrast ratio of 2.8:1 against the `bg-zinc-900` background — well below WCAG AA minimum of 4.5:1.\n\n### Root Cause\nThe label classes were hardcoded without dark mode variants. Need to add `dark:text-gray-300` or use the design system''s `text-muted-foreground` token which already adapts.\n\n### Recommendation\nReplace `text-gray-600` with `text-muted-foreground` across all settings form labels.',
    now() - interval '2 hours',
    now() - interval '1 hour 30 minutes'
  ),
  -- Step 2: Implement Fix (in progress, claimed by Atlas)
  (
    'd0000000-0000-4000-a000-000000000402',
    'd0000000-0000-4000-a000-000000000002',
    'b1111111-1111-4111-b111-111111111111',
    'd0000000-0000-4000-a000-000000000301',
    'b0000000-0000-4000-a000-000000000001',  -- Atlas (Dev)
    'Implement Fix',
    'Fix the root cause and add regression tests.',
    'in_progress',
    2000, 2, 'Full Stack Developer', false,
    NULL,
    now() - interval '45 minutes',
    NULL
  ),
  -- Step 3: Verify Fix (pending)
  (
    'd0000000-0000-4000-a000-000000000403',
    'd0000000-0000-4000-a000-000000000002',
    'b1111111-1111-4111-b111-111111111111',
    'd0000000-0000-4000-a000-000000000301',
    'b0000000-0000-4000-a000-000000000004',  -- Sentinel (QA)
    'Verify Fix',
    'Confirm the fix resolves the issue without regressions.',
    'pending',
    3000, 3, 'QA Engineer', false,
    NULL, NULL, NULL
  ),
  -- Step 4: Regression Check (pending, approval gate)
  (
    'd0000000-0000-4000-a000-000000000404',
    'd0000000-0000-4000-a000-000000000002',
    'b1111111-1111-4111-b111-111111111111',
    'd0000000-0000-4000-a000-000000000301',
    'a3333333-3333-4333-a333-333333333333',  -- Product Owner
    'Regression Check',
    'Final sign-off that the fix is complete and no side-effects remain.',
    'pending',
    4000, 4, 'Product Owner', true,
    NULL, NULL, NULL
  )
ON CONFLICT (id) DO NOTHING;

-- Step comments (inter-agent communication)
INSERT INTO workflow_step_comments (id, step_id, idea_id, author_id, type, content) VALUES
  -- Sentinel's output on step 1
  (
    'd0000000-0000-4000-a000-000000000501',
    'd0000000-0000-4000-a000-000000000401',  -- step 1
    'b1111111-1111-4111-b111-111111111111',
    'b0000000-0000-4000-a000-000000000004',  -- Sentinel
    'output',
    'Contrast ratio measured at 2.8:1 for `text-gray-600` on `bg-zinc-900`. All 7 affected labels identified in `settings-form.tsx` lines 45-120. Replacing with `text-muted-foreground` brings the ratio to 7.2:1 (passes AAA).'
  ),
  -- Atlas picking up step 2
  (
    'd0000000-0000-4000-a000-000000000502',
    'd0000000-0000-4000-a000-000000000402',  -- step 2
    'b1111111-1111-4111-b111-111111111111',
    'b0000000-0000-4000-a000-000000000001',  -- Atlas
    'comment',
    'Picking this up. Will replace all 7 instances with `text-muted-foreground` as Sentinel recommended, plus add a visual regression snapshot test to catch future contrast issues.'
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 8. Auto-Rule Triggers — assign labels to tasks
--    The auto_apply_workflow_on_label() trigger will auto-create workflow runs.
-- ============================================================================

-- "Feature" label on toggle task → triggers Feature Development workflow (6 steps)
INSERT INTO board_task_labels (task_id, label_id) VALUES
  ('d0000000-0000-4000-a000-000000000001', 'd0000000-0000-4000-a000-0000000000b1')  -- Feature label
ON CONFLICT DO NOTHING;

-- "Spike" label on research task → triggers Technical Spike workflow (4 steps)
INSERT INTO board_task_labels (task_id, label_id) VALUES
  ('d0000000-0000-4000-a000-000000000003', 'd0000000-0000-4000-a000-0000000000b5')  -- Spike label
ON CONFLICT DO NOTHING;

-- "Bug" label on contrast task (workflow already manually created above, trigger will skip it)
INSERT INTO board_task_labels (task_id, label_id) VALUES
  ('d0000000-0000-4000-a000-000000000002', 'd0000000-0000-4000-a000-0000000000b2')  -- Bug label
ON CONFLICT DO NOTHING;

COMMIT;
