-- Backfill deliverables on workflow library templates, idea-scoped templates, and existing task workflow steps.
-- Idempotent: only sets deliverables where not already present.

-- ============================================================================
-- A) Update workflow_library_templates JSONB steps with deliverables
-- ============================================================================

DO $$
DECLARE
  _deliverables_map jsonb := '{
    "Feature Development": {
      "Requirements": ["Requirements document", "Acceptance criteria"],
      "UX Design": ["Design document (HTML)"],
      "Design Review": ["Design approval or feedback"],
      "Implementation": ["Implementation code", "Unit tests"],
      "QA Testing": ["Test report", "Bug list"],
      "Final Sign-off": ["Release approval"]
    },
    "Bug Fix": {
      "Reproduce & Investigate": ["Reproduction steps", "Root cause analysis"],
      "Implement Fix": ["Bug fix code", "Regression tests"],
      "Verify Fix": ["Verification report"],
      "Regression Check": ["Release approval"]
    },
    "Technical Spike": {
      "Define Research Questions": ["Research brief", "Success criteria"],
      "Research & Prototype": ["Prototype", "Research findings"],
      "Write Recommendation": ["Recommendation document"],
      "Review & Decide": ["Decision record"]
    },
    "Idea Validation": {
      "Market Research": ["Market analysis report"],
      "Competitor Analysis": ["Competitor matrix"],
      "User Interview Synthesis": ["User insights report"],
      "Go/No-Go Decision": ["Decision record"]
    },
    "Design Review": {
      "Audit Current UX": ["UX audit report"],
      "Create Design Proposals": ["Design proposals (HTML)"],
      "Implement Approved Design": ["Implementation code"],
      "Visual QA": ["Visual QA report"]
    },
    "Client Project": {
      "Brief & Requirements": ["Client brief", "Requirements document"],
      "Proposal & Scope": ["Proposal document", "Scope estimate"],
      "Execute": ["Implementation code", "Unit tests"],
      "Client Review": ["Client feedback summary"],
      "Deliver & Handoff": ["Handoff documentation"]
    },
    "Product Launch": {
      "Pre-launch Checklist": ["Launch readiness report"],
      "Marketing Assets": ["Marketing materials"],
      "Launch Approval": ["Launch approval"],
      "Post-launch Metrics Review": ["Metrics report", "Lessons learned"]
    }
  }'::jsonb;
  _template RECORD;
  _new_steps jsonb;
  _step jsonb;
  _step_title text;
  _template_deliverables jsonb;
  _step_deliverables jsonb;
  _i int;
BEGIN
  -- Update library templates
  FOR _template IN SELECT id, name, steps FROM workflow_library_templates LOOP
    _template_deliverables := _deliverables_map -> _template.name;
    IF _template_deliverables IS NULL THEN
      CONTINUE;
    END IF;

    _new_steps := '[]'::jsonb;
    FOR _i IN 0..jsonb_array_length(_template.steps) - 1 LOOP
      _step := _template.steps -> _i;
      _step_title := _step ->> 'title';
      _step_deliverables := _template_deliverables -> _step_title;

      IF _step_deliverables IS NOT NULL AND (_step -> 'deliverables') IS NULL THEN
        _step := _step || jsonb_build_object('deliverables', _step_deliverables);
      END IF;

      _new_steps := _new_steps || jsonb_build_array(_step);
    END LOOP;

    UPDATE workflow_library_templates SET steps = _new_steps WHERE id = _template.id;
  END LOOP;

  -- Update idea-scoped workflow templates (same logic)
  FOR _template IN SELECT id, name, steps FROM workflow_templates LOOP
    _template_deliverables := _deliverables_map -> _template.name;
    IF _template_deliverables IS NULL THEN
      CONTINUE;
    END IF;

    _new_steps := '[]'::jsonb;
    FOR _i IN 0..jsonb_array_length(_template.steps) - 1 LOOP
      _step := _template.steps -> _i;
      _step_title := _step ->> 'title';
      _step_deliverables := _template_deliverables -> _step_title;

      IF _step_deliverables IS NOT NULL AND (_step -> 'deliverables') IS NULL THEN
        _step := _step || jsonb_build_object('deliverables', _step_deliverables);
      END IF;

      _new_steps := _new_steps || jsonb_build_array(_step);
    END LOOP;

    UPDATE workflow_templates SET steps = _new_steps WHERE id = _template.id;
  END LOOP;
END;
$$;

-- ============================================================================
-- B) Backfill task_workflow_steps.expected_deliverables
-- ============================================================================
-- Only updates rows with empty deliverables (idempotent).

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Requirements document', 'Acceptance criteria']
  WHERE title = 'Requirements' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Design document (HTML)']
  WHERE title = 'UX Design' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Design approval or feedback']
  WHERE title = 'Design Review' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Implementation code', 'Unit tests']
  WHERE title = 'Implementation' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Test report', 'Bug list']
  WHERE title = 'QA Testing' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Release approval']
  WHERE title = 'Final Sign-off' AND expected_deliverables = '{}';

-- Bug Fix steps
UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Reproduction steps', 'Root cause analysis']
  WHERE title = 'Reproduce & Investigate' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Bug fix code', 'Regression tests']
  WHERE title = 'Implement Fix' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Verification report']
  WHERE title = 'Verify Fix' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Release approval']
  WHERE title = 'Regression Check' AND expected_deliverables = '{}';

-- Technical Spike steps
UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Research brief', 'Success criteria']
  WHERE title = 'Define Research Questions' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Prototype', 'Research findings']
  WHERE title = 'Research & Prototype' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Recommendation document']
  WHERE title = 'Write Recommendation' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Decision record']
  WHERE title = 'Review & Decide' AND expected_deliverables = '{}';

-- Idea Validation steps
UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Market analysis report']
  WHERE title = 'Market Research' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Competitor matrix']
  WHERE title = 'Competitor Analysis' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['User insights report']
  WHERE title = 'User Interview Synthesis' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Decision record']
  WHERE title = 'Go/No-Go Decision' AND expected_deliverables = '{}';

-- Design Review steps
UPDATE task_workflow_steps SET expected_deliverables = ARRAY['UX audit report']
  WHERE title = 'Audit Current UX' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Design proposals (HTML)']
  WHERE title = 'Create Design Proposals' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Implementation code']
  WHERE title = 'Implement Approved Design' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Visual QA report']
  WHERE title = 'Visual QA' AND expected_deliverables = '{}';

-- Client Project steps
UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Client brief', 'Requirements document']
  WHERE title = 'Brief & Requirements' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Proposal document', 'Scope estimate']
  WHERE title = 'Proposal & Scope' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Implementation code', 'Unit tests']
  WHERE title = 'Execute' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Client feedback summary']
  WHERE title = 'Client Review' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Handoff documentation']
  WHERE title = 'Deliver & Handoff' AND expected_deliverables = '{}';

-- Product Launch steps
UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Launch readiness report']
  WHERE title = 'Pre-launch Checklist' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Marketing materials']
  WHERE title = 'Marketing Assets' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Launch approval']
  WHERE title = 'Launch Approval' AND expected_deliverables = '{}';

UPDATE task_workflow_steps SET expected_deliverables = ARRAY['Metrics report', 'Lessons learned']
  WHERE title = 'Post-launch Metrics Review' AND expected_deliverables = '{}';
