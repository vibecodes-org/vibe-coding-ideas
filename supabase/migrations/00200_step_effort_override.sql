-- Per-step effort (card 5e654dd1, stage 5): a workflow step may carry its own
-- reasoning effort (low, medium, high, xhigh, max) that wins over its tier's
-- effort. NULL means "the tier's own", which is today's behaviour for every
-- existing row.
--
-- 1. New nullable column task_workflow_steps.effort_override with a CHECK.
-- 2. replace_unstarted_workflow_run (from 00188, unchanged apart from this)
--    copies p_steps[].effort_override into the new column, so a swapped run
--    keeps a step's own level. Signature and security settings are identical.
--
-- Template JSON (workflow_templates.steps and the user / library template
-- tables) needs no change: it gains an optional "effort" key.
--
-- Tables and columns used: task_workflow_steps (existing columns as in 00188,
-- plus the new effort_override), workflow_runs, board_tasks, workflow_step_comments.
-- REAL-SCHEMA REHEARSAL STILL OWED by the release session (DO block ending in
-- RAISE EXCEPTION) before applying.

ALTER TABLE public.task_workflow_steps
  ADD COLUMN IF NOT EXISTS effort_override text NULL
  CHECK (effort_override IN ('low', 'medium', 'high', 'xhigh', 'max'));

COMMENT ON COLUMN public.task_workflow_steps.effort_override IS
  'Per-step reasoning effort; NULL = the tier''s own effort (from Model Tiers settings).';

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

  -- workflow_runs has no idea_id; take it from the card. OF r locks only the
  -- run row, not the card.
  SELECT r.task_id, bt.idea_id INTO v_task_id, v_idea_id
  FROM workflow_runs r
  JOIN board_tasks bt ON bt.id = r.task_id
  WHERE r.id = p_run_id
  FOR UPDATE OF r;

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
    human_check_required, expected_deliverables, model_tier, effort_override,
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
    s.value->>'effort_override',
    (s.ordinality - 1)::int * 1000,
    s.ordinality::int,
    'pending', NULL, NULL
  FROM jsonb_array_elements(p_steps) WITH ORDINALITY AS s(value, ordinality);

  RETURN true;
END;
$$;
