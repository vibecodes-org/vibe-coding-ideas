-- Agent-voiced comments, Phase A (docs/agent-voice-comments-design.html, Rev 2).
--
-- Adds the work_token_hash column claim_next_step will mint alongside the
-- existing claim_token_hash (docs/claim-token-protocol-design.html): the
-- claim_token stays with the orchestrator and authorises complete_step/
-- fail_step; the new work_token is handed to the executing subagent and
-- authorises posting comments in the step's assigned agent's voice. Additive
-- and deploy-safe BEFORE the code goes live — old code ignores the column and
-- the widened policies (an unrecognised author_id branch on an OR just never
-- matches).
--
-- Also closes the board_task_comments authoring gap noted in migration
-- 00039: its INSERT policy has always checked team membership only, never
-- author_id, so anyone on the team could insert a comment authored as anyone.
-- Design Review made tightening this a condition of the design, not optional
-- — the review verified there are exactly two insert paths into the table
-- (the web comment form, always self-authored, and this MCP tool), and both
-- remain compatible with the tightened check below.

ALTER TABLE task_workflow_steps ADD COLUMN work_token_hash text;

COMMENT ON COLUMN task_workflow_steps.work_token_hash IS
  'sha256 hex of the multi-use work token minted by claim_next_step alongside claim_token_hash. Proves the holder is inside the live claim, but grants comment-voice only — never completion. Plaintext is never stored. NULL when unclaimed/completed/reset (cleared everywhere claim_token_hash is cleared).';

-- Helper: is p_bot_id a bot on this idea's agent team? (Distinct from
-- is_bot_owner, added in 00039 — this checks TEAM membership, not
-- ownership, so a collaborator executing a run may author as a teammate's
-- bot through a live work token, which owner-only would incorrectly block.)
CREATE OR REPLACE FUNCTION public.is_idea_agent(p_bot_id uuid, p_idea_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM idea_agents WHERE bot_id = p_bot_id AND idea_id = p_idea_id
  );
$$;

-- ============================================================
-- workflow_step_comments — INSERT: widen to team-agent authoring
-- ============================================================
DROP POLICY IF EXISTS "Team members can insert step comments" ON workflow_step_comments;
CREATE POLICY "Team members can insert step comments"
  ON workflow_step_comments FOR INSERT TO authenticated
  WITH CHECK (
    (
      auth.uid() = author_id
      OR is_bot_owner(author_id, auth.uid())
      OR is_idea_agent(author_id, idea_id)
    )
    AND is_idea_team_member(idea_id, auth.uid())
  );

-- ============================================================
-- board_task_comments — INSERT: TIGHTEN to check author_id (closes 00039:62)
-- ============================================================
DROP POLICY IF EXISTS "Team members can insert" ON board_task_comments;
CREATE POLICY "Team members can insert" ON board_task_comments FOR INSERT
  WITH CHECK (
    is_idea_team_member(idea_id, auth.uid())
    AND (
      auth.uid() = author_id
      OR is_bot_owner(author_id, auth.uid())
      OR is_idea_agent(author_id, idea_id)
    )
  );
