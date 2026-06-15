-- Refresh the "AI App / Agent" kit labels (drop data-science framing)
--
-- 00124 renamed the "AI / ML Project" kit -> "AI App / Agent" (name + description),
-- but its label_presets + workflow mappings still leaned data-science:
--   Model, Data, Pipeline, Experiment.
-- Refresh them toward building AI apps/agents: Prompt, Eval, Dataset, Integration
-- (Feature + Bug are retained). Then fix the kit_workflow_mappings that referenced
-- the removed labels — like-for-like onto the SAME existing templates (no new
-- workflows, no team change), mirroring the prior mapping shape.
--
-- Before -> After (label -> template):
--   Feature    -> AI / ML Feature   (primary)   [kept]
--   Bug        -> Bug Fix                        [kept]
--   Model      -> AI / ML Feature   => removed; Prompt      -> AI / ML Feature
--   Pipeline   -> Infrastructure Change => removed; Integration -> AI / ML Feature
--   Experiment -> Technical Spike   => removed; Eval        -> Technical Spike
--   Data       -> Technical Spike   => removed; Dataset     -> Technical Spike
--
-- Idempotent: fixed-value UPDATE, DELETE of the removed labels' mappings, and
-- guarded INSERT ... ON CONFLICT — safe to re-run. Follows 00100/00103/00124.
-- MUST be applied to prod manually (like 00123/00124).

BEGIN;

-- ============================================================
-- 1. Refresh label_presets (reuse the dropped labels' colors for continuity)
-- ============================================================
UPDATE project_kits
SET label_presets = '[
  {"name":"Bug","color":"red"},
  {"name":"Feature","color":"violet"},
  {"name":"Prompt","color":"emerald"},
  {"name":"Eval","color":"blue"},
  {"name":"Dataset","color":"amber"},
  {"name":"Integration","color":"cyan"}
]'::jsonb
WHERE name = 'AI App / Agent';

-- ============================================================
-- 2. Remove workflow mappings for the dropped labels (they'd otherwise be
--    orphaned — a mapping whose label no longer exists on the kit).
-- ============================================================
DELETE FROM kit_workflow_mappings kwm
USING project_kits pk
WHERE kwm.kit_id = pk.id
  AND pk.name = 'AI App / Agent'
  AND kwm.label_name IN ('Model', 'Data', 'Pipeline', 'Experiment');

-- ============================================================
-- 3. Add like-for-like mappings for the new labels onto existing templates.
--    Feature + Bug mappings are untouched (seeded in 00100).
--    UNIQUE(kit_id, label_name) guards re-runs.
-- ============================================================
INSERT INTO kit_workflow_mappings (kit_id, workflow_library_template_id, label_name, is_primary)
SELECT
  pk.id,
  wlt.id,
  mapping.label_name,
  mapping.is_primary
FROM (VALUES
  ('Prompt',      'AI / ML Feature', false),
  ('Integration', 'AI / ML Feature', false),
  ('Eval',        'Technical Spike', false),
  ('Dataset',     'Technical Spike', false)
) AS mapping(label_name, template_name, is_primary)
JOIN project_kits pk ON pk.name = 'AI App / Agent'
JOIN workflow_library_templates wlt ON wlt.name = mapping.template_name AND wlt.is_active = true
ON CONFLICT (kit_id, label_name) DO NOTHING;

COMMIT;
