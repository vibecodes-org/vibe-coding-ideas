# f0a13bde: in-browser sessions message each other

## Status
- 11 Nov 2026: Plan step written (Planner). Waiting for Nick's approval. Nothing built.
- Mock: `docs/session-messaging-mock.html` (also attached to the card).

## Binding decisions (Nick, 19 Sep 2026, card comment)
- A: messages send themselves. No "wait for Enter", not even as a setting.
- B: messages may pass through the relay readable in v1; the guide must say so.

## Decided in the plan (awaiting Nick's approval)
- Two stages. Stage 1: the whole pipe, with Claude sessions able to receive and any session able to send. Stage 2: Codex sessions able to receive (Codex's own queue command).
- Claude delivery without typing into a yes/no prompt: the bridge tracks Claude's state through hooks added at launch (`--settings`), and
  - Claude idle, nobody typing: type the message (bracketed paste, then Enter) and confirm it was accepted.
  - Claude busy, or the human has unsent text: hold it; at the end of Claude's turn the Stop hook hands it over ("block" + reason), so nothing is typed at all.
  - A permission prompt can only show mid-turn, so a message is never typed while one is open.
- Codex delivery (stage 2): `codex queue --thread <id> --message <text>` run by the bridge with an argument list (no shell). The bridge must first learn the Codex thread id (not tracked today): find the rollout file its own Codex process has open, fall back to the newest rollout in the same folder started after the spawn.
- Sender identity: the bridge puts the session id plus a proof (HMAC of the id with that session's own key) in the agent's environment. The server checks the proof against the database and stamps the sender's name and agent itself. For Claude, a PreToolUse hook fills it in automatically.
- Integrity: the app signs every message with the receiving session's own key; the bridge refuses anything unsigned, stale or replayed. So the relay can read messages (decision B) but cannot forge them.
- Loop guard: at most 10 messages a minute and 60 an hour into any one session, counted in the relay. Held messages expire after 30 minutes.
- Tab pill: a sky "message" pill on background tabs, cleared when the tab is opened.
- Teaching the agents: the two tool descriptions plus the marked first line on every message. Not added to the board server's standing instructions (every session pays for those words, and Codex doesn't treat them as standing instructions).

## Ruled out, and why
- Claude Code "channels" (local server pushing messages into a session): custom channels need `--dangerously-load-development-channels`, which shows a full-screen confirmation on every launch, and the feature is a research preview. Revisit if that prompt goes away.
- Typing blindly into Claude: Enter on an open permission prompt picks the highlighted option, so typed text could approve a command.
- Codex's `notify` setting to learn the thread id: Nick already uses it; a per-launch override would replace his.
- A separate local helper server per session for the tools: one more process and two launch-config paths for little gain in v1.
- Scrambling peer messages: declined by Nick (decision B).

## Facts checked (11 Nov 2026)
- `terminal_sessions` IS already in `src/types/database.ts` (the card's note is out of date).
- Live sessions have their per-session key on the row while active; the key is cleared when the session ends.
- Last 30 days: 235 Claude sessions, 17 Codex sessions.
- Codex on Nick's Mac: 0.163.0; `codex queue --thread <uuid-or-name> --message <text>` exists. Claude Code 2.1.322.
- Relay already stores each session's helper version (`bridgeHelperVersion`), so it can refuse too-old helpers honestly.
- Helper on master: 0.3.31.

## Spikes the builder must run first (stop and report if any fails)
1. Hooks passed with `--settings` fire alongside the user's own hooks (not replacing them).
2. Stop hook "block" with a reason makes Claude continue and the text is visible in the terminal.
3. Bracketed paste of a multi-line body, then Enter, arrives as one message at the idle prompt.
4. PreToolUse can fill a missing tool argument on a board tool call.
5. (Stage 2) Codex 0.163 `codex queue` reaches an open idle window, a busy one, and one showing an approval prompt without answering it.

## Build, stage 1 (11 Nov 2026, Atlas)
Branch `feat/f0a13bde-session-messaging`. Nick approved the plan with the recommended answers (two stages, the tab label, 10 a minute / 60 an hour / 30 minute hold).

### Spikes (run first, on Claude Code 2.1.322 in a scratch folder, through a real terminal)
1. PASS. Hooks passed with `--settings` fire, and a hook in the project's own settings still fires too (merged, not replaced).
2. PASS. A Stop hook answering `{"decision":"block","reason":...}` made Claude carry on and act on the reason; the terminal shows it as a "Stop hook error" line with the reason text. A second Stop (stop_hook_active true) with nothing new is not blocked.
3. PASS. Bracketed paste of a two-line body, then a separate Enter, arrived as ONE message; UserPromptSubmit fired once.
4. PASS (proxy). An http PreToolUse hook to 127.0.0.1 is allowed and `updatedInput` rewrote a tool call's input (tested on Bash; Claude noticed the rewrite and said so, for a board tool the rewrite is the intended behaviour). Not tested on a real board tool.
5. NOT RUN. The idle_prompt / permission_prompt notifications were not exercised. The design does not depend on them for safety (busy always holds); they only improve the idle detection. QA's live check A10 covers the permission prompt case.

### Decisions
- `list_my_sessions` and `send_session_message` register as agent-neutral tools (count 88 to 90; guide and the count test updated). Both accept an optional `from_session`; for Claude the PreToolUse hook fills it, for Codex the tool description tells the agent to read `VIBECODES_SESSION`.
- The hook matcher covers both tools (`^mcp__.+__(send_session_message|list_my_sessions)$`) so the list can mark which session is "you".
- The PreToolUse answer for those two tools is `permissionDecision: "allow"` (needed for `updatedInput`). Effect: the peer tools never ask the user for permission. Sending a message cannot approve anything on the receiving side, so this is judged acceptable; flagged for Nick.
- Draft tracking differs slightly from the plan: the "person has unsent text" flag is cleared only by a submitted prompt (UserPromptSubmit) or a lone Ctrl-C / Ctrl-U, not by Stop, because text typed during a busy turn is still in the box at Stop. Cost: a message can wait longer, never be mixed into text.
- A session with no hook event yet is "unknown" and treated as busy (held). It becomes idle at the first Stop or an idle_prompt notification. A freshly resumed, never-prompted session therefore holds messages until its first turn ends.
- Hook flags ride the existing per-launch flags (`launchFlags()` in the bridge) rather than `resolveClaudeLaunch`, so they apply to fresh, `--resume` and `--continue` launches alike and never to `--cmd`, with no change to the launch-command tests.
- The relay-safe pieces (constants, ack frame, notice frame, "browser may not send these" test, helper-version compare) are in `terminal/shared/peer-frames.mjs` (no node:crypto, because a Worker has none); signing and checking are in `terminal/shared/peer-message.mjs`.
- Helper version NOT bumped in this change (Nick/review: helper 0.3.32 ships without this code; messaging and the setup screen release together as 0.3.33). The relay minimum for peer messages is `PEER_MESSAGE_MIN_HELPER = "0.3.33"` in `peer-frames.mjs`: the release must ship exactly that version or higher: 0.3.33.
- `VIBECODES_SESSION=<sid>.<proof>` is put in the environment of every Claude and Codex launch that has a session key (not custom commands).

### Not built (by plan)
Codex receiving (stage 2).

### Rework round 1 (code review)
- Type check: the board server's standalone type check could not find types for the two shared `.mjs` files. Turned on `allowJs` (no `checkJs`) in `mcp-server/tsconfig.json`, matching the root tsconfig, so the two files get types inferred from the JS.
- Minimum helper version is 0.3.33 (was 0.3.32).
- The "waiting for you" notice (idle_prompt) now only turns unknown into idle; it never overrides busy, asking or typing.
- New "typing" phase: set the moment a message is chosen for typing; later messages wait. Enter is pressed only while the phase is still "typing" and there is no draft (was: anything but asking). Any hook event during the paste moves the phase on and cancels the Enter. If a message is pasted but not submitted, the phase goes back to unknown and the box counts as holding a draft, so nothing else is typed on top.
