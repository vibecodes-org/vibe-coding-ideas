-- Fix FK constraints that block user deletion (NO ACTION → SET NULL)
-- These tables reference public.users(id) but don't cascade on delete,
-- causing admin_delete_user RPC to fail with FK violation errors.
-- Also drop NOT NULL on columns that need to accept NULL after SET NULL.

-- mcp_tool_log.user_id
ALTER TABLE mcp_tool_log ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE mcp_tool_log DROP CONSTRAINT mcp_tool_log_user_id_fkey;
ALTER TABLE mcp_tool_log ADD CONSTRAINT mcp_tool_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- mcp_tool_log.owner_user_id
ALTER TABLE mcp_tool_log ALTER COLUMN owner_user_id DROP NOT NULL;
ALTER TABLE mcp_tool_log DROP CONSTRAINT mcp_tool_log_owner_user_id_fkey;
ALTER TABLE mcp_tool_log ADD CONSTRAINT mcp_tool_log_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- mcp_tool_stats.user_id
ALTER TABLE mcp_tool_stats ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE mcp_tool_stats DROP CONSTRAINT mcp_tool_stats_user_id_fkey;
ALTER TABLE mcp_tool_stats ADD CONSTRAINT mcp_tool_stats_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- task_workflow_steps.bot_id
ALTER TABLE task_workflow_steps DROP CONSTRAINT task_workflow_steps_bot_id_fkey;
ALTER TABLE task_workflow_steps ADD CONSTRAINT task_workflow_steps_bot_id_fkey
  FOREIGN KEY (bot_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- task_workflow_steps.claimed_by
ALTER TABLE task_workflow_steps DROP CONSTRAINT task_workflow_steps_claimed_by_fkey;
ALTER TABLE task_workflow_steps ADD CONSTRAINT task_workflow_steps_claimed_by_fkey
  FOREIGN KEY (claimed_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- workflow_runs.started_by
ALTER TABLE workflow_runs DROP CONSTRAINT workflow_runs_started_by_fkey;
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_started_by_fkey
  FOREIGN KEY (started_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- workflow_templates.created_by
ALTER TABLE workflow_templates ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE workflow_templates DROP CONSTRAINT workflow_templates_created_by_fkey;
ALTER TABLE workflow_templates ADD CONSTRAINT workflow_templates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
