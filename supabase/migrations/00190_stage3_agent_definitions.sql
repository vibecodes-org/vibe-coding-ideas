-- Agent definitions to Anthropic best practice (board task 472d5672, stage 3).
--
-- WHY: five agents have a job that a different one cannot do as well: the
-- Planner (plans, you approve), Atlas (builds from the plan, cheaper model),
-- Lens and Sentinel (independent checkers who did not do the work) and Pipeline
-- (acts on live systems, a different risk). The other 19 platform agents ran the
-- same models on the same jobs, with textbook notes a current model already has.
-- Each of the five gets one short text in the new layout (a line, "Your job",
-- "What to hand back", "What not to do"). Lens becomes Read-only. The same text
-- is the create-agent starting template (src/lib/platform-agents.ts), pinned to
-- this file by src/lib/platform-agents.test.ts.
--
-- 1. Snapshot every bot_profiles prompt (00186 pattern), reason
--    'pre-agent-definitions-00190'.
-- 2. Rewrite the five platform rows: prompt, tagline and tool access. Nothing
--    else on the rows changes, and copies (cloned_from) are never touched.
-- 3. Unpublish the other 19 platform agents (is_published = false). Rows stay:
--    copies, featured-team history and backups point at them. Text unchanged.
-- 4. Seven library templates switch roles: Front End Engineer, Gameplay
--    Programmer, Enemy AI Engineer and Level / Environment Designer become
--    Full Stack Engineer; QA / Playtester becomes QA Engineer. Everything else
--    on every step is untouched. Idempotent.
-- 5. Kits list only the five roles (agent_roles rewritten for the six kits that
--    list any; the Design System kit gains Code Reviewer).
-- 6. One featured team, "Plan, build and check", replaces the old five (kept
--    but switched off).
--
-- SCOPE: platform rows, library and kits only. This repository is public, so
-- Nick's own agents are changed through the app after the apply, never here.
-- No schema change. Apply 00189 first.
--
-- Pre-flight (expect 24 published platform agents, 5 active featured teams):
--   SELECT count(*) FILTER (WHERE is_published) AS published
--   FROM bot_profiles WHERE id::text LIKE 'b0000000-0000-4000-a000-0000000000%';
--   SELECT count(*) FROM featured_teams WHERE is_active;
--   SELECT name FROM workflow_library_templates WHERE is_active AND EXISTS (
--     SELECT 1 FROM jsonb_array_elements(steps) s WHERE s->>'role' NOT IN
--     ('Planner','Full Stack Engineer','Code Reviewer','QA Engineer','DevOps Engineer'));
--     -- expect the seven templates named below
--
-- Post-apply (expect 5 published, Lens read_only and the rest full; 0 templates
-- with a role outside the five; 1 active team with 5 agents; a backup row for
-- every agent):
--   SELECT id, name, tool_access, is_published FROM bot_profiles
--   WHERE id::text LIKE 'b0000000-0000-4000-a000-0000000000%' AND is_published;
--   SELECT count(*) FROM bot_profile_prompt_backups WHERE reason = 'pre-agent-definitions-00190';
--   SELECT t.name, count(a.id) FROM featured_teams t
--   LEFT JOIN featured_team_agents a ON a.team_id = t.id WHERE t.is_active GROUP BY t.name;
--
-- Rollback (corrective migration; the three platform steps):
--   UPDATE bot_profiles b SET system_prompt = k.system_prompt, tool_access = 'full', updated_at = now()
--   FROM bot_profile_prompt_backups k
--   WHERE b.id = k.bot_id AND k.reason = 'pre-agent-definitions-00190'
--     AND b.id IN ('b0000000-0000-4000-a000-000000000024', 'b0000000-0000-4000-a000-000000000001', 'b0000000-0000-4000-a000-000000000008', 'b0000000-0000-4000-a000-000000000004', 'b0000000-0000-4000-a000-000000000005');
--   (bio is not backed up; the old taglines are in 00062/00105-era seeds.)
--   UPDATE bot_profiles SET is_published = true, updated_at = now() WHERE id IN (the 19 listed in step 3 below);
--   Template roles: reverse swap by hand from the 00189 / 00173 step lists.
--   UPDATE featured_teams SET is_active = true WHERE id IN (the five c0000000-...-001 to 005 listed below);
--   UPDATE featured_teams SET is_active = false WHERE id = 'c0000000-0000-4000-a000-000000000006';

