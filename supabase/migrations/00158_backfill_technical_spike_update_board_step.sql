-- Backfill the "Update Board with Findings" step onto already-created Technical Spike
-- workflow runs (on Nick's own idea boards) that were created before the template
-- gained its 5th step. Only appends a new pending step; no existing rows are touched.
-- Idempotent via the NOT EXISTS guard.

WITH target_runs AS (
  SELECT wr.id AS run_id, wr.task_id
  FROM workflow_runs wr
  WHERE wr.template_id IN (
    '2a9e76d3-8c2b-476d-9953-839ec996c1b8','29b48eb3-9b3b-48a0-aeaa-fe538cdb0e77','4abedd93-b6f6-46ff-8f33-462d1548753b',
    'c12aa212-39da-47f2-ad25-e6d972b6af3a','843006de-0ed1-422b-8cb8-f10e5e772245','d0318fd4-d4c9-4b13-8953-6254d81a0bd2',
    'f2ad97fc-210e-4937-b17d-49849ed6d12d','e53d181a-1d44-466d-b75f-c7aadde8adcc','b90b773f-ad49-42c4-b151-f3b94ef0bfbb',
    '2e298c46-67d7-4ad0-97d0-24907a3d3b73','6ec46560-9c61-4f48-b624-e6c95cc1515c','050955cd-cf76-491d-81a9-913b8d3a1c24',
    'e749515c-2205-485e-8d73-a18567c5d2c7','89d1eee9-f3df-4e29-ad3c-252c6b350caf','e30ec83f-6e18-42a4-928c-5d701e705233',
    '08fab99c-8f95-420d-8928-8c35ddd01e3e'
  )
  AND wr.status <> 'completed'
),
agg AS (
  SELECT tws.run_id,
         bt.idea_id,
         max(tws.position) AS max_position,
         max(tws.step_order) AS max_step_order,
         (array_agg(tws.bot_id) FILTER (WHERE tws.agent_role = 'Product Owner'))[1] AS po_bot_id
  FROM task_workflow_steps tws
  JOIN board_tasks bt ON bt.id = tws.task_id
  WHERE tws.run_id IN (SELECT run_id FROM target_runs)
  GROUP BY tws.run_id, bt.idea_id
)
INSERT INTO task_workflow_steps
  (task_id, idea_id, run_id, bot_id, title, description, status, position, step_order,
   agent_role, expected_deliverables, model_tier, human_check_required, match_tier)
SELECT
  tr.task_id,
  a.idea_id,
  a.run_id,
  a.po_bot_id,
  'Update Board with Findings',
  'The decision from the previous step is now approved. Find the board task(s) this research was meant to unblock — usually the build or feature task that depends on this decision — and rewrite their descriptions with the actual decision and findings, replacing any outdated assumptions or options that were ruled out. If no existing task covers the follow-up work, create a new task with the decision and findings included so nothing gets lost.',
  'pending',
  a.max_position + 1000,
  a.max_step_order + 1,
  'Product Owner',
  ARRAY['Updated or new board task(s) reflecting the decision'],
  'standard',
  false,
  'exact'
FROM agg a
JOIN target_runs tr ON tr.run_id = a.run_id
WHERE NOT EXISTS (
  SELECT 1 FROM task_workflow_steps existing
  WHERE existing.run_id = a.run_id AND existing.title = 'Update Board with Findings'
);
