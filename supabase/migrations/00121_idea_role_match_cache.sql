-- Cache for per-idea AI role-matching results (perf: Workflows tab, task a4cb3128).
--
-- getRoleCoverage() runs an AI (LLM) role-match for any template step role that
-- isn't an exact match to an agent. That ran on every Workflows-tab open,
-- uncached, costing a few seconds. This table caches the computed matches per
-- idea, keyed by a `signature` hash of (template roles + agent pool) so it
-- self-invalidates when either changes — no triggers needed. Cache is
-- best-effort; the app falls back to computing fresh on any cache miss/error.
CREATE TABLE idea_role_match_cache (
  idea_id    uuid PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
  signature  text NOT NULL,
  matches    jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE idea_role_match_cache ENABLE ROW LEVEL SECURITY;

-- Idea team members (humans + pooled agents) may read/write their idea's cache.
-- The service-role client bypasses RLS.
CREATE POLICY "Team members manage role-match cache"
  ON idea_role_match_cache
  FOR ALL
  USING (is_idea_team_member(idea_id, auth.uid()))
  WITH CHECK (is_idea_team_member(idea_id, auth.uid()));
