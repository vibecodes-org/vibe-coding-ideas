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

## Rework round 1 (28 Oct)
- Rule A now needs the claim's persona hash: the same-bot alternative counts only if its tag starts `[vc <hash> `; out-of-date copies and `[vc skills-names-only` don't. It reports the alternative's name as subagent_type.
- The sync clause is "If none is offered with that tag", so a stale synced copy still re-syncs; an unmarked launch copy that is out of date stops with "Agent X was changed after this session started. Restart or Resume the session to load the current version."
- D tightened: the downgrade to "adapted" and the subagent_type requirement apply only when the claim named a native subagent, recomputed at complete/fail (`claimNamedNativeSubagent`: Claude, assigned bot with persona text, no model switch). subagent_type is REQUIRED with "verbatim" in that case (rejected before any write, error says what to pass). No persona text, unassigned step, model switch: no requirement, no downgrade.
- Codex is EXEMPT, explicitly: it has no board-native agents, so its persona path (persona in the child's message / optional role file) is not a swap. Comments in session-agents.ts and claimNamedNativeSubagent say so; behaviour unchanged.
- Too large or names-only is a VibeCodes fault (Nick: live agents are ~5k chars, skills ~1.3k, far under the 90k/40k limits). The session is told to stop and ask the user to report it; warn-level logs at the source (namesOnly branch in session-agents.ts, too_large in agent-sync.ts). namesOnlyTag comment updated.
- E additions: an existing script_path is the same script (run, don't overwrite/read); `fallback_script_path` (`.claude/vibecodes/agent-sync-<id>.sh`, a folder Claude Code doesn't watch, not git-ignored, delete after the run) if writing under ~ is refused.
- Model-switch case of "claim named no native" is recomputed from live availability at completion; it is not covered by a unit test (needs the full claim fixture).