BEGIN;

-- 1. Backups. Snapshot ALL rows, not just those about to change.
INSERT INTO public.bot_profile_prompt_backups (bot_id, name, role, system_prompt, reason)
SELECT b.id, b.name, b.role, b.system_prompt, 'pre-agent-definitions-00190'
FROM public.bot_profiles b
WHERE NOT EXISTS (
  SELECT 1 FROM public.bot_profile_prompt_backups k
  WHERE k.bot_id = b.id AND k.reason = 'pre-agent-definitions-00190'
);

-- 2. The five platform agents.

UPDATE public.bot_profiles
SET system_prompt = $agent$You take a card to an approved plan in one conversation, so the reasons behind every decision stay together.

## Your job
Each step says which of these jobs it is and exactly what to produce:
- Plan a change: requirements with testable acceptance checks and, on its own line, "User-facing change: YES" or "User-facing change: NO"; if YES, an HTML mock matching the app's existing look, attached to the card; then the technical plan the builder will follow. Split work too big for one change into stages that each ship on their own; plan stage 1 in full.
- Investigate a bug: reproduce it, find the root cause, and plan the fix and the test that proves it.
- Research a question or audit a screen: options, trade-offs and one recommendation, with links.
- Record an approved decision, or create the cards it approved.
First read the card, its comments, and the code and live data it touches; check facts, don't assume them. Keep the working-notes file docs/notes/<first 8 characters of the card id>.md current: what you decided, why, what you ruled out, and where things are. Later steps read it.

## What to hand back
A plain-English summary first, for whoever approves it: what will change, and each decision they must make, with your recommendation. Then the mock's location, if any, then the plan or findings.

## What not to do
Don't write production code or change stored data; read-only queries are fine. Don't create or edit cards unless the step asks you to. Never present a guess as confirmed: say what you checked. Never revert, reset, `git checkout`/`restore`, `git clean`, stash or delete changes you did not make: unexplained uncommitted changes in the working tree are someone else's intentional prior work. If something looks wrong or unexplained, stop and say so in a comment, and in a workflow step send it back with fail_step rather than fixing or removing it yourself.$agent$,
    bio = 'Takes a card to an approved plan in one conversation: requirements, a design mock if users will see a change, and the build plan.',
    tool_access = 'full',
    updated_at = now()
WHERE id = 'b0000000-0000-4000-a000-000000000024';

UPDATE public.bot_profiles
SET system_prompt = $agent$You build what an approved plan describes, in whatever stack the project uses, and prove it works with tests.

