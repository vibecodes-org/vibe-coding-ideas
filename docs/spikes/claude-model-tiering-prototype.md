# Prototype — Claude Code orchestrator/subagent model tiering

**Status:** SPIKE PROTOTYPE (not production). Sketch to make the mechanism concrete
and reviewable. See the Step 2 research findings for the honest assessment of
whether the saving accrues to VibeCodes at all (spoiler: today it accrues to the
*user*, because the launched Claude Code runs on the user's own auth).

Spike card: Technical Spike — Claude Code model tiering. Author: full-stack persona, Step 2.

---

## What this prototype demonstrates

The tiering pattern that Claude Code actually supports:

- **Orchestrator (main loop)** stays on ONE model for the whole session (keeps the
  prompt cache warm — switching the main-loop model mid-session invalidates it).
- **Implementation is delegated to subagents** whose definitions carry a
  `model:` frontmatter field, so the heavy generation/exploration tokens land on a
  cheaper model (Sonnet) while the orchestrator reasons/reviews on the pricier one.

Two independent levers, set independently:

| Lever | Sets | Where |
| --- | --- | --- |
| Session model selection (`/model`, settings `model`, launch flag) | orchestrator (main loop) | user's global/session config |
| `.claude/agents/*.md` `model:` frontmatter + per-spawn Task `model` override | subagents | project `.claude/` dir OR in-prompt instruction |

---

## The three artefacts VibeCodes *could* preload

> IMPORTANT: The launched Claude Code runs in the **user's own project directory**
> (their clone / a fresh `~/projects/<slug>`), NOT the VibeCodes repo. VibeCodes
> has no direct filesystem write to that dir. The ONLY channel VibeCodes controls
> at launch is the **bootstrap prompt** carried in the deep link
> (`claude-cli://open?q=…` or `vibecodes://launch?…&prompt=…`). So "preload" here
> means: the bootstrap prompt instructs the agent to (a) delegate to a Sonnet
> subagent this session, and (b) optionally write the subagent definition + a
> CLAUDE.md profile note so future sessions inherit it. Files only take effect on
> the NEXT session; the in-prompt instruction is what tiers the CURRENT one.

### 1. Subagent definition — `.claude/agents/vibecodes-implementer.md`

The agent writes this into the project on first launch (same channel it already
uses to write `CLAUDE.md` and `.vibecodes/`). Read by Claude Code at session start.

```markdown
---
name: vibecodes-implementer
description: >-
  Implements a frozen, well-specified coding task — writes and edits code, runs
  the build/tests, and reports back. Delegate mechanical implementation here to
  keep the orchestrator's context small and cheap. NOT for architecture,
  ambiguous scope, or board/workflow decisions — those stay with the orchestrator.
model: sonnet
---

You implement a single, already-specified task. The orchestrator has frozen the
spec — do not redesign it. Steps:
1. Read only the files named in the spec (plus their direct imports).
2. Make the change. Match existing patterns, naming, and file structure.
3. Run `npm run lint` and `npx tsc --noEmit`; run the relevant tests.
4. Report: files changed, test results, and anything the spec got wrong.
Never touch the VibeCodes board (no MCP `move_task`/`complete_step`) — the
orchestrator owns board state and identity.
```

### 2. Orchestrator profile note — appended to the project `CLAUDE.md`

Written by the agent alongside the subagent def. Instructs the main loop to
delegate. (This is the soft, prompt-level equivalent of the
`Rylaa/fable5-orchestrator` profile — we do NOT need the full plugin.)

```markdown
## Model tiering (cost)

Stay on your launched model as the orchestrator. Delegate mechanical
implementation to the `vibecodes-implementer` subagent (runs on Sonnet) via the
Task tool. Keep architecture, spec-writing, board/workflow orchestration, and
review on the orchestrator. Freeze the spec before delegating so the subagent
does not have to explore. Batch independent sub-tasks into parallel Task calls.
```

### 3. In-prompt instruction — appended to the launch bootstrap prompt

This is the ONLY part that tiers the CURRENT session. It would be a new terse
clause in the compact bootstrap builder
(`src/lib/launch-claude-code.ts` → `buildCompactBootstrapPromptParts`). Sketch of
the clause (kept short — the compact prompt has a hard URL budget):

```
Delegate implementation to a Sonnet subagent (Task tool, model: "sonnet"); keep
planning, review and board ops on your main model.
```

Production note: this clause costs ~120 encoded chars against the
`MAX_DEEP_LINK_URL_LENGTH` (1900) / vibecodes:// budget. It is trimmable tail, so
it must sit AFTER the load-bearing MCP-connect + `record_project_path` steps, or
be dropped first under truncation. Do not put it in the protected head.

---

## What is a sketch vs what is production-ready

| Element | State |
| --- | --- |
| `.claude/agents/vibecodes-implementer.md` content | Sketch — needs iteration on when delegation actually helps vs adds latency |
| CLAUDE.md profile note | Sketch — wording only |
| Bootstrap-prompt clause | Sketch — real change is ~5 lines in `buildCompactBootstrapPromptParts`; needs a URL-budget test |
| Per-spawn Task `model` override | Real Claude Code feature, no VibeCodes code needed |
| Any settings.json / SessionStart hook injection | NOT possible — VibeCodes never writes to the user's machine; see findings |

---

## Honest caveats

1. **VibeCodes cannot force the model.** No `--model` flag, `ANTHROPIC_MODEL` env,
   or settings.json is injected by the launcher (verified — see findings). Every
   artefact above is advisory; the user's own config/CLAUDE.md/`/model` wins.
2. **The saving is the user's, not VibeCodes'.** The launched Claude Code bills to
   the user's Claude subscription or their own API key on their machine. VibeCodes
   pays nothing for these tokens today, so tiering them saves the user money and
   is a UX/goodwill feature, not a VibeCodes COGS reduction.
3. **Where tiering WOULD save VibeCodes money** is the separate in-app AI SDK path
   (`resolveAiProvider` / platform credits / BYOK) — a different surface that this
   prototype does not touch.
4. **A Fable orchestrator is not the cost-optimal orchestrator.** Because Fable is
   ~2× Opus per token, an Opus-orchestrator + Sonnet-subagents split is cheaper
   than Fable-orchestrator + Sonnet-subagents (see cost table). Keep Fable on the
   orchestrator only if orchestration quality demonstrably needs the frontier model.
```
