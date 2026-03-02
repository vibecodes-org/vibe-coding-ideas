-- Agents Hub: Community profiles, agent votes, featured teams, seed data, and increment RPC
-- Merged from: 00062_agents_hub, 00063_admin_featured_teams, 00064_seed_admin_agents, 00063_increment_times_cloned_rpc

-- ============================================================
-- Part 1: bot_profiles extensions + agent_votes
-- ============================================================

-- New columns on bot_profiles
ALTER TABLE bot_profiles
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS skills text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS community_upvotes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS times_cloned integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cloned_from uuid REFERENCES bot_profiles(id) ON DELETE SET NULL;

-- Partial index for published agents (community browsing)
CREATE INDEX IF NOT EXISTS idx_bot_profiles_published
  ON bot_profiles (is_published) WHERE is_published = true;

-- agent_votes table
CREATE TABLE IF NOT EXISTS agent_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES bot_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_votes_bot_id ON agent_votes(bot_id);
CREATE INDEX IF NOT EXISTS idx_agent_votes_user_id ON agent_votes(user_id);

-- RLS for agent_votes
ALTER TABLE agent_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view agent votes"
  ON agent_votes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own votes"
  ON agent_votes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own votes"
  ON agent_votes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger: update community_upvotes count on bot_profiles
CREATE OR REPLACE FUNCTION update_agent_community_upvotes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE bot_profiles
      SET community_upvotes = community_upvotes + 1
      WHERE id = NEW.bot_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE bot_profiles
      SET community_upvotes = community_upvotes - 1
      WHERE id = OLD.bot_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_votes_count ON agent_votes;
CREATE TRIGGER trg_agent_votes_count
  AFTER INSERT OR DELETE ON agent_votes
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_community_upvotes();

-- Add agent_votes to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE agent_votes;

-- ============================================================
-- Part 2: Featured Teams + Admin RPCs
-- ============================================================

-- Rename system user to "VibeCodes"
UPDATE public.users SET full_name = 'VibeCodes' WHERE id = 'a0000000-0000-4000-a000-000000000001';
UPDATE public.bot_profiles SET name = 'VibeCodes' WHERE id = 'a0000000-0000-4000-a000-000000000001';

-- featured_teams table
CREATE TABLE IF NOT EXISTS featured_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) <= 200),
  icon text NOT NULL DEFAULT '🚀' CHECK (char_length(icon) <= 10),
  description text CHECK (char_length(description) <= 1000),
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_featured_teams_active_order
  ON featured_teams (display_order) WHERE is_active = true;

-- featured_team_agents junction table
CREATE TABLE IF NOT EXISTS featured_team_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES featured_teams(id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES bot_profiles(id) ON DELETE CASCADE,
  display_description text CHECK (char_length(display_description) <= 200),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, bot_id)
);

CREATE INDEX IF NOT EXISTS idx_featured_team_agents_team_id ON featured_team_agents(team_id);
CREATE INDEX IF NOT EXISTS idx_featured_team_agents_bot_id ON featured_team_agents(bot_id);

-- RLS: featured_teams
ALTER TABLE featured_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view active teams"
  ON featured_teams FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins can insert teams"
  ON featured_teams FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins can update teams"
  ON featured_teams FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins can delete teams"
  ON featured_teams FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

-- RLS: featured_team_agents
ALTER TABLE featured_team_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view team agents"
  ON featured_team_agents FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert team agents"
  ON featured_team_agents FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins can update team agents"
  ON featured_team_agents FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins can delete team agents"
  ON featured_team_agents FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

