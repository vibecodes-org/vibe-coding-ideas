-- 5 new project-type-specific workflow library templates
-- Based on research into industry best practices, CrewAI/ChatDev patterns,
-- and Google/MIT multi-agent scaling findings (3-6 steps optimal, 2 approval gates)

-- 1. Web Application Feature (6 steps, 2 approval gates)
INSERT INTO workflow_library_templates (name, description, display_order, steps, is_active) VALUES (
  'Web Application Feature',
  'End-to-end web app feature delivery: requirements, UX design, implementation, QA & security, release',
  10,
  '[
    {"title":"Requirements & Acceptance Criteria","role":"Product Owner","description":"Define what needs to be built, acceptance criteria, and user stories. Clarify scope boundaries.","requires_approval":false,"deliverables":["Requirements document","Acceptance criteria"]},
    {"title":"UX Design & Prototyping","role":"UX Designer","description":"Create wireframes and interaction flows based on the requirements. Consider responsive design and accessibility.","requires_approval":false,"deliverables":["Design document (HTML)"]},
    {"title":"Design Approval","role":"Product Owner","description":"Review proposed designs against requirements and provide approval or feedback.","requires_approval":true,"deliverables":["Design approval or feedback"]},
    {"title":"Implementation & Unit Tests","role":"Full Stack Engineer","description":"Build the feature with tests following project conventions. Cover frontend, backend, and database changes.","requires_approval":false,"deliverables":["Implementation code","Unit tests"]},
    {"title":"QA & Security Review","role":"QA Engineer","description":"Verify the implementation meets acceptance criteria. Test edge cases, cross-browser compatibility, accessibility, and basic security concerns.","requires_approval":false,"deliverables":["Test report","Bug list"]},
    {"title":"Release Sign-off","role":"Product Owner","description":"Confirm the feature is ready for release.","requires_approval":true,"deliverables":["Release approval"]}
  ]'::jsonb,
  true
);

-- 2. Mobile App Feature (6 steps, 2 approval gates)
INSERT INTO workflow_library_templates (name, description, display_order, steps, is_active) VALUES (
  'Mobile App Feature',
  'Mobile feature delivery with platform scoping, gesture-based UX, device testing, and app store compliance',
  11,
  '[
    {"title":"Requirements & Platform Scoping","role":"Product Owner","description":"Define requirements and determine platform scope (iOS, Android, or both). Document acceptance criteria and platform-specific considerations.","requires_approval":false,"deliverables":["Requirements document","Platform matrix (iOS/Android/both)","Acceptance criteria"]},
    {"title":"UX Design & Interaction Patterns","role":"UX Designer","description":"Design mobile-specific wireframes focusing on touch interactions, gesture navigation, thumb zones, and platform conventions (iOS HIG / Material Design).","requires_approval":false,"deliverables":["Mobile wireframes","Gesture/interaction specs"]},
    {"title":"Design Approval","role":"Product Owner","description":"Review proposed designs against requirements, ensuring platform conventions are followed.","requires_approval":true,"deliverables":["Design approval or feedback"]},
    {"title":"Implementation","role":"Full Stack Engineer","description":"Build the feature with tests. Handle platform-specific adaptations, offline support, and native module integration where needed.","requires_approval":false,"deliverables":["Implementation code","Unit tests","Platform-specific adaptations"]},
    {"title":"Device Testing & Performance","role":"QA Engineer","description":"Test across real devices covering the device matrix. Check touch targets, gesture behaviour, performance (memory, battery), and accessibility.","requires_approval":false,"deliverables":["Device test matrix results","Performance benchmarks","Accessibility audit"]},
    {"title":"Release Approval","role":"Product Owner","description":"Confirm the feature is ready for release. Verify app store compliance.","requires_approval":true,"deliverables":["Release approval","App store compliance checklist"]}
  ]'::jsonb,
  true
);

-- 3. API / Backend Feature (5 steps, 2 approval gates)
INSERT INTO workflow_library_templates (name, description, display_order, steps, is_active) VALUES (
  'API / Backend Feature',
  'Contract-first API development: schema design, contract approval, implementation, load testing & security, release',
  12,
  '[
    {"title":"API Contract & Schema Design","role":"Full Stack Engineer","description":"Design the API contract (OpenAPI/GraphQL schema), endpoint specifications, and migration plan. Contract-first enables parallel work.","requires_approval":false,"deliverables":["OpenAPI/GraphQL schema","Endpoint specifications","Migration plan"]},
    {"title":"Contract Review & Approval","role":"Product Owner","description":"Review the API contract for completeness and backwards compatibility. Once consumers code against it, changes are expensive.","requires_approval":true,"deliverables":["Approved schema","Breaking change assessment"]},
    {"title":"Implementation & Contract Tests","role":"Full Stack Engineer","description":"Build to the approved contract. Write contract tests to verify implementation matches schema, plus integration tests.","requires_approval":false,"deliverables":["Implementation code","Contract tests","Integration tests"]},
    {"title":"Load Testing & Security Audit","role":"QA Engineer","description":"Test API under load. Audit authentication, rate limiting, input validation, and error handling against OWASP API Top 10.","requires_approval":false,"deliverables":["Load test results","Security audit report"]},
    {"title":"Release Sign-off","role":"Product Owner","description":"Confirm backwards compatibility and approve for release. Verify API versioning and changelog.","requires_approval":true,"deliverables":["Release approval","API versioning confirmation","Changelog"]}
  ]'::jsonb,
  true
);

