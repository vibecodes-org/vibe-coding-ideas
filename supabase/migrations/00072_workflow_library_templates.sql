-- Workflow Library Templates: admin-managed template library (replaces hardcoded WORKFLOW_TEMPLATE_LIBRARY)

CREATE TABLE workflow_library_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  steps       jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active   boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Prevent duplicate names (case-insensitive)
CREATE UNIQUE INDEX workflow_library_templates_name_lower_idx
  ON workflow_library_templates (lower(name));

-- Updated_at trigger
CREATE TRIGGER set_workflow_library_templates_updated_at
  BEFORE UPDATE ON workflow_library_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE workflow_library_templates ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (needed by import dialog)
CREATE POLICY "Authenticated users can view library templates"
  ON workflow_library_templates FOR SELECT
  TO authenticated
  USING (true);

-- Admin-only write
CREATE POLICY "Admins can insert library templates"
  ON workflow_library_templates FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can update library templates"
  ON workflow_library_templates FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can delete library templates"
  ON workflow_library_templates FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

-- Seed the 7 existing templates
INSERT INTO workflow_library_templates (name, description, steps, display_order) VALUES
(
  'Feature Development',
  'End-to-end feature delivery from requirements through QA to sign-off.',
  '[
    {"title": "Requirements", "description": "Gather and document requirements, define acceptance criteria, and estimate scope.", "role": "Product Owner", "requires_approval": false},
    {"title": "UX Design", "description": "Create wireframes and interaction flows based on the requirements.", "role": "UX Designer", "requires_approval": false},
    {"title": "Design Review", "description": "Review proposed designs against requirements and provide approval or feedback.", "role": "Product Owner", "requires_approval": true},
    {"title": "Implementation", "description": "Build the feature with tests following project conventions.", "role": "Full Stack Developer", "requires_approval": false},
    {"title": "QA Testing", "description": "Verify the implementation meets acceptance criteria and test edge cases.", "role": "QA Engineer", "requires_approval": false},
    {"title": "Final Sign-off", "description": "Confirm the feature is ready for release.", "role": "Product Owner", "requires_approval": true}
  ]'::jsonb,
  0
),
(
  'Bug Fix',
  'Structured bug resolution from reproduction through verification.',
  '[
    {"title": "Reproduce & Investigate", "description": "Confirm the bug, identify root cause, and document reproduction steps.", "role": "QA Engineer", "requires_approval": false},
    {"title": "Implement Fix", "description": "Fix the root cause and add regression tests.", "role": "Full Stack Developer", "requires_approval": false},
    {"title": "Verify Fix", "description": "Confirm the fix resolves the issue without regressions.", "role": "QA Engineer", "requires_approval": false},
    {"title": "Regression Check", "description": "Final sign-off that the fix is complete and no side-effects remain.", "role": "Product Owner", "requires_approval": true}
  ]'::jsonb,
  1
),
(
  'Technical Spike',
  'Time-boxed research to answer technical questions and recommend a path forward.',
  '[
    {"title": "Define Research Questions", "description": "Clarify what needs to be answered and set a time-box.", "role": "Product Owner", "requires_approval": false},
    {"title": "Research & Prototype", "description": "Investigate options, build prototypes, and gather data.", "role": "Full Stack Developer", "requires_approval": false},
    {"title": "Write Recommendation", "description": "Document findings, trade-offs, and a recommended approach.", "role": "Full Stack Developer", "requires_approval": false},
    {"title": "Review & Decide", "description": "Review the recommendation and decide on next steps.", "role": "Product Owner", "requires_approval": true}
  ]'::jsonb,
  2
),
(
  'Design Review',
  'Audit existing UX, propose improvements, implement, and verify visually.',
  '[
    {"title": "Audit Current UX", "description": "Review the current user experience and identify pain points.", "role": "UX Designer", "requires_approval": false},
    {"title": "Create Design Proposals", "description": "Produce design options with mockups and rationale.", "role": "UX Designer", "requires_approval": true},
    {"title": "Implement Approved Design", "description": "Build the approved design with pixel-perfect accuracy.", "role": "Frontend Engineer", "requires_approval": false},
    {"title": "Visual QA", "description": "Verify the implementation matches the approved design across viewports.", "role": "QA Engineer", "requires_approval": false}
  ]'::jsonb,
  3
),
(
  'Idea Validation',
  'Validate a product idea through market research and user insights before committing resources.',
  '[
    {"title": "Market Research", "description": "Analyse the market landscape, identify trends, and assess demand.", "role": "Product Owner", "requires_approval": false},
    {"title": "Competitor Analysis", "description": "Review competing solutions, identify gaps and differentiators.", "role": "Product Owner", "requires_approval": false},
    {"title": "User Interview Synthesis", "description": "Compile user interview findings and extract key insights.", "role": "UX Designer", "requires_approval": false},
    {"title": "Go/No-Go Decision", "description": "Review all evidence and decide whether to proceed.", "role": "Product Owner", "requires_approval": true}
  ]'::jsonb,
  4
),
(
  'Product Launch',
  'Coordinate a product launch from pre-launch checks through post-launch review.',
  '[
    {"title": "Pre-launch Checklist", "description": "Verify all launch prerequisites: tests passing, docs updated, monitoring configured.", "role": "Product Owner", "requires_approval": false},
    {"title": "Marketing Assets", "description": "Create launch announcements, screenshots, and promotional materials.", "role": "UX Designer", "requires_approval": false},
    {"title": "Launch Approval", "description": "Final go/no-go decision for the launch.", "role": "Product Owner", "requires_approval": true},
    {"title": "Post-launch Metrics Review", "description": "Review key metrics 48 hours after launch and document lessons learned.", "role": "Product Owner", "requires_approval": false}
  ]'::jsonb,
  5
),
(
  'Client Project',
  'End-to-end client engagement from brief through delivery and handoff.',
  '[
    {"title": "Brief & Requirements", "description": "Gather client brief, clarify requirements, and document constraints.", "role": "Product Owner", "requires_approval": false},
    {"title": "Proposal & Scope", "description": "Draft proposal with scope, timeline, and cost estimate for client approval.", "role": "Product Owner", "requires_approval": true},
    {"title": "Execute", "description": "Implement the agreed scope following project standards.", "role": "Full Stack Developer", "requires_approval": false},
    {"title": "Client Review", "description": "Present deliverables to client for review and feedback.", "role": "Product Owner", "requires_approval": true},
    {"title": "Deliver & Handoff", "description": "Package final deliverables, documentation, and handoff notes.", "role": "Product Owner", "requires_approval": false}
  ]'::jsonb,
  6
);