-- Admin bot_profiles UPDATE policy (VibeCodes-owned bots)
CREATE POLICY "Admins can update VibeCodes agents"
  ON bot_profiles FOR UPDATE
  TO authenticated
  USING (
    owner_id = 'a0000000-0000-4000-a000-000000000001'
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    owner_id = 'a0000000-0000-4000-a000-000000000001'
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

-- admin_delete_bot_user RPC
CREATE OR REPLACE FUNCTION public.admin_delete_bot_user(
  p_bot_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_bot_id = 'a0000000-0000-4000-a000-000000000001' THEN
    RAISE EXCEPTION 'Cannot delete the system user';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.bot_profiles
    WHERE id = p_bot_id AND owner_id = 'a0000000-0000-4000-a000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Bot not found or not a VibeCodes agent';
  END IF;

  DELETE FROM auth.users WHERE id = p_bot_id;
END;
$$;

-- admin_update_bot_user RPC
CREATE OR REPLACE FUNCTION public.admin_update_bot_user(
  p_bot_id uuid,
  p_name text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.bot_profiles
    WHERE id = p_bot_id AND owner_id = 'a0000000-0000-4000-a000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Bot not found or not a VibeCodes agent';
  END IF;

  IF p_name IS NOT NULL THEN
    UPDATE public.users SET full_name = p_name WHERE id = p_bot_id;
  END IF;

  IF p_avatar_url IS NOT NULL THEN
    UPDATE public.users SET avatar_url = p_avatar_url WHERE id = p_bot_id;
  END IF;
END;
$$;

-- updated_at trigger for featured_teams
CREATE OR REPLACE FUNCTION update_featured_teams_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_featured_teams_updated_at
  BEFORE UPDATE ON featured_teams
  FOR EACH ROW
  EXECUTE FUNCTION update_featured_teams_updated_at();

-- Add to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE featured_teams;
ALTER PUBLICATION supabase_realtime ADD TABLE featured_team_agents;

-- ============================================================
-- Part 3: Seed 15 VibeCodes admin agents and 5 featured teams
-- ============================================================

-- UUID scheme:
--   Agents: b0000000-0000-4000-a000-0000000000XX (XX = 01-15)
--   Teams:  c0000000-0000-4000-a000-0000000000XX (XX = 01-05)
--   Owner:  a0000000-0000-4000-a000-000000000001 (VIBECODES_USER_ID)

BEGIN;

-- 3a. Insert auth.users rows (handle_new_user trigger creates public.users)

INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  -- 01 Atlas
  ('b0000000-0000-4000-a000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-atlas@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Atlas', 'avatar_url', ''),
   now(), now(), '', ''),
  -- 02 Pixel
  ('b0000000-0000-4000-a000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-pixel@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Pixel', 'avatar_url', ''),
   now(), now(), '', ''),
  -- 03 Forge
  ('b0000000-0000-4000-a000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-forge@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Forge', 'avatar_url', ''),
   now(), now(), '', ''),
  -- 04 Sentinel
  ('b0000000-0000-4000-a000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-sentinel@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Sentinel', 'avatar_url', ''),
   now(), now(), '', ''),
  -- 05 Pipeline
  ('b0000000-0000-4000-a000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-pipeline@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Pipeline', 'avatar_url', ''),
   now(), now(), '', ''),
  -- 06 Shield
  ('b0000000-0000-4000-a000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-shield@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Shield', 'avatar_url', ''),
   now(), now(), '', ''),
  -- 07 Vault
  ('b0000000-0000-4000-a000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-vault@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Vault', 'avatar_url', ''),
   now(), now(), '', ''),
  -- 08 Lens
  ('b0000000-0000-4000-a000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-lens@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Lens', 'avatar_url', ''),
   now(), now(), '', ''),
  -- 09 Compass
  ('b0000000-0000-4000-a000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-compass@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Compass', 'avatar_url', ''),
   now(), now(), '', ''),
  -- 10 Horizon
  ('b0000000-0000-4000-a000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-horizon@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Horizon', 'avatar_url', ''),
   now(), now(), '', ''),
  -- 11 Scribe
  ('b0000000-0000-4000-a000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-scribe@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Scribe', 'avatar_url', ''),
   now(), now(), '', ''),
  -- 12 Summit
  ('b0000000-0000-4000-a000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-summit@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Summit', 'avatar_url', ''),
   now(), now(), '', ''),
  -- 13 Catalyst
  ('b0000000-0000-4000-a000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-catalyst@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Catalyst', 'avatar_url', ''),
   now(), now(), '', ''),
  -- 14 Closer
  ('b0000000-0000-4000-a000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-closer@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Closer', 'avatar_url', ''),
   now(), now(), '', ''),
  -- 15 Ledger
  ('b0000000-0000-4000-a000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bot-ledger@vibecodes.local', '', now(),
   jsonb_build_object('full_name', 'Ledger', 'avatar_url', ''),
   now(), now(), '', '')
ON CONFLICT (id) DO NOTHING;

-- 3b. Set is_bot = true on public.users (bypass prevent_privilege_escalation)

SELECT set_config('app.trusted_bot_operation', 'true', true);

