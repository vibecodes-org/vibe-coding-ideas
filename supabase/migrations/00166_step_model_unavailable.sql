-- Auto-switch to the configured backup model when the primary is unavailable
-- (card 5d0665a2 — Nick lost a workflow step on 3 Sep 2026 when Fable credits
-- ran out mid-task).
--
-- Before this, the fallback chain in platform_settings.model_tier_defaults
-- existed ONLY as a sentence inside claim_next_step's MANDATORY MODEL
-- directive ("if X is unavailable, use Y"). That is an honour system: it works
-- when the orchestrator reads and obeys it, and does nothing at all when a
-- step simply dies. Every subsequent step was still directed at the dead model.
--
-- VibeCodes never calls the model itself (steps execute as Task-tool subagents
-- inside Claude Code on the user's own machine), so there is no server-side
-- retry to add. What this column buys is the two things the server CAN do:
-- re-issue the step that died, and stop pointing later steps at a model we
-- have same-day evidence is unavailable.
--
-- Single boolean, deliberately: WHICH model was unavailable is derived at read
-- time from the row's model_tier, never stored. The obvious store —
-- executed_model — is only populated when the orchestrator self-reports
-- model_used, and an agent whose model was unreachable frequently has nothing
-- to report, so a stored marker would routinely name no model at all and the
-- switch would silently no-op. Deriving also means a later config change (a
-- new platform default, a user's own tier override) is picked up automatically
-- instead of stranding a marker that points at a model the tier no longer uses.
--
-- The flag also doubles as the rescue-once guard. fail_step reads it BEFORE
-- writing: already true means this step has been auto-rescued once already,
-- so the second failure is left failed rather than looping the step back to
-- pending forever.

ALTER TABLE task_workflow_steps
  ADD COLUMN model_unavailable BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN task_workflow_steps.model_unavailable IS
  'True when this step reported that its directed model was unavailable (out of credits, overloaded, not on the plan) — set by fail_step''s model_unavailable param, or inferred by complete_step when the self-reported model_used equals the tier''s configured fallback rather than its resolved model. WHICH model is not stored: it is resolved from this row''s model_tier at read time. Read two ways: (1) a same-UTC-day true row is the marker that makes claim_next_step resolve that user''s affected tier straight to the backup; (2) on the step itself it is the rescue-once guard — a step that is already true is never auto-returned to pending a second time. Self-reported, never verified, and it expires by time alone (queries bound on updated_at), so there is nothing to clear down.';

-- The claim-time lookup is "any same-day unavailability marker on this board",
-- a tiny and very selective slice — partial index so it costs nothing on the
-- overwhelmingly common false rows.
--
-- Scoped by idea_id, NOT by user. Credit exhaustion is really an account-level
-- fact, so per-board is narrower than the truth — the first step on a second
-- board still has to fail once before that board learns. That is deliberate:
-- claimed_by holds the assigned BOT's id rather than the human's, so it cannot
-- express "this account", and the alternative (an unscoped read) would leak
-- one user's marker to another on the stdio/service-role path, which bypasses
-- RLS. A board-local marker is wrong in the safe direction, and the paired
-- rescue behaviour makes that one extra failure cost nothing.
CREATE INDEX idx_workflow_steps_model_unavailable
  ON task_workflow_steps (idea_id, updated_at DESC)
  WHERE model_unavailable = true;
