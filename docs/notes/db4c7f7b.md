# db4c7f7b: board-named agent must never be silently swapped

## Cause
On 28 Oct a claim named `vc-planner-54dc8eca-frontier-high`; the session only had `vc-planner-54dc8eca-frontier`. Our text then said: sync -> if it can't be used, "spawn a general helper" with `get_agent_prompt as_persona`. The sync command (one large heredoc) was refused by the session's command-complexity guard, so every instruction the session followed led to a general-purpose agent, which then reported persona_used "verbatim" (a self-report nothing checked).
Text that offered the fallback: `sessionAgentClaimHint` (src/lib/terminal/session-agents.ts), every outcome in `INSTRUCTION` plus the error and too_large replies (mcp-server/src/tools/agent-sync.ts), the tool descriptions in register-tools.ts (sync_board_agents) and bots.ts (as_persona). Codex path left as is: Codex has no system-prompt field and puts the persona in the message by design.

## Decisions
- A: claim hint says first: same persona under another tier/effort suffix (name starts `vc-<slug>-<id8>`) counts as the named agent; pass model/effort explicitly; report "verbatim".
- B: no silent fallback; stop, tell the user, general helper only on explicit yes, then persona_used "adapted" + subagent_type "general-purpose". "No subagent tool at all -> inline" unchanged.
- C: shared `NO_LOAD_STEPS` in agent-sync.ts used by every unloaded outcome (NEW_FOLDER, MISMATCH, NOT_LOADED, foreground, refused/other failure, too_large, no persona).
- D: `subagent_type` (optional string) on complete_step and fail_step. Not a reject: a "verbatim" report with a type that is not `vc-<role>-<this step's bot id8>-…` is downgraded to "adapted" (persona_honored false). Less disruptive than rejecting: a finished step is never lost over a label, and the existing amber "Persona: adapted" badge in step-detail-dialog.tsx shows it. No migration: the type itself is not stored. Omitted subagent_type changes nothing (old callers keep working).
- E: DONE (coordinator asked for it in this PR). The sync reply now carries `script_path` (`~/.claude/vibecodes/agent-sync-<8 hex of the files' fingerprints>.sh`, same folder as the step-usage scripts) and `run_command` (`sh <path>`). The session saves the second block (the unchanged installer, with its sha256 check, folder rules and READY/NEW_FOLDER/MISMATCH/NOT_LOADED) to that path with its file-write tool, then runs the one short line in the background. A session with no file-write tool runs the block as one command, as before. Tests run the script under plain `sh`.

## Ruled out / notes
- The "general-purpose" label Nick saw is not rendered by our UI (no such string in src); it comes from the session's own agent display / transcript.
- Test pins changed deliberately: session-agents.test.ts (fallback wording, length budgets), workflows.test.ts (fallback wording; three hand-off size budgets +~400 chars), agent-sync.test.ts (general-purpose assertion replaced).