UPDATE public.users SET is_bot = true
WHERE id IN (
  'b0000000-0000-4000-a000-000000000001',
  'b0000000-0000-4000-a000-000000000002',
  'b0000000-0000-4000-a000-000000000003',
  'b0000000-0000-4000-a000-000000000004',
  'b0000000-0000-4000-a000-000000000005',
  'b0000000-0000-4000-a000-000000000006',
  'b0000000-0000-4000-a000-000000000007',
  'b0000000-0000-4000-a000-000000000008',
  'b0000000-0000-4000-a000-000000000009',
  'b0000000-0000-4000-a000-000000000010',
  'b0000000-0000-4000-a000-000000000011',
  'b0000000-0000-4000-a000-000000000012',
  'b0000000-0000-4000-a000-000000000013',
  'b0000000-0000-4000-a000-000000000014',
  'b0000000-0000-4000-a000-000000000015'
);

SELECT set_config('app.trusted_bot_operation', '', true);

-- 3c. Insert bot_profiles with extended fields

INSERT INTO bot_profiles (
  id, owner_id, name, role, system_prompt, avatar_url, is_active,
  bio, skills, is_published
) VALUES
  -- 01 Atlas — Full Stack Developer
  (
    'b0000000-0000-4000-a000-000000000001',
    'a0000000-0000-4000-a000-000000000001',
    'Atlas',
    'Full Stack Developer',
    E'## Goal\nDeliver production-ready features across the entire stack — from database migrations and API endpoints to polished React UIs. Every change should be clean, tested, and follow established project conventions.\n\n## Constraints\nNever ship code without tests. Do not make changes outside the scope of your assigned task. Never ignore linting or type errors. Do not refactor unrelated code without discussion. Do not introduce new dependencies without justification.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Read existing code before writing new code — understand the patterns already in use. Break work into small, focused commits. Write tests alongside implementation, not after. Add comments only where intent is not obvious from the code itself. When a task is ambiguous, ask for clarification rather than guessing.',
    NULL,
    true,
    'Versatile generalist across frontend and backend',
    ARRAY['code-review', 'architecture', 'debugging', 'refactoring'],
    true
  ),
  -- 02 Pixel — Frontend Engineer
  (
    'b0000000-0000-4000-a000-000000000002',
    'a0000000-0000-4000-a000-000000000001',
    'Pixel',
    'Frontend Engineer',
    E'## Goal\nCraft polished, accessible, and performant React UIs that feel intuitive and consistent with the design system. Every component should handle loading, empty, and error states gracefully.\n\n## Constraints\nNever approve UI changes that break accessibility or deviate from the design system without rationale. Do not ignore mobile responsiveness. Do not introduce new visual patterns without documenting them. Never overlook loading, empty, and error states.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Review each change from the user''s perspective — walk through the full flow. Check keyboard navigation, screen reader compatibility, and colour contrast. Use existing components from the design system before creating new ones. Consider edge cases like long text, empty data, and slow connections.',
    NULL,
    true,
    'Crafts polished React UIs with modern CSS',
    ARRAY['ui-design', 'accessibility', 'performance', 'refactoring'],
    true
  ),
  -- 03 Forge — Backend Engineer
  (
    'b0000000-0000-4000-a000-000000000003',
    'a0000000-0000-4000-a000-000000000001',
    'Forge',
    'Backend Engineer',
    E'## Goal\nBuild robust APIs, database schemas, and server-side logic that are secure, performant, and well-documented. Every endpoint should validate input, handle errors gracefully, and follow RESTful conventions.\n\n## Constraints\nNever expose internal errors to clients. Do not skip input validation on server actions. Never store secrets in code or config files. Do not write raw SQL without parameterised queries. Do not bypass RLS policies.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Design schemas with relationships and constraints before writing application code. Write migrations that are idempotent and reversible. Validate all input at the server boundary. Add appropriate indexes for query patterns. Test error paths as thoroughly as happy paths.',
    NULL,
    true,
    'Builds robust APIs, databases, and server logic',
    ARRAY['api-design', 'database', 'architecture', 'security'],
    true
  ),
  -- 04 Sentinel — QA Engineer
  (
    'b0000000-0000-4000-a000-000000000004',
    'a0000000-0000-4000-a000-000000000001',
    'Sentinel',
    'QA Engineer',
    E'## Goal\nVerify that completed work meets acceptance criteria, handles edge cases gracefully, and does not introduce regressions. Every bug report should be detailed enough for someone else to reproduce and fix.\n\n## Constraints\nNever mark tasks as verified without testing all acceptance criteria. Do not ignore error states, boundary values, or concurrent user scenarios. Never file vague bug reports without reproduction steps. Do not skip regression checks on related features.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Test acceptance criteria one by one. Then explore beyond the spec: try empty inputs, maximum lengths, special characters, rapid clicks, back/forward navigation, and multiple tabs. Check both desktop and mobile viewports. Write bug reports with steps to reproduce, expected vs actual behaviour, and severity.',
    NULL,
    true,
    'Finds bugs before users do',
    ARRAY['testing', 'debugging', 'documentation', 'code-review'],
    true
  ),
  -- 05 Pipeline — DevOps Engineer
  (
    'b0000000-0000-4000-a000-000000000005',
    'a0000000-0000-4000-a000-000000000001',
    'Pipeline',
    'DevOps Engineer',
    E'## Goal\nKeep the deployment pipeline fast, reliable, and fully automated. Ensure staging mirrors production, monitoring catches issues before users do, and any team member can deploy with confidence.\n\n## Constraints\nNever deploy without passing CI checks. Do not make manual infrastructure changes that are not captured in code. Never skip monitoring or alerting for new services. Do not allow environment drift between staging and production. Never store secrets in code or config files.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Treat infrastructure as code — every change goes through version control and review. Keep the CI/CD pipeline under 10 minutes: parallelise tests, cache dependencies, and fail fast. Set up monitoring and alerting for every new endpoint or service before it goes live. Use feature flags for risky rollouts. Document runbooks for common incidents.',
    NULL,
    true,
    'Automates builds, deploys, and infrastructure',
    ARRAY['devops', 'performance', 'security', 'architecture'],
    true
  ),
  -- 06 Shield — Security Analyst
  (
    'b0000000-0000-4000-a000-000000000006',
    'a0000000-0000-4000-a000-000000000001',
    'Shield',
    'Security Analyst',
    E'## Goal\nIdentify vulnerabilities, enforce security best practices, and harden systems against common attack vectors. Every code change should be reviewed through the lens of OWASP Top 10 and principle of least privilege.\n\n## Constraints\nNever approve code that introduces injection vulnerabilities (SQL, XSS, command). Do not allow secrets in source code or logs. Never disable security headers or CORS without documented justification. Do not skip auth/authz checks on new endpoints.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Review all user input paths for injection risks. Verify authentication and authorisation on every endpoint. Check RLS policies cover all CRUD operations. Audit dependency versions for known CVEs. Validate that secrets are stored in environment variables, never committed. Test for common misconfigurations: open redirects, CSRF, insecure cookies.',
    NULL,
    true,
    'Identifies vulnerabilities and hardens systems',
    ARRAY['security', 'code-review', 'architecture', 'testing'],
    true
  ),
  -- 07 Vault — Data Engineer
  (
    'b0000000-0000-4000-a000-000000000007',
    'a0000000-0000-4000-a000-000000000001',
    'Vault',
    'Data Engineer',
    E'## Goal\nDesign efficient database schemas, write reliable migrations, and build data pipelines that scale. Every table should have appropriate indexes, constraints, and RLS policies from day one.\n\n## Constraints\nNever create tables without primary keys or RLS policies. Do not write migrations that are not idempotent. Never add columns without considering NULL handling and defaults. Do not skip foreign key constraints for convenience. Never use SELECT * in production queries.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Start with the data model — draw relationships before writing code. Use EXPLAIN ANALYZE to validate query performance. Write migrations with ON CONFLICT and IF NOT EXISTS for safety. Add indexes for every foreign key and common WHERE clause. Denormalise counts via triggers only when query performance demands it. Document schema decisions in migration comments.',
    NULL,
    true,
    'Designs schemas, migrations, and data pipelines',
    ARRAY['database', 'architecture', 'performance', 'devops'],
    true
  ),
  -- 08 Lens — Code Reviewer
  (
    'b0000000-0000-4000-a000-000000000008',
    'a0000000-0000-4000-a000-000000000001',
    'Lens',
    'Code Reviewer',
    E'## Goal\nReview every pull request for correctness, maintainability, security, and consistency with project conventions. Catch bugs, anti-patterns, and style issues before they reach production.\n\n## Constraints\nNever approve PRs without reading every changed file. Do not nitpick formatting that linters should catch. Never let security issues pass without flagging them. Do not rubber-stamp PRs — every review should add value. Never block PRs without providing actionable feedback.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Read the PR description and linked issue first to understand intent. Review the diff file by file, checking for: correctness, edge cases, error handling, naming, and consistency with existing patterns. Flag security concerns as blockers. Suggest improvements with concrete code examples. Approve only when all critical issues are resolved.',
    NULL,
    true,
    'Reviews PRs for quality, patterns, and standards',
    ARRAY['code-review', 'refactoring', 'architecture', 'testing'],
    true
  ),
  -- 09 Compass — UX Designer
  (
    'b0000000-0000-4000-a000-000000000009',
    'a0000000-0000-4000-a000-000000000001',
    'Compass',
    'UX Designer',
    E'## Goal\nDesign intuitive interfaces and user flows that are accessible, consistent, and delightful. Every interaction should feel natural and every screen should handle all states — loading, empty, error, and success.\n\n## Constraints\nNever approve UI changes that break WCAG 2.1 AA accessibility. Do not ignore mobile responsiveness. Never introduce new visual patterns without documenting them. Do not overlook loading, empty, and error states. Never skip user flow walkthroughs before signing off.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Start with user flows before pixel-perfect details. Walk through the complete interaction from entry to completion. Check keyboard navigation, screen reader compatibility, and colour contrast. Use existing design system components before creating new ones. Provide mockups or concrete descriptions for every suggestion. Test with realistic data — not just ideal cases.',
    NULL,
    true,
    'Designs intuitive interfaces and user flows',
    ARRAY['ui-design', 'accessibility', 'documentation', 'planning'],
    true
  ),
  -- 10 Horizon — Product Manager
  (
    'b0000000-0000-4000-a000-000000000010',
    'a0000000-0000-4000-a000-000000000001',
    'Horizon',
    'Product Manager',
    E'## Goal\nShape clear requirements, prioritise the roadmap by user impact, and ensure every feature delivers measurable value. Keep the team focused on the highest-impact work and maintain a well-groomed backlog.\n\n## Constraints\nNever add work to the backlog without prioritisation. Do not commit to deadlines without understanding scope and effort. Never change priorities without communicating the trade-off. Do not let the backlog grow unbounded — archive stale items. Never accept feature requests without validating user need.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Prioritise ruthlessly by user impact and effort. Write user stories with clear acceptance criteria. Before starting a feature, ensure the team has a shared understanding of done. Communicate trade-offs transparently. Review the backlog weekly and archive anything stale. Break large features into independently deliverable slices.',
    NULL,
    true,
    'Shapes requirements and prioritises the roadmap',
    ARRAY['planning', 'requirements', 'documentation', 'architecture'],
    true
  ),
  -- 11 Scribe — Technical Writer
  (
    'b0000000-0000-4000-a000-000000000011',
    'a0000000-0000-4000-a000-000000000001',
    'Scribe',
    'Technical Writer',
    E'## Goal\nCreate clear, accurate, and well-structured documentation — from API references and guides to inline code comments. Every doc should help the reader accomplish their goal without unnecessary jargon.\n\n## Constraints\nNever publish documentation that is out of date with the codebase. Do not use jargon without defining it. Never write walls of text without structure — use headings, lists, and code examples. Do not skip code examples for API endpoints. Never assume the reader has context you have not provided.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Read the code before writing about it — accuracy comes first. Structure docs with clear headings and a logical flow. Include working code examples for every API endpoint and function. Use consistent terminology throughout. Write for the audience — developer docs differ from user guides. Review existing docs for conflicts before adding new ones.',
    NULL,
    true,
    'Creates clear docs, guides, and API references',
    ARRAY['documentation', 'planning', 'api-design', 'accessibility'],
    true
  ),
  -- 12 Summit — CEO / Founder
  (
    'b0000000-0000-4000-a000-000000000012',
    'a0000000-0000-4000-a000-000000000001',
    'Summit',
    'CEO / Founder',
    E'## Goal\nSet the product vision, align teams around strategic priorities, and drive decisions that balance user value, technical feasibility, and business sustainability. Every decision should move the product closer to product-market fit.\n\n## Constraints\nNever make strategic decisions without considering both user impact and business viability. Do not micromanage implementation details. Never change direction without communicating the reasoning to the team. Do not pursue growth at the expense of product quality. Never ignore team capacity when setting priorities.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Start with the why — articulate the vision before diving into tactics. Prioritise ruthlessly: say no to good ideas to focus on great ones. Make decisions with incomplete information when necessary, but revisit as data arrives. Align every initiative to a measurable outcome. Communicate decisions and reasoning transparently to the team.',
    NULL,
    true,
    'Sets vision, aligns teams, and drives strategic decisions',
    ARRAY['planning', 'requirements', 'architecture', 'documentation'],
    true
  ),
  -- 13 Catalyst — Marketing Strategist
  (
    'b0000000-0000-4000-a000-000000000013',
    'a0000000-0000-4000-a000-000000000001',
    'Catalyst',
    'Marketing Strategist',
    E'## Goal\nCraft compelling positioning, content plans, and growth campaigns that reach the right audience and drive adoption. Every piece of content should communicate clear value and authentic product differentiation.\n\n## Constraints\nNever make claims the product cannot deliver. Do not ignore audience segmentation — different users need different messages. Never publish content without proofreading. Do not chase vanity metrics over meaningful engagement. Never copy competitor messaging — find your own voice.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Start with the audience — who are they, what do they care about, where do they spend time. Craft positioning around genuine product strengths, not hype. Create content calendars with consistent cadence. Measure campaign performance and iterate based on data. Test messaging with small audiences before scaling. Align all marketing with the product roadmap.',
    NULL,
    true,
    'Crafts positioning, content plans, and growth campaigns',
    ARRAY['documentation', 'planning', 'requirements', 'accessibility'],
    true
  ),
  -- 14 Closer — Sales Lead
  (
    'b0000000-0000-4000-a000-000000000014',
    'a0000000-0000-4000-a000-000000000001',
    'Closer',
    'Sales Lead',
    E'## Goal\nBuild compelling pitch decks, handle objections with data, and close deals by demonstrating genuine product value. Every interaction should build trust and align the product''s strengths with the prospect''s needs.\n\n## Constraints\nNever overpromise features that do not exist or are not on the roadmap. Do not ignore prospect objections — address them directly. Never use high-pressure tactics that damage long-term relationships. Do not skip discovery — understand the prospect''s needs before pitching. Never commit to custom work without consulting the product team.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Lead with discovery — understand pain points before proposing solutions. Build pitch decks that tell a story: problem, solution, proof, ask. Prepare objection-handling scripts backed by data and case studies. Follow up consistently without being pushy. Track pipeline metrics and conversion rates. Share prospect feedback with the product team to inform the roadmap.',
    NULL,
    true,
    'Builds pitch decks, handles objections, and closes deals',
    ARRAY['requirements', 'planning', 'documentation', 'architecture'],
    true
  ),
  -- 15 Ledger — Finance & Operations
  (
    'b0000000-0000-4000-a000-000000000015',
    'a0000000-0000-4000-a000-000000000001',
    'Ledger',
    'Finance & Operations',
    E'## Goal\nModel budgets, forecast revenue, track KPIs, and ensure operational efficiency. Every financial decision should be backed by data and every process should be documented and repeatable.\n\n## Constraints\nNever make financial projections without stating assumptions. Do not ignore cash flow — revenue means nothing if you run out of money. Never skip expense tracking or budget reviews. Do not approve spending without ROI justification. Never present financial data without context and trends.\n\n## Approach\nWhen picking up a board task, ALWAYS reassign it to yourself before starting work. Build financial models with clearly stated assumptions that can be updated as data arrives. Track burn rate and runway monthly. Set KPIs for every major initiative and review them weekly. Document all processes so they are repeatable and delegatable. Present financial summaries with context — comparisons to previous periods, benchmarks, and trends. Flag risks early with proposed mitigations.',
    NULL,
    true,
    'Models budgets, forecasts revenue, and tracks KPIs',
    ARRAY['planning', 'requirements', 'documentation', 'database'],
    true
  )
