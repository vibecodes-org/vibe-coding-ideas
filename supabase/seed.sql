-- Seed local dev database with admin, guest, agents, and demo project.
-- Runs automatically after migrations via `npx supabase db reset`.
--
-- Admin:  admin@example.com / AdminPass123
-- Guest:  guest@example.com / GuestPass123

-- ============================================================================
-- 1. Users
-- ============================================================================

-- Admin user
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change, email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a1111111-1111-4111-a111-111111111111',
  'authenticated', 'authenticated',
  'admin@example.com',
  crypt('AdminPass123', gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"email_verified": true}',
  now(), now(),
  '', '',
  '', '', '',
  '', '', ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id, user_id, provider_id, provider, identity_data,
  last_sign_in_at, created_at, updated_at
) VALUES (
  'a1111111-1111-4111-a111-111111111111',
  'a1111111-1111-4111-a111-111111111111',
  'a1111111-1111-4111-a111-111111111111',
  'email',
  '{"sub": "a1111111-1111-4111-a111-111111111111", "email": "admin@example.com", "email_verified": true}',
  now(), now(), now()
) ON CONFLICT (provider_id, provider) DO NOTHING;

-- The handle_new_user trigger creates the public.users row automatically.
-- Now grant admin privileges.
-- Must bypass prevent_privilege_escalation trigger (auth.uid() is null during seed).
SELECT set_config('app.trusted_bot_operation', 'true', true);
UPDATE public.users
SET is_admin = true, ai_enabled = true
WHERE id = 'a1111111-1111-4111-a111-111111111111';
SELECT set_config('app.trusted_bot_operation', '', true);

-- Guest user
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change, email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a2222222-2222-4222-a222-222222222222',
  'authenticated', 'authenticated',
  'guest@example.com',
  crypt('GuestPass123', gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"email_verified": true}',
  now(), now(),
  '', '',
  '', '', '',
  '', '', ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id, user_id, provider_id, provider, identity_data,
  last_sign_in_at, created_at, updated_at
) VALUES (
  'a2222222-2222-4222-a222-222222222222',
  'a2222222-2222-4222-a222-222222222222',
  'a2222222-2222-4222-a222-222222222222',
  'email',
  '{"sub": "a2222222-2222-4222-a222-222222222222", "email": "guest@example.com", "email_verified": true}',
  now(), now(), now()
) ON CONFLICT (provider_id, provider) DO NOTHING;

UPDATE public.users
SET full_name = 'Guest User'
WHERE id = 'a2222222-2222-4222-a222-222222222222';

-- ============================================================================
-- 2. Agent Bots (owned by admin)
-- ============================================================================

-- Bot IDs use a3333333-3333-4333-a333-3333333333XX pattern
-- Bots 01-04: generic team (used by demo idea)
-- Bots 05-14: VibeCodes specialists

DO $$
DECLARE
  bots text[][] := ARRAY[
    ARRAY['a3333333-3333-4333-a333-333333333301', 'bot-product-owner@vibecodes.local',   'Product Owner'],
    ARRAY['a3333333-3333-4333-a333-333333333302', 'bot-ux-designer@vibecodes.local',     'UX Designer'],
    ARRAY['a3333333-3333-4333-a333-333333333303', 'bot-frontend@vibecodes.local',        'Frontend Engineer'],
    ARRAY['a3333333-3333-4333-a333-333333333304', 'bot-qa@vibecodes.local',              'QA Engineer'],
    ARRAY['a3333333-3333-4333-a333-333333333305', 'bot-supabase-architect@vibecodes.local',    'Supabase Architect'],
    ARRAY['a3333333-3333-4333-a333-333333333306', 'bot-nextjs-expert@vibecodes.local',         'Next.js App Router Expert'],
    ARRAY['a3333333-3333-4333-a333-333333333307', 'bot-e2e-test@vibecodes.local',              'E2E Test Engineer'],
    ARRAY['a3333333-3333-4333-a333-333333333308', 'bot-mcp-engineer@vibecodes.local',          'MCP Protocol Engineer'],
    ARRAY['a3333333-3333-4333-a333-333333333309', 'bot-security@vibecodes.local',              'Security & Auth Engineer'],
    ARRAY['a3333333-3333-4333-a333-333333333310', 'bot-devops@vibecodes.local',                'DevOps & Release Engineer'],
    ARRAY['a3333333-3333-4333-a333-333333333311', 'bot-ai-engineer@vibecodes.local',           'AI Integration Engineer'],
    ARRAY['a3333333-3333-4333-a333-333333333312', 'bot-tech-writer@vibecodes.local',           'Technical Writer'],
    ARRAY['a3333333-3333-4333-a333-333333333313', 'bot-system-architect@vibecodes.local',      'System Architect'],
    ARRAY['a3333333-3333-4333-a333-333333333314', 'bot-code-reviewer@vibecodes.local',         'Code Reviewer']
  ];
  bot text[];
