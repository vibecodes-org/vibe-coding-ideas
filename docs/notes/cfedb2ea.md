# cfedb2ea: New Task dialog, show and choose the card's workflow before Create

## Plain-English summary (for Nick)

The New Task box gets one new dropdown, **Workflow**, under Labels. It looks and works like the Assignee dropdown.

- Left alone it says **"Automatic: <name>"**: the workflow your labels will attach. It changes as you tick labels. With no matching label it says "Automatic: none".
- You can pick any workflow yourself for this one card, or **"None: no steps"** for a plain note card.
- Under it, a small grey line says where the choice came from, e.g. "From the Bug label".
- Nothing else on the board changes. A card made with agents' tools works exactly as today.

Decisions for you (recommendation first):

1. **Grey explanation line under the dropdown.** Assignee and Labels don't have one. Recommend: keep it, because "Automatic: Bug Fix" alone doesn't say why.
2. **When the preview names a workflow, should Create just attach it?** Today, if a label's workflow looks like a poor fit for the card's title, the app sometimes holds it back as a "suggestion" instead of attaching it (in the last 90 days, 17 cards on this board were held back like this, counting cards made by agents too; 7 are still waiting). Recommend **yes, attach what the box shows**: pressing Create with the preview on screen is you confirming it, so what you see is what you get. The alternative keeps that check, but then the box can occasionally promise a workflow the card doesn't get. Note: this one case is the only way "Automatic" differs from today.
3. **Two labels that both have workflows.** Today the label you ticked first wins. Recommend keeping that and saying so in the grey line ("Bug and Feature both have workflows. Bug was picked first, so it wins.").
4. **Your own pick (or None) applies to this card only.** Labels are still added but don't change its workflow at creation. Recommend yes. (Adding another workflow label to the card later can still swap it, the same as using the card's Apply Workflow button today.)
5. **Fix a small bug found on the way:** choosing "Unassigned" by hand in the New Task box probably makes Create fail (found by reading the code, not tried live). Recommend fixing it in the same change; it is one line.

## Where things are

- Mock: docs/new-task-workflow-field-design.html (attached to the card as new-task-workflow-field-design.html). Checked at 375px: no sideways scroll.
- Dialog: src/components/board/task-edit-dialog.tsx (used only from board-column.tsx).
- Assignee control to copy: src/components/board/assignee-select.tsx (Radix Select, h-9, no help line).
- Auto-attach today: src/actions/board.ts `addLabelsToTask` -> src/lib/workflow-helpers.ts `checkAndApplyAutoRules` -> `applyOrSuggest` -> src/lib/workflow-matching.ts `decideAutoRuleApplication` / `detectMismatch` (server-only module: imports `ai`).
- Manual apply: src/actions/workflow-templates.ts `applyWorkflowTemplate` (throws if a run is active; no fit check).
- Agent tool path: mcp-server/src/tools/board-write.ts `createTask` (same per-label loop). Not changed.
- No database trigger attaches workflows (live check: only set_board_tasks_updated_at on board_tasks; old trigger dropped in 00083).
- Rules are label -> template only (workflow_auto_rules: id, idea_id, label_id, template_id, created_at).

## Decided

- Control: Radix `Select` like Assignee (Radix Select is safe in this modal; Popover/Checkbox are not, React #185).
- Options: "Automatic: X" / "Automatic: none", "None: no steps", separator, group "Workflows" with each template and its step count.
- Hidden when the board has no templates (mirrors Labels hidden with no labels).
- Loads templates + rules when the dialog opens; on failure it falls back to Automatic with no preview text, and Create still works (never stuck on "Loading...", cf. card b9f0835c).
- Board card after Create uses existing pills ("Wiring workflow…", progress, "No workflow"). No new badge.
- Preview and server use one shared pure function so they cannot disagree.

## Ruled out

- Editing steps in the dialog (out of scope per card).
- Ordering by on-screen label order (would change today's result).
- Importing `detectMismatch` into the browser (its module pulls server-only AI code).
- Column-based rules (none exist).

## Open

Decisions 1-5 above, awaiting Nick at the Plan approval.

## Build notes (12 Nov 2026)

Nick approved all five decisions as recommended.

- Shared matcher: src/lib/auto-rule-pick.ts (used by the dialog preview and by the server attach).
- New server actions in src/actions/workflow-templates.ts: getNewTaskWorkflowOptions, applyNewTaskWorkflow. addLabelsToTask got an optional skipAutoRules.
- Field is hidden until options load (not "Automatic" with no name as the plan said for loading): simpler, and the same as the load-failed case, which falls back to today's calls. Create pressed before load finishes behaves as today.
- Explicit "Unassigned" fix: the picker's value "unassigned" is now mapped to no assignee before createBoardTask.
- Unassigned bug NOT reproduced live: no Docker/local database in this environment, so only a unit test covers it (the old code passed the word "unassigned" as the assignee id).
- No Playwright spec added: the e2e suite needs a live database and login which this environment lacks. Dialog behaviour is covered by unit tests.
- Guide pages updated: workflows, kanban-boards, getting-started.

## Review round 1 fix (12 Nov 2026)

- Workflows are tied to one board through workflow_templates.idea_id (never null). Every caller (card button, auto-rules, suggestions, New Task dialog) uses a template of the card's own board, so the ownership check sits in applyWorkflowTemplateWithContext: it refuses when template.idea_id differs from the card's board. This also closes the gap in the card's Apply Workflow button.
- applyNewTaskWorkflow now looks up the card's real board, refuses if it differs from the board id sent, and reads label rules for the real board.
- Tests: both refusals added; the effort test fixture got an idea_id.
- addLabelsToTask still takes a browser board id for auto-rules, but any template from another board is now refused by the core check, so no cross-board attach is possible.
