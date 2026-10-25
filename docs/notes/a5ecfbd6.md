# a5ecfbd6 - changing one step's role by hand keeps the old agent

Cause: `updateWorkflowStep` (src/actions/workflow.ts) and MCP `updateStep` (mcp-server/src/tools/workflows.ts) wrote the new `agent_role` only. `bot_id` and `match_tier` stayed, so the old agent stayed; a stored "exact" tier also outranks an equal-tier rematch. Whole-template edits were fixed in 52c1f2e9; these single-step paths were missed.

Fix: when `agent_role` is supplied, read the current role; if `!sameRole(old, new)`, clear `bot_id` + `match_tier` in the same update (even a "manual" pick), then rematch that task (`rematchWorkflowAgentsWithClient` / `rematchWorkflowAgents`, which use `decideStepRematch`). Unchanged role: nothing touched. App path: an explicit `bot_id` in the same edit is kept (no clear, no rematch). Rematch failure is logged (logger.warn) and does not fail the edit.

Ruled out: assigning the exact-role agent directly (rematch already does it and handles AI/fuzzy tiers). Rematch covers the whole task but only fills empty/weaker steps.
Not changed: UI role-edit dialog; no stored-data migration (existing wrong agents on pending steps are fixed by a rematch).
Tests: workflows.test.ts "updateStep - role change ..." (MCP), workflow.test.ts "updateWorkflowStep - role change" (app).