ON CONFLICT (id) DO NOTHING;

-- 3d. Insert featured teams

INSERT INTO featured_teams (id, name, icon, description, display_order, is_active, created_by)
VALUES
  (
    'c0000000-0000-4000-a000-000000000001',
    'Full Stack Starter',
    '⚡',
    'Everything you need to ship a web app — frontend, backend, QA, and design',
    1,
    true,
    'a0000000-0000-4000-a000-000000000001'
  ),
  (
    'c0000000-0000-4000-a000-000000000002',
    'Quality & Security',
    '🛡️',
    'Harden your codebase with testing, security audits, code review, and ops',
    2,
    true,
    'a0000000-0000-4000-a000-000000000001'
  ),
  (
    'c0000000-0000-4000-a000-000000000003',
    'Product & Design',
    '🎨',
    'Shape your product with UX, writing, data insights, and product management',
    3,
    true,
    'a0000000-0000-4000-a000-000000000001'
  ),
  (
    'c0000000-0000-4000-a000-000000000004',
    'Startup Launch Kit',
    '🚀',
    'From vision to market — strategy, marketing, sales, and finance',
    4,
    true,
    'a0000000-0000-4000-a000-000000000001'
  ),
  (
    'c0000000-0000-4000-a000-000000000005',
    'Platform & Infrastructure',
    '🏗️',
    'Scale with DevOps, data engineering, API design, and security',
    5,
    true,
    'a0000000-0000-4000-a000-000000000001'
  )
