-- Add "Research" label and Technical Spike workflow mapping to the Web Application kit.
-- Other kits (Mobile App, API/Backend, AI/ML) already have Technical Spike mappings
-- but Web Application was missing one.

-- 1. Add "Research" label to the Web Application kit's label_presets
UPDATE project_kits
SET label_presets = label_presets || '[{"name":"Research","color":"cyan"}]'::jsonb
WHERE name = 'Web Application'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(label_presets) elem
    WHERE elem->>'name' = 'Research'
  );

-- 2. Add kit_workflow_mapping: Research -> Technical Spike
INSERT INTO kit_workflow_mappings (kit_id, workflow_library_template_id, label_name, is_primary)
SELECT
  pk.id,
  wlt.id,
  'Research',
  false
FROM project_kits pk
JOIN workflow_library_templates wlt ON wlt.name = 'Technical Spike' AND wlt.is_active = true
WHERE pk.name = 'Web Application'
ON CONFLICT DO NOTHING;