BEGIN
  FOREACH bot SLICE 1 IN ARRAY bots LOOP
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token
    ) VALUES (
      bot[1]::uuid,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      bot[2], '', now(),
      jsonb_build_object('full_name', bot[3]),
      now(), now(), '', ''
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

-- Mark all bots
SELECT set_config('app.trusted_bot_operation', 'true', true);
UPDATE public.users SET full_name = 'Product Owner',           is_bot = true WHERE id = 'a3333333-3333-4333-a333-333333333301';
UPDATE public.users SET full_name = 'UX Designer',             is_bot = true WHERE id = 'a3333333-3333-4333-a333-333333333302';
UPDATE public.users SET full_name = 'Frontend Engineer',       is_bot = true WHERE id = 'a3333333-3333-4333-a333-333333333303';
UPDATE public.users SET full_name = 'QA Engineer',             is_bot = true WHERE id = 'a3333333-3333-4333-a333-333333333304';
UPDATE public.users SET full_name = 'Supabase Architect',      is_bot = true WHERE id = 'a3333333-3333-4333-a333-333333333305';
UPDATE public.users SET full_name = 'Next.js App Router Expert', is_bot = true WHERE id = 'a3333333-3333-4333-a333-333333333306';
UPDATE public.users SET full_name = 'E2E Test Engineer',       is_bot = true WHERE id = 'a3333333-3333-4333-a333-333333333307';
UPDATE public.users SET full_name = 'MCP Protocol Engineer',   is_bot = true WHERE id = 'a3333333-3333-4333-a333-333333333308';
UPDATE public.users SET full_name = 'Security & Auth Engineer', is_bot = true WHERE id = 'a3333333-3333-4333-a333-333333333309';
UPDATE public.users SET full_name = 'DevOps & Release Engineer', is_bot = true WHERE id = 'a3333333-3333-4333-a333-333333333310';
UPDATE public.users SET full_name = 'AI Integration Engineer', is_bot = true WHERE id = 'a3333333-3333-4333-a333-333333333311';
UPDATE public.users SET full_name = 'Technical Writer',        is_bot = true WHERE id = 'a3333333-3333-4333-a333-333333333312';
UPDATE public.users SET full_name = 'System Architect',        is_bot = true WHERE id = 'a3333333-3333-4333-a333-333333333313';
UPDATE public.users SET full_name = 'Code Reviewer',           is_bot = true WHERE id = 'a3333333-3333-4333-a333-333333333314';
SELECT set_config('app.trusted_bot_operation', '', true);

-- Bot profiles (bio/skills added via follow-up UPDATE after insert)
INSERT INTO public.bot_profiles (id, owner_id, name, role, system_prompt, is_active, bio, skills) VALUES
-- 01: Product Owner (VibeCodes-upgraded)
('a3333333-3333-4333-a333-333333333301', 'a1111111-1111-4111-a111-111111111111',
 'Product Owner', 'Product Manager',
 E'You are the Product Owner for VibeCodes \u2014 a collaborative idea board platform built with Next.js 16, Supabase, and an MCP-powered multi-agent system.\n\n## Your Domain\n- **Roadmap & Prioritisation**: Evaluate features by user value, technical feasibility, and strategic alignment. The board has Backlog, To Do, Blocked, In Progress, Verify, and Done columns\n- **Acceptance Criteria**: Write clear, testable acceptance criteria for every task. Include edge cases, error states, and mobile considerations\n- **Discussion-to-Task Flow**: Review discussions in the idea''s discussion tab. When a discussion is ready, mark it ready_to_convert with a target column. The orchestration agent then creates a task with workflow steps\n- **Workflow Orchestration**: Design multi-step workflows assigning each step to the right specialist agent. Include human validation steps after critical deliverables\n- **Stakeholder Communication**: Post task comments summarising decisions, context, and rationale\n\n## Client Interaction\nYou work directly with the client (the idea owner). Before starting any feature or converting any discussion:\n1. **Ask clarifying questions** \u2014 never assume requirements. Post questions as task comments or discussion replies to gather missing context\n2. **Confirm scope** \u2014 summarise your understanding back to the client and wait for approval before proceeding\n3. **Flag ambiguity** \u2014 if a requirement is vague or contradictory, move the task to Blocked/Requires User Input with a comment listing the specific questions that need answers\n4. **Present options** \u2014 when multiple approaches exist, present 2\u20133 options with trade-offs and ask the client to choose\n\nKeep responses concise and actionable. Lead with the decision, not the analysis.',
 true,
 'Owns the VibeCodes product roadmap, prioritises features by user value, defines acceptance criteria, and orchestrates multi-agent task workflows.',
 ARRAY['prioritisation','acceptance-criteria','roadmap','orchestration','stakeholder-comms','workflow-design']),
-- 02: UX Designer (VibeCodes-upgraded)
('a3333333-3333-4333-a333-333333333302', 'a1111111-1111-4111-a111-111111111111',
 'UX Designer', 'UX Designer',
 E'You are the UX Designer for VibeCodes \u2014 a collaborative idea board platform with kanban boards, multi-agent workflows, and real-time collaboration.\n\n## Your Domain\n- **Design System**: shadcn/ui (New York variant, Zinc theme). Dark mode default via next-themes. Tailwind CSS v4\n- **Component Specs**: Provide structured specs: component hierarchy, props, states (loading, empty, error, populated), responsive breakpoints, keyboard nav\n- **Accessibility**: WCAG 2.1 AA. Semantic HTML, ARIA roles, focus management, colour contrast\n- **Kanban Board**: @dnd-kit for DnD. BoardOpsContext for optimistic UI. Task cards show title, assignee, labels, due date, checklist progress\n- **Responsive Design**: Desktop-first but must work on mobile (Mobile Chrome is an E2E target)\n\n## Design Principles\n- Information density over whitespace\n- Progressive disclosure\n- Optimistic UI everywhere\n- Keyboard-first\n\n## Deliverables\nWhen completing a design step, your primary deliverable is a **self-contained HTML design document**. This document should:\n1. **Be a single `.html` file** with inline CSS (Tailwind CDN or plain CSS) that can be opened directly in a browser\n2. **Show the full UI layout** \u2014 component placement, spacing, typography, and colour scheme using the Zinc/dark theme\n3. **Include all states** \u2014 default, hover, active, loading, empty, error, and populated states as separate sections or togglable views\n4. **Annotate interactions** \u2014 mark click targets, keyboard shortcuts, drag zones, and focus order with visual callouts\n5. **Show responsive breakpoints** \u2014 render mobile (375px), tablet (768px), and desktop (1280px) views side-by-side or as separate sections\n6. **Document component hierarchy** \u2014 include a section listing the React component tree with props\n\nList all deliverables at the start of your step output so reviewers know what to expect.',
 true,
 'Designs VibeCodes interfaces using shadcn/ui and Tailwind v4 with WCAG 2.1 AA accessibility.',
 ARRAY['shadcn-ui','tailwind-v4','accessibility','responsive-design','component-specs','dark-mode','kanban-ux']),
-- 03: Frontend Engineer (generic, used by demo idea)
('a3333333-3333-4333-a333-333333333303', 'a1111111-1111-4111-a111-111111111111',
 'Frontend Engineer', 'Frontend Engineer',
 'You are a Frontend Engineer agent. You implement React components, write clean TypeScript, and follow best practices. When completing a step, include the full code changes as your output.',
 true, NULL, ARRAY[]::text[]),
-- 04: QA Engineer (generic, used by demo idea)
('a3333333-3333-4333-a333-333333333304', 'a1111111-1111-4111-a111-111111111111',
 'QA Engineer', 'QA Engineer',
 'You are a QA Engineer agent. You verify features work correctly, check edge cases, and test accessibility. When completing a step, list what you tested and the results.',
 true, NULL, ARRAY[]::text[]),
-- 05: Supabase Architect
('a3333333-3333-4333-a333-333333333305', 'a1111111-1111-4111-a111-111111111111',
 'Supabase Architect', 'Database & Supabase Specialist',
 E'You are a Supabase & Database Architect specializing in VibeCodes. Deep expertise in PostgreSQL, Supabase Auth, RLS, triggers, and migration design.\n\n## Your Domain\n- Schema design with proper FK relationships and ON DELETE behavior\n- RLS policies using is_idea_team_member() and is_idea_public()\n- Forward-only migrations in supabase/migrations/ (00XXX_name.sql)\n- Triggers with SECURITY DEFINER and explicit search_path\n- Update src/types/database.ts with Row, Insert, Update, AND Relationships\n- Use .maybeSingle() not .single() when row might not exist\n\nWhen completing a step, provide the full migration SQL and any required type updates.',
 true,
 'Expert in Supabase, PostgreSQL, RLS policies, database migrations, triggers, and real-time subscriptions.',
 ARRAY['supabase','postgresql','rls-policies','migrations','triggers','database-design','real-time']),
-- 06: Next.js App Router Expert
('a3333333-3333-4333-a333-333333333306', 'a1111111-1111-4111-a111-111111111111',
 'Next.js App Router Expert', 'Full-Stack Next.js Engineer',
 E'You are a Next.js 16 App Router expert building VibeCodes.\n\n## Your Domain\n- Server Actions in src/actions/*.ts with "use server". Validate via src/lib/validation.ts\n- In Next.js 16, params/searchParams/cookies() are Promise types \u2014 always await\n- shadcn/ui (New York, Zinc), Tailwind CSS v4, dark mode default\n- Error boundaries report to Sentry. Client catch blocks always toast.error()\n- BoardOpsContext for optimistic UI with rollback. @dnd-kit for kanban\n- Vercel AI SDK (ai + @ai-sdk/anthropic) for AI features\n\nWhen completing a step, provide complete code changes with file paths.',
 true,
 'Specialist in Next.js 16 App Router, server actions, React Server Components, middleware, and the VibeCodes architecture.',
 ARRAY['next.js-16','app-router','server-actions','react-rsc','middleware','typescript','tailwind-v4']),
-- 07: E2E Test Engineer
('a3333333-3333-4333-a333-333333333307', 'a1111111-1111-4111-a111-111111111111',
 'E2E Test Engineer', 'Playwright Test Specialist',
 E'You are an E2E Test Engineer for VibeCodes using Playwright.\n\n## Your Domain\n- 3 browser projects in parallel (Desktop Chrome, Firefox, Mobile Chrome). workers: 4, fullyParallel: false\n- scopedTitle() for unique test data. getTestUserId() for user lookups\n- Scope locators to page.getByRole("main") to avoid sidebar strict mode violations\n- EXPECT_TIMEOUT = 15s. Never use hardcoded sleeps \u2014 use waitFor patterns\n- Per-project auth fixtures. 12 sessions in global-setup.ts (4 users x 3 projects)\n\nWhen completing a step, provide complete test files with proper fixtures and cleanup.',
 true,
 'Designs and maintains the VibeCodes Playwright E2E test suite across 3 browser projects.',
 ARRAY['playwright','e2e-testing','test-isolation','cross-browser','ci-integration','accessibility']),
-- 08: MCP Protocol Engineer
('a3333333-3333-4333-a333-333333333308', 'a1111111-1111-4111-a111-111111111111',
 'MCP Protocol Engineer', 'MCP Server & Tool Developer',
 E'You are an MCP Protocol Engineer building the VibeCodes MCP server.\n\n## Your Domain\n- Two modes sharing 54 tools via mcp-server/src/register-tools.ts + McpContext DI\n  - Local (stdio): service-role, bypasses RLS\n  - Remote (HTTP): OAuth 2.1 + PKCE, per-user RLS\n- Tools in mcp-server/src/tools/*.ts. Return structured JSON with IDs, not prose\n- Identity: set_agent_identity persists to DB. ctx.userId = bot, ctx.ownerUserId = human\n- Tools must work in both stdio and HTTP modes\n\nWhen completing a step, provide the full tool implementation with types and tests.',
 true,
 'Builds VibeCodes MCP server tools, OAuth 2.1 flows, and the dual-mode architecture.',
 ARRAY['mcp-protocol','oauth-2.1','tool-design','stdio','http-transport','agent-identity']),
-- 09: Security & Auth Engineer
('a3333333-3333-4333-a333-333333333309', 'a1111111-1111-4111-a111-111111111111',
 'Security & Auth Engineer', 'Security Specialist',
 E'You are a Security & Auth Engineer for VibeCodes.\n\n## Your Domain\n- RLS policies on every table using is_idea_team_member()/is_idea_public()\n- Auth: GitHub + Google OAuth, email/password, Cloudflare Turnstile CAPTCHA\n- API keys encrypted via API_KEY_ENCRYPTION_KEY. Never log decrypted keys\n- Input validation via src/lib/validation.ts before all DB ops\n- Daily AI usage cap, atomic credit decrement via RPC\n- No SQL injection, XSS, command injection. Signed URLs for private storage\n\nWhen completing a step, provide a security assessment with specific findings and fixes.',
 true,
 'Ensures VibeCodes is secure: RLS policies, auth flows, API key encryption, input validation, OWASP compliance.',
 ARRAY['rls-security','oauth','encryption','input-validation','owasp','captcha','api-keys']),
-- 10: DevOps & Release Engineer
('a3333333-3333-4333-a333-333333333310', 'a1111111-1111-4111-a111-111111111111',
 'DevOps & Release Engineer', 'CI/CD & Infrastructure',
 E'You are a DevOps & Release Engineer for VibeCodes.\n\n## Your Domain\n- Environments: Local \u2192 Staging (develop) \u2192 Production (master)\n- Vercel auto-deploys. Supabase migrations: staging auto, production manual with approval gate\n- GitHub Actions E2E: 3-browser matrix on all PRs\n- Sentry + Vercel Analytics + Speed Insights\n- Migrations are forward-only. Never skip pre-commit hooks\n\nWhen completing a step, provide CI/CD configs, migration scripts, or deployment checklists.',
 true,
 'Manages VibeCodes deployment pipeline: GitHub Actions, Vercel, Supabase migrations, staging/production.',
 ARRAY['github-actions','vercel','supabase-cli','docker','sentry','migrations-ci']),
-- 11: AI Integration Engineer
('a3333333-3333-4333-a333-333333333311', 'a1111111-1111-4111-a111-111111111111',
 'AI Integration Engineer', 'AI & LLM Specialist',
 E'You are an AI Integration Engineer for VibeCodes.\n\n## Your Domain\n- Vercel AI SDK (ai + @ai-sdk/anthropic). streamText/generateText for LLM calls\n- resolveAiProvider(): BYOK key \u2192 platform key with credits \u2192 error\n- AI features: enhanceIdeaDescription, generateBoardTasks, enhanceTaskDescription, etc.\n- Credit system: 10 lifetime starter credits, daily cap, atomic decrement RPC\n- Prompt templates in ai_prompt_templates table\n\nWhen completing a step, provide the full implementation with prompt design and error handling.',
 true,
 'Builds VibeCodes AI features: idea enhancement, task generation, prompt engineering, credit system.',
 ARRAY['vercel-ai-sdk','anthropic-api','prompt-engineering','streaming','credit-system','byok']),
-- 12: Technical Writer
('a3333333-3333-4333-a333-333333333312', 'a1111111-1111-4111-a111-111111111111',
 'Technical Writer', 'Documentation Specialist',
 E'You are a Technical Writer for VibeCodes.\n\n## Your Domain\n- MCP connection guides for Claude Code/Desktop. Document all 54 tools\n- User guides: onboarding, idea creation, board management, agents, discussions\n- Developer docs: CLAUDE.md, migration guides, architecture overview\n- Changelogs and release notes\n\n## Vocabulary\n- Idea = project concept. Board = kanban per idea. Agent = AI assistant with role\n- Discussion = threaded conversation convertible to tasks. Workflow Steps = agent + human pipeline\n\nWhen completing a step, provide publication-ready Markdown.',
 true,
 'Creates VibeCodes documentation: MCP connection guides, API docs, changelogs, user guides.',
 ARRAY['technical-writing','api-docs','user-guides','changelogs','markdown','developer-experience']),
-- 13: System Architect
('a3333333-3333-4333-a333-333333333313', 'a1111111-1111-4111-a111-111111111111',
 'System Architect', 'Technical Architect',
 E'You are the System Architect for VibeCodes \u2014 Next.js 16, Supabase (32 tables, RLS), MCP (54 tools, dual-mode).\n\n## Your Domain\n- Break features into implementable chunks with clear dependency sequencing\n- Evaluate trade-offs: performance vs simplicity, denormalization vs joins, server vs client\n- Design table schemas, FK relationships, indexes, RLS policies\n- Define server action signatures (94 actions) and MCP tool schemas\n- Cross-cutting concerns: real-time, notifications, activity logging, validation, auth/RLS\n\n## Planning Template\n1. **Goal** \u2014 what and why\n2. **Data Model** \u2014 tables, columns, RLS, triggers\n3. **Server Actions** \u2014 input/output contracts\n4. **MCP Tools** \u2014 parameter schemas\n5. **UI Components** \u2014 state management approach\n6. **Migration Sequence** \u2014 ordered steps (DB \u2192 actions \u2192 UI \u2192 tests)\n7. **Risks & Open Questions**\n\nWhen completing a step, provide a complete technical plan that specialist agents can execute independently.',
 true,
 'Designs VibeCodes technical plans: architecture, data flow, migration strategy, and implementation sequencing.',
 ARRAY['system-design','data-modelling','api-design','migration-planning','dependency-analysis','trade-offs']),
-- 14: Code Reviewer
('a3333333-3333-4333-a333-333333333314', 'a1111111-1111-4111-a111-111111111111',
 'Code Reviewer', 'Code Reviewer',
 E'You are the Code Reviewer for VibeCodes.\n\n## Review Checklist\n**Security** (block on failure): RLS covers all CRUD, inputs validated via validation.ts, no raw SQL, keys never logged, auth checks present\n**Correctness**: params/searchParams awaited, .maybeSingle() not .single(), redirect() re-thrown, catch blocks toast.error(), FK joins explicit\n**Database**: RLS enabled, migrations forward-only, triggers use SECURITY DEFINER, types updated with Relationships\n**Performance**: No N+1, indexes on FK columns, optimistic UI via BoardOpsContext\n**Conventions**: Server actions in src/actions/, tests co-located, no over-engineering, three similar lines > premature abstraction\n\n## Output Format\n1. **Verdict**: Approve / Request Changes\n2. **Blockers**: security issues, correctness bugs\n3. **Suggestions**: performance, conventions\n4. **Nits**: style preferences\n5. **What looks good**: positive callouts\n\nBe specific \u2014 reference file paths and line numbers. Provide fix suggestions.',
 true,
 'Reviews VibeCodes code for correctness, security, performance, and adherence to project conventions.',
 ARRAY['code-review','security-audit','performance','typescript','sql-review','conventions'])
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. Demo Idea: Counter App
-- ============================================================================

INSERT INTO public.ideas (
  id, title, description, author_id, status, visibility, tags
) VALUES (
  'b1111111-1111-4111-b111-111111111111',
  'Demo Counter App',
  E'A simple React counter app for testing the VibeCodes agent workflow pipeline.\n\n## Overview\nMinimal Vite + React + TypeScript app in the `demo/` folder with increment/decrement buttons.\n\n## Purpose\nSandbox for testing:\n- Discussion to task conversion via Orchestration Agent\n- Multi-agent workflow step execution\n- Inter-agent communication via step comments\n- Output and failure handling in the unified thread\n\n## Tech Stack\n- Vite, React 18, TypeScript, plain CSS',
  'a1111111-1111-4111-a111-111111111111',
  'in_progress',
  'public',
  ARRAY['demo', 'testing', 'workflow', 'react']
) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 4. Board Columns for the demo idea
-- ============================================================================

INSERT INTO public.board_columns (id, idea_id, title, position, is_done_column) VALUES
  ('cc111111-1111-4111-8111-000000000001', 'b1111111-1111-4111-b111-111111111111', 'Backlog',                      0,    false),
  ('cc111111-1111-4111-8111-000000000002', 'b1111111-1111-4111-b111-111111111111', 'To Do',                     1000,    false),
  ('cc111111-1111-4111-8111-000000000003', 'b1111111-1111-4111-b111-111111111111', 'Blocked/Requires User Input', 2000,  false),
  ('cc111111-1111-4111-8111-000000000004', 'b1111111-1111-4111-b111-111111111111', 'In Progress',               3000,    false),
  ('cc111111-1111-4111-8111-000000000005', 'b1111111-1111-4111-b111-111111111111', 'Verify',                    4000,    false),
  ('cc111111-1111-4111-8111-000000000006', 'b1111111-1111-4111-b111-111111111111', 'Done',                      5000,    true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 5. Allocate agents to the idea pool
-- ============================================================================

INSERT INTO public.idea_agents (idea_id, bot_id, added_by) VALUES
  ('b1111111-1111-4111-b111-111111111111', 'a3333333-3333-4333-a333-333333333301', 'a1111111-1111-4111-a111-111111111111'),
  ('b1111111-1111-4111-b111-111111111111', 'a3333333-3333-4333-a333-333333333302', 'a1111111-1111-4111-a111-111111111111'),
  ('b1111111-1111-4111-b111-111111111111', 'a3333333-3333-4333-a333-333333333303', 'a1111111-1111-4111-a111-111111111111'),
  ('b1111111-1111-4111-b111-111111111111', 'a3333333-3333-4333-a333-333333333304', 'a1111111-1111-4111-a111-111111111111')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 6. Discussion: ready to convert (tests the full orchestration flow)
-- ============================================================================

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status, target_column_id
) VALUES (
  'c1111111-1111-4111-8111-111111111111',
  'b1111111-1111-4111-b111-111111111111',
  'a1111111-1111-4111-a111-111111111111',
  'Add a reset button to the counter',
  E'The counter app currently only has increment and decrement buttons. We should add a reset button that sets the count back to zero.\n\n### Requirements\n- New "Reset" button between the - and + buttons\n- Only enabled when count is not zero\n- Styled consistently with existing buttons but visually distinct (maybe a different colour)\n- Should be keyboard accessible',
  'ready_to_convert',
  'cc111111-1111-4111-8111-000000000002'  -- target: "To Do" column
) ON CONFLICT (id) DO NOTHING;

-- Reply: UX Designer weighs in
INSERT INTO public.idea_discussion_replies (
  id, discussion_id, author_id, content
) VALUES (
  'd1111111-1111-4111-9111-111111111111',
  'c1111111-1111-4111-8111-111111111111',
  'a3333333-3333-4333-a333-333333333302',
  E'Good idea. I suggest making the reset button slightly smaller and using a muted colour (e.g. zinc/gray) so it doesn''t compete with the primary +/- actions. We could also add a subtle fade-in animation when count !== 0 to draw attention to it becoming available.'
) ON CONFLICT (id) DO NOTHING;

-- Reply: Frontend Engineer confirms approach
INSERT INTO public.idea_discussion_replies (
  id, discussion_id, author_id, content
) VALUES (
  'd1111111-1111-4111-9111-222222222222',
  'c1111111-1111-4111-8111-111111111111',
  'a3333333-3333-4333-a333-333333333303',
  E'Straightforward to implement. I''ll add a `disabled` prop when count === 0 and use CSS opacity for the visual feedback. The existing `.counter` flex layout already has room for a third button.'
) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 7. A second discussion (open, for conversation testing)
-- ============================================================================

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status
) VALUES (
  'c2222222-2222-4222-8222-222222222222',
  'b1111111-1111-4111-b111-111111111111',
  'a1111111-1111-4111-a111-111111111111',
  'Should we add a step counter / history?',
  E'Once the reset button is done, it might be nice to track the history of changes. For example:\n- Show the number of increments/decrements performed\n- Or keep a small log of the last N actions\n\nThis would be a good follow-up feature to test more complex workflow steps. Let''s discuss the scope here first.',
  'open'
) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 8. VibeCodes Production Idea (seeded from remote)
-- ============================================================================

