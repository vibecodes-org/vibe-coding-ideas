-- Standardise role names in workflow_library_templates steps JSONB
-- "Full Stack Developer" → "Full Stack Engineer"
-- "Frontend Engineer" → "Front End Engineer"

UPDATE workflow_library_templates
SET steps = (
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'role' = 'Full Stack Developer'
        THEN jsonb_set(elem, '{role}', '"Full Stack Engineer"')
      WHEN elem->>'role' = 'Frontend Engineer'
        THEN jsonb_set(elem, '{role}', '"Front End Engineer"')
      ELSE elem
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements(steps) WITH ORDINALITY AS t(elem, ordinality)
)
WHERE steps::text LIKE '%Full Stack Developer%'
   OR steps::text LIKE '%Frontend Engineer%';
