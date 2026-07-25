-- Two fixes from the Opus 5 context-engineering spike (task dd890fab), finding 3.
--
-- PROBLEM: compliance is measured by asking the agent to grade its own homework
-- (persona_used / persona_honored / tier_honored on task_workflow_steps). Across
-- 425 attestation rows it has never once recorded a violation, in a system where
-- we have a first-party record (commit ec69009) of agents cutting exactly this
-- corner. An instrument that never disagrees with the thing it measures is not
-- evidence.
--
-- Compounding it: the planned independent cross-check — per-persona skill pickup
-- from mcp_tool_log — could not be run, because a tool call is attributed to a
-- bot only via mcp_tool_log.user_id, which holds a bot id ONLY when the client
-- called set_agent_identity. The subagent protocol tells clients NOT to do that,
-- so the protocol change silently removed our own attribution signal.
--
-- ---------------------------------------------------------------------------
-- FIX 1: workflow_step_plausibility — a signal the agent cannot self-report.
--
-- Derived entirely from facts the server already owns: when the step was claimed,
-- when it was completed, and how much deliverable came back. A fresh subagent
-- must be spawned, read its context, do the work and return — that takes time.
-- A large deliverable appearing seconds after the claim is not physically
-- consistent with that, whatever the attestation says.
--
-- Calibrated on 3,522 completed steps in production at the time of writing:
--   p10 28s · p50 199s · p90 2041s · mean output 2,503 chars
-- 11 steps breach the threshold below. All 11 predate the attestation columns,
-- and the two worst returned 4,192 and 4,920 chars in 13.7s and 17.3s
-- (305 and 285 chars/sec) — the era ec69009 was written about.
--
-- This flags IMPLAUSIBILITY, not guilt: a cached result, a trivially short step,
-- or a re-claim can all look fast. It is a screen for human attention, and
-- deliberately not an enforcement gate.

CREATE OR REPLACE VIEW public.workflow_step_plausibility
WITH (security_invoker = true) AS
SELECT
  s.id AS step_id,
  s.task_id,
  s.idea_id,
  s.run_id,
  s.title,
  s.agent_role,
  s.bot_id,
  s.status,
  s.started_at,
  s.completed_at,
  EXTRACT(EPOCH FROM (s.completed_at - s.started_at))::numeric AS duration_secs,
  length(COALESCE(s.output, '')) AS output_chars,
  CASE
    WHEN s.completed_at > s.started_at
      THEN round(length(COALESCE(s.output, ''))
                 / EXTRACT(EPOCH FROM (s.completed_at - s.started_at))::numeric, 1)
    ELSE NULL
  END AS chars_per_sec,
  -- What the agent claimed about itself, kept alongside so the two can be
  -- compared. Disagreement between claimed and observed is the interesting case.
  s.persona_used,
  s.persona_honored,
  s.executed_model,
  s.tier_honored,
  -- Observed implausibility: a substantial deliverable returned too fast for a
  -- spawn-plus-work cycle. Thresholds are deliberately conservative.
  (
    s.completed_at IS NOT NULL
    AND s.started_at IS NOT NULL
    AND s.completed_at > s.started_at
    AND EXTRACT(EPOCH FROM (s.completed_at - s.started_at)) < 20
    AND length(COALESCE(s.output, '')) > 2000
  ) AS implausibly_fast,
  -- The case that matters most: physically implausible, yet self-reported clean.
  (
    s.completed_at IS NOT NULL
    AND s.started_at IS NOT NULL
    AND s.completed_at > s.started_at
    AND EXTRACT(EPOCH FROM (s.completed_at - s.started_at)) < 20
    AND length(COALESCE(s.output, '')) > 2000
    AND (s.persona_honored IS TRUE OR s.tier_honored IS TRUE)
  ) AS contradicts_own_attestation
FROM public.task_workflow_steps s
WHERE s.started_at IS NOT NULL
  AND s.completed_at IS NOT NULL;

COMMENT ON VIEW public.workflow_step_plausibility IS
  'Server-derived compliance screen for workflow steps. Uses claim/complete timing and deliverable size — facts the executing agent cannot self-report — to flag steps too fast to be consistent with spawning a fresh subagent. contradicts_own_attestation isolates steps that are implausible AND self-reported as compliant. A screen for human review, not an enforcement gate.';

-- ---------------------------------------------------------------------------
-- FIX 2: restore per-persona tool attribution, independent of ambient identity.
--
-- Several tools (get_agent_skill_content, get_agent_prompt, clone_agent, …)
-- already take an explicit agent_id argument. Recording it makes per-persona
-- analysis — notably "did the agent actually load the skill we pointed it at?" —
-- possible without requiring the identity switch the subagent protocol removed.
--
-- Nullable and additive: existing rows and tools without an agent_id are
-- unaffected, and user_id keeps its current meaning.

ALTER TABLE public.mcp_tool_log
  ADD COLUMN IF NOT EXISTS bot_id uuid REFERENCES public.bot_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.mcp_tool_log.bot_id IS
  'Agent the call explicitly named via an agent_id argument. Independent of user_id, which only carries a bot id when the client called set_agent_identity — something the subagent protocol tells clients not to do.';

CREATE INDEX IF NOT EXISTS idx_mcp_tool_log_bot_created
  ON public.mcp_tool_log (bot_id, created_at DESC)
  WHERE bot_id IS NOT NULL;