-- 4. Design System Component (5 steps, 2 approval gates)
INSERT INTO workflow_library_templates (name, description, display_order, steps, is_active) VALUES (
  'Design System Component',
  'Component development with audit, design specification, Storybook implementation, visual QA, and release governance',
  13,
  '[
    {"title":"Component Proposal & Audit","role":"UX Designer","description":"Check if the component already exists or can be extended. Document the proposal with usage guidelines and rationale.","requires_approval":false,"deliverables":["Component proposal","Existing component audit","Usage guidelines draft"]},
    {"title":"Design Specification","role":"UX Designer","description":"Define design tokens, component specs (states, variants, sizes), and accessibility requirements. This is the contract for implementation.","requires_approval":true,"deliverables":["Design tokens","Component specs (states, variants, sizes)","Accessibility requirements"]},
    {"title":"Implementation & Documentation","role":"Front End Engineer","description":"Build the component with Storybook stories. Document the API, usage examples, and accessibility compliance. Stories ARE documentation.","requires_approval":false,"deliverables":["Component code (Storybook)","API documentation","Usage examples"]},
    {"title":"Visual QA & Cross-browser Testing","role":"QA Engineer","description":"Run visual regression tests, verify cross-browser rendering, and audit keyboard navigation and screen reader compatibility.","requires_approval":false,"deliverables":["Visual regression test results","Cross-browser report","Accessibility audit results"]},
    {"title":"Release Approval & Changelog","role":"Product Owner","description":"Approve for release. Breaking changes require a migration guide for consumers.","requires_approval":true,"deliverables":["Release approval","Changelog entry","Migration guide (if breaking change)"]}
  ]'::jsonb,
  true
);

-- 5. AI / ML Feature (6 steps, 2 approval gates)
INSERT INTO workflow_library_templates (name, description, display_order, steps, is_active) VALUES (
  'AI / ML Feature',
  'AI/ML feature delivery: problem definition, data preparation, experimentation, model evaluation with bias review, deployment with monitoring',
  14,
  '[
    {"title":"Problem Definition & Data Assessment","role":"Business Analyst","description":"Frame the problem with clear success metrics. Assess data availability, quality, and ethical considerations. AI features need precise business framing.","requires_approval":false,"deliverables":["Problem statement","Success metrics","Data availability assessment","Ethical considerations"]},
    {"title":"Data Preparation & Feature Engineering","role":"Full Stack Engineer","description":"Clean, validate, and prepare the dataset. Build feature engineering pipelines. This step often takes 60-80% of total effort.","requires_approval":false,"deliverables":["Clean dataset","Feature pipeline code","Data validation report"]},
    {"title":"Experiment & Model Training","role":"Full Stack Engineer","description":"Run experiments, train models, track metrics. Compare with baselines. Document what was tried and why.","requires_approval":false,"deliverables":["Experiment logs","Model artifacts","Evaluation metrics","Comparison with baseline"]},
    {"title":"Model Evaluation & Bias Review","role":"QA Engineer","description":"Evaluate model quality against success metrics. Review for bias, fairness, and edge cases. This is the quality gate for AI features.","requires_approval":true,"deliverables":["Evaluation report","Bias/fairness analysis","Performance benchmarks"]},
    {"title":"Integration & API Deployment","role":"Full Stack Engineer","description":"Integrate the model into the application. Set up API serving, monitoring dashboards, and drift detection.","requires_approval":false,"deliverables":["Integration code","API endpoint","Monitoring setup","Drift detection config"]},
    {"title":"Release & Monitoring Sign-off","role":"Product Owner","description":"Confirm monitoring is in place and approve for release. AI features have outsized risk — verify rollback plan.","requires_approval":true,"deliverables":["Release approval","Monitoring dashboard confirmation","Rollback plan"]}
  ]'::jsonb,
  true
);

