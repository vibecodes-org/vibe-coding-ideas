-- Auto-switch to the configured backup model when the primary is unavailable
-- (card 5d0665a2 — Nick lost a workflow step on 3 Sep 2026 when Fable credits
-- ran out mid-task).
--
-- Before this, the fallback chain in platform_settings.model_tier_defaults
-- existed ONLY as a sentence inside claim_next_step's MANDATORY MODEL
-- directive ("if X is unavailable, use Y"). That is an honour system: it works
-- when the orchestrator reads and obeys it, and does nothing at all when a
-- step simply dies. Every subsequent step was still directed at the dead
-- model.
--
-- VibeCodes never calls the model itself (steps execute as Task-tool
-- subagents inside Claude Code or Codex on the user's own machine), so there
-- is no server-side retry to add. What these columns buy is the two things
-- the server CAN do: re-issue the step that died on the configured backup,
-- and stop pointing later steps at a model we have same-day evidence is
-- unavailable.
--
-- Two columns, not one boolean (revised from the closed, never-merged PR #255
-- during this rebuild's Requirements step): tiers now resolve to a DIFFERENT
-- model per agent (Claude vs Codex, migration 00171-era), so a marker that
-- only names a TIER can't say which agent's model actually died — a Codex
-- failure would wrongly divert Claude work on the same tier, and if the admin
-- re-points the tier's default in between, deriving "the dead model" from the
-- tier at read time would invert and mark the model that is currently WORKING
-- as dead. The fix is cheap: the server already resolves tier+agent to a
-- concrete model when it writes the marker (fail_step's rescue path,
-- complete_step's free signal) — this just stores that resolved name
-- alongside its own timestamp.
--
-- model_unavailable_at is keyed on its OWN write, never on updated_at:
-- workflow_step_updated_at_trigger bumps updated_at on every write to the
-- row, and nothing clears these columns on an ordinary re-claim, cascade
-- reset, or skip — so a step marked on Tuesday and merely re-claimed on
-- Thursday must not present as a fresh Thursday marker. On the step itself,
-- model_unavailable_at also doubles as the rescue-once guard: fail_step reads
-- it BEFORE writing — already set means this step has had its one rescue
-- (ever, not just today), so a second model-unavailability failure is left
-- failed instead of looping the step back to pending forever.

ALTER TABLE task_workflow_steps
  ADD COLUMN IF NOT EXISTS model_unavailable_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS model_unavailable_model TEXT;

ALTER TABLE task_workflow_steps
  DROP CONSTRAINT IF EXISTS task_workflow_steps_model_unavailable_model_check;

ALTER TABLE task_workflow_steps
  ADD CONSTRAINT task_workflow_steps_model_unavailable_model_check
  CHECK (model_unavailable_model IS NULL OR length(model_unavailable_model) <= 100);

COMMENT ON COLUMN task_workflow_steps.model_unavailable_at IS
  'Set once, by the code that actually observed the failure — either fail_step''s model_unavailable param (the rescue path) or complete_step''s free signal (model_used self-reported as the tier''s fallback). Never updated by an ordinary re-claim, cascade reset, or skip; reset_workflow clears it back to NULL for a fresh run. Read two ways: (1) the newest same-UTC-day row across the board (idea_id) is the live marker claim_next_step consults to redirect an affected tier onto its backup; (2) on the step itself, "is it set at all" is the rescue-once guard — a step that already has a value here is never auto-returned to pending a second time. Self-reported, never verified.';

COMMENT ON COLUMN task_workflow_steps.model_unavailable_model IS
  'The concrete model name (resolved server-side for the step''s tier + agent at write time, e.g. "fable") that was reported unavailable — paired with model_unavailable_at. Stored rather than derived from model_tier at read time so a later platform-default or per-user override change can never invert which model a stale marker points at, and so a Codex failure can never be confused with a Claude one on the same tier. Length-capped, not enum-constrained: a novel model family needs no schema change (mirrors executed_model, migration 00171).';

-- The claim-time lookup is "any same-day unavailability marker on this
-- board" — a tiny, very selective slice — so a partial index costs nothing
-- against the overwhelmingly common NULL rows.
--
-- Scoped by idea_id, NOT by user. Credit exhaustion is really an
-- account-level fact, so per-board is narrower than the truth — a second
-- board still has to fail once before it learns. That is deliberate:
-- claimed_by holds the assigned BOT's id rather than the human's, so it
-- cannot express "this account", and an unscoped read would leak one user's
-- marker to another on the stdio/service-role path, which bypasses RLS. A
-- board-local marker is wrong in the safe direction, and the paired rescue
-- makes that one extra failure cost nothing.
CREATE INDEX IF NOT EXISTS idx_workflow_steps_model_unavailable
  ON task_workflow_steps (idea_id, model_unavailable_at DESC)
  WHERE model_unavailable_at IS NOT NULL;