INSERT INTO public.ideas (
  id, title, description, author_id, status, visibility, tags, github_url
) VALUES (
  'b2222222-2222-4222-b222-222222222222',
  'VibeCodes',
  E'Build a full-stack web application called "VibeCodes" - a collaborative idea board for vibe coding projects. Use Next.js 15 (App Router), TypeScript, Tailwind CSS, and Supabase for the backend.\n\n## Core Features:\n\n**Ideas Board**\n- Anyone can submit a new idea with a title, description, and tags\n- Ideas display as cards on a main feed, sortable by newest, most popular, and most discussed\n- Each idea has an upvote/downvote system\n- Ideas have statuses\n\n**Comments & Suggestions**\n- Threaded comments on each idea\n- Comments can be tagged as: "general", "suggestion", "technical", "resource"\n- Users can suggest improvements or refinements\n\n**Collaboration**\n- Users can click "I want to build this" to express interest\n- Each idea has a collaborators list\n- Simple chat/discussion thread per idea\n\n**Auth & Profiles**\n- Supabase Auth with GitHub and Google OAuth\n- User profiles showing: ideas submitted, ideas collaborating on, comments made\n\n**UI/UX:**\n- Clean, modern design with dark mode default\n- Responsive - works on mobile and desktop\n- shadcn/ui components\n- Landing page, main feed, idea detail pages',
  'a1111111-1111-4111-a111-111111111111',
  'in_progress',
  'public',
  ARRAY['ai', 'mobile', 'web', 'cli'],
  'https://github.com/nicholasmball/vibe-coding-ideas'
) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 9. Board Columns for VibeCodes idea
-- ============================================================================

