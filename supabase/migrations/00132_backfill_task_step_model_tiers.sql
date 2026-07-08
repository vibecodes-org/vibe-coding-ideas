-- P2 backfill: apply the advisory model_tier default onto every not-yet-started
-- workflow step, so EXISTING workflows tier automatically (not just newly-applied
-- templates). 00131 seeded the platform library; this backdates the same default
-- onto in-flight task steps.
--
-- Safety: PENDING steps ONLY (never touch in_progress/completed/failed/awaiting —
-- matches propagateTemplateEdits rules); NULL-only (never overwrite an explicit
-- choice). Same role/title map as 00131 (design §06). Advisory field — no effect
-- on execution. Only rows that resolve to a real tier are written.

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
