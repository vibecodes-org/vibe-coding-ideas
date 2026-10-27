-- Let board members read their own boards' step cost rows (card 5e654dd1,
-- stage 13). 00196 made workflow_step_usage readable by admins only, which
-- left the read-only get_cost_report MCP tool returning nothing (shown as
-- "cost missing") for a normal user on the remote server, where the tool runs
-- under that user's row-level security.
--
-- Same membership rule as the board tables: is_idea_team_member() on the
-- row's idea. The admin policy stays; this adds read access only. There is no
-- insert/update/delete change: the existing "Team members can record step
-- usage" insert policy is untouched and nobody gains write access.
--
-- Tables/columns/functions used (all exist in 00196 / earlier):
--   workflow_step_usage.idea_id, is_idea_team_member(uuid, uuid), auth.uid().

CREATE POLICY "Team members can read their boards' step usage"
  ON workflow_step_usage FOR SELECT
  USING (is_idea_team_member(idea_id, auth.uid()));

COMMENT ON TABLE workflow_step_usage IS
  'Token use per workflow step attempt and model, self-reported by the orchestrating session from its subagent transcript (card ba37039b). Priced at read time by src/lib/step-cost/pricing.ts. Readable by admins and by members of the row''s board; written only by board members via complete_step / fail_step.';
