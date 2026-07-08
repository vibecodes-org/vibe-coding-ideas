-- P2b: Seed advisory model_tier defaults into IDEA-LEVEL and USER templates.
--
-- 00131 seeded only workflow_library_templates — but label auto-rules apply the
-- idea-level workflow_templates copy, so freshly auto-applied workflows still
-- arrived untier'd (observed 2026-07-08 on the P2b card itself). This applies
-- the same role/title -> tier map (design §06) to workflow_templates and
-- user_workflow_templates, and re-runs the 00132 pending-step backfill to catch
-- steps created between 00132 and this migration.
--
-- Never overwrites a step that already carries a model_tier.

DO $$
DECLARE
  tbl text;
  tpl RECORD;
  new_steps jsonb;
  step jsonb;
  role_txt text;
  title_txt text;
  tier text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['workflow_templates', 'user_workflow_templates'] LOOP
    FOR tpl IN EXECUTE format('SELECT id, steps FROM %I', tbl) LOOP
      IF tpl.steps IS NULL OR jsonb_typeof(tpl.steps) <> 'array' THEN
        CONTINUE;
      END IF;

      new_steps := '[]'::jsonb;

      FOR step IN SELECT * FROM jsonb_array_elements(tpl.steps) LOOP
        IF (step ? 'model_tier') AND (step->>'model_tier') IS NOT NULL THEN
          new_steps := new_steps || step;
          CONTINUE;
        END IF;

        role_txt := lower(coalesce(step->>'role', ''));
        title_txt := lower(coalesce(step->>'title', ''));
        tier := NULL;

        IF role_txt ~ '\yqa\y|quality assurance|\ytest'
           OR title_txt ~ '\yqa\y|verify|run tests|\ylint|\yformat|changelog' THEN
          tier := 'cheap';
        ELSIF role_txt ~ '\yux\y|\yui\y|design'
           OR title_txt ~ 'design' THEN
          tier := 'frontier';
        ELSIF role_txt ~ 'product|owner|analyst|\ypm\y|\yba\y|founder|\yceo\y'
           OR title_txt ~ 'review|approv|decision|requirement' THEN
          tier := 'frontier';
        ELSIF role_txt ~ 'engineer|developer|\ydev\y|programmer|architect|full.?stack|front|back' THEN
          tier := 'standard';
        END IF;

        IF tier IS NOT NULL THEN
          step := jsonb_set(step, '{model_tier}', to_jsonb(tier), true);
        END IF;

        new_steps := new_steps || step;
      END LOOP;

      EXECUTE format('UPDATE %I SET steps = $1 WHERE id = $2', tbl) USING new_steps, tpl.id;
    END LOOP;
  END LOOP;
END $$;

-- Re-run the 00132 pending-step backfill for task steps created since it ran
-- (e.g. workflows auto-applied from the then-unseeded idea templates).
WITH tiered AS (
  SELECT id,
    CASE
      WHEN lower(coalesce(agent_role,'')) ~ '\yqa\y|quality assurance|\ytest'
        OR lower(coalesce(title,''))     ~ '\yqa\y|verify|run tests|\ylint|\yformat|changelog'
        THEN 'cheap'
      WHEN lower(coalesce(agent_role,'')) ~ '\yux\y|\yui\y|design'
        OR lower(coalesce(title,''))     ~ 'design'
        THEN 'frontier'
      WHEN lower(coalesce(agent_role,'')) ~ 'product|owner|analyst|\ypm\y|\yba\y|founder|\yceo\y'
        OR lower(coalesce(title,''))     ~ 'review|approv|decision|requirement'
        THEN 'frontier'
      WHEN lower(coalesce(agent_role,'')) ~ 'engineer|developer|\ydev\y|programmer|architect|full.?stack|front|back'
        THEN 'standard'
      ELSE NULL
    END AS tier
  FROM task_workflow_steps
  WHERE status = 'pending' AND model_tier IS NULL
)
UPDATE task_workflow_steps s
SET model_tier = t.tier
FROM tiered t
WHERE s.id = t.id AND t.tier IS NOT NULL;