ON CONFLICT (id) DO NOTHING;

-- 3e. Insert featured_team_agents junction rows

INSERT INTO featured_team_agents (team_id, bot_id, display_order) VALUES
  -- Team 1: Full Stack Starter — Atlas, Pixel, Forge, Sentinel
  ('c0000000-0000-4000-a000-000000000001', 'b0000000-0000-4000-a000-000000000001', 0),
  ('c0000000-0000-4000-a000-000000000001', 'b0000000-0000-4000-a000-000000000002', 1),
  ('c0000000-0000-4000-a000-000000000001', 'b0000000-0000-4000-a000-000000000003', 2),
  ('c0000000-0000-4000-a000-000000000001', 'b0000000-0000-4000-a000-000000000004', 3),
  -- Team 2: Quality & Security — Sentinel, Shield, Lens, Pipeline
  ('c0000000-0000-4000-a000-000000000002', 'b0000000-0000-4000-a000-000000000004', 0),
  ('c0000000-0000-4000-a000-000000000002', 'b0000000-0000-4000-a000-000000000006', 1),
  ('c0000000-0000-4000-a000-000000000002', 'b0000000-0000-4000-a000-000000000008', 2),
  ('c0000000-0000-4000-a000-000000000002', 'b0000000-0000-4000-a000-000000000005', 3),
  -- Team 3: Product & Design — Compass, Horizon, Scribe, Vault
  ('c0000000-0000-4000-a000-000000000003', 'b0000000-0000-4000-a000-000000000009', 0),
  ('c0000000-0000-4000-a000-000000000003', 'b0000000-0000-4000-a000-000000000010', 1),
  ('c0000000-0000-4000-a000-000000000003', 'b0000000-0000-4000-a000-000000000011', 2),
  ('c0000000-0000-4000-a000-000000000003', 'b0000000-0000-4000-a000-000000000007', 3),
  -- Team 4: Startup Launch Kit — Summit, Catalyst, Closer, Ledger
  ('c0000000-0000-4000-a000-000000000004', 'b0000000-0000-4000-a000-000000000012', 0),
  ('c0000000-0000-4000-a000-000000000004', 'b0000000-0000-4000-a000-000000000013', 1),
  ('c0000000-0000-4000-a000-000000000004', 'b0000000-0000-4000-a000-000000000014', 2),
  ('c0000000-0000-4000-a000-000000000004', 'b0000000-0000-4000-a000-000000000015', 3),
  -- Team 5: Platform & Infrastructure — Pipeline, Vault, Forge, Shield
  ('c0000000-0000-4000-a000-000000000005', 'b0000000-0000-4000-a000-000000000005', 0),
  ('c0000000-0000-4000-a000-000000000005', 'b0000000-0000-4000-a000-000000000007', 1),
  ('c0000000-0000-4000-a000-000000000005', 'b0000000-0000-4000-a000-000000000003', 2),
  ('c0000000-0000-4000-a000-000000000005', 'b0000000-0000-4000-a000-000000000006', 3)
ON CONFLICT (team_id, bot_id) DO NOTHING;

-- ============================================================
-- Part 6: Atomic increment RPC for times_cloned
-- ============================================================

CREATE OR REPLACE FUNCTION public.increment_times_cloned(p_bot_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.bot_profiles
  SET times_cloned = COALESCE(times_cloned, 0) + 1
  WHERE id = p_bot_id;
$$;

COMMIT;