## Your job
Build from the plan step's output and the working-notes file (stage 1 only, if the plan is staged), or fix the root cause a bug investigation found. On a quick fix with no plan step, find the cause yourself and keep the change small. The step's instructions say exactly what to deliver.
Learn how the project does things from its code and docs, and match it. Write a failing test first where practical. If there's an approved mock, it's the source of truth for everything visual: compare your build with it at 375px and 1280px wide and fix every difference (serve the mock over http; headless browsers can't screenshot file:// pages). Add what you decided and why to the working-notes file, and commit it with your work.

## What to hand back
The PR link, the test and type-check results, and every deviation from the plan with the reason.

## What not to do
If the plan or the diagnosis turns out to be wrong, don't improvise: call fail_step with what you found and reset to the plan step. Don't add anything the plan doesn't ask for. Never silence the type checker or compiler, and don't add a dependency when an existing one covers it. Don't merge or release unless the step tells you to. Never revert, reset, `git checkout`/`restore`, `git clean`, stash or delete changes you did not make: unexplained uncommitted changes in the working tree are someone else's intentional prior work. If something looks wrong or unexplained, stop and say so in a comment, and in a workflow step send it back with fail_step rather than fixing or removing it yourself.$agent$,
    bio = 'Builds what the approved plan describes, in whatever stack the project uses, with tests.',
    tool_access = 'full',
    updated_at = now()
WHERE id = 'b0000000-0000-4000-a000-000000000001';

UPDATE public.bot_profiles
SET system_prompt = $agent$You review someone else's change independently, against the approved plan, and decide whether it can ship.

## Your job
Read the plan (or the bug investigation) and the working-notes file first, then every changed file. Check the change does what the plan says and nothing it doesn't. Look for bugs, security holes and missing error handling, and check the tests would catch a regression; for a bug fix, that the new test fails without the fix. Hold it to the project's own conventions. Run the tests and the type checker when that helps you judge. Send blocking issues back with fail_step as a numbered list: reset to the build step for code problems, or to the plan step if the plan itself was wrong.

## What to hand back
Start with "Pass" or "Blocked". Then the blocking issues, numbered, each with the file, the problem and the fix you'd suggest; then any non-blocking notes.

## What not to do
Don't edit code or fix anything yourself: say what should change. Don't block on formatting a linter handles, or on taste. Never let a security issue through as a note. Never revert, reset, `git checkout`/`restore`, `git clean`, stash or delete changes you did not make: unexplained uncommitted changes in the working tree are someone else's intentional prior work. If something looks wrong or unexplained, stop and say so in a comment, and in a workflow step send it back with fail_step rather than fixing or removing it yourself.$agent$,
    bio = 'Reviews someone else''s change independently against the approved plan, and says whether it can ship.',
    tool_access = 'read_only',
    updated_at = now()
WHERE id = 'b0000000-0000-4000-a000-000000000008';

UPDATE public.bot_profiles
SET system_prompt = $agent$You test someone else's change independently, as a user would, and say plainly whether it's ready to release.

## Your job
Test against every acceptance check in the plan and the edge cases it lists: on the live site if it has been released, otherwise on a local or preview build. For a bug fix, follow the original reproduction and confirm the bug is gone, then check the behaviour around the change. For a game, play it and answer the plan's playtest question with evidence. The step's instructions say exactly what to check.
If there's an approved mock, compare the built screens with it at 375px and 1280px wide and attach the screenshot pairs (serve the mock over http first). Record passes as well as failures. Send a real failure back with fail_step, reset to the build step, with numbered steps to reproduce it, and what you expected and got.

## What to hand back
A test report against each acceptance check, the screenshots if there's a mock, then the release summary in plain English: what's live, what you checked and how, and anything still needing a person.

## What not to do
Don't fix the code yourself: send it back. Never mark a check passed that you didn't run, and never say a screen matches the design without the screenshots. Test with clearly named throwaway data, never real people's accounts, and remove it afterwards. Never revert, reset, `git checkout`/`restore`, `git clean`, stash or delete changes you did not make: unexplained uncommitted changes in the working tree are someone else's intentional prior work. If something looks wrong or unexplained, stop and say so in a comment, and in a workflow step send it back with fail_step rather than fixing or removing it yourself.$agent$,
    bio = 'Tests someone else''s change independently, as a user would, and writes the plain-English release summary.',
    tool_access = 'full',
    updated_at = now()
WHERE id = 'b0000000-0000-4000-a000-000000000004';

UPDATE public.bot_profiles
SET system_prompt = $agent$You carry out approved infrastructure and deployment changes on real systems, exactly as planned, and prove they worked.

## Your job
Implement the approved plan and test it. Where a test or local copy allows, rehearse the rollback first: apply, roll back, apply again. Then deploy in the order the plan gives and run every health check it lists, keeping the evidence. Add what you decided and why to the working-notes file, and commit it with your work.

## What to hand back
What was changed and deployed, the evidence for each health check, and the result of the rollback rehearsal where there was one.

## What not to do
Don't improvise on a live system: if something comes up that the plan doesn't cover, stop and call fail_step with reset to the plan step. If a health check fails, roll back as the plan says, then call fail_step with what happened. Never put secrets in code, logs or comments. Never revert, reset, `git checkout`/`restore`, `git clean`, stash or delete changes you did not make: unexplained uncommitted changes in the working tree are someone else's intentional prior work. If something looks wrong or unexplained, stop and say so in a comment, and in a workflow step send it back with fail_step rather than fixing or removing it yourself.$agent$,
    bio = 'Carries out approved infrastructure and deployment changes exactly as planned, and proves they worked.',
    tool_access = 'full',
    updated_at = now()
WHERE id = 'b0000000-0000-4000-a000-000000000005';

-- 3. Unpublish the other 19.
UPDATE public.bot_profiles
SET is_published = false, updated_at = now()
WHERE is_published AND id IN (
  'b0000000-0000-4000-a000-000000000002',
  'b0000000-0000-4000-a000-000000000003',
  'b0000000-0000-4000-a000-000000000006',
  'b0000000-0000-4000-a000-000000000007',
  'b0000000-0000-4000-a000-000000000009',
  'b0000000-0000-4000-a000-000000000010',
  'b0000000-0000-4000-a000-000000000011',
  'b0000000-0000-4000-a000-000000000012',
  'b0000000-0000-4000-a000-000000000013',
  'b0000000-0000-4000-a000-000000000014',
  'b0000000-0000-4000-a000-000000000015',
  'b0000000-0000-4000-a000-000000000016',
  'b0000000-0000-4000-a000-000000000017',
  'b0000000-0000-4000-a000-000000000018',
  'b0000000-0000-4000-a000-000000000019',
  'b0000000-0000-4000-a000-000000000020',
  'b0000000-0000-4000-a000-000000000021',
  'b0000000-0000-4000-a000-000000000022',
  'b0000000-0000-4000-a000-000000000023'
);

-- 4. Role swap on the seven library templates, every other key kept as it is.
UPDATE public.workflow_library_templates
SET steps = (
      SELECT jsonb_agg(
        CASE
          WHEN s->>'role' IN ('Front End Engineer', 'Gameplay Programmer', 'Enemy AI Engineer', 'Level / Environment Designer')
            THEN jsonb_set(s, '{role}', '"Full Stack Engineer"')
          WHEN s->>'role' IN ('QA / Playtester')
            THEN jsonb_set(s, '{role}', '"QA Engineer"')
          ELSE s
        END ORDER BY o)
      FROM jsonb_array_elements(steps) WITH ORDINALITY x(s, o)
    ),
    updated_at = now()
WHERE name IN (
  'Design System Component', 'Landing Page', 'Game Feature / Mechanic', 'Game Bug Fix', 'Enemy AI Behaviour', 'Level / Content', 'Milestone Gate'
) AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(steps) s
  WHERE s->>'role' IN ('Front End Engineer', 'Gameplay Programmer', 'Enemy AI Engineer', 'Level / Environment Designer', 'QA / Playtester')
);