-- Update kit agent_roles with project-type-specific skills
UPDATE project_kits SET agent_roles = '[
  {"role":"Full Stack Engineer","name_suggestion":"Atlas","skills":["TypeScript","React","Next.js","Node.js","PostgreSQL"]},
  {"role":"UX Designer","name_suggestion":"Compass","skills":["Wireframing","Accessibility (WCAG 2.1)","Responsive Design","User Flows"]},
  {"role":"QA Engineer","name_suggestion":"Sentinel","skills":["E2E Testing","Cross-browser","Accessibility Audit","Performance Budget"]},
  {"role":"Security Engineer","name_suggestion":"Shield","skills":["OWASP Top 10","Auth/AuthZ","XSS/CSRF Prevention","RLS"]},
  {"role":"DevOps Engineer","name_suggestion":"Pipeline","skills":["CI/CD","Docker","CDN","Monitoring","SSL/TLS"]}
]'::jsonb WHERE name = 'Web Application';

UPDATE project_kits SET agent_roles = '[
  {"role":"Full Stack Engineer","name_suggestion":"Atlas","skills":["React Native","Swift","Kotlin","Mobile APIs","Offline-first"]},
  {"role":"UX Designer","name_suggestion":"Compass","skills":["Mobile UX Patterns","Touch Targets","Gesture Design","Platform Conventions"]},
  {"role":"QA Engineer","name_suggestion":"Sentinel","skills":["Multi-device Testing","Battery Profiling","App Store Compliance","Touch Target Validation"]},
  {"role":"Security Engineer","name_suggestion":"Shield","skills":["Certificate Pinning","Secure Storage","Biometric Auth","API Key Protection"]},
  {"role":"DevOps Engineer","name_suggestion":"Pipeline","skills":["App Store CI/CD","Code Signing","OTA Updates","Crash Reporting"]}
]'::jsonb WHERE name = 'Mobile App';

UPDATE project_kits SET agent_roles = '[
  {"role":"Full Stack Engineer","name_suggestion":"Atlas","skills":["API Design (REST/GraphQL)","PostgreSQL","Caching","Message Queues"]},
  {"role":"QA Engineer","name_suggestion":"Sentinel","skills":["Contract Testing","Load Testing","Schema Validation","Error Code Coverage"]},
  {"role":"Security Engineer","name_suggestion":"Shield","skills":["API Auth (OAuth/JWT)","Rate Limiting","Input Sanitization","Encryption at Rest"]},
  {"role":"DevOps Engineer","name_suggestion":"Pipeline","skills":["Docker","Kubernetes","Database Migrations","Health Checks"]}
]'::jsonb WHERE name = 'API / Backend';

UPDATE project_kits SET agent_roles = '[
  {"role":"UX Designer","name_suggestion":"Compass","skills":["Design Tokens","Component Patterns","Accessibility Standards","Documentation"]},
  {"role":"Front End Engineer","name_suggestion":"Pixel","skills":["Storybook","CSS/Tailwind","React Components","Variant APIs","Tree-shaking"]},
  {"role":"QA Engineer","name_suggestion":"Sentinel","skills":["Visual Regression","Cross-browser","Screen Reader Testing","Keyboard Navigation"]}
]'::jsonb WHERE name = 'Design System';

UPDATE project_kits SET agent_roles = '[
  {"role":"Full Stack Engineer","name_suggestion":"Atlas","skills":["Python","ML Frameworks (PyTorch/TF)","API Serving","Data Pipelines"]},
  {"role":"QA Engineer","name_suggestion":"Sentinel","skills":["Model Evaluation","Bias Testing","Hallucination Detection","Data Drift Monitoring"]},
  {"role":"Security Engineer","name_suggestion":"Shield","skills":["Prompt Injection Prevention","PII Handling","Data Anonymization","Model Access Control"]},
  {"role":"Business Analyst","name_suggestion":"BA Bob","skills":["AI Requirements","Success Metrics","Use Case Validation","Data Analysis"]}
]'::jsonb WHERE name = 'AI / ML Project';

-- Link each kit to its corresponding workflow template
UPDATE project_kits SET workflow_library_template_id = (
  SELECT id FROM workflow_library_templates WHERE name = 'Web Application Feature' LIMIT 1
) WHERE name = 'Web Application';

UPDATE project_kits SET workflow_library_template_id = (
  SELECT id FROM workflow_library_templates WHERE name = 'Mobile App Feature' LIMIT 1
) WHERE name = 'Mobile App';

UPDATE project_kits SET workflow_library_template_id = (
  SELECT id FROM workflow_library_templates WHERE name = 'API / Backend Feature' LIMIT 1
) WHERE name = 'API / Backend';

UPDATE project_kits SET workflow_library_template_id = (
  SELECT id FROM workflow_library_templates WHERE name = 'Design System Component' LIMIT 1
) WHERE name = 'Design System';

UPDATE project_kits SET workflow_library_template_id = (
  SELECT id FROM workflow_library_templates WHERE name = 'AI / ML Feature' LIMIT 1
) WHERE name = 'AI / ML Project';
