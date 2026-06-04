-- Claim-token protocol for workflow step enforcement.
-- Design: docs/claim-token-protocol-design.html (Rev 3, approved 2026-06-04).
--
-- claim_next_step mints a one-time token, stores ONLY its sha256 hash here, and
-- returns the plaintext once to the claimer. complete_step/fail_step verify the
-- token (capability layer) before the kept persona-consistency check. The hash
-- is cleared on completion/failure/approval and on every reset path, so the
-- state is self-cleaning — its lifecycle is bound to the step.

ALTER TABLE task_workflow_steps ADD COLUMN claim_token_hash TEXT;

COMMENT ON COLUMN task_workflow_steps.claim_token_hash IS
  'sha256 hex of the one-time claim token minted by claim_next_step. Plaintext is never stored. NULL when unclaimed/completed/reset.';
