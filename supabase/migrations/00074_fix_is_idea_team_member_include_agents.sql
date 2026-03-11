-- Fix: discussion RLS policies block bots from creating/replying via remote MCP
--
-- Root cause: INSERT policies on idea_discussions and idea_discussion_replies
-- enforce `auth.uid() = author_id`. In the remote MCP, auth.uid() is the human
-- user's JWT but author_id is the bot's ID (set via set_agent_identity).
-- This mismatch causes RLS violations.
--
-- Compare with board_task_comments which does NOT have this constraint and works.
--
-- Fix: Allow bot owners to insert/update/delete as their bots by adding
-- `OR EXISTS (SELECT 1 FROM bot_profiles WHERE id = author_id AND owner_id = auth.uid())`
-- Also update is_idea_team_member() to recognize bots in the idea_agents pool.

-- ============================================================================
-- 1. Update is_idea_team_member() to include idea_agents
-- ============================================================================

CREATE OR REPLACE FUNCTION is_idea_team_member(p_idea_id uuid, p_user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM ideas WHERE id = p_idea_id AND author_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM collaborators WHERE idea_id = p_idea_id AND user_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM idea_agents WHERE idea_id = p_idea_id AND bot_id = p_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 2. Fix idea_discussions INSERT policy
-- ============================================================================

DROP POLICY IF EXISTS "Team members can create discussions" ON idea_discussions;
CREATE POLICY "Team members can create discussions"
  ON idea_discussions FOR INSERT TO authenticated
  WITH CHECK (
    (
      auth.uid() = author_id
      OR EXISTS (SELECT 1 FROM bot_profiles WHERE id = author_id AND owner_id = auth.uid())
    )
    AND is_idea_team_member(idea_id, auth.uid())
  );

-- ============================================================================
-- 3. Fix idea_discussions UPDATE policy
-- ============================================================================

DROP POLICY IF EXISTS "Author or idea owner can update discussions" ON idea_discussions;
CREATE POLICY "Author or idea owner can update discussions"
  ON idea_discussions FOR UPDATE TO authenticated
  USING (
    auth.uid() = author_id
    OR EXISTS (SELECT 1 FROM bot_profiles WHERE id = author_id AND owner_id = auth.uid())
    OR auth.uid() = (SELECT author_id FROM ideas WHERE id = idea_id)
  );

-- ============================================================================
-- 4. Fix idea_discussions DELETE policy
-- ============================================================================

DROP POLICY IF EXISTS "Author, idea owner, or admins can delete discussions" ON idea_discussions;
CREATE POLICY "Author, idea owner, or admins can delete discussions"
  ON idea_discussions FOR DELETE TO authenticated
  USING (
    auth.uid() = author_id
    OR EXISTS (SELECT 1 FROM bot_profiles WHERE id = author_id AND owner_id = auth.uid())
    OR auth.uid() = (SELECT author_id FROM ideas WHERE id = idea_id)
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

-- ============================================================================
-- 5. Fix idea_discussion_replies INSERT policy
-- ============================================================================

DROP POLICY IF EXISTS "Team members can reply to discussions" ON idea_discussion_replies;
CREATE POLICY "Team members can reply to discussions"
  ON idea_discussion_replies FOR INSERT TO authenticated
  WITH CHECK (
    (
      auth.uid() = author_id
      OR EXISTS (SELECT 1 FROM bot_profiles WHERE id = author_id AND owner_id = auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM idea_discussions d
      WHERE d.id = discussion_id
      AND is_idea_team_member(d.idea_id, auth.uid())
    )
  );

-- ============================================================================
-- 6. Fix idea_discussion_replies UPDATE policy
-- ============================================================================

DROP POLICY IF EXISTS "Authors can update own replies" ON idea_discussion_replies;
CREATE POLICY "Authors can update own replies"
  ON idea_discussion_replies FOR UPDATE TO authenticated
  USING (
    auth.uid() = author_id
    OR EXISTS (SELECT 1 FROM bot_profiles WHERE id = author_id AND owner_id = auth.uid())
  );

-- ============================================================================
-- 7. Fix idea_discussion_replies DELETE policy
-- ============================================================================

DROP POLICY IF EXISTS "Author, discussion owner, idea owner, or admins can delete replies" ON idea_discussion_replies;
CREATE POLICY "Author, discussion owner, idea owner, or admins can delete replies"
  ON idea_discussion_replies FOR DELETE TO authenticated
  USING (
    auth.uid() = author_id
    OR EXISTS (SELECT 1 FROM bot_profiles WHERE id = author_id AND owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM idea_discussions d
      WHERE d.id = discussion_id
      AND (
        auth.uid() = d.author_id
        OR auth.uid() = (SELECT author_id FROM ideas WHERE id = d.idea_id)
      )
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );
