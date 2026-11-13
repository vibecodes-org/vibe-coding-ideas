-- Template edits reach cards that are already running (card bff94aed).
--
-- reshape_workflow_run applies a change plan, worked out in TypeScript, to one
-- running card: it deletes steps nobody has touched, rewrites waiting steps and
-- adds new waiting steps, all in one transaction. Before it writes anything it
-- locks the run and its steps and re-checks that the plan still fits:
--   * the run is still open and is the card's live run,
--   * every step has the id and status the plan was made from,
--   * every step to delete is still untouched (pending, never claimed, no
--     output, no comment).
-- If any check fails it changes nothing and returns 'changed'; otherwise it
-- returns 'applied'. Steps that are not pending are never updated or deleted.
--
-- Tables and columns used (checked against the live schema, read-only,
-- 13 Nov 2026): task_workflow_steps (id, task_id, idea_id, run_id, title,
-- description, agent_role, human_check_required, expected_deliverables,
-- model_tier, effort_override, position, step_order, status, bot_id, match_tier,
-- started_at, claimed_by, claim_token_hash, work_token_hash, output,
-- comment_count), workflow_runs (id, task_id, status), board_tasks (id,
-- idea_id), workflow_step_comments (step_id), function workflow_live_run_id.
-- REAL-SCHEMA RUN STILL OWED: applying this to production needs Nick's approval.

CREATE OR REPLACE FUNCTION public.reshape_workflow_run(
  p_run_id uuid,
  p_expected jsonb,
  p_deletes uuid[],
  p_updates jsonb,
  p_inserts jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_task_id uuid;
  v_idea_id uuid;
  v_run_status text;
  v_step_ids uuid[];
  v_actual int;
  v_match int;
  v_deletes uuid[] := COALESCE(p_deletes, '{}'::uuid[]);
  v_untouched int;
  u jsonb;
  s jsonb;
BEGIN
  IF p_expected IS NULL OR jsonb_typeof(p_expected) <> 'array' THEN
    RETURN 'changed';
  END IF;

  -- workflow_runs has no idea_id; take it from the card. OF r locks only the run.
  SELECT r.task_id, bt.idea_id, r.status INTO v_task_id, v_idea_id, v_run_status
  FROM workflow_runs r
  JOIN board_tasks bt ON bt.id = r.task_id
  WHERE r.id = p_run_id
  FOR UPDATE OF r;

  IF NOT FOUND OR v_run_status IN ('completed', 'failed') THEN
    RETURN 'changed';
  END IF;

  IF workflow_live_run_id(v_task_id) IS DISTINCT FROM p_run_id THEN
    RETURN 'changed';
  END IF;

  -- Lock every step of the run, then compare with what the plan was made from.
  SELECT array_agg(id) INTO v_step_ids FROM (
    SELECT id FROM task_workflow_steps WHERE run_id = p_run_id FOR UPDATE
  ) locked;
  v_actual := COALESCE(array_length(v_step_ids, 1), 0);

  SELECT count(*) INTO v_match
  FROM task_workflow_steps st
  JOIN jsonb_to_recordset(p_expected) AS e(id uuid, status text) ON e.id = st.id
  WHERE st.run_id = p_run_id AND st.status = e.status;

  IF v_actual <> jsonb_array_length(p_expected) OR v_match <> v_actual THEN
    RETURN 'changed';
  END IF;

  -- Every step to delete must still be untouched.
  IF array_length(v_deletes, 1) IS NOT NULL THEN
    SELECT count(*) INTO v_untouched
    FROM task_workflow_steps
    WHERE run_id = p_run_id
      AND id = ANY(v_deletes)
      AND status = 'pending'
      AND started_at IS NULL
      AND claimed_by IS NULL
      AND claim_token_hash IS NULL
      AND work_token_hash IS NULL
      AND output IS NULL
      AND comment_count = 0;

    IF v_untouched <> array_length(v_deletes, 1) THEN
      RETURN 'changed';
    END IF;

    -- comment_count is trigger-maintained; check the comments table too.
    IF EXISTS (SELECT 1 FROM workflow_step_comments WHERE step_id = ANY(v_deletes)) THEN
      RETURN 'changed';
    END IF;

    DELETE FROM task_workflow_steps
    WHERE run_id = p_run_id AND id = ANY(v_deletes) AND status = 'pending';
  END IF;

  -- Rewrite waiting steps. Only fields present in the plan entry are written;
  -- clear_agent also drops the agent matched to the old role.
  IF p_updates IS NOT NULL AND jsonb_typeof(p_updates) = 'array' THEN
    FOR u IN SELECT value FROM jsonb_array_elements(p_updates) LOOP
      UPDATE task_workflow_steps SET
        title = COALESCE(u->>'title', title),
        description = CASE WHEN u ? 'description' THEN u->>'description' ELSE description END,
        agent_role = CASE WHEN u ? 'agent_role' THEN u->>'agent_role' ELSE agent_role END,
        human_check_required = CASE WHEN u ? 'human_check_required'
          THEN (u->>'human_check_required')::boolean ELSE human_check_required END,
        expected_deliverables = CASE WHEN u ? 'expected_deliverables'
          THEN COALESCE(ARRAY(SELECT jsonb_array_elements_text(u->'expected_deliverables')), '{}'::text[])
          ELSE expected_deliverables END,
        model_tier = CASE WHEN u ? 'model_tier' THEN u->>'model_tier' ELSE model_tier END,
        effort_override = CASE WHEN u ? 'effort_override' THEN u->>'effort_override' ELSE effort_override END,
        step_order = CASE WHEN u ? 'step_order' THEN (u->>'step_order')::int ELSE step_order END,
        position = CASE WHEN u ? 'position' THEN (u->>'position')::int ELSE position END,
        bot_id = CASE WHEN COALESCE((u->>'clear_agent')::boolean, false) THEN NULL ELSE bot_id END,
        match_tier = CASE WHEN COALESCE((u->>'clear_agent')::boolean, false) THEN NULL ELSE match_tier END
      WHERE id = (u->>'id')::uuid
        AND run_id = p_run_id
        AND status = 'pending';
    END LOOP;
  END IF;

  -- Add new waiting steps.
  IF p_inserts IS NOT NULL AND jsonb_typeof(p_inserts) = 'array' THEN
    FOR s IN SELECT value FROM jsonb_array_elements(p_inserts) LOOP
      INSERT INTO task_workflow_steps (
        task_id, idea_id, run_id, title, description, agent_role,
        human_check_required, expected_deliverables, model_tier, effort_override,
        position, step_order, status, bot_id, match_tier
      ) VALUES (
        v_task_id, v_idea_id, p_run_id,
        s->>'title',
        s->>'description',
        s->>'agent_role',
        COALESCE((s->>'human_check_required')::boolean, false),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(s->'expected_deliverables')), '{}'::text[]),
        s->>'model_tier',
        s->>'effort_override',
        (s->>'position')::int,
        (s->>'step_order')::int,
        'pending', NULL, NULL
      );
    END LOOP;
  END IF;

  RETURN 'applied';
END;
$$;
