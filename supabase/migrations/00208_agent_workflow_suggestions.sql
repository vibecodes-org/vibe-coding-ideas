-- Agent-made workflow suggestions (card 69ca757c).
-- An agent that picks up a card with no workflow records a suggestion from the
-- board's existing templates. Such a suggestion has no label, so label_id must
-- be nullable, and 'agent' becomes a valid source.
ALTER TABLE workflow_suggestions ALTER COLUMN label_id DROP NOT NULL;

ALTER TABLE workflow_suggestions DROP CONSTRAINT workflow_suggestions_source_check;
ALTER TABLE workflow_suggestions ADD CONSTRAINT workflow_suggestions_source_check
  CHECK (source IN ('ai', 'heuristic', 'agent'));

-- One open label-less suggestion per card. NULL labels slip past the existing
-- (task_id, label_id) unique index, so this partial index covers them.
CREATE UNIQUE INDEX idx_workflow_suggestions_open_unlabelled
  ON workflow_suggestions(task_id)
  WHERE status = 'suggested' AND label_id IS NULL;
