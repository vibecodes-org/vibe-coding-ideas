INSERT INTO workflow_library_templates (name, description, steps, is_active, display_order)
VALUES (
  'Infrastructure Change',
  'Structured workflow for infrastructure and DevOps changes with impact assessment, environment validation, and deployment approval gates.',
  '[
    {
      "title": "Requirements & Impact Assessment",
      "role": "DevOps Engineer",
      "description": "Analyse the infrastructure change needed — scope, affected systems, risks, and rollback strategy.",
      "requires_approval": false,
      "deliverables": ["Impact assessment", "Change request document"]
    },
    {
      "title": "Implementation Plan",
      "role": "DevOps Engineer",
      "description": "Create a detailed plan including steps, timing, dependencies, and rollback procedure. Requires approval before execution.",
      "requires_approval": true,
      "deliverables": ["Implementation plan", "Rollback procedure"]
    },
    {
      "title": "Implement & Test",
      "role": "DevOps Engineer",
      "description": "Execute the infrastructure change in a test environment and validate it works as expected.",
      "requires_approval": false,
      "deliverables": ["Implementation code", "Test results"]
    },
    {
      "title": "Deploy to Target Environment",
      "role": "DevOps Engineer",
      "description": "Apply the change to the target environment. Verify deployment succeeds and systems are healthy.",
      "requires_approval": true,
      "deliverables": ["Deployment log", "Health check results"]
    },
    {
      "title": "Post-Deploy Verification",
      "role": "QA Engineer",
      "description": "Verify the change is stable in the target environment — check monitoring dashboards, review logs, and run smoke tests.",
      "requires_approval": false,
      "deliverables": ["Monitoring report", "Verification checklist"]
    }
  ]'::jsonb,
  true,
  7
);
