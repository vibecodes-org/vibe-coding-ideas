-- P2c: Capture executed model + tier-adherence reporting.
-- Records what model the orchestrator SELF-REPORTS running a tiered step's
-- subagent on (executed_model) and whether that honoured the step's directed
-- P2b tier (tier_honored). This is telemetry, not verification — VibeCodes
-- never checks what actually ran, only records what the caller claims.
-- Additive, nullable, no backfill (NULL on every pre-P2c row and on every
-- step whose orchestrator doesn't pass model_used).
--
-- NULL != false, always. Storing `false` implies "we know this was dishonored";
-- storing `NULL` means "we don't know" (omitted model_used, model_used =
-- "unknown", or the step's model_tier is NULL/Auto, which makes no promise to
-- honour). See mcp-server/src/tools/workflows.ts:resolveTierAdherence.

ALTER TABLE task_workflow_steps
  ADD COLUMN executed_model TEXT,
  ADD COLUMN tier_honored BOOLEAN;

ALTER TABLE task_workflow_steps
  ADD CONSTRAINT task_workflow_steps_executed_model_check
  CHECK (executed_model IS NULL OR executed_model IN ('fable', 'opus', 'sonnet', 'haiku', 'other', 'unknown'));

COMMENT ON COLUMN task_workflow_steps.executed_model IS
  'Self-reported by the orchestrator via complete_step/fail_step''s model_used param — the Task-tool model alias it says it ran this step''s subagent on (or "unknown"/"other"). NULL = not reported. Never verified against what actually ran.';

COMMENT ON COLUMN task_workflow_steps.tier_honored IS
  'Whether executed_model honoured this step''s model_tier (resolved model or its allowed fallback). NULL != false: NULL means unknown (model_tier is Auto/NULL, model_used was omitted, or model_used="unknown") — never conflate with false (a concrete, differing model was reported). Self-reported, not hard enforcement.';

-- Admins can read all workflow steps (needed for the two adherence reporting
-- views below, and the admin dashboard's "Tier Adherence" card — P2c
-- Design-Review CONDITION 3) — mirrors the existing ai_usage_log admin policy.
-- Non-admins keep the existing team-member/public-idea policy unchanged.
CREATE POLICY "Admins can view all workflow steps"
  ON task_workflow_steps FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

-- ─────────────────────────────────────────────────────────────────────────
-- Reporting views (P2c Design-Review CONDITION 2). Both are self-reported
-- telemetry, NOT hard verification — do not present counts here as proof of
-- what actually ran. `security_invoker = true` so both views respect the
-- querying role's RLS (the admin policy above, or the ordinary team-member
-- policy for non-admin callers) rather than bypassing it as the view owner.
--
-- honored    = tier_honored = true
-- dishonored = tier_honored = false
-- unknown    = tier_honored IS NULL
-- (never conflate — an adherence rate quoted without its `unknown`
-- denominator is the numeric version of treating NULL as false.)
--
-- Only steps with a tier (model_tier IS NOT NULL — Auto made no promise) and
-- a terminal status (completed/failed) are included; in-flight/pending/
-- awaiting_approval/skipped steps have nothing to report yet.
-- ─────────────────────────────────────────────────────────────────────────

-- Query 1 — adherence summary (what you'd run weekly):
--   select week, user_email, tier, honored, dishonored, unknown, total
--   from workflow_tier_adherence
--   where week >= now() - interval '30 days'
--   order by week desc, dishonored desc;
--
-- 0 rows = no tiered steps completed yet. Rows appear after the first
-- completion of a step that has a model tier. An all-`unknown` week means
-- steps are completing but orchestrators aren't reporting model_used yet —
-- that is not itself evidence of dishonoring.
CREATE VIEW workflow_tier_adherence WITH (security_invoker = true) AS
SELECT
  date_trunc('week', s.completed_at) AS week,
  s.claimed_by AS user_id,
  u.email AS user_email,
  s.run_id,
  s.model_tier AS tier,
  count(*) FILTER (WHERE s.tier_honored = true) AS honored,
  count(*) FILTER (WHERE s.tier_honored = false) AS dishonored,
  count(*) FILTER (WHERE s.tier_honored IS NULL) AS unknown,
  count(*) AS total
FROM task_workflow_steps s
LEFT JOIN users u ON u.id = s.claimed_by
WHERE s.model_tier IS NOT NULL
  AND s.status IN ('completed', 'failed')
GROUP BY week, s.claimed_by, u.email, s.run_id, s.model_tier;

COMMENT ON VIEW workflow_tier_adherence IS
  'P2c self-reported tier-adherence summary — grouped by completion week, claimed_by user, run, and tier. Self-reported by the orchestrator; VibeCodes records what the agent says it ran and does not verify it. honored/dishonored/unknown come from tier_honored=true/false/NULL respectively — never conflate NULL (unknown) with false (dishonored).';

-- Query 2 — row-level drill-down, e.g. "which frontier steps didn't run on Fable?":
--   select completed_at, task_title, step_title, executed_model, bot_name
--   from workflow_tier_adherence_steps
--   where tier = 'frontier' and tier_honored = false
--   order by completed_at desc limit 20;
CREATE VIEW workflow_tier_adherence_steps WITH (security_invoker = true) AS
SELECT
  s.id AS step_id,
  s.task_id,
  t.title AS task_title,
  s.title AS step_title,
  s.run_id,
  s.idea_id,
  s.model_tier AS tier,
  s.executed_model,
  s.tier_honored,
  s.status,
  s.claimed_by,
  u.full_name AS bot_name,
  s.completed_at
FROM task_workflow_steps s
LEFT JOIN board_tasks t ON t.id = s.task_id
LEFT JOIN users u ON u.id = s.claimed_by
WHERE s.model_tier IS NOT NULL
  AND s.status IN ('completed', 'failed');

COMMENT ON VIEW workflow_tier_adherence_steps IS
  'P2c self-reported tier-adherence drill-down — one row per completed/failed tiered step. Self-reported by the orchestrator; VibeCodes records what the agent says it ran and does not verify it. Companion of workflow_tier_adherence (row-level detail behind that view''s aggregate counts).';
