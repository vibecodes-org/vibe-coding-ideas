---
paths:
  - "supabase/**"
  - "src/types/**"
---

# Area rules: database (moved from CLAUDE.md)

## Database

Migrations live in `supabase/migrations/`, numbered `NNNNN_name.sql` — `ls` it for the latest number. `src/types/database.ts` types these tables:

- **Core**: users, ideas, comments, collaborators, votes, notifications, feedback, idea_attachments
- **Board**: board_columns, board_tasks, board_labels, board_task_labels, board_task_activity, board_task_comments, board_task_attachments
- **Workflows**: workflow_templates, workflow_auto_rules, workflow_runs, task_workflow_steps, workflow_step_comments, workflow_library_templates, user_workflow_templates, workflow_suggestions, workflow_step_usage (token use per step attempt, admin Reports tab)
- **Discussions**: idea_discussions, idea_discussion_replies, discussion_votes, discussion_attachments
- **Agents**: bot_profiles, idea_agents, agent_votes, agent_skills, featured_teams, featured_team_agents
- **Terminal**: idea_project_paths (recorded project folder per idea + machine), terminal_sessions (the in-app terminal's session registry)
- **Kits**: project_kits, kit_workflow_mappings
- **AI**: ai_usage_log, ai_prompt_templates, idea_role_match_cache, platform_settings
- **MCP**: mcp_oauth_clients, mcp_oauth_codes, mcp_tool_log, mcp_tool_stats, mcp_agent_sessions (retired with `set_agent_identity`; dropped in the pending Phase B task ec2bde45)
- **User/integration**: user_api_keys, user_github_connections, github_oauth_states, pending_uploads
- **Collaboration**: collaboration_requests

Board tables use `is_idea_team_member()` RLS function. `is_super_admin` separates destructive ops from general admin access.

**Production database:** Supabase project `irqbqxspxxzvuczhujzg`. Agents may run read-only queries through the Supabase MCP `execute_sql`; keep each request under about 5,000 characters (larger ones are rejected).

**Prove a migration on the real schema.** Postgres checks the table and column names inside a function body only when it runs, so a migration can apply cleanly and then fail on every call (00188 read a column `workflow_runs` doesn't have, 12 Oct 2026). Stand-in tables made by hand prove nothing about names: check every table and column the migration uses against the live `information_schema` (read-only), and say in your output that the real-schema run is still owed. The release session runs it as a DO block ending in `RAISE EXCEPTION`, so nothing persists, before applying.

### `database.ts` notes
Some table blocks in `database.ts` are indented one level less than the rest; search for `<table>: {` without assuming the indentation. (`board_checklist_items` also appears in migrations but was later dropped — it is correctly absent, don't re-add it.)


### Adding DB Tables
1. Migration in `supabase/migrations/`
2. Types in `src/types/database.ts` (include `Relationships`)
3. Export in `src/types/index.ts`
