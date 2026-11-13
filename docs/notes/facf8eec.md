# facf8eec: generated tasks sized as whole pieces of work, AI picks the count

Planning notes (Planner, 13 Nov 2026). Status: plan awaiting Nick's approval.
(Written in the planning worktree; the main checkout was not writable from this session.)

## What I checked
- New-board prompt: `src/actions/onboarding.ts` ~L314-353. Fixed "Create 15-20 tasks", "implementation steps as markdown task list" (twice: prompt and system). One `generateObject` call, `maxOutputTokens: 8000`, 90 s timeout, default effort, no continuation. Code backstop `slice(0, 50)`.
- "Generate tasks" button: the live path is `src/app/api/ai/generate-tasks/route.ts` (streaming, 32,000 output room, 270 s deadline, "Generate the rest"). It has NO count in the prompt and no code cap; the user's own prompt (default text in `src/components/board/ai-generate-dialog.tsx` L147) steers. Both system prompt variants (persona / default) ask for "- [ ]" checklists. Large ideas (>12,000 chars) get a nudge to split into many one-sentence tasks.
- `generateBoardTasks` in `src/actions/ai.ts` (~L478-590) has no callers anywhere in src/, e2e/ or mcp-server/: dead code that carries the same checklist prompt.
- Daily model check `src/lib/model-watch-checks.ts` ~L94: its own system line and "Generate 5 tasks for a recipe-sharing web app", 120 s timeout, shape-only validation.
- Guide: no page says "15-20". `src/app/guide/kanban-boards/page.tsx` ~L268 says "A single run returns up to 50 tasks — if you need more, run it again": already wrong (no 50 cap since the streaming route, and "Generate the rest" exists). `getting-started` L85 describes the Board Ready interstitial generically.
- Onboarding screen: "AI generated N tasks" + mini preview of titles (truncated). No wording depends on the count or on checklists. So no on-screen change is needed.
- Live usage (read-only, `ai_usage_log`, action generate_board_tasks): platform (onboarding) runs on Sonnet 5 / 5.5 use about 2,850-4,400 output tokens for 15-20 tasks (~200 per task). One June run hit the 8,000 cap. The app model is `claude-sonnet-5-5` (`AI_MODEL`).
- Earlier card 5df56c02 notes: on Nick's 50,000-character idea, Generate tasks produced 56-72 small tasks in one run. Relevant to the Generate-tasks limit.

## Basis
Anthropic, "Prompting Claude Opus 5.5" (platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5):
- Capabilities: "strongest on multistep work in a real repository, such as carrying a change through a large code base until its tests pass" and "sustains long-running autonomous work ... end to end ... with little oversight".
- Unattended agentic runs: keep the task's parts "in a checklist the model updates" and "state the completion condition up front". Read as: the agent keeps its own checklist; the card should state the done condition. That is why tasks get a "Done when" and lose the prescribed checklist.
- The guide does not discuss task counts. The case for no fixed count is the capability above plus our own data, not a quote.

## Decisions (proposed, Nick to confirm)
1. Limit, new board: AI chooses, at most 12. Prompt says it; code trims to 12 as a backstop (with a warning log).
2. Limit, Generate tasks: AI chooses, at most 30 per run, unless the person's own request names a number. No code trim (keeps "Generate the rest" behaviour). Alternative kept open: a "reached the limit" message on the amber bar = on-screen change, would need a mock, so not in stage 1.
3. Description shape: 1-2 sentences on what it delivers and why, then "Done when:" with plain "- " bullets of observable results. No "- [ ]" lists, no how-to steps.
4. No on-screen change. Default prompt text in the Generate tasks box stays as is (option for Nick to reword later).
5. Overlap: fold b53e5203 (faster generation, 8-10 tasks, shorter checklists, lower effort) into this card: same prompt, same count. Keep effort unchanged in stage 1; decide after the before/after samples. 34c59f67 (background generation) and 9d65f875 (better input, show its work) go after this one; 9d65f875 stage 2 talks about showing the card's "checklist" and must be reworded to "what done means" once this ships.
6. Delete the dead `generateBoardTasks` rather than edit its prompt.

## Ruled out
- Knowledge-work article as basis (Nick, 13 Nov).
- Schema-level max on the task array: Anthropic structured output does not support maxItems (comment in ai.ts).
- Lower effort in this change without measurement (guide: test effort levels on your own evals).
- Paid sample runs without Nick's OK; free proxy via the Claude Code subscription instead.

## Where things are
- Shared prompt text goes in `src/lib/generate-tasks-stream.ts` (pure, already shared with the model check).


## Decisions (Nick, 13 Nov 2026) - these override the proposed decisions above
- No task count or limit is given to the AI on either path. The "never more than N" sentence is gone from the shared guidance (`TASK_SIZING_GUIDANCE`).
- New board: hidden code cap `NEW_BOARD_MAX_TASKS = 100` (keeps the first 100, `logger.warn`). Generate tasks: no cap.
- Generate tasks window: box starts empty with a faint optional hint; empty box works end to end (the route treats `prompt` as optional extra guidance; the dialog's Generate button is no longer disabled when empty). Agent dropdown and the route's persona variant removed; `buildPromptContextParts` lost its agent parts. The route ignores any persona fields still sent.
- Daily model check: system = `NEW_BOARD_SYSTEM_PROMPT`, prompt has no number, passes on valid shape with 1 to 100 tasks.
- Guide: kanban-boards page describes the new behaviour (no "up to 50"); ai-agent-teams page no longer says AI Generate takes a persona.
- Dead `generateBoardTasks` deleted from `src/actions/ai.ts`. Unused `bots`/`userBotProfiles` props removed from the dialog, toolbar and kanban-board pass-through.
- Large-idea nudge rewritten to the two-part description form, still no count.

## A7 before-and-after (via `claude -p --model sonnet`, subscription only, invented projects)
Old = prompts on master; new = this branch. Same project text and allowed columns/labels, JSON requested.

| Project | Old tasks | Old with "- [ ]" | Old with "Done when" | New tasks | New with "- [ ]" | New with "Done when" |
|---|---|---|---|---|---|---|
| One word ("Plantpal": "plants") | 20 | 20 | 0 | 9 | 0 | 9 |
| One paragraph ("Bookshelf Swap") | 19 | 19 | 0 | 9 | 0 | 9 |
| Long spec ("Fleet Tracker", ~14,000 chars) | 19 | 19 | 0 | 15 | 0 | 15 |

- Every new list starts with the setup task and then has real features (e.g. "People can sign up and log in", "Users can message each other to arrange a swap").
- One-word project got 9 tasks (not 1-2). Tasks read as whole capabilities, not too broad. New output was shorter (5.1k vs 7.3k characters on the one-word project).
- Observation: new lists also include a design task and a launch/deploy task; fine. Long spec ran on the shared guidance only (the large-idea nudge lives in the route and was not part of this comparison).
