-- Add suggested label columns to workflow_library_templates
ALTER TABLE workflow_library_templates
  ADD COLUMN suggested_label_name text,
  ADD COLUMN suggested_label_color text;

-- Backfill existing templates
UPDATE workflow_library_templates SET suggested_label_name = 'Feature', suggested_label_color = 'violet' WHERE name = 'Feature Development';
UPDATE workflow_library_templates SET suggested_label_name = 'Bug', suggested_label_color = 'red' WHERE name = 'Bug Fix';
UPDATE workflow_library_templates SET suggested_label_name = 'Research', suggested_label_color = 'cyan' WHERE name = 'Technical Spike';
UPDATE workflow_library_templates SET suggested_label_name = 'Design', suggested_label_color = 'pink' WHERE name = 'Design Review';
UPDATE workflow_library_templates SET suggested_label_name = 'Research', suggested_label_color = 'cyan' WHERE name = 'Idea Validation';
UPDATE workflow_library_templates SET suggested_label_name = 'Launch', suggested_label_color = 'orange' WHERE name = 'Product Launch';
UPDATE workflow_library_templates SET suggested_label_name = 'Client', suggested_label_color = 'blue' WHERE name = 'Client Project';
UPDATE workflow_library_templates SET suggested_label_name = 'Infrastructure', suggested_label_color = 'amber' WHERE name = 'Infrastructure Change';
