---
paths:
  - "mcp-server/**"
  - "src/app/api/mcp/**"
  - "src/lib/workflow-*"
  - "src/actions/workflow*"
  - "src/actions/collaborators*"
  - "src/actions/discussions*"
  - "src/components/board/*workflow*"
  - "src/lib/terminal/session-agent-files.ts"
---

# Area rules: workflows, concurrency, identity and the MCP server (moved from CLAUDE.md)

### Concurrency Guards
- All workflow step mutations use `.eq("status", expected)` + `.maybeSingle()` — prevents concurrent claims/double-completions
- Same pattern used for collaboration requests (`.eq("status", "pending")`) and discussion conversion
- Shared `checkAndCompleteRun()` helper in `src/lib/workflow-helpers.ts`

### Identity Enforcement
- MCP `complete_step`/`fail_step` verify the step's `claim_token`; completion is attributed to `step.bot_id` regardless of the caller's connection identity
- Agent-voiced comments require the step's live `work_token`; rejected tokens log a structured warn (the attribution-anomaly signal)
- `approve_step`/rejection of `awaiting_approval` steps are human-gated (no claim token needed; bot identities blocked)
- Steps with `bot_id = null` are not affected

### Workflow Orchestration
- Claude Code orchestrates: `claim_next_step` → spawn persona subagent (hand it the `work_token`) → execute (the helper saves its full write-up with `save_step_output` and hands back a summary of at most 2,000 characters) → `complete_step` with `claim_token` and no `output` (the saved write-up wins over any pasted text; with nothing saved it refuses unless `output` is passed) → loop
- `claim_next_step` returns `claim_token` (single-use, completion), `work_token` (multi-use: agent-voiced comments and `save_step_output`), `bot_id`, `available_agents` (only when no bot is assigned), `prior_steps` (earlier steps' ids, titles and sizes; read their write-ups with `get_task` + `step_ids`), `rework_instructions` (`{ scope: this_step | earlier_step, feedback, earlier_rounds }`: the newest round once, from failure/changes_requested comments only)
- Comments posted with `work_token` are authored as the step's agent; without it, as the human; invalid/retired tokens are rejected with an actionable error
- Real subagents outside VibeCodes-launched sessions (own terminal, cloud): `claim_next_step` tells the session to call `sync_board_agents` (`idea_id`, `step_id`) when the named `vc-…` subagent isn't offered. The reply carries `script_path` + `run_command` (`sh <path>`) and, as its second block, a self-checking installer script with the files of the claimed step's agent AND the rest of its run (claimed first, then step order, deduped, persona only, ≤ 60,000 bytes in all) inside it (sha256 fingerprints; no network, so any cloud network level works, and stdio works too). The session saves the script with its file-write tool (a long multi-line command is often refused by a command-safety check; with no write tool it runs the block directly), runs the one short line with `run_in_background` and ends its turn. Claude Code's watcher polls (every 30 s once the session is idle) and can lose a file written just before it switches rate, so the command doesn't sleep: it sets each file's atime to 2000 and waits until Claude Code has read every file, re-touching once if none is read after 5 s, then prints READY (or NOT_LOADED after ~75 s; without atime support a fixed 38 s wait). After READY every listed agent is loaded for the session even if the Agent tool's listing still shows an older tag (listing deltas are keyed by name), so later steps spawn natively with no further sync (card 0b5656a5). It writes to `.claude/agents/` if that exists, else `~/.claude/agents/`; if neither existed at session start it creates `.claude/agents/` + `.gitignore` (`vc-*.md`) and the user-level folder (so every later session on that machine, any repo, is covered with no setup) and reports NEW_FOLDER — Claude Code never loads a folder created mid-session, so that step uses the general path and the `.gitignore` is committed. Synced files start their description with "Saved by sync_board_agents."; an offered agent with a stale tag and that marker is re-synced, one without it is a `--agents` launch copy: the session stops and says to Restart or Resume. The board-named agent is never optional (card db4c7f7b): the same bot id under another tier/effort name counts only if its tag starts with the claim's `[vc <hash> `; otherwise the session stops, tells the user, and uses a general helper only on their explicit yes (recorded `adapted`). `complete_step`/`fail_step` take `subagent_type`, required with `persona_used: "verbatim"` when the claim named a native subagent; a type that isn't `vc-<role>-<that bot id8>-…` is recorded `adapted`. Codex has no board-native agents and is exempt. Too-large or names-only agents are VibeCodes faults (logged at warn), never a reason for a stand-in. Code: `src/lib/terminal/session-agent-files.ts`, `mcp-server/src/tools/agent-sync.ts`. Only `.claude/agents/.gitignore` is committed — never agent prompts.
- Step cost (card ba37039b): a Claude claim returns `usage_command` (with a random `vcu_` marker); when the step's work is done the session runs it (AGENT_ID → the subagents' agentIds, or unchanged if it did the work itself) and passes the JSON it prints as `usage` to `complete_step`/`fail_step`, stored per attempt in `workflow_step_usage` (best effort, never blocks). A step's cost = the session's own calls after the claim (found by the marker) up to its own usage run, each split equally across the steps open at that moment (stage 16 of 5e654dd1: steps run side by side), + its subagents' (in full) (input/cache exact; output estimated from text length, because Claude Code saves output counts before a call finishes). Past runs: `node scripts/step-usage-backfill.mjs` (same rules, claim and completion paired by claim token; keep it in step with the awk) writes a file for Admin → Reports → Import past cost. Priced at read time by `src/lib/step-cost/pricing.ts` — update that table when model prices change.
- `human_check_required` routes to `awaiting_approval` instead of `completed`
- `fail_step` with `reset_to_step_id` enables cascade rejection back to any earlier step
- Completion is attributed to the step's `bot_id` via the claim token; both token hashes are cleared together on complete/fail/reset/approve

## MCP Server

Two modes sharing one tool set, registered in `mcp-server/src/register-tools.ts` (implementations in `mcp-server/src/tools/`). The exact tool count is pinned by `register-tools.test.ts` — update it there when adding or removing a tool.

Usage steering (shipped Aug 2026, task b3b9be67): `mcp-server/src/steering-copy.ts` single-sources the "board data is live — call the tool again, never re-parse earlier output" copy; both transports pass it as the MCP server-level `instructions`, the three board read tools (`get_board`/`get_task`/`get_my_tasks`) carry it in their descriptions, and their responses are stamped via `jsonResult(data, { live: true })` with `generated_at` (first key) + `_reminder` (last key). Tool calls are logged to `mcp_tool_log` with `session_id` (migration 00160; admin queries documented in the migration comments).
- **Local (stdio)**: `mcp-server/src/index.ts` — service-role client, bypasses RLS
- **Remote (HTTP)**: `src/app/api/mcp/[[...transport]]/route.ts` — OAuth 2.1 + PKCE, per-user RLS

Identity: completion attribution flows from the `claim_token`, comment voice from the `work_token` (both minted by `claim_next_step`); `set_agent_identity` is a deprecation-error stub (Phase B removes it — see task ec2bde45). `ctx.userId` = the authenticated human (stdio: the configured `VIBECODES_BOT_ID`), `ctx.ownerUserId` = real human. Must exclude MCP/OAuth paths from Next.js middleware.
