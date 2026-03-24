-- Project Kits: bundles of agents, workflows, labels, and board columns by project type
CREATE TABLE project_kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '✨',
  description TEXT,
  category TEXT,

  -- Kit contents (JSONB for flexibility)
  agent_roles JSONB NOT NULL DEFAULT '[]',
  label_presets JSONB NOT NULL DEFAULT '[]',
  board_column_presets JSONB DEFAULT NULL,
  auto_rule_label TEXT,

  -- Linked workflow template from library
  workflow_library_template_id UUID REFERENCES workflow_library_templates(id) ON DELETE SET NULL,

  -- Admin management
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE project_kits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active kits"
  ON project_kits FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage kits"
  ON project_kits FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

-- Add project_kit_id to ideas
ALTER TABLE ideas ADD COLUMN project_kit_id UUID REFERENCES project_kits(id) ON DELETE SET NULL;

-- Updated_at trigger
CREATE TRIGGER set_project_kits_updated_at
  BEFORE UPDATE ON project_kits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed 6 default kits
INSERT INTO project_kits (name, icon, description, category, display_order, agent_roles, label_presets, auto_rule_label) VALUES
(
  'Web Application', '🌐',
  'Full-stack web app with frontend, backend, and deployment',
  'Development', 0,
  '[{"role":"Full Stack Engineer","name_suggestion":"Atlas","skills":["TypeScript","React","Node.js"]},{"role":"UX Designer","name_suggestion":"Compass","skills":["Wireframing","Accessibility","User Research"]},{"role":"QA Engineer","name_suggestion":"Sentinel","skills":["Testing","E2E","Bug Reporting"]},{"role":"Security Engineer","name_suggestion":"Shield","skills":["OWASP","Auth","Encryption"]},{"role":"DevOps Engineer","name_suggestion":"Pipeline","skills":["CI/CD","Docker","Monitoring"]}]',
  '[{"name":"Bug","color":"red"},{"name":"Feature","color":"violet"},{"name":"Enhancement","color":"emerald"},{"name":"Refactor","color":"amber"},{"name":"Documentation","color":"cyan"},{"name":"Infrastructure","color":"blue"}]',
  'Feature'
),
(
  'Mobile App', '📱',
  'iOS, Android, or cross-platform mobile application',
  'Development', 1,
  '[{"role":"Full Stack Engineer","name_suggestion":"Atlas","skills":["React Native","Swift","Kotlin"]},{"role":"UX Designer","name_suggestion":"Compass","skills":["Mobile UX","Prototyping","Gestures"]},{"role":"QA Engineer","name_suggestion":"Sentinel","skills":["Device Testing","Performance","Accessibility"]},{"role":"Security Engineer","name_suggestion":"Shield","skills":["Mobile Security","Certificate Pinning"]},{"role":"DevOps Engineer","name_suggestion":"Pipeline","skills":["App Store","CI/CD","OTA Updates"]}]',
  '[{"name":"Bug","color":"red"},{"name":"Feature","color":"violet"},{"name":"UI/UX","color":"pink"},{"name":"Performance","color":"amber"},{"name":"Platform-specific","color":"cyan"}]',
  'Feature'
),
(
  'API / Backend', '⚙️',
  'REST/GraphQL API, microservice, or data pipeline',
  'Development', 2,
  '[{"role":"Full Stack Engineer","name_suggestion":"Atlas","skills":["API Design","Database","GraphQL"]},{"role":"QA Engineer","name_suggestion":"Sentinel","skills":["API Testing","Load Testing","Contract Testing"]},{"role":"Security Engineer","name_suggestion":"Shield","skills":["Auth","Rate Limiting","Input Validation"]},{"role":"DevOps Engineer","name_suggestion":"Pipeline","skills":["Docker","Kubernetes","Monitoring"]}]',
  '[{"name":"Bug","color":"red"},{"name":"Feature","color":"violet"},{"name":"Endpoint","color":"emerald"},{"name":"Schema","color":"amber"},{"name":"Performance","color":"cyan"}]',
  'Feature'
),
(
  'Design System', '🎨',
  'Component library, design tokens, documentation site',
  'Design', 3,
  '[{"role":"UX Designer","name_suggestion":"Compass","skills":["Design Tokens","Components","Accessibility"]},{"role":"Front End Engineer","name_suggestion":"Pixel","skills":["Storybook","CSS","React Components"]},{"role":"QA Engineer","name_suggestion":"Sentinel","skills":["Visual Regression","Cross-browser","Accessibility Audit"]}]',
  '[{"name":"Component","color":"violet"},{"name":"Token","color":"amber"},{"name":"Documentation","color":"cyan"},{"name":"Breaking Change","color":"red"}]',
  'Component'
),
(
  'AI / ML Project', '🤖',
  'Machine learning, data science, or AI agent system',
  'AI', 4,
  '[{"role":"Full Stack Engineer","name_suggestion":"Atlas","skills":["Python","ML Frameworks","API Integration"]},{"role":"QA Engineer","name_suggestion":"Sentinel","skills":["Model Evaluation","Data Validation","Bias Testing"]},{"role":"Security Engineer","name_suggestion":"Shield","skills":["Data Privacy","Model Security","Prompt Injection"]},{"role":"Business Analyst","name_suggestion":"BA Bob","skills":["Requirements","Data Analysis","Stakeholder Communication"]}]',
  '[{"name":"Bug","color":"red"},{"name":"Feature","color":"violet"},{"name":"Model","color":"emerald"},{"name":"Data","color":"amber"},{"name":"Pipeline","color":"cyan"},{"name":"Experiment","color":"blue"}]',
  'Feature'
),
(
  'Custom', '✨',
  'Start from scratch and configure everything yourself',
  NULL, 5,
  '[]',
  '[]',
  NULL
);
