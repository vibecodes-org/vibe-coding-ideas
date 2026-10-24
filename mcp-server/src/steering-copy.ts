/**
 * Single source for the MCP usage-steering copy (docs/mcp-usage-steering-design.html
 * §3): board data is live and can change underneath a session, so every
 * surface an agent encounters repeats the same rule — call the tool again for
 * current state; never re-read a stale transcript response or script-parse
 * tool output. Both transports and register-tools.ts import these constants
 * so the wording can't drift between them (§3, single-source pattern also
 * used by buildCompactStepPieces for the launch prompt).
 *
 * Scope note: the launch-prompt directive (design doc Surface D) and the
 * CLAUDE.md workflow-rules line are OUT of scope for this module — Nick's
 * Design Review approval note confined steering to the MCP server so it
 * protects any connected Claude Code session, not just VibeCodes-launched
 * ones.
 */

/**
 * The "soft landing" (task 5e654dd1): when a session summarises its own
 * conversation (auto-compact) in the middle of a workflow step, these rules
 * tell the summariser what must survive word for word and what to do first
 * afterwards. Part of SERVER_INSTRUCTIONS, so every connected session carries
 * it and it survives each summary. Keep it short: Claude Code cuts server
 * instructions at 4,096 characters in total.
 */
export const COMPACTION_RULES =
  "When your conversation is summarised to free up memory, keep these word for word: the card id and step id you are working on, the ct_ claim token and the wt_ work token, any subagents still running, and any decisions made in chat that are not yet on the board. Straight after a summary, call get_task for the card before doing anything else. If the claim token was lost, call claim_next_step to re-claim the same step only when no subagent is still working on it: a re-claim issues new tokens and the running subagent's work token stops working.";

/** Surface A — sent as the MCP server's `instructions` on both transports at construction. */
export const SERVER_INSTRUCTIONS =
  "VibeCodes board data is live and shared: humans and other agents change it while your session runs. Every board tool response is a snapshot stamped with generated_at — treat it as already aging. Before acting on board state (choosing, moving, or completing anything), call the tool again for current state. Never re-read an earlier response from your transcript, never save responses to files for later, and never write scripts to parse tool output — present it directly. Tool calls are cheap; stale reads cause double-claimed tasks and lost work. " +
  COMPACTION_RULES;

/** Surface B — appended to the descriptions of get_board, get_task, and get_my_tasks only. */
export const LIVE_DATA_SENTENCE =
  "Live shared data: call this tool again for current state before acting on it — never re-read an earlier response, save it for later, or script-parse this output; present it directly.";

/** Surface C — stamped as `_reminder` (last key) by jsonResult(data, { live: true }). Must stay ≤200 chars. */
export const RESPONSE_REMINDER =
  "Snapshot from generated_at; the board changes live. Call the tool again for current state — never re-read this from your transcript or script-parse it.";
