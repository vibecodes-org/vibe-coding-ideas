-- Move QA/verification work off the cheap tier.
--
-- WHY: the skills spike (task b471a2bd) ran an identical code-audit task on the
-- cheap tier four times and on the frontier tier twice. All four cheap runs made
-- the same FALSE claim their #1 critical finding — that board_task_labels has
-- "zero indexes" — and attached invented timings to it ("5-10s from sequential
-- scan"). The index exists: board_task_labels_task_id_label_id_key UNIQUE
-- (task_id, label_id), task_id leftmost. Both frontier runs got it right, and one
-- explicitly ruled the hypothesis out by measuring instead of asserting.
--
-- A QA step's entire deliverable is a trusted verdict. A fabricated PASS is worse
-- than no QA step at all, because it manufactures false confidence and removes the
-- prompt for anyone else to look. Cost is not a consideration here (owner's call).
--
-- THREE places had to change or new cheap QA steps would keep appearing:
--   1. defaultTierForRole (src/lib/constants.ts) — the code default. Done separately.
--   2. pending steps already queued — below.
--   3. template step definitions — below. Without this, applying any existing
--      template re-mints cheap QA steps and the fix silently undoes itself.
--
-- SCOPE NOTE: every pending step on the cheap tier was a QA role at the time of
-- writing (873 "QA Engineer" + 24 "QA", 897 total, zero others), so promoting all
-- pending cheap steps needs no per-role judgement. Completed and skipped steps are
-- history and are deliberately left alone — see task f374ae39 for the separate
-- question of whether the 113 already-completed cheap verdicts can be trusted.
--
-- The cheap tier itself is NOT removed. It stays available for explicit selection
-- and in the admin tier map; nothing auto-assigns it any more.

-- 1. Pending steps: promote to standard.
UPDATE public.task_workflow_steps
SET model_tier = 'standard'
WHERE model_tier = 'cheap'
  AND status = 'pending';

-- 2. Platform library templates (steps JSONB). Preserves array order via ORDINALITY.
UPDATE public.workflow_library_templates t
SET steps = (
  SELECT jsonb_agg(
           CASE WHEN s->>'model_tier' = 'cheap'
                THEN jsonb_set(s, '{model_tier}', '"standard"')
                ELSE s
           END
           ORDER BY ord
         )
  FROM jsonb_array_elements(t.steps) WITH ORDINALITY AS x(s, ord)
)
WHERE t.steps @> '[{"model_tier": "cheap"}]';

-- 3. Per-idea templates.
UPDATE public.workflow_templates t
SET steps = (
  SELECT jsonb_agg(
           CASE WHEN s->>'model_tier' = 'cheap'
                THEN jsonb_set(s, '{model_tier}', '"standard"')
                ELSE s
           END
           ORDER BY ord
         )
  FROM jsonb_array_elements(t.steps) WITH ORDINALITY AS x(s, ord)
)
WHERE t.steps @> '[{"model_tier": "cheap"}]';

-- 4. Personal saved templates.
UPDATE public.user_workflow_templates t
SET steps = (
  SELECT jsonb_agg(
           CASE WHEN s->>'model_tier' = 'cheap'
                THEN jsonb_set(s, '{model_tier}', '"standard"')
                ELSE s
           END
           ORDER BY ord
         )
  FROM jsonb_array_elements(t.steps) WITH ORDINALITY AS x(s, ord)
)
WHERE t.steps @> '[{"model_tier": "cheap"}]';
