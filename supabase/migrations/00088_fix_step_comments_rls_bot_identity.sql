-- Fix workflow_step_comments INSERT and DELETE RLS policies to allow bot identities.
-- Same pattern used in migration 00074 for idea_discussions: bot owners can
-- insert/delete comments authored by their bots.

DROP POLICY IF EXISTS "Team members can insert step comments" ON workflow_step_comments;
CREATE POLICY "Team members can insert step comments"
  ON workflow_step_comments FOR INSERT TO authenticated
  WITH CHECK (
    (
      auth.uid() = author_id
      OR EXISTS (SELECT 1 FROM bot_profiles WHERE id = author_id AND owner_id = auth.uid())
    )
    AND is_idea_team_member(idea_id, auth.uid())
  );

DROP POLICY IF EXISTS "Authors can delete own step comments" ON workflow_step_comments;
CREATE POLICY "Authors can delete own step comments"
  ON workflow_step_comments FOR DELETE TO authenticated
  USING (
    auth.uid() = author_id
    OR EXISTS (SELECT 1 FROM bot_profiles WHERE id = author_id AND owner_id = auth.uid())
  );
