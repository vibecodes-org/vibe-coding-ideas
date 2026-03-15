-- Add missing updated_at triggers to board_tasks and board_columns.
-- The shared update_updated_at() function already exists (from 00001_create_users.sql)
-- but was never wired up to these tables.

CREATE TRIGGER set_board_tasks_updated_at
  BEFORE UPDATE ON board_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_board_columns_updated_at
  BEFORE UPDATE ON board_columns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