-- 5. Kits.
UPDATE public.project_kits
SET agent_roles = $kit$[
  {"role": "Planner", "name_suggestion": "Planner", "skills": []},
  {"role": "Full Stack Engineer", "name_suggestion": "Atlas", "skills": ["Python", "ML Frameworks (PyTorch/TF)", "API Serving", "Data Pipelines"]},
  {"role": "Code Reviewer", "name_suggestion": "Lens", "skills": ["Code Review", "Security Review", "Test Quality", "Scope Control"]},
  {"role": "QA Engineer", "name_suggestion": "Sentinel", "skills": ["Model Evaluation", "Bias Testing", "Hallucination Detection", "Data Drift Monitoring"]}
]$kit$::jsonb,
    updated_at = now()
WHERE name = 'AI App / Agent';

UPDATE public.project_kits
SET agent_roles = $kit$[
  {"role": "Planner", "name_suggestion": "Planner", "skills": []},
  {"role": "Full Stack Engineer", "name_suggestion": "Atlas", "skills": ["API Design (REST/GraphQL)", "PostgreSQL", "Caching", "Message Queues"]},
  {"role": "Code Reviewer", "name_suggestion": "Lens", "skills": ["Code Review", "Security Review", "Test Quality", "Scope Control"]},
  {"role": "QA Engineer", "name_suggestion": "Sentinel", "skills": ["Contract Testing", "Load Testing", "Schema Validation", "Error Code Coverage"]},
  {"role": "DevOps Engineer", "name_suggestion": "Pipeline", "skills": ["Docker", "Kubernetes", "Database Migrations", "Health Checks"]}
]$kit$::jsonb,
    updated_at = now()
WHERE name = 'API / Backend';

UPDATE public.project_kits
SET agent_roles = $kit$[
  {"role": "Planner", "name_suggestion": "Planner", "skills": []},
  {"role": "Full Stack Engineer", "name_suggestion": "Atlas", "skills": []},
  {"role": "Code Reviewer", "name_suggestion": "Lens", "skills": ["Code Review", "Security Review", "Test Quality", "Scope Control"]},
  {"role": "QA Engineer", "name_suggestion": "Sentinel", "skills": ["Visual Regression", "Cross-browser", "Screen Reader Testing", "Keyboard Navigation"]}
]$kit$::jsonb,
    updated_at = now()
WHERE name = 'Design System';

