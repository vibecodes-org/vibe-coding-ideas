-- Add workflow_runs to Realtime publication so TaskWorkflowSection
-- receives events when a workflow is created or its status changes.
ALTER PUBLICATION supabase_realtime ADD TABLE workflow_runs;
ALTER TABLE workflow_runs REPLICA IDENTITY FULL;
