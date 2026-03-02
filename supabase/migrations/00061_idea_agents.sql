-- Migration: Idea Agent Pool — shared bot allocation per idea
--
-- New junction table: idea_agents
-- Allows collaborators to allocate their bots to an idea's shared agent pool
-- All team members can then assign these pooled bots to board tasks

-- ============================================================================
-- 1. Table
-- ============================================================================

CREATE TABLE idea_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES bot_profiles(id) ON DELETE CASCADE,
  added_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idea_id, bot_id)
);

CREATE INDEX idea_agents_idea_id_idx ON idea_agents(idea_id);
CREATE INDEX idea_agents_bot_id_idx ON idea_agents(bot_id);
CREATE INDEX idea_agents_added_by_idx ON idea_agents(added_by);

-- ============================================================================
-- 2. RLS
-- ============================================================================

ALTER TABLE idea_agents ENABLE ROW LEVEL SECURITY;

-- SELECT: team members + public idea viewers
CREATE POLICY "Team members and public viewers can view idea agents"
  ON idea_agents FOR SELECT TO authenticated
  USING (
    is_idea_team_member(idea_id, auth.uid())
    OR is_idea_public(idea_id)
  );

-- INSERT: team members who own the bot AND bot is active
CREATE POLICY "Team members can allocate their own active bots"
  ON idea_agents FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = added_by
    AND is_idea_team_member(idea_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM bot_profiles
      WHERE bot_profiles.id = bot_id
        AND bot_profiles.owner_id = auth.uid()
        AND bot_profiles.is_active = true
    )
  );

-- DELETE: the person who added it OR the idea author
CREATE POLICY "Adder or idea author can remove idea agents"
  ON idea_agents FOR DELETE TO authenticated
  USING (
    auth.uid() = added_by
    OR auth.uid() = (SELECT author_id FROM ideas WHERE id = idea_id)
  );

-- ============================================================================
-- 3. Triggers
-- ============================================================================

-- When a collaborator is removed, clean up all bots they allocated to that idea
CREATE OR REPLACE FUNCTION cleanup_idea_agents_on_collaborator_remove()
RETURNS trigger AS $$
BEGIN
  DELETE FROM idea_agents
  WHERE idea_id = OLD.idea_id
    AND added_by = OLD.user_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_collaborator_remove_cleanup_agents
  AFTER DELETE ON collaborators
  FOR EACH ROW EXECUTE FUNCTION cleanup_idea_agents_on_collaborator_remove();

-- When a bot is removed from the pool, unassign it from any tasks in that idea
CREATE OR REPLACE FUNCTION unassign_bot_on_idea_agent_remove()
RETURNS trigger AS $$
BEGIN
  UPDATE board_tasks
  SET assignee_id = NULL
  WHERE idea_id = OLD.idea_id
    AND assignee_id = OLD.bot_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_idea_agent_remove_unassign
  AFTER DELETE ON idea_agents
  FOR EACH ROW EXECUTE FUNCTION unassign_bot_on_idea_agent_remove();

-- ============================================================================
-- 4. Realtime
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE idea_agents;
