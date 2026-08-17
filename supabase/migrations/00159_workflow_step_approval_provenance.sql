-- Human-approval gate enforcement (board task d572c4d1-bb45-468d-94b0-f3ac01855601):
-- "URGENT: human-approval gates aren't enforced — an orchestrating agent can
-- call approve_step on its own workflow."
--
-- BUG: the MCP `approve_step` tool only checked `users.is_bot` on
-- `ctx.userId`. On the remote OAuth transport, `ctx.userId` is always the
-- authenticated HUMAN's own id — an autonomous agent orchestrating a
-- workflow over a connection authenticated as its human owner sailed
-- straight through that check and could self-approve its own
-- human_check_required step, defeating the gate entirely. `fail_step`'s
-- awaiting_approval rejection branch had no identity gate of any kind.
--
-- FIX (Option 1 — "approvals only via the web UI"): the MCP tools
-- `approve_step` and `fail_step` (on an awaiting_approval step) are now hard-
-- error stubs — see mcp-server/src/tools/workflows.ts. The ONLY remaining
-- path to approval is `approveWorkflowStep` in src/actions/workflow.ts, a
-- Server Action that runs inside the human's own authenticated browser
-- session. This migration:
--
--   1. Adds provenance columns so an approval can be attributed to a real
--      human, method, and time — today only 'web_ui' exists, but the column
--      is a free CHECK-constrained text (not an enum) so a future approval
--      surface doesn't need a schema migration to add itself.
--   2. Adds a BEFORE UPDATE trigger as defence in depth: even if the
--      application-level stub above regresses (a future PR reintroduces a
--      working approve_step, a new code path forgets the provenance write,
--      etc.), the database itself refuses to move a step from
--      awaiting_approval to completed unless approved_by AND
--      approval_method are both set on the very same UPDATE.
--
-- AUDITED every path that transitions a task_workflow_steps row OUT OF
-- awaiting_approval (full list in the PR description) — the trigger only
-- constrains awaiting_approval -> completed, so it does not touch any of
-- them: MCP fail_step (now rejects awaiting_approval outright, never
-- reaches an UPDATE), MCP/UI cascade reset and resetWorkflow (-> pending),
-- MCP/UI removeWorkflow (DELETE, not UPDATE), propagateTemplateEdits/
-- resync_workflow_template (touches pending steps only). The single
-- legitimate awaiting_approval -> completed writer is approveWorkflowStep,
-- updated in this PR to stamp all three columns in the same UPDATE.

ALTER TABLE task_workflow_steps
  ADD COLUMN approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approval_method text CHECK (approval_method IN ('web_ui'));

COMMENT ON COLUMN task_workflow_steps.approved_by IS 'Human who approved this step (awaiting_approval -> completed). Null for steps never gated or not yet approved.';
COMMENT ON COLUMN task_workflow_steps.approved_at IS 'When approved_by approved this step.';
COMMENT ON COLUMN task_workflow_steps.approval_method IS 'How the approval was made. Currently only ''web_ui'' (src/actions/workflow.ts approveWorkflowStep) — there is no MCP path.';

-- Defence in depth: block the transition at the database layer regardless of
-- which code path (or bug) attempts it.
CREATE OR REPLACE FUNCTION enforce_workflow_step_approval_gate()
RETURNS trigger AS $$
BEGIN
  IF NEW.approved_by IS NULL OR NEW.approval_method IS NULL THEN
    RAISE EXCEPTION 'task_workflow_steps %: cannot move awaiting_approval -> completed without approved_by and approval_method (human-approval gate, board task d572c4d1)', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER workflow_step_approval_gate_trigger
  BEFORE UPDATE ON task_workflow_steps
  FOR EACH ROW
  WHEN (OLD.status = 'awaiting_approval' AND NEW.status = 'completed')
  EXECUTE FUNCTION enforce_workflow_step_approval_gate();
