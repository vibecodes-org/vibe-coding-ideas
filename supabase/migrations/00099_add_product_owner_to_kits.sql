-- Fix: Add Product Owner role to all kit agent_roles
-- All workflow templates reference Product Owner for Requirements and Design Review steps,
-- but no kit included this role — causing "no matching agent" warnings on every applied workflow.

-- Web Application: add Product Owner
UPDATE project_kits
SET agent_roles = agent_roles || '[{"role":"Product Owner","name_suggestion":"PO","skills":["Prioritisation","User Stories","Acceptance Criteria"]}]'::jsonb,
    updated_at = now()
WHERE name = 'Web Application';

-- Mobile App: add Product Owner
UPDATE project_kits
SET agent_roles = agent_roles || '[{"role":"Product Owner","name_suggestion":"PO","skills":["Prioritisation","User Stories","Acceptance Criteria"]}]'::jsonb,
    updated_at = now()
WHERE name = 'Mobile App';

-- API / Backend: add Product Owner
UPDATE project_kits
SET agent_roles = agent_roles || '[{"role":"Product Owner","name_suggestion":"PO","skills":["Prioritisation","User Stories","Acceptance Criteria"]}]'::jsonb,
    updated_at = now()
WHERE name = 'API / Backend';

-- Design System: add Product Owner
UPDATE project_kits
SET agent_roles = agent_roles || '[{"role":"Product Owner","name_suggestion":"PO","skills":["Prioritisation","User Stories","Acceptance Criteria"]}]'::jsonb,
    updated_at = now()
WHERE name = 'Design System';

-- AI / ML Project: add Product Owner
UPDATE project_kits
SET agent_roles = agent_roles || '[{"role":"Product Owner","name_suggestion":"PO","skills":["Prioritisation","User Stories","Acceptance Criteria"]}]'::jsonb,
    updated_at = now()
WHERE name = 'AI / ML Project';