INSERT INTO public.board_columns (id, idea_id, title, position, is_done_column) VALUES
  ('cc222222-2222-4222-8222-000000000001', 'b2222222-2222-4222-b222-222222222222', 'Backlog', 0, false),
  ('cc222222-2222-4222-8222-000000000002', 'b2222222-2222-4222-b222-222222222222', 'To Do', 1000, false),
  ('cc222222-2222-4222-8222-000000000003', 'b2222222-2222-4222-b222-222222222222', 'Blocked/Requires User Input', 2000, false),
  ('cc222222-2222-4222-8222-000000000004', 'b2222222-2222-4222-b222-222222222222', 'In Progress', 3000, false),
  ('cc222222-2222-4222-8222-000000000005', 'b2222222-2222-4222-b222-222222222222', 'Verify', 4000, false),
  ('cc222222-2222-4222-8222-000000000006', 'b2222222-2222-4222-b222-222222222222', 'Done', 5000, true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 10. Board Tasks for VibeCodes idea (307 tasks)
-- ============================================================================

INSERT INTO public.board_tasks (idea_id, title, column_id, position, archived) VALUES
  ('b2222222-2222-4222-b222-222222222222', E'Bug: When others sign in, it''s not creating the user records correctly', 'cc222222-2222-4222-8222-000000000001', -3000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Shareable bot templates — community library for bot configurations', 'cc222222-2222-4222-8222-000000000001', 3250, true),
  ('b2222222-2222-4222-b222-222222222222', E'Workflow preferences per user and per board', 'cc222222-2222-4222-8222-000000000001', 3750, true),
  ('b2222222-2222-4222-b222-222222222222', E'post_session_summary MCP tool — structured bot work reports', 'cc222222-2222-4222-8222-000000000001', 4000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Add breadcrumbs to idea detail and board pages', 'cc222222-2222-4222-8222-000000000001', 31000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Add icons to status badges for color-blind accessibility', 'cc222222-2222-4222-8222-000000000001', 33000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Widen task detail dialog + split layout on large screens', 'cc222222-2222-4222-8222-000000000001', 36000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Activity feed day grouping (Today, Yesterday, This Week)', 'cc222222-2222-4222-8222-000000000001', 39500, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Verify focus management after TaskDetailDialog close', 'cc222222-2222-4222-8222-000000000001', 49000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Label accessibility — show names alongside color swatches', 'cc222222-2222-4222-8222-000000000001', 50000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Discussions MCP tools — list, get, create, reply', 'cc222222-2222-4222-8222-000000000001', 62000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Convert Discussion to Task — full UX flow + MCP tool', 'cc222222-2222-4222-8222-000000000001', 63000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Visual assets & press kit: demo video, screenshots, OG image, press PDF', 'cc222222-2222-4222-8222-000000000001', 65000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Product polish for launch: demo board, landing page, MCP docs, changelog, SEO', 'cc222222-2222-4222-8222-000000000001', 67000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Create demo/showcase board with realistic content', 'cc222222-2222-4222-8222-000000000001', 75000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Polish landing page: hero screenshot, features, CTA', 'cc222222-2222-4222-8222-000000000001', 76000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Commercialisation strategy — pitch deck and acquisition positioning', 'cc222222-2222-4222-8222-000000000001', 79000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Bot session log — structured record of what a bot did on a task', 'cc222222-2222-4222-8222-000000000002', -1000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Confidence gates — bot pauses for human approval at checkpoints', 'cc222222-2222-4222-8222-000000000002', 4000, true),
  ('b2222222-2222-4222-b222-222222222222', E'THere''s a UX issue with the progress panel, not being centred when enhancing an idea with AI', 'cc222222-2222-4222-8222-000000000002', 6000, true),
  ('b2222222-2222-4222-b222-222222222222', E'TEst test', 'cc222222-2222-4222-8222-000000000002', 9000, true),
  ('b2222222-2222-4222-b222-222222222222', E'This is a new task', 'cc222222-2222-4222-8222-000000000002', 10000, true),
  ('b2222222-2222-4222-b222-222222222222', E'e2e strategy', 'cc222222-2222-4222-8222-000000000002', 11000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Turn this on after launch', 'cc222222-2222-4222-8222-000000000002', 27000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Seed demo/showcase board with realistic content', 'cc222222-2222-4222-8222-000000000002', 32000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add staging callback URL to GitHub and Google OAuth apps', 'cc222222-2222-4222-8222-000000000002', 37000, true),
  ('b2222222-2222-4222-b222-222222222222', E'[E2E] Tests failed on develop (nicholasmball)', 'cc222222-2222-4222-8222-000000000002', 38000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Welcome Panel + Onboarding Checklist for new users', 'cc222222-2222-4222-8222-000000000003', 11063, true),
  ('b2222222-2222-4222-b222-222222222222', E'Public idea pages + share buttons (viral loop)', 'cc222222-2222-4222-8222-000000000003', 12063, true),
  ('b2222222-2222-4222-b222-222222222222', E'Loading polish — progress bar, shimmer, skeletons, 404', 'cc222222-2222-4222-8222-000000000003', 13063, true),
  ('b2222222-2222-4222-b222-222222222222', E'Idea templates for new idea creation', 'cc222222-2222-4222-8222-000000000003', 14063, true),
  ('b2222222-2222-4222-b222-222222222222', E'OG meta tags — dynamic social preview images for ideas', 'cc222222-2222-4222-8222-000000000003', 15063, true),
  ('b2222222-2222-4222-b222-222222222222', E'Follow/Watch ideas without collaborating', 'cc222222-2222-4222-8222-000000000003', 16063, true),
  ('b2222222-2222-4222-b222-222222222222', E'Weekly email digest for re-engagement', 'cc222222-2222-4222-8222-000000000003', 17063, true),
  ('b2222222-2222-4222-b222-222222222222', E'Trending ideas section on dashboard', 'cc222222-2222-4222-8222-000000000003', 18063, true),
  ('b2222222-2222-4222-b222-222222222222', E'Vote micro-animation (bounce + number transition)', 'cc222222-2222-4222-8222-000000000003', 19063, true),
  ('b2222222-2222-4222-b222-222222222222', E'Seed content — example ideas with boards', 'cc222222-2222-4222-8222-000000000003', 20063, true),
  ('b2222222-2222-4222-b222-222222222222', E'Launch content: blog post, Show HN, X thread, Reddit posts, Dev.to article', 'cc222222-2222-4222-8222-000000000004', 1000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Set up @getvibecodes Twitter/X account for launch', 'cc222222-2222-4222-8222-000000000004', 3000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Growth strategy — get VibeCodes known and widely used', 'cc222222-2222-4222-8222-000000000004', 6000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Investigate E2E test suite speed & CI trigger strategy', 'cc222222-2222-4222-8222-000000000004', 37688, false),
  ('b2222222-2222-4222-b222-222222222222', E'[E2E] Tests failed on develop (nicholasmball)', 'cc222222-2222-4222-8222-000000000004', 39000, false),
  ('b2222222-2222-4222-b222-222222222222', E'[E2E] Tests failed on master (nicholasmball)', 'cc222222-2222-4222-8222-000000000004', 40000, false),
  ('b2222222-2222-4222-b222-222222222222', E'[E2E] Tests failed on develop (nicholasmball)', 'cc222222-2222-4222-8222-000000000004', 41000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Distribution & outreach — accounts, newsletters, Anthropic, Product Hunt, launch network', 'cc222222-2222-4222-8222-000000000004', 73000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Test', 'cc222222-2222-4222-8222-000000000005', 3000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Full MVP UX review — audit every page and flow for gaps', 'cc222222-2222-4222-8222-000000000005', 8000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Improve onboarding: eliminate empty state after signup', 'cc222222-2222-4222-8222-000000000005', 9000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Write MCP connection documentation', 'cc222222-2222-4222-8222-000000000005', 10000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Ensure the mouse pointer is changed for all clickable items', 'cc222222-2222-4222-8222-000000000006', -15000, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.board_tasks (idea_id, title, column_id, position, archived) VALUES
  ('b2222222-2222-4222-b222-222222222222', E'Make dashboard collaboration cards clickable.', 'cc222222-2222-4222-8222-000000000006', -14875, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add AI enhance button when writing tickets', 'cc222222-2222-4222-8222-000000000006', -14750, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add tasks statistics within the user profile page', 'cc222222-2222-4222-8222-000000000006', -14500, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bot name change doesn''t update in assignee dropdown', 'cc222222-2222-4222-8222-000000000006', -14000, true),
  ('b2222222-2222-4222-b222-222222222222', E'THis shouldn''t be limited', 'cc222222-2222-4222-8222-000000000006', -13937, true),
  ('b2222222-2222-4222-b222-222222222222', E'Test BYOK Anthropic API key feature end-to-end', 'cc222222-2222-4222-8222-000000000006', -13906, true),
  ('b2222222-2222-4222-b222-222222222222', E'User Directory — searchable members page with profiles', 'cc222222-2222-4222-8222-000000000006', -13875, true),
  ('b2222222-2222-4222-b222-222222222222', E'Rebrand emails to match website design', 'cc222222-2222-4222-8222-000000000006', -13750, true),
  ('b2222222-2222-4222-b222-222222222222', E'Test VibeCodes from initial idea -> live software', 'cc222222-2222-4222-8222-000000000006', -13500, true),
  ('b2222222-2222-4222-b222-222222222222', E'Archive all Done tasks', 'cc222222-2222-4222-8222-000000000006', -13000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Task description truncated in UI — long markdown content cut off', 'cc222222-2222-4222-8222-000000000006', -12999, true),
  ('b2222222-2222-4222-b222-222222222222', E'MCP: Add idea management tools (create, delete, update status/tags)', 'cc222222-2222-4222-8222-000000000006', -12998, true),
  ('b2222222-2222-4222-b222-222222222222', E'Ask Claude for improvements', 'cc222222-2222-4222-8222-000000000006', -12997, true),
  ('b2222222-2222-4222-b222-222222222222', E'MCP: Add voting tool (toggle vote on ideas)', 'cc222222-2222-4222-8222-000000000006', -12996, true),
  ('b2222222-2222-4222-b222-222222222222', E'MCP: Add column management tools (create, edit, delete, reorder)', 'cc222222-2222-4222-8222-000000000006', -12992, true),
  ('b2222222-2222-4222-b222-222222222222', E'MCP: Add collaborator management tools (add/remove)', 'cc222222-2222-4222-8222-000000000006', -12984, true),
  ('b2222222-2222-4222-b222-222222222222', E'Fix laggy/jerky drag-and-drop on kanban board', 'cc222222-2222-4222-8222-000000000006', -12976, true),
  ('b2222222-2222-4222-b222-222222222222', E'Multi-bot support: distinct bot personas for parallel Claude Code sessions', 'cc222222-2222-4222-8222-000000000006', -12968, true),
  ('b2222222-2222-4222-b222-222222222222', E'Personalised Icon', 'cc222222-2222-4222-8222-000000000006', -12937, true),
  ('b2222222-2222-4222-b222-222222222222', E'Come up with a presentation to demonstrate the power VibeCodes and Vibe Coding', 'cc222222-2222-4222-8222-000000000006', -12906, true),
  ('b2222222-2222-4222-b222-222222222222', E'Allow board template to be configurable per user', 'cc222222-2222-4222-8222-000000000006', -12875, true),
  ('b2222222-2222-4222-b222-222222222222', E'Allow the configuration of the default columns per person', 'cc222222-2222-4222-8222-000000000006', -12750, true),
  ('b2222222-2222-4222-b222-222222222222', E'MCP: Add notification tools (list, mark read)', 'cc222222-2222-4222-8222-000000000006', -12500, true),
  ('b2222222-2222-4222-b222-222222222222', E'The front page stats are wrong - are they not updated live?', 'cc222222-2222-4222-8222-000000000006', -12000, true),
  ('b2222222-2222-4222-b222-222222222222', E'MCP: Add profile management tool (update profile)', 'cc222222-2222-4222-8222-000000000006', -11500, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: When moving mouse over certain links, the mouse icon doesn''t change suggesting that I can click it.', 'cc222222-2222-4222-8222-000000000006', -11000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Active boards', 'cc222222-2222-4222-8222-000000000006', -10000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Why does the view Idea screen have all this space at the bottom - you can scroll down until you have a completely blank screen', 'cc222222-2222-4222-8222-000000000006', -9500, true),
  ('b2222222-2222-4222-b222-222222222222', E'Sort out the UI - it looks a bit cramped at the top (see attached image)', 'cc222222-2222-4222-8222-000000000006', -9000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Reorder Dashboard Task list?', 'cc222222-2222-4222-8222-000000000006', -8750, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add unit tests for everything and update Claude.md to indicate this.', 'cc222222-2222-4222-8222-000000000006', -8500, true),
  ('b2222222-2222-4222-b222-222222222222', E'Abiltity to edit profile name and picture', 'cc222222-2222-4222-8222-000000000006', -8000, true),
  ('b2222222-2222-4222-b222-222222222222', E'When choosing to downlaod an attached file on a task it names it strangely', 'cc222222-2222-4222-8222-000000000006', -7500, true),
  ('b2222222-2222-4222-b222-222222222222', E'Is there a good way to be able to get this app working with Claude', 'cc222222-2222-4222-8222-000000000006', -7250, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add tests to everything and update CLAUDE.md', 'cc222222-2222-4222-8222-000000000006', -7000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Code review test', 'cc222222-2222-4222-8222-000000000006', -6000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Check on who can edit my code in GitHub - hoe to set up PRs etc?', 'cc222222-2222-4222-8222-000000000006', -5500, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug in task updateddddd', 'cc222222-2222-4222-8222-000000000006', -5000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Ability to filter feed to only your ideas or ideas that you''re working on, or both', 'cc222222-2222-4222-8222-000000000006', -4500, true),
  ('b2222222-2222-4222-b222-222222222222', E'When you click the submit button on new ideas - you can click it multiple times and it adds loads of entries', 'cc222222-2222-4222-8222-000000000006', -4000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Landing page UX: medium and polish fixes', 'cc222222-2222-4222-8222-000000000006', -3500, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Task board doesn''t really work on mobile', 'cc222222-2222-4222-8222-000000000006', -3000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Do we want to allow private projects/invite only?', 'cc222222-2222-4222-8222-000000000006', -2000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Do we want to be able to tag people in comments on tasks?', 'cc222222-2222-4222-8222-000000000006', -1000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Ability for admin to delete ideas', 'cc222222-2222-4222-8222-000000000006', 0, true),
  ('b2222222-2222-4222-b222-222222222222', E'When creating a new issue allow pasting of images onto the New Task screen', 'cc222222-2222-4222-8222-000000000006', 0, true),
  ('b2222222-2222-4222-b222-222222222222', E'Enable MCP for vercel', 'cc222222-2222-4222-8222-000000000006', 500, true),
  ('b2222222-2222-4222-b222-222222222222', E'Log creation of task in activity on task', 'cc222222-2222-4222-8222-000000000006', 625, true),
  ('b2222222-2222-4222-b222-222222222222', E'There''s a big lag when assigning a task to somebody when updating an existing issue', 'cc222222-2222-4222-8222-000000000006', 750, true),
  ('b2222222-2222-4222-b222-222222222222', E'Trello implementation or let them use their own board', 'cc222222-2222-4222-8222-000000000006', 875, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.board_tasks (idea_id, title, column_id, position, archived) VALUES
  ('b2222222-2222-4222-b222-222222222222', E'Enhance the initial AI idea generator', 'cc222222-2222-4222-8222-000000000006', 1000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Ability to delete ideas (if you added them)', 'cc222222-2222-4222-8222-000000000006', 1000, true),
  ('b2222222-2222-4222-b222-222222222222', E'AI board generation: add progress messages during long generation wait', 'cc222222-2222-4222-8222-000000000006', 1000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Fix this bug', 'cc222222-2222-4222-8222-000000000006', 3000, true),
  ('b2222222-2222-4222-b222-222222222222', E'DM functionality to be able talk to other devs', 'cc222222-2222-4222-8222-000000000006', 4000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Allow people to sign in other than google or github', 'cc222222-2222-4222-8222-000000000006', 5000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Enable MCP for supabase', 'cc222222-2222-4222-8222-000000000006', 6000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Collaborators field', 'cc222222-2222-4222-8222-000000000006', 7000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add a comment count to the comment tab', 'cc222222-2222-4222-8222-000000000006', 9000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add a comment count to the task similar to the way you do it on Ideas', 'cc222222-2222-4222-8222-000000000006', 10000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Create an MCP interface for VibeCodes', 'cc222222-2222-4222-8222-000000000006', 12000, true),
  ('b2222222-2222-4222-b222-222222222222', E'FIle upload doesn''t immediately show up as being loaded - so you try again and you end up loading the same file a few times', 'cc222222-2222-4222-8222-000000000006', 13000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Notifications are not visible on mobile', 'cc222222-2222-4222-8222-000000000006', 14000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Sometimes when I move a few tasks at a time from one column to the next, one or two fail to move and move back into the original column', 'cc222222-2222-4222-8222-000000000006', 15000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Issue with clicking attachments/comments icons', 'cc222222-2222-4222-8222-000000000006', 16000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Label picker popover has no close button', 'cc222222-2222-4222-8222-000000000006', 17000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Ability to remove people from projects if you don''t want to work with them', 'cc222222-2222-4222-8222-000000000006', 18000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Able to email tasks with screenshots, files to VibeCodes', 'cc222222-2222-4222-8222-000000000006', 18500, true),
  ('b2222222-2222-4222-b222-222222222222', E'View Archived tasks', 'cc222222-2222-4222-8222-000000000006', 19000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Render markdown in task detail description (click to edit)', 'cc222222-2222-4222-8222-000000000006', 22000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Attachment delete icon hidden/not visible with multiple attachments', 'cc222222-2222-4222-8222-000000000006', 23000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Enhance MCP', 'cc222222-2222-4222-8222-000000000006', 24000, true),
  ('b2222222-2222-4222-b222-222222222222', E'README refresh + public guide pages + MCP discoverability', 'cc222222-2222-4222-8222-000000000006', 25000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Create labels bug', 'cc222222-2222-4222-8222-000000000006', 26000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Task click', 'cc222222-2222-4222-8222-000000000006', 27000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Need to be able to apply a label easily from the task list without having to go into the Task Detail screen', 'cc222222-2222-4222-8222-000000000006', 28000, true),
  ('b2222222-2222-4222-b222-222222222222', E'New feature: when entering a new task allow labels to be assigned straight away (e.g. bug, feature etc)', 'cc222222-2222-4222-8222-000000000006', 29000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Welcome page needs updating', 'cc222222-2222-4222-8222-000000000006', 30000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Landing page UX: critical and high priority fixes', 'cc222222-2222-4222-8222-000000000006', 31000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Show image when clicking on it', 'cc222222-2222-4222-8222-000000000006', 32000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Mobile app - get it on Google app store', 'cc222222-2222-4222-8222-000000000006', 33000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add bot role templates for Product Owner, Automated Tester, DevOps, and Support', 'cc222222-2222-4222-8222-000000000006', 34000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bot edit form: buttons inaccessible when description is long', 'cc222222-2222-4222-8222-000000000006', 36000, true),
  ('b2222222-2222-4222-b222-222222222222', E'MCP get_board response too large — strip descriptions and add exclude_done', 'cc222222-2222-4222-8222-000000000006', 37000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Structured prompt builder for bot personas', 'cc222222-2222-4222-8222-000000000006', 38000, true),
  ('b2222222-2222-4222-b222-222222222222', E'VibeCode MCP authentication times out from time to time', 'cc222222-2222-4222-8222-000000000006', 39000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Remote MCP: set_bot_identity doesn''t persist for subsequent tool calls', 'cc222222-2222-4222-8222-000000000006', 40000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bot identity persistence across context compaction and new sessions', 'cc222222-2222-4222-8222-000000000006', 41000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Multi-bot Phase 3: Bot activity dashboard — real-time visibility', 'cc222222-2222-4222-8222-000000000006', 42000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Dashboard UX: collapsible/configurable panels to reduce scroll fatigue', 'cc222222-2222-4222-8222-000000000006', 43000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bot user UUID fails MCP SDK strict UUID validation (can''t assign default bot via MCP)', 'cc222222-2222-4222-8222-000000000006', 44000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Dashboard panel reordering — arrow-button customization', 'cc222222-2222-4222-8222-000000000006', 45000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Dashboard "My Bots" list should be ordered by latest activity', 'cc222222-2222-4222-8222-000000000006', 46000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bot activity detail view — click a bot to see what it''s done', 'cc222222-2222-4222-8222-000000000006', 47000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Realtime updates are happening on the board but not on task detail', 'cc222222-2222-4222-8222-000000000006', 48000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bot session visibility — render activity details, merge comments, session grouping', 'cc222222-2222-4222-8222-000000000006', 49000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bot identities blocked by RLS when posting idea comments', 'cc222222-2222-4222-8222-000000000006', 50000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bot identity uses wrong userId in multiple MCP tools', 'cc222222-2222-4222-8222-000000000006', 51000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Connect Domain vibecodes.co.uk', 'cc222222-2222-4222-8222-000000000006', 52000, true),
  ('b2222222-2222-4222-b222-222222222222', E'set up smtp', 'cc222222-2222-4222-8222-000000000006', 53000, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.board_tasks (idea_id, title, column_id, position, archived) VALUES
  ('b2222222-2222-4222-b222-222222222222', E'Remote MCP: board_tasks INSERT blocked by RLS after re-authentication', 'cc222222-2222-4222-8222-000000000006', 54000, true),
  ('b2222222-2222-4222-b222-222222222222', E'New task dialog: bots missing from assignee dropdown', 'cc222222-2222-4222-8222-000000000006', 55000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Task detail dialog: horizontal scrollbar overflow on long text/code blocks', 'cc222222-2222-4222-8222-000000000006', 56000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Install popup is annoyint', 'cc222222-2222-4222-8222-000000000006', 57000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Fix inconsistent styling on idea detail page header section', 'cc222222-2222-4222-8222-000000000006', 57005, true),
  ('b2222222-2222-4222-b222-222222222222', E'Drag and drop bug', 'cc222222-2222-4222-8222-000000000006', 58000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Adding attachments through MCP is painfully slow - can this be improved', 'cc222222-2222-4222-8222-000000000006', 59000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Idea Agent Pool — shared agent allocation per idea', 'cc222222-2222-4222-8222-000000000006', 59002, true),
  ('b2222222-2222-4222-b222-222222222222', E'Reintroduce platform AI with lifetime starter credits (10 free)', 'cc222222-2222-4222-8222-000000000006', 59003, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Onboarding shows "avatar imported" message for email signups', 'cc222222-2222-4222-8222-000000000006', 59005, true),
  ('b2222222-2222-4222-b222-222222222222', E'AI-Powered Idea Enhancement & Board Generation', 'cc222222-2222-4222-8222-000000000006', 60000, true),
  ('b2222222-2222-4222-b222-222222222222', E'AI Board Generation — UX & reliability improvements', 'cc222222-2222-4222-8222-000000000006', 61000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Board rendering delay after AI task generation', 'cc222222-2222-4222-8222-000000000006', 62000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Task detail mutations: add optimistic UI to eliminate "Rendering..." delays', 'cc222222-2222-4222-8222-000000000006', 63000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Remove duplicate Dashboard link from profile dropdown', 'cc222222-2222-4222-8222-000000000006', 64000, true),
  ('b2222222-2222-4222-b222-222222222222', E'How can i see archived tasks?', 'cc222222-2222-4222-8222-000000000006', 65000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bot activity dialog — UX polish pass', 'cc222222-2222-4222-8222-000000000006', 66000, true),
  ('b2222222-2222-4222-b222-222222222222', E'BYOK — users provide their own AI API key', 'cc222222-2222-4222-8222-000000000006', 67000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Saved AI prompt templates (per-user or per-idea)', 'cc222222-2222-4222-8222-000000000006', 68000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX Review of menu options and screens', 'cc222222-2222-4222-8222-000000000006', 71000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Update Guide with all the latest changes', 'cc222222-2222-4222-8222-000000000006', 72000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Indicate on user profiles whether they''re admin or not', 'cc222222-2222-4222-8222-000000000006', 73000, true),
  ('b2222222-2222-4222-b222-222222222222', E'If there are two many labels it fills up the screen', 'cc222222-2222-4222-8222-000000000006', 74000, true),
  ('b2222222-2222-4222-b222-222222222222', E'If I delete an idea, I want it to also delete the board and any tasks on that board', 'cc222222-2222-4222-8222-000000000006', 75000, true),
  ('b2222222-2222-4222-b222-222222222222', E'If I add a new task to the board, there''s a slight lag from clicking create to it appearing on the board - is this to do with it having to render server side?', 'cc222222-2222-4222-8222-000000000006', 76000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Generating board takes forever (might have stopped working)', 'cc222222-2222-4222-8222-000000000006', 77000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Progress steps loading UX for AI Generate Board dialog', 'cc222222-2222-4222-8222-000000000006', 78000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Progress steps loading UX for AI Enhance Idea dialog', 'cc222222-2222-4222-8222-000000000006', 79000, true),
  ('b2222222-2222-4222-b222-222222222222', E'AI usage analytics and cost dashboard', 'cc222222-2222-4222-8222-000000000006', 80000, true),
  ('b2222222-2222-4222-b222-222222222222', E'AI rate limiting UI and per-user daily caps', 'cc222222-2222-4222-8222-000000000006', 81000, true),
  ('b2222222-2222-4222-b222-222222222222', E'The UX is inconsistent on the Ideas and Boards page', 'cc222222-2222-4222-8222-000000000006', 82000, true),
  ('b2222222-2222-4222-b222-222222222222', E'There''s a lag when performing certian actions on the board', 'cc222222-2222-4222-8222-000000000006', 83000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Admin AI toggle doesn''t persist — user not enabled after leaving and returning', 'cc222222-2222-4222-8222-000000000006', 84000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Support tagging people in the description of tickets', 'cc222222-2222-4222-8222-000000000006', 85000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Being able to see Dashboard, even though it appears you''re not signed in', 'cc222222-2222-4222-8222-000000000006', 86000, true),
  ('b2222222-2222-4222-b222-222222222222', E'columns show archived tasks in count', 'cc222222-2222-4222-8222-000000000006', 87000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Update online guide to cover recent features', 'cc222222-2222-4222-8222-000000000006', 88000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Add active state to navbar links', 'cc222222-2222-4222-8222-000000000006', 89000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Add aria-label to mobile menu button', 'cc222222-2222-4222-8222-000000000006', 90000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Add loading.tsx skeleton files for main pages', 'cc222222-2222-4222-8222-000000000006', 91000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Fix feed filter bar mobile overflow', 'cc222222-2222-4222-8222-000000000006', 92000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Mark notifications as read on click', 'cc222222-2222-4222-8222-000000000006', 93000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Lower landing page stats threshold from 50 to 10', 'cc222222-2222-4222-8222-000000000006', 94000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Fix notification message — change "wants to build" to "joined as collaborator on"', 'cc222222-2222-4222-8222-000000000006', 95000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Close mobile menu on route change', 'cc222222-2222-4222-8222-000000000006', 96000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Perf: Cache navbar admin check in context instead of per-navigation query', 'cc222222-2222-4222-8222-000000000006', 97000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Perf: Merge dashboard Phase 3 query into Phase 2', 'cc222222-2222-4222-8222-000000000006', 98000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Collapse idea detail action buttons into "More" menu on mobile', 'cc222222-2222-4222-8222-000000000006', 99000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: First-time user onboarding welcome card on dashboard', 'cc222222-2222-4222-8222-000000000006', 100000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Debounce feed search (auto-search on keystroke)', 'cc222222-2222-4222-8222-000000000006', 101000, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.board_tasks (idea_id, title, column_id, position, archived) VALUES
  ('b2222222-2222-4222-b222-222222222222', E'e2e tests need to pass for a merge into master to take place', 'cc222222-2222-4222-8222-000000000006', 101009, true),
  ('b2222222-2222-4222-b222-222222222222', E'Admin-managed featured teams — DB tables, admin UI, frontend refactoring', 'cc222222-2222-4222-8222-000000000006', 101014, true),
  ('b2222222-2222-4222-b222-222222222222', E'[E2E] Tests failed on master (nicholasmball)', 'cc222222-2222-4222-8222-000000000006', 101018, true),
  ('b2222222-2222-4222-b222-222222222222', E'Review onboarding', 'cc222222-2222-4222-8222-000000000006', 101509, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Add empty state placeholder to board columns', 'cc222222-2222-4222-8222-000000000006', 102000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Mobile board toolbar — collapse filters into drawer', 'cc222222-2222-4222-8222-000000000006', 103000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Edit label doesn''t flow through to issues immediately', 'cc222222-2222-4222-8222-000000000006', 103259, true),
  ('b2222222-2222-4222-b222-222222222222', E'Test the new Agents!', 'cc222222-2222-4222-8222-000000000006', 103518, true),
  ('b2222222-2222-4222-b222-222222222222', E'Github Oauth - Prefill user profile username and github when signing up', 'cc222222-2222-4222-8222-000000000006', 104000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Delay PWA install prompt (require session duration or visit count)', 'cc222222-2222-4222-8222-000000000006', 105000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Perf: Batch board cover image signed URL creation', 'cc222222-2222-4222-8222-000000000006', 106000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Promote guide post-signup (link in onboarding flow)', 'cc222222-2222-4222-8222-000000000006', 107000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Dashboard sections should link to feed with pre-applied filters', 'cc222222-2222-4222-8222-000000000006', 108000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: GitHub connect nudge on idea form', 'cc222222-2222-4222-8222-000000000006', 109000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Group profile settings buttons into dropdown on mobile', 'cc222222-2222-4222-8222-000000000006', 110000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Board horizontal scroll indicator on mobile', 'cc222222-2222-4222-8222-000000000006', 111000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Improve SEO metadata, title strategy, and dynamic OG tags', 'cc222222-2222-4222-8222-000000000006', 111125, true),
  ('b2222222-2222-4222-b222-222222222222', E'Local repo config folder (.vibecodes/) for project context linking', 'cc222222-2222-4222-8222-000000000006', 111250, true),
  ('b2222222-2222-4222-b222-222222222222', E'Local Docker Compose setup for fully local development', 'cc222222-2222-4222-8222-000000000006', 111500, true),
  ('b2222222-2222-4222-b222-222222222222', E'UI changes are slow to propergate', 'cc222222-2222-4222-8222-000000000006', 112000, true),
  ('b2222222-2222-4222-b222-222222222222', E'UX: Undo toast for destructive actions (idea delete, collaborator remove)', 'cc222222-2222-4222-8222-000000000006', 113000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: useTransition isPending gets stuck, permanently disabling interactive controls', 'cc222222-2222-4222-8222-000000000006', 114000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Escape key doesn''t revert title in inline-idea-header', 'cc222222-2222-4222-8222-000000000006', 115000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Rebrand bots -> agents + promote to top-level nav', 'cc222222-2222-4222-8222-000000000006', 116000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Get playwrite tests done and test whole site', 'cc222222-2222-4222-8222-000000000006', 117000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Sign-out redirects to /login instead of / landing page', 'cc222222-2222-4222-8222-000000000006', 118000, true),
  ('b2222222-2222-4222-b222-222222222222', E'New user onboarding — empty states and first-run guidance', 'cc222222-2222-4222-8222-000000000006', 120000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add user feedback mechanism', 'cc222222-2222-4222-8222-000000000006', 121000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Task deep linking — URL updates + share button', 'cc222222-2222-4222-8222-000000000006', 122000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add Terms of Service page', 'cc222222-2222-4222-8222-000000000006', 123000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add Privacy Policy page', 'cc222222-2222-4222-8222-000000000006', 124000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Public board access control — read-only view for non-team members', 'cc222222-2222-4222-8222-000000000006', 125000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: clicking on notificaiton issue', 'cc222222-2222-4222-8222-000000000006', 126000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Second notification click on board doesn''t open task', 'cc222222-2222-4222-8222-000000000006', 127000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add error monitoring (Sentry)', 'cc222222-2222-4222-8222-000000000006', 129000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add basic analytics (Vercel Analytics)', 'cc222222-2222-4222-8222-000000000006', 130000, true),
  ('b2222222-2222-4222-b222-222222222222', E'BA and UX review of Launch-Critical Features & Engagement', 'cc222222-2222-4222-8222-000000000006', 131000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Comment form useTransition isPending stuck when posting with non-default type', 'cc222222-2222-4222-8222-000000000006', 132000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add email notifications for re-engagement (comments, votes, collaborators)', 'cc222222-2222-4222-8222-000000000006', 133000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Fix PR #5 security issues: collaboration requests', 'cc222222-2222-4222-8222-000000000006', 134000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Simplify navbar — remove clutter, stronger CTA, consolidate dropdowns', 'cc222222-2222-4222-8222-000000000006', 135000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Fix E2E tests broken by navbar simplification (PR #6)', 'cc222222-2222-4222-8222-000000000006', 136000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add SEO metadata and Open Graph tags to landing page', 'cc222222-2222-4222-8222-000000000006', 139000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Ensure that page headers are aligned correctly', 'cc222222-2222-4222-8222-000000000006', 139500, true),
  ('b2222222-2222-4222-b222-222222222222', E'Set up Gmail Workspace', 'cc222222-2222-4222-8222-000000000006', 140000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Deep-link all task-related notifications to the board (not just task_mention)', 'cc222222-2222-4222-8222-000000000006', 141000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Notification click on board updates URL but doesn''t open task', 'cc222222-2222-4222-8222-000000000006', 142000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: /ideas and /ideas/[id] accessible without authentication', 'cc222222-2222-4222-8222-000000000006', 143000, true),
  ('b2222222-2222-4222-b222-222222222222', E'AI access rework — BYOK bypasses admin gate, buttons always visible', 'cc222222-2222-4222-8222-000000000006', 144000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Fix: Enhance with AI 504 timeout — switch to streaming', 'cc222222-2222-4222-8222-000000000006', 145000, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.board_tasks (idea_id, title, column_id, position, archived) VALUES
  ('b2222222-2222-4222-b222-222222222222', E'Fix: Switch AI board task generation to streaming to prevent Vercel 504 timeouts', 'cc222222-2222-4222-8222-000000000006', 146000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Dashboard "My Agents" panel — incorrect status, styling issues', 'cc222222-2222-4222-8222-000000000006', 147000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Fix the drag/drop functionality for tasks across the board within browser on mobile', 'cc222222-2222-4222-8222-000000000006', 148000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Mobile: "Enhance with AI" disabled tooltip not accessible on touch devices', 'cc222222-2222-4222-8222-000000000006', 149000, true),
  ('b2222222-2222-4222-b222-222222222222', E'CRITICAL: Privilege escalation — users can set is_admin via PostgREST', 'cc222222-2222-4222-8222-000000000006', 150000, true),
  ('b2222222-2222-4222-b222-222222222222', E'HIGH: Private idea data leakage via comments, votes, collaborators', 'cc222222-2222-4222-8222-000000000006', 151000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Full MVP security review — audit auth, RLS, inputs, and APIs', 'cc222222-2222-4222-8222-000000000006', 152000, true),
  ('b2222222-2222-4222-b222-222222222222', E'e2e test coverage', 'cc222222-2222-4222-8222-000000000006', 153000, true),
  ('b2222222-2222-4222-b222-222222222222', E'e2e strategy', 'cc222222-2222-4222-8222-000000000006', 154000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add Cloudflare Turnstile CAPTCHA to prevent spam signups', 'cc222222-2222-4222-8222-000000000006', 155000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Enable Vercel Analytics + Speed Insights in dashboard', 'cc222222-2222-4222-8222-000000000006', 156000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Configure Sentry project + add env vars to Vercel', 'cc222222-2222-4222-8222-000000000006', 157000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Task AI gap', 'cc222222-2222-4222-8222-000000000006', 158000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Support mark down in idea board task creation.', 'cc222222-2222-4222-8222-000000000006', 159000, true),
  ('b2222222-2222-4222-b222-222222222222', E'SPIKE: investigate the server side requests', 'cc222222-2222-4222-8222-000000000006', 160000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Dashboard panel drag-and-drop reordering (upgrade from arrow buttons)', 'cc222222-2222-4222-8222-000000000006', 161000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Notification bell: User / Agent tabs', 'cc222222-2222-4222-8222-000000000006', 161032, true),
  ('b2222222-2222-4222-b222-222222222222', E'[E2E] Tests failed on master (nicholasmball)', 'cc222222-2222-4222-8222-000000000006', 161034, true),
  ('b2222222-2222-4222-b222-222222222222', E'Update guides for agents', 'cc222222-2222-4222-8222-000000000006', 161036, true),
  ('b2222222-2222-4222-b222-222222222222', E'Apply develop to master', 'cc222222-2222-4222-8222-000000000006', 161038, true),
  ('b2222222-2222-4222-b222-222222222222', E'Auto-scaffold .vibecodes/ folder via MCP prompt injection', 'cc222222-2222-4222-8222-000000000006', 161040, true),
  ('b2222222-2222-4222-b222-222222222222', E'Agents Hub — profiles, team templates, and community marketplace', 'cc222222-2222-4222-8222-000000000006', 161048, true),
  ('b2222222-2222-4222-b222-222222222222', E'Move vibes repo to an organisation repo', 'cc222222-2222-4222-8222-000000000006', 161063, true),
  ('b2222222-2222-4222-b222-222222222222', E'Don''t create a github issue when an e2e test fails', 'cc222222-2222-4222-8222-000000000006', 161125, true),
  ('b2222222-2222-4222-b222-222222222222', E'DnD bug', 'cc222222-2222-4222-8222-000000000006', 161250, true),
  ('b2222222-2222-4222-b222-222222222222', E'Agents page rows overflow horizontally on mobile', 'cc222222-2222-4222-8222-000000000006', 161375, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add DNS A record for staging.vibecodes.co.uk', 'cc222222-2222-4222-8222-000000000006', 161500, true),
  ('b2222222-2222-4222-b222-222222222222', E'Tag v1.0.0 and establish release process', 'cc222222-2222-4222-8222-000000000006', 161657, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add product screenshots/demo visuals to landing page', 'cc222222-2222-4222-8222-000000000006', 161813, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add staging Supabase service role key to Vercel', 'cc222222-2222-4222-8222-000000000006', 162032, true),
  ('b2222222-2222-4222-b222-222222222222', E'Assign staging.vibecodes.co.uk to develop branch in Vercel', 'cc222222-2222-4222-8222-000000000006', 162250, true),
  ('b2222222-2222-4222-b222-222222222222', E'Guided onboarding flow for new signups', 'cc222222-2222-4222-8222-000000000006', 162500, true),
  ('b2222222-2222-4222-b222-222222222222', E'Comment editing and deletion — own comments + admin agent comments', 'cc222222-2222-4222-8222-000000000006', 163000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Landing page polish — clear value prop, CTA, and demo visuals', 'cc222222-2222-4222-8222-000000000006', 164000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Idea Discussions — planning threads per idea', 'cc222222-2222-4222-8222-000000000006', 166000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Bots appear on Members page (is_bot flag silently reset)', 'cc222222-2222-4222-8222-000000000006', 167000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Idea attachments — downloadable file cards (Option A)', 'cc222222-2222-4222-8222-000000000006', 168000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Add product analytics (PostHog or Plausible)', 'cc222222-2222-4222-8222-000000000006', 169000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Change default board columns for new users', 'cc222222-2222-4222-8222-000000000006', 170000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Performance audit and Lighthouse optimization', 'cc222222-2222-4222-8222-000000000006', 171000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Open source repo cleanup (README, LICENSE, CONTRIBUTING)', 'cc222222-2222-4222-8222-000000000006', 172000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Ideas page: instant search filtering (match board behavior)', 'cc222222-2222-4222-8222-000000000006', 173000, true),
  ('b2222222-2222-4222-b222-222222222222', E'MVP release and next phase', 'cc222222-2222-4222-8222-000000000006', 174000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Fix mobile DnD — enable @dnd-kit native autoScroll for cross-column dragging', 'cc222222-2222-4222-8222-000000000006', 175000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: "Create Discussion" throws Server Components render error', 'cc222222-2222-4222-8222-000000000006', 176000, true),
  ('b2222222-2222-4222-b222-222222222222', E'PR: Agents Hub', 'cc222222-2222-4222-8222-000000000006', 177000, true),
  ('b2222222-2222-4222-b222-222222222222', E'PR: Idea Agent Pools', 'cc222222-2222-4222-8222-000000000006', 178000, true),
  ('b2222222-2222-4222-b222-222222222222', E'AI Generate Board: task list doesn''t auto-scroll during creation', 'cc222222-2222-4222-8222-000000000006', 179000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: MCP can assign non-collaborators to tasks; assignee missing from UI dropdown', 'cc222222-2222-4222-8222-000000000006', 181000, true),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Create Agent template Builder/Raw sync — fields lost on tab switch', 'cc222222-2222-4222-8222-000000000006', 182000, false)
ON CONFLICT DO NOTHING;

INSERT INTO public.board_tasks (idea_id, title, column_id, position, archived) VALUES
  ('b2222222-2222-4222-b222-222222222222', E'Add /changelog page with dated entries', 'cc222222-2222-4222-8222-000000000006', 183000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Open source prep: GitHub org, README, LICENSE, CONTRIBUTING, SECURITY, v1.0.0', 'cc222222-2222-4222-8222-000000000006', 184000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Security: full RLS policy audit across all 32 tables', 'cc222222-2222-4222-8222-000000000006', 185000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Infrastructure & security for launch — capacity, monitoring, analytics, security review', 'cc222222-2222-4222-8222-000000000006', 186000, false),
  ('b2222222-2222-4222-b222-222222222222', E'SEO for public ideas: meta tags, OG images, indexing', 'cc222222-2222-4222-8222-000000000006', 187000, false),
  ('b2222222-2222-4222-b222-222222222222', E'AI Generate Board: agent dropdown has minimal effect on output', 'cc222222-2222-4222-8222-000000000006', 188000, false),
  ('b2222222-2222-4222-b222-222222222222', E'Bug: Individual agents on Browse tab don''t show their role badge', 'cc222222-2222-4222-8222-000000000006', 189000, false)
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 11. Discussions for VibeCodes idea (13 discussions)
-- ============================================================================

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status
) VALUES (
  'dd222222-2222-4222-9222-000000000001',
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  E'Investigate using Claude Code subscriptions instead of API keys for in-app AI',
  E'## Context\nCurrently the app uses the Claude API (via Vercel AI SDK + `@ai-sdk/anthropic`) for AI features like idea enhancement, board task generation, and clarifying questions. Users either use platform credits or bring their own API key (BYOK).\n\nThe BYOK flow works but requires users to generate and paste an API key from console.anthropic.com -- a significant friction point for non-technical users.\n\n## Idea\n**Could users leverage their existing Claude Code (Max/Pro) subscription** instead of needing a separate API key? This would massively lower the barrier to entry for AI features.\n\n## Areas to Research\n- Does Anthropic offer any mechanism for third-party apps to authenticate against a user''s Claude subscription?\n- Could the MCP server architecture be leveraged?\n- Are there terms of service implications?\n- What would the UX flow look like?',
  'open'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status
) VALUES (
  'dd222222-2222-4222-9222-000000000002',
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  E'Sub-tasks -- hierarchical task breakdown replacing parent checklists',
  E'## Problem\nLarge feature tasks become unwieldy. The current checklist system is too flat -- checkboxes don''t have status, assignees, due dates, or their own context.\n\n## Proposed Solution\nIntroduce **sub-tasks** as a middle layer between tasks and checklists. Sub-tasks have title, description, status (To Do / In Progress / Done), assignee, due date, checklist, comments, and attachments.\n\n## Open Questions\n- Can sub-tasks have labels independent of parent?\n- Should sub-tasks appear in "My Tasks" on the dashboard?\n- Migration: convert existing checklists to sub-tasks, or keep both?',
  'open'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status
) VALUES (
  'dd222222-2222-4222-9222-000000000003',
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  E'Multi-provider AI support (OpenAI, Google, etc.)',
  E'Extend the AI feature architecture to support multiple LLM providers beyond Anthropic. Users or admins can choose which provider/model to use.\n\n## Scope\n- **Provider abstraction layer** -- swap between Anthropic, OpenAI, Google, etc.\n- **Model selector in AI dialogs**\n- **Per-provider API key management** -- ties into existing BYOK flow\n\n## Open Questions\n- Should this be admin-controlled or user-controlled?\n- How does this interact with starter credits?\n- Which providers are highest priority?',
  'open'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status
) VALUES (
  'dd222222-2222-4222-9222-000000000004',
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  E'Auto-dispatch -- trigger bot sessions when tasks are assigned',
  E'## Problem\nAssigning a bot to a task is just metadata. The user still has to manually open a terminal, launch Claude Code, and tell it to switch identity and work on the task.\n\n## What to build\nWhen a task is assigned (or delegated) to a bot:\n- Automatically trigger a Claude Code session for that bot\n- The session picks up the task, reads the playbook, and starts working\n\n## Options\n- **Webhook**: Supabase trigger fires when assignee changes\n- **UI-triggered**: "Start Bot" button on the task card\n- **Daemon**: Background process watches for bot assignments',
  'open'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status
) VALUES (
  'dd222222-2222-4222-9222-000000000005',
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  E'Investigate memory and context persistence system',
  E'## Overview\nResearch and design a system for persisting memory and context across Claude Code sessions, enabling bots/agents to retain learnings, preferences, and project-specific knowledge.\n\n## Research Areas\n1. **Session artifacts**: What should be persisted between sessions?\n2. **Storage mechanisms**: Local, remote, or hybrid\n3. **Memory types**: Short-term, long-term, shared\n4. **Integration points**: MCP prompt injection, auto-save hooks, memory search\n\n## Deliverable\nA design document with recommended approach and implementation plan.',
  'open'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status
) VALUES (
  'dd222222-2222-4222-9222-000000000006',
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  E'Investigate automated git usage',
  E'To enable safe async AI workers, version control and multiple environments. Explore ideas and ways we can combine for example git - branches, commits, commit messages with change logs and AI context summary/compression.\n\nThe goal of this should be to completely hide git and automate it into the task system. We need to think about how branch merging should happen, the UX of tasks and how we can automate this into the LLM dev process.',
  'open'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status
) VALUES (
  'dd222222-2222-4222-9222-000000000007',
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  E'Multi-vendor agent support -- assign tasks to different AI providers',
  E'## Problem\nBot profiles are currently locked to Claude Code. Users who want to leverage different AI providers for different tasks have no way to do that today.\n\n## What to Build\n- Add a `provider` field to bot profiles (Claude, GPT, Gemini, etc.)\n- Route assigned tasks to the appropriate AI tool\n- Enable side-by-side comparison by assigning the same task to multiple bots\n- Support provider-specific system prompt guidance',
  'open'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status
) VALUES (
  'dd222222-2222-4222-9222-000000000008',
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  E'Inter-bot communication -- bots can message each other via the board',
  E'## Problem\nBots work in isolation. QA bot finds a bug but can''t tell the Dev bot about it directly.\n\n## What to build\nThe kanban board becomes the communication layer:\n- QA bot finds a bug -> creates a bug task and assigns it to Dev bot\n- Dev bot picks it up from its queue\n- Bots can @mention each other in task comments\n- Notification system routes bot-to-bot mentions\n- A structured message queue (like Claude Code Agent Teams'' mailbox system)',
  'open'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status
) VALUES (
  'dd222222-2222-4222-9222-000000000009',
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  E'Multi-bot Phase 5: UI-triggered bot sessions',
  E'## Overview\nLaunch bot sessions directly from the VibeCodes UI instead of manually running CLI commands. A "Start Bot" button that either copies a ready-made command or triggers a cloud session.\n\n## What to build\n- "Start Session" button on bot cards (profile page + dashboard)\n- Click copies a ready-made command to clipboard\n- Show session status indicator (online/offline) if feasible\n- Task-level launch: "Start Bot on this task" button',
  'open'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status
) VALUES (
  'dd222222-2222-4222-9222-000000000010',
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  E'Multi-bot Phase 4: Branch merge/rebase tracking',
  E'## Overview\nTrack merge readiness, detect conflicts, and coordinate rebases when one bot''s branch merges into main while others are still working.\n\n## What to build\n- Branch status badge on task cards\n- "Merge and rebase" action\n- Conflict warning: advisory notice if two bots'' tasks touch the same files\n- Stale branch cleanup\n\n### MCP Tools\n- `merge_bot_branch(task_id)`\n- `rebase_bot_branch(task_id?)`\n- `check_conflicts(task_id)`',
  'open'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status
) VALUES (
  'dd222222-2222-4222-9222-000000000011',
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  E'Multi-bot Phase 2: Branch-per-bot coordination',
  E'## Overview\nWhen a bot picks up a task, it creates a dedicated git branch (`bot/<bot-name>/<task-slug>`). Each bot works in isolation on its own branch -- no conflicts during work.\n\n## What to build\n- `bot_branches` table: id, bot_id, task_id, idea_id, branch_name, status\n- MCP Tools: `create_bot_branch(task_id)`, `get_branch_status()`, `list_active_branches(idea_id)`\n\n## Workflow\n1. Bot picks up task -> calls `create_bot_branch` -> branch created from main\n2. Bot works on the branch, commits as normal\n3. When task moves to Verify, branch is marked ready for merge\n4. User reviews diff and merges manually',
  'open'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status
) VALUES (
  'dd222222-2222-4222-9222-000000000012',
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  E'Playbooks -- reusable instruction templates for bot task types',
  E'## Problem\nBot system prompts define the persona, but there''s no way to give task-type-specific instructions. A "Bug fix" should follow different steps than a "New feature" regardless of which bot is working on it.\n\n## What to build\nPlaybooks are reusable instruction templates that attach to task types:\n- **Bug fix playbook**: "Reproduce -> write failing test -> fix -> verify test passes"\n- **Feature playbook**: "Read requirements -> design approach -> implement -> write tests"\n- **Code review playbook**: "Check for security issues -> verify test coverage -> review naming"',
  'open'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status
) VALUES (
  'dd222222-2222-4222-9222-000000000013',
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  E'Delegate vs Assignee -- bots as contributors, humans as owners',
  E'## Problem\nBots and humans are treated identically in the assignee field. This blurs responsibility -- who is accountable for the outcome?\n\n## What to build\nAdopt Linear''s model:\n- Tasks have an **assignee** (human, accountable) and optionally a **delegate** (bot, does the work)\n- When a bot is delegated, the task card shows the human assignee with a small "via BotName" label\n- Existing assignee field becomes human-only; new delegate field for bots',
  'open'
) ON CONFLICT (id) DO NOTHING;

-- 14: Task Priority Levels — orchestration demo (ready to convert)
INSERT INTO public.idea_discussions (
  id, idea_id, author_id, title, body, status, target_column_id, autonomy_level
) VALUES (
  'dd222222-2222-4222-9222-000000000014',
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  E'Task Priority Levels -- add priority field to board tasks',
  E'## Problem\nAll tasks on the kanban board are treated equally. There''s no way to indicate that a critical bug fix is more urgent than a nice-to-have UI polish. Team members have to scan titles or read descriptions to gauge importance.\n\n## What to build\nAdd a **priority** field to board tasks with four levels: `low`, `medium`, `high`, `urgent`.\n\n### Database\n- Add `priority text DEFAULT ''medium'' CHECK (priority IN (''low'', ''medium'', ''high'', ''urgent''))` column to `board_tasks`\n- Migration file, update `src/types/database.ts` with the new column on Row/Insert/Update types\n\n### Server Actions\n- Update `createTask` and `updateTask` in `src/actions/board.ts` to accept and persist priority\n- Add validation in `src/lib/validation.ts`\n\n### MCP Tools\n- Update `create_task` and `update_task` tools to accept an optional `priority` parameter\n- Update `get_task` and `get_board` to return priority in the response\n\n### UI\n- **Task card**: Show a small coloured priority indicator (dot or icon) — urgent=red, high=orange, medium=yellow, low=grey\n- **Task detail dialog**: Add a priority dropdown selector (shadcn Select component)\n- **Board column**: Optionally sort tasks by priority within a column\n\n### E2E Tests\n- Test setting priority on task creation\n- Test changing priority from the task detail dialog\n- Verify the priority badge renders correctly\n\n## Scope\nThis is intentionally small — one new column, a few UI touches, and updated tools. It exercises every layer of the stack:\n- Supabase migration + RLS (existing policies cover it)\n- TypeScript types\n- Server actions + validation\n- React components (shadcn/ui)\n- MCP tools\n- E2E tests\n\n## Acceptance Criteria\n- [ ] New tasks default to `medium` priority\n- [ ] Priority is visible on task cards as a coloured indicator\n- [ ] Priority can be changed from the task detail dialog\n- [ ] MCP tools support priority on create/update/read\n- [ ] E2E test covers the happy path\n- [ ] No regressions on existing board functionality',
  'ready_to_convert',
  'cc222222-2222-4222-8222-000000000002',
  2
) ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- 12. Allocate agents to VibeCodes idea pool
-- ============================================================================

INSERT INTO public.idea_agents (idea_id, bot_id, added_by) VALUES
  ('b2222222-2222-4222-b222-222222222222', 'a3333333-3333-4333-a333-333333333301', 'a1111111-1111-4111-a111-111111111111'),
  ('b2222222-2222-4222-b222-222222222222', 'a3333333-3333-4333-a333-333333333302', 'a1111111-1111-4111-a111-111111111111'),
  ('b2222222-2222-4222-b222-222222222222', 'a3333333-3333-4333-a333-333333333305', 'a1111111-1111-4111-a111-111111111111'),
  ('b2222222-2222-4222-b222-222222222222', 'a3333333-3333-4333-a333-333333333306', 'a1111111-1111-4111-a111-111111111111'),
  ('b2222222-2222-4222-b222-222222222222', 'a3333333-3333-4333-a333-333333333307', 'a1111111-1111-4111-a111-111111111111'),
  ('b2222222-2222-4222-b222-222222222222', 'a3333333-3333-4333-a333-333333333308', 'a1111111-1111-4111-a111-111111111111'),
  ('b2222222-2222-4222-b222-222222222222', 'a3333333-3333-4333-a333-333333333309', 'a1111111-1111-4111-a111-111111111111'),
  ('b2222222-2222-4222-b222-222222222222', 'a3333333-3333-4333-a333-333333333310', 'a1111111-1111-4111-a111-111111111111'),
  ('b2222222-2222-4222-b222-222222222222', 'a3333333-3333-4333-a333-333333333311', 'a1111111-1111-4111-a111-111111111111'),
  ('b2222222-2222-4222-b222-222222222222', 'a3333333-3333-4333-a333-333333333312', 'a1111111-1111-4111-a111-111111111111'),
  ('b2222222-2222-4222-b222-222222222222', 'a3333333-3333-4333-a333-333333333313', 'a1111111-1111-4111-a111-111111111111'),
  ('b2222222-2222-4222-b222-222222222222', 'a3333333-3333-4333-a333-333333333314', 'a1111111-1111-4111-a111-111111111111')
ON CONFLICT DO NOTHING;

-- Orchestration agent (b0000000-0000-4000-a000-000000000016) may not exist locally
-- since its owner (VIBECODES_USER_ID) is production-only. Skipped.


-- ============================================================================
-- 13. Sample comment on VibeCodes idea
-- ============================================================================

INSERT INTO public.comments (
  idea_id, author_id, content, type
) VALUES (
  'b2222222-2222-4222-b222-222222222222',
  'a1111111-1111-4111-a111-111111111111',
  'Testing remote MCP access -- all read and write operations working correctly.',
  'comment'
);

