-- Task Workflow Steps, Orchestration Agent flag, Default Orchestration Agent
-- Merged from: 00067_task_workflow_steps, 00068_orchestration_agent, 00069_default_orchestration_agent

-- ============================================================
-- Part 1: Task Workflow Steps table (sequential agent pipeline)
-- ============================================================

-- 1. Create task_workflow_steps table
CREATE TABLE task_workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES board_tasks(id) ON DELETE CASCADE,
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  position integer NOT NULL DEFAULT 0,
  output text,
  failure_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE task_workflow_steps ENABLE ROW LEVEL SECURITY;

-- 2. RLS policies
CREATE POLICY "Authenticated users can view workflow steps for public ideas or team members"
  ON task_workflow_steps FOR SELECT
  USING (
    is_idea_team_member(idea_id, auth.uid())
    OR (auth.uid() IS NOT NULL AND is_idea_public(idea_id))
  );

CREATE POLICY "Team members can insert workflow steps"
  ON task_workflow_steps FOR INSERT
  WITH CHECK (is_idea_team_member(idea_id, auth.uid()));

CREATE POLICY "Team members can update workflow steps"
  ON task_workflow_steps FOR UPDATE
  USING (is_idea_team_member(idea_id, auth.uid()));

CREATE POLICY "Team members can delete workflow steps"
  ON task_workflow_steps FOR DELETE
  USING (is_idea_team_member(idea_id, auth.uid()));

-- 3. Replace denormalized columns on board_tasks
ALTER TABLE board_tasks
  DROP COLUMN checklist_total,
  DROP COLUMN checklist_done,
  ADD COLUMN workflow_step_total integer NOT NULL DEFAULT 0,
  ADD COLUMN workflow_step_completed integer NOT NULL DEFAULT 0;

-- 4. Trigger to maintain workflow step counts
CREATE OR REPLACE FUNCTION update_workflow_step_counts()
RETURNS trigger AS $$
DECLARE
  target_task_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_task_id := OLD.task_id;
  ELSE
    target_task_id := NEW.task_id;
  END IF;

  UPDATE board_tasks SET
    workflow_step_total = (SELECT count(*) FROM task_workflow_steps WHERE task_id = target_task_id),
    workflow_step_completed = (SELECT count(*) FROM task_workflow_steps WHERE task_id = target_task_id AND status = 'completed')
  WHERE id = target_task_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER workflow_step_counts_trigger
  AFTER INSERT OR UPDATE OR DELETE ON task_workflow_steps
  FOR EACH ROW EXECUTE FUNCTION update_workflow_step_counts();

-- 5. Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_workflow_step_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflow_step_updated_at_trigger
  BEFORE UPDATE ON task_workflow_steps
  FOR EACH ROW EXECUTE FUNCTION update_workflow_step_updated_at();

-- 6. Drop old checklist infrastructure
DROP TRIGGER IF EXISTS checklist_counts_trigger ON board_checklist_items;
DROP FUNCTION IF EXISTS update_checklist_counts();
ALTER PUBLICATION supabase_realtime DROP TABLE board_checklist_items;
DROP TABLE board_checklist_items;

-- 7. Add new table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE task_workflow_steps;
ALTER TABLE task_workflow_steps REPLICA IDENTITY FULL;

-- ============================================================
-- Part 2: Orchestration Agent flag on idea_agents
-- ============================================================

-- Add orchestration agent flag to idea_agents
ALTER TABLE idea_agents ADD COLUMN is_orchestrator boolean NOT NULL DEFAULT false;

-- Trigger: enforce at most one orchestrator per idea (last-write-wins)
CREATE OR REPLACE FUNCTION enforce_single_orchestrator()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_orchestrator = true THEN
    UPDATE idea_agents
    SET is_orchestrator = false
    WHERE idea_id = NEW.idea_id
      AND id != NEW.id
      AND is_orchestrator = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_single_orchestrator
  BEFORE INSERT OR UPDATE OF is_orchestrator ON idea_agents
  FOR EACH ROW
  EXECUTE FUNCTION enforce_single_orchestrator();

-- UPDATE policy for idea_agents (only SELECT/INSERT/DELETE exist)
CREATE POLICY "Team members can update idea agents"
  ON idea_agents FOR UPDATE
  USING (is_idea_team_member(idea_id, auth.uid()))
  WITH CHECK (is_idea_team_member(idea_id, auth.uid()));

-- ============================================================
-- Part 3: Seed default orchestration agent
-- ============================================================

