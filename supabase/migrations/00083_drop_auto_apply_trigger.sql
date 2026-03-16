-- Move auto-rule workflow application from Postgres trigger to application code.
-- The trigger created steps without agent matching or deliverables.
-- Application code uses buildRoleMatcher for full fuzzy agent matching.
DROP TRIGGER IF EXISTS trg_auto_apply_workflow_on_label ON board_task_labels;
DROP FUNCTION IF EXISTS auto_apply_workflow_on_label();