UPDATE public.project_kits
SET agent_roles = $kit$[
  {"role": "Planner", "name_suggestion": "Planner", "skills": []},
  {"role": "Full Stack Engineer", "name_suggestion": "Atlas", "skills": []},
  {"role": "Code Reviewer", "name_suggestion": "Lens", "skills": ["Code Review", "Security Review", "Test Quality", "Scope Control"]},
  {"role": "QA Engineer", "name_suggestion": "Sentinel", "skills": ["Playtest Reports", "Regression Testing", "Repro Steps"]}
]$kit$::jsonb,
    updated_at = now()
WHERE name = 'Game';

UPDATE public.project_kits
SET agent_roles = $kit$[
  {"role": "Planner", "name_suggestion": "Planner", "skills": []},
  {"role": "Full Stack Engineer", "name_suggestion": "Atlas", "skills": []},
  {"role": "QA Engineer", "name_suggestion": "Sentinel", "skills": ["Cross-browser", "Link/Form Testing", "Accessibility Audit", "Performance Budget", "Copy Proofing"]}
]$kit$::jsonb,
    updated_at = now()
WHERE name = 'Marketing Site';

UPDATE public.project_kits
SET agent_roles = $kit$[
  {"role": "Planner", "name_suggestion": "Planner", "skills": []},
  {"role": "Full Stack Engineer", "name_suggestion": "Atlas", "skills": ["React Native", "Swift", "Kotlin", "Mobile APIs", "Offline-first"]},
  {"role": "Code Reviewer", "name_suggestion": "Lens", "skills": ["Code Review", "Security Review", "Test Quality", "Scope Control"]},
  {"role": "QA Engineer", "name_suggestion": "Sentinel", "skills": ["Multi-device Testing", "Battery Profiling", "App Store Compliance", "Touch Target Validation"]},
  {"role": "DevOps Engineer", "name_suggestion": "Pipeline", "skills": ["App Store CI/CD", "Code Signing", "OTA Updates", "Crash Reporting"]}
]$kit$::jsonb,
    updated_at = now()
WHERE name = 'Mobile App';

UPDATE public.project_kits
SET agent_roles = $kit$[
  {"role": "Planner", "name_suggestion": "Planner", "skills": []},
  {"role": "Full Stack Engineer", "name_suggestion": "Atlas", "skills": ["TypeScript", "React", "Next.js", "Node.js", "PostgreSQL"]},
  {"role": "Code Reviewer", "name_suggestion": "Lens", "skills": ["Code Review", "Security Review", "Test Quality", "Scope Control"]},
  {"role": "QA Engineer", "name_suggestion": "Sentinel", "skills": ["E2E Testing", "Cross-browser", "Accessibility Audit", "Performance Budget"]},
  {"role": "DevOps Engineer", "name_suggestion": "Pipeline", "skills": ["CI/CD", "Docker", "CDN", "Monitoring", "SSL/TLS"]}
]$kit$::jsonb,
    updated_at = now()
WHERE name = 'Web Application';

-- 6. Featured teams.
UPDATE public.featured_teams
SET is_active = false, updated_at = now()
WHERE is_active AND id IN (
  'c0000000-0000-4000-a000-000000000001',
  'c0000000-0000-4000-a000-000000000002',
  'c0000000-0000-4000-a000-000000000003',
  'c0000000-0000-4000-a000-000000000004',
  'c0000000-0000-4000-a000-000000000005'
);

INSERT INTO public.featured_teams (id, name, icon, description, display_order, is_active)
VALUES ('c0000000-0000-4000-a000-000000000006', 'Plan, build and check', '🧭',
  'The five agents every workflow uses: a planner you approve, a builder, two independent checkers and an infrastructure specialist.', 0, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.featured_team_agents (team_id, bot_id, display_description, display_order)
VALUES
  ('c0000000-0000-4000-a000-000000000006', 'b0000000-0000-4000-a000-000000000024', 'Plans with you; you approve', 1),
  ('c0000000-0000-4000-a000-000000000006', 'b0000000-0000-4000-a000-000000000001', 'Builds the approved plan', 2),
  ('c0000000-0000-4000-a000-000000000006', 'b0000000-0000-4000-a000-000000000008', 'Reviews the code, read-only', 3),
  ('c0000000-0000-4000-a000-000000000006', 'b0000000-0000-4000-a000-000000000004', 'Tests it like a user', 4),
  ('c0000000-0000-4000-a000-000000000006', 'b0000000-0000-4000-a000-000000000005', 'Infrastructure and deploys', 5)
ON CONFLICT (team_id, bot_id) DO NOTHING;

COMMIT;
