-- Remove auto_run column from workflow_auto_rules.
-- Auto-rules now always fire when a matching label is added (no opt-out toggle).
ALTER TABLE workflow_auto_rules DROP COLUMN auto_run;
