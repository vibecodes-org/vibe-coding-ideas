-- Multi-template kit support: kit_workflow_mappings junction table
-- Each kit can map multiple labels to different workflow library templates

CREATE TABLE kit_workflow_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id UUID NOT NULL REFERENCES project_kits(id) ON DELETE CASCADE,
  workflow_library_template_id UUID NOT NULL REFERENCES workflow_library_templates(id) ON DELETE CASCADE,
  label_name TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(kit_id, label_name)
);

-- RLS: same as project_kits — all authenticated SELECT, admin-only write
ALTER TABLE kit_workflow_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read kit mappings"
  ON kit_workflow_mappings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage kit mappings"
  ON kit_workflow_mappings FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

-- Index for kit lookups
CREATE INDEX idx_kit_workflow_mappings_kit_id ON kit_workflow_mappings(kit_id);

-- Seed mappings for all 5 non-Custom kits
-- We reference library templates by name since IDs are auto-generated

-- Web Application kit mappings
INSERT INTO kit_workflow_mappings (kit_id, workflow_library_template_id, label_name, is_primary)
SELECT
  pk.id,
  wlt.id,
  mapping.label_name,
  mapping.is_primary
FROM (VALUES
  ('Web Application', 'Feature', 'Web Application Feature', true),
  ('Web Application', 'Bug', 'Bug Fix', false),
  ('Web Application', 'Enhancement', 'Web Application Feature', false),
  ('Web Application', 'Refactor', 'Bug Fix', false),
  ('Web Application', 'Infrastructure', 'Infrastructure Change', false)
) AS mapping(kit_name, label_name, template_name, is_primary)
JOIN project_kits pk ON pk.name = mapping.kit_name
JOIN workflow_library_templates wlt ON wlt.name = mapping.template_name AND wlt.is_active = true;

-- Mobile App kit mappings
INSERT INTO kit_workflow_mappings (kit_id, workflow_library_template_id, label_name, is_primary)
SELECT
  pk.id,
  wlt.id,
  mapping.label_name,
  mapping.is_primary
FROM (VALUES
  ('Mobile App', 'Feature', 'Mobile App Feature', true),
  ('Mobile App', 'Bug', 'Bug Fix', false),
  ('Mobile App', 'UI/UX', 'Mobile App Feature', false),
  ('Mobile App', 'Performance', 'Technical Spike', false),
  ('Mobile App', 'Platform-specific', 'Bug Fix', false)
) AS mapping(kit_name, label_name, template_name, is_primary)
JOIN project_kits pk ON pk.name = mapping.kit_name
JOIN workflow_library_templates wlt ON wlt.name = mapping.template_name AND wlt.is_active = true;

-- API / Backend kit mappings
INSERT INTO kit_workflow_mappings (kit_id, workflow_library_template_id, label_name, is_primary)
SELECT
  pk.id,
  wlt.id,
  mapping.label_name,
  mapping.is_primary
FROM (VALUES
  ('API / Backend', 'Feature', 'API / Backend Feature', true),
  ('API / Backend', 'Bug', 'Bug Fix', false),
  ('API / Backend', 'Endpoint', 'API / Backend Feature', false),
  ('API / Backend', 'Schema', 'Technical Spike', false),
  ('API / Backend', 'Performance', 'Technical Spike', false)
) AS mapping(kit_name, label_name, template_name, is_primary)
JOIN project_kits pk ON pk.name = mapping.kit_name
JOIN workflow_library_templates wlt ON wlt.name = mapping.template_name AND wlt.is_active = true;

-- Design System kit mappings
INSERT INTO kit_workflow_mappings (kit_id, workflow_library_template_id, label_name, is_primary)
SELECT
  pk.id,
  wlt.id,
  mapping.label_name,
  mapping.is_primary
FROM (VALUES
  ('Design System', 'Component', 'Design System Component', true),
  ('Design System', 'Token', 'Design System Component', false),
  ('Design System', 'Breaking Change', 'Design System Component', false)
) AS mapping(kit_name, label_name, template_name, is_primary)
JOIN project_kits pk ON pk.name = mapping.kit_name
JOIN workflow_library_templates wlt ON wlt.name = mapping.template_name AND wlt.is_active = true;

-- AI / ML Project kit mappings
INSERT INTO kit_workflow_mappings (kit_id, workflow_library_template_id, label_name, is_primary)
SELECT
  pk.id,
  wlt.id,
  mapping.label_name,
  mapping.is_primary
FROM (VALUES
  ('AI / ML Project', 'Feature', 'AI / ML Feature', true),
  ('AI / ML Project', 'Bug', 'Bug Fix', false),
  ('AI / ML Project', 'Model', 'AI / ML Feature', false),
  ('AI / ML Project', 'Data', 'Technical Spike', false),
  ('AI / ML Project', 'Pipeline', 'Infrastructure Change', false),
  ('AI / ML Project', 'Experiment', 'Technical Spike', false)
) AS mapping(kit_name, label_name, template_name, is_primary)
JOIN project_kits pk ON pk.name = mapping.kit_name
JOIN workflow_library_templates wlt ON wlt.name = mapping.template_name AND wlt.is_active = true;
