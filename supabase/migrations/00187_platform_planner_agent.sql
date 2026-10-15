-- Seed "Planner" as a platform agent (task 472d5672, Nick's change 2).
--
-- The Planner takes a card to an approved plan: requirements, a design mock if
-- users will see a change, and the build plan, in one conversation. Until now
-- it existed only as one board's own agent. As a published platform agent any
-- board can copy it, and kits can copy it by role once a kit lists "Planner".
--
-- The text is the same as the "Planner" starting template in
-- src/lib/planner-agent.ts, in the new instructions layout (one line, then
-- "## Your job", "## What to hand back", "## What not to do"). A unit test
-- (planner-agent.test.ts) reads this file and fails if the two drift apart.
--
-- New row, so no prompt backup is needed. Full access, empty tags. Follows the
-- seeding pattern of 00173: auth.users, then public.users.is_bot, then
-- bot_profiles. Idempotent. Platform owner: a0000000-0000-4000-a000-000000000001.
-- The previous highest platform persona id is ...023.

BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token
) VALUES (
  'b0000000-0000-4000-a000-000000000024', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'bot-planner@vibecodes.local', '', now(),
  jsonb_build_object('full_name', 'Planner', 'avatar_url', ''),
  now(), now(), '', ''
)
ON CONFLICT (id) DO NOTHING;

SELECT set_config('app.trusted_bot_operation', 'true', true);

UPDATE public.users SET is_bot = true
WHERE id = 'b0000000-0000-4000-a000-000000000024';

SELECT set_config('app.trusted_bot_operation', '', true);

INSERT INTO bot_profiles (
  id, owner_id, name, role, system_prompt, avatar_url, is_active,
  bio, skills, is_published, tool_access
) VALUES (
  'b0000000-0000-4000-a000-000000000024',
  'a0000000-0000-4000-a000-000000000001',
  'Planner',
  'Planner',
  $planner$You plan changes, from card to approved plan, in one conversation.

## Your job
For the card you're given:
1. Read the card, its comments, and the code and live data it touches. Check facts; don't plan from assumptions.
2. Write the requirements: what changes and why, testable acceptance checks, and on its own line "User-facing change: YES" or "User-facing change: NO".
3. If YES, design it as an HTML mock in docs/ that matches the app's existing look and components, and attach the mock to the card so it's in front of whoever approves the plan.
4. Write the technical plan the build agent will follow: files to change and why, any data or interface changes (including database changes), the tests to write, and the risks. If the work is too big for one change, split it into stages that each ship on their own, and plan stage 1 in full.
5. Keep a working-notes file at docs/notes/<first 8 characters of the card's id>.md: what you decided, why, what you ruled out, and where things are. Later steps read it.

## What to hand back
A plain-English summary for whoever approves the plan first (what will change, and each decision they need to make, with your recommendation), then the mock's location if there is one, then the plan.

## What not to do
Don't write production code, change the database, or create or edit other cards. Your plan is approved before anything is built.$planner$,
  NULL,
  true,
  'Takes a card to an approved plan: requirements, a design mock if users will see a change, and the build plan, in one conversation.',
  ARRAY[]::text[],
  true,
  'full'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
