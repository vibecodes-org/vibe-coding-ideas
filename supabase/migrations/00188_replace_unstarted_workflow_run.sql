-- Replace a never-started workflow run's steps in one transaction (task 472d5672, stage 2).
--
-- WHY: when a workflow template is edited, propagateTemplateEdits updates the
-- pending steps of active runs, but skips any run whose step count differs from
-- the template ("structural mismatch"). The stage 2 template rewrite changes the
-- step count of most templates, and about 490 cards already have a run that has
-- not started. Skipping them would leave those cards on the old steps. This
-- function swaps such a run to the new steps, but only when nothing has happened
-- on it yet.
--
-- SAFETY: the check and the swap are one transaction. The run row and its steps
-- are locked FOR UPDATE, then the swap happens only if EVERY step is still
-- pending and untouched: no start time, no claimer, no token, no output, no
-- assigned-and-worked comment. Anything else returns false and changes nothing,
-- so a run that someone has started, claimed or commented on is never rewritten.
-- Returns true when the steps were replaced.
--
-- SECURITY INVOKER: row-level security applies as the caller (the app) and the
-- service role bypasses it (the stdio MCP server), exactly as for the direct
-- step updates this replaces. The card progress counters on board_tasks are
-- recomputed from scratch by the existing row triggers (migration 00101), so
-- they end up right after the delete and insert.
--
-- p_steps: a JSON array, in order, of
--   { "title", "description", "agent_role", "human_check_required",
--     "expected_deliverables": [text], "model_tier" }
-- New rows get step_order i+1, position i*1000, status pending, no bot (the
-- caller rematches agents afterwards, as for every other propagated edit).

CREATE OR REPLACE FUNCTION public.replace_unstarted_workflow_run(
  p_run_id uuid,
  p_steps jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_task_id uuid;
  v_idea_id uuid;
  v_step_ids uuid[];
  v_untouched boolean;
BEGIN
  IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' OR jsonb_array_length(p_steps) = 0 THEN
    RETURN false;
  END IF;

  SELECT task_id, idea_id INTO v_task_id, v_idea_id
  FROM workflow_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Lock every step of the run, then judge them together.
  SELECT array_agg(id), bool_and(
    status = 'pending'
    AND started_at IS NULL
    AND claimed_by IS NULL
    AND claim_token_hash IS NULL
    AND work_token_hash IS NULL
    AND output IS NULL
    AND comment_count = 0
  )
  INTO v_step_ids, v_untouched
  FROM (
    SELECT id, status, started_at, claimed_by, claim_token_hash, work_token_hash, output, comment_count
    FROM task_workflow_steps
    WHERE run_id = p_run_id
    FOR UPDATE
  ) locked;

  IF v_step_ids IS NULL OR v_untouched IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- comment_count is trigger-maintained; check the comments table too so a
  -- stale counter can never hide a comment.
  IF EXISTS (SELECT 1 FROM workflow_step_comments WHERE step_id = ANY(v_step_ids)) THEN
    RETURN false;
  END IF;

  DELETE FROM task_workflow_steps WHERE run_id = p_run_id;

  INSERT INTO task_workflow_steps (
    task_id, idea_id, run_id, title, description, agent_role,
    human_check_required, expected_deliverables, model_tier,
    position, step_order, status, bot_id, match_tier
  )
  SELECT
    v_task_id, v_idea_id, p_run_id,
    s.value->>'title',
    s.value->>'description',
    s.value->>'agent_role',
    COALESCE((s.value->>'human_check_required')::boolean, false),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(s.value->'expected_deliverables')),
      '{}'::text[]
    ),
    s.value->>'model_tier',
    (s.ordinality - 1)::int * 1000,
    s.ordinality::int,
    'pending', NULL, NULL
  FROM jsonb_array_elements(p_steps) WITH ORDINALITY AS s(value, ordinality);

  RETURN true;
END;
$$;
