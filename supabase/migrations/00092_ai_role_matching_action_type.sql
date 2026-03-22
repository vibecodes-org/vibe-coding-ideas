-- Add "role_matching" to ai_usage_log action_type CHECK constraint
ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_action_type_check;
ALTER TABLE ai_usage_log ADD CONSTRAINT ai_usage_log_action_type_check CHECK (action_type IN (
    'enhance_description',
    'generate_questions',
    'enhance_with_context',
    'generate_board_tasks',
    'enhance_task_description',
    'enhance_discussion_body',
    'role_matching'
));