-- UUID: b0000000-0000-4000-a000-000000000016
-- Owner: a0000000-0000-4000-a000-000000000001 (VIBECODES_USER_ID)

-- 3a. Insert auth.users row (handle_new_user trigger creates public.users)
INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token
) VALUES (
  'b0000000-0000-4000-a000-000000000016',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'bot-orchestrator@vibecodes.local', '', now(),
  jsonb_build_object('full_name', 'VibeCodes Orchestration Agent', 'avatar_url', ''),
  now(), now(), '', ''
)
ON CONFLICT (id) DO NOTHING;

-- 3b. Set is_bot = true (bypass prevent_privilege_escalation)
SELECT set_config('app.trusted_bot_operation', 'true', true);

UPDATE public.users SET is_bot = true
WHERE id = 'b0000000-0000-4000-a000-000000000016';

SELECT set_config('app.trusted_bot_operation', '', true);

-- 3c. Insert bot_profiles
INSERT INTO bot_profiles (
  id, owner_id, name, role, system_prompt, avatar_url, is_active,
  bio, skills, is_published
) VALUES (
  'b0000000-0000-4000-a000-000000000016',
  'a0000000-0000-4000-a000-000000000001',
  'VibeCodes Orchestration Agent',
  'Orchestration Agent',
  E'## Goal\nCoordinate multi-agent workflows by converting discussions into well-structured board tasks with sequential workflow steps, assigning each step to the right agent based on their skills. Ensure tasks have clear acceptance criteria and full context from the original discussion thread.\n\n## Constraints\nNever create tasks without linking back to the source discussion. Do not assign workflow steps to agents whose skills do not match the work. Never discard context from the discussion — carry forward key decisions, requirements, and constraints into the task description. Do not create duplicate tasks for the same discussion. Never start a workflow step that has unresolved dependencies on earlier steps.\n\n## Workflow Steps\nEach board task can have an ordered pipeline of workflow steps stored in `task_workflow_steps`. Steps have two types:\n\n### Agent Steps (`step_type: ''agent''`)\nAssigned to a bot agent (`bot_id`). Status: `pending` → `in_progress` → `completed` (or `failed`). When a step starts, the task''s assignee automatically updates to that step''s agent. The agent does the work and posts output via `complete_step`.\n\n### Human Steps (`step_type: ''human''`)\nValidation checkpoints that pause the pipeline for human review. No `bot_id` — these are completed by team members via `approve_step` or sent back via `request_changes`. Use human steps after critical agent work (e.g. after UX design, after implementation, before release) to ensure quality and gather feedback.\n\nSteps execute sequentially — the output of completed steps is passed as context to the next step via `get_next_step`. When `get_next_step` returns a human step, it includes `requires_human: true` — agents should stop and wait rather than trying to claim it.\n\nAvailable MCP tools for workflow orchestration:\n- `create_workflow_steps` — create an ordered list of steps (each with title, description, bot_id for agent steps, and step_type)\n- `get_next_step` — find the next pending/failed step and collect outputs from prior completed steps as context\n- `start_step` — claim a step (moves it to in_progress, updates task assignee for agent steps)\n- `complete_step` — mark a step done with structured markdown output\n- `fail_step` — mark a step as failed with a reason; optionally reset the current step back to pending\n- `approve_step` — approve a human validation step (completes it, allows pipeline to continue)\n- `request_changes` — reject a human step, sending a target step back for rework\n- `get_step_context` — retrieve all steps and their outputs for a task\n- `update_workflow_step` / `delete_workflow_step` — modify or remove steps\n\n## Approach\nWhen converting a discussion, read the full thread including all replies to understand the complete context. Extract clear requirements and acceptance criteria from the conversation. Create focused, actionable tasks with descriptive titles. Use `create_workflow_steps` to define a sequential pipeline of steps, assigning each to the most appropriate agent based on their role and skills (e.g. a UX Designer for mockups, a Developer for implementation, a QA Engineer for testing). **Include human validation checkpoints** after key deliverables — for example, after a design step add a human review step, after implementation add a code review step, and before final completion add a sign-off step. Include a summary of the discussion context in the task description so assigned agents can work independently. Use `get_next_step` to drive the pipeline forward, passing prior step outputs as context to the next agent.',
  NULL,
  true,
  'Coordinates multi-agent workflows by converting discussions into tasks and assigning work to the right agents',
  ARRAY['orchestration', 'planning', 'coordination', 'delegation'],
  true
)
ON CONFLICT (id) DO NOTHING;
