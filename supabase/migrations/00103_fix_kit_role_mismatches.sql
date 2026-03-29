-- Fix kit agent role vs workflow template step mismatches:
-- 1. Remove Security Engineer from all kits (no workflow uses it — opt-in via future template)
-- 2. Add Infrastructure label + Infrastructure Change template mapping to Mobile App and API/Backend
-- 3. Add DevOps Engineer to AI/ML Project kit (it maps to Infrastructure Change but was missing the agent)

-- ============================================================
-- 1. Remove Security Engineer from all 4 kits that have it
-- ============================================================

UPDATE project_kits
SET agent_roles = (
  SELECT jsonb_agg(role)
  FROM jsonb_array_elements(agent_roles) AS role
  WHERE role ->> 'role' != 'Security Engineer'
)
WHERE name IN ('Web Application', 'Mobile App', 'API / Backend', 'AI / ML Project')
  AND agent_roles @> '[{"role": "Security Engineer"}]';

-- ============================================================
-- 2a. Add "Infrastructure" label to Mobile App and API/Backend label_presets
-- ============================================================

UPDATE project_kits
SET label_presets = label_presets || '[{"name": "Infrastructure", "color": "blue"}]'::jsonb
WHERE name = 'Mobile App'
  AND NOT label_presets @> '[{"name": "Infrastructure"}]';

UPDATE project_kits
SET label_presets = label_presets || '[{"name": "Infrastructure", "color": "blue"}]'::jsonb
WHERE name = 'API / Backend'
  AND NOT label_presets @> '[{"name": "Infrastructure"}]';

-- ============================================================
-- 2b. Add Infrastructure Change template mapping for Mobile App and API/Backend
-- ============================================================

INSERT INTO kit_workflow_mappings (kit_id, label_name, workflow_library_template_id, is_primary)
SELECT pk.id, 'Infrastructure', wlt.id, false
FROM project_kits pk
CROSS JOIN workflow_library_templates wlt
WHERE pk.name = 'Mobile App'
  AND wlt.name = 'Infrastructure Change'
  AND NOT EXISTS (
    SELECT 1 FROM kit_workflow_mappings kwm
    WHERE kwm.kit_id = pk.id AND kwm.label_name = 'Infrastructure'
  );

INSERT INTO kit_workflow_mappings (kit_id, label_name, workflow_library_template_id, is_primary)
SELECT pk.id, 'Infrastructure', wlt.id, false
FROM project_kits pk
CROSS JOIN workflow_library_templates wlt
WHERE pk.name = 'API / Backend'
  AND wlt.name = 'Infrastructure Change'
  AND NOT EXISTS (
    SELECT 1 FROM kit_workflow_mappings kwm
    WHERE kwm.kit_id = pk.id AND kwm.label_name = 'Infrastructure'
  );

-- ============================================================
-- 3. Add DevOps Engineer to AI/ML Project kit
-- ============================================================

UPDATE project_kits
SET agent_roles = agent_roles || '[{"role": "DevOps Engineer", "name_suggestion": "Pipeline", "skills": ["ML Pipelines", "Model Deployment", "GPU Infrastructure", "Data Pipeline Orchestration"]}]'::jsonb
WHERE name = 'AI / ML Project'
  AND NOT agent_roles @> '[{"role": "DevOps Engineer"}]';
