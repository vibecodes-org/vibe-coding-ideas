-- board_task_comments.updated_at was never bumped on edit, so the client's
-- "(edited)" indicator (which compares updated_at to created_at) never showed.
-- Reuse the generic update_step_comment_updated_at() function introduced in
-- migration 00071 for workflow_step_comments — it's table-agnostic
-- (`NEW.updated_at = now()`), so the same function works here unchanged.

DROP TRIGGER IF EXISTS board_task_comment_updated_at_trigger ON board_task_comments;

CREATE TRIGGER board_task_comment_updated_at_trigger
  BEFORE UPDATE ON board_task_comments
  FOR EACH ROW EXECUTE FUNCTION update_step_comment_updated_at();
