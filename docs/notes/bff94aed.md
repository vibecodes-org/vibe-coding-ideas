# bff94aed — template edits reach cards already running

Card: "Handle structural mismatches in template propagation gracefully" (task bff94aed-4e31-49b4-8f2f-f388e7f93c9e), created 23 Mar 2026. Workflow "Feature Development": Plan (Planner) → Build → Code review → Test and release summary.
Plan step: 12 Nov 2026. Branch `plan-template-propagation-bff94aed` (local only).
User-facing change: YES (save message wording, guide paragraph, agent tool reply). Mock: `docs/template-propagation-mismatch-design.html`.

## What already exists (checked in code, 12 Nov)
- `propagateTemplateEdits` (src/lib/workflow-helpers.ts) runs after every template step edit (app action `updateWorkflowTemplate`, MCP `update_workflow_template`) and from `resync_workflow_template` (app + MCP). It only looks at runs whose status is not completed/failed.
- Same step count: every **pending** step is rewritten **by position** (title, description, role, approval, deliverables, tier, effort); agent cleared if the role changed. Guarded by `status = 'pending'` on each update.
- Different step count: if NOTHING has happened on the run (all pending, no claim, token, output or comment), `replace_unstarted_workflow_run` (migrations 00188, 00200) swaps the steps in one transaction. That half of the card's March ask was done by card 472d5672.
- Different step count and the run has started (or has a comment): skipped and counted in `skippedStructuralMismatch`. Nothing is shown to the user; the app's save just says "Template updated". This is what's still open.
- Hidden bug in the same-count path: matching by position means a reorder rewrites a waiting step into a step that's already done (A,B,C → B,A,C with A done turns waiting B into a second A). Live check: 0 running cards affected today.
- Every propagation rewrites every waiting step even when nothing changed (wasted writes over up to 223 runs per template).

## Live numbers (read-only, prod, 12 Nov)
- Open runs: ~1,430; 0 cards have more than one open run.
- Stranded today (step count differs from template, run started, card not archived): **45 runs**; 41 more on archived cards. Mostly old cards started before the October template rewrite (latest activity late Sept / one on 31 Oct).
- 15 never-started, not-archived runs also mismatch: skipped because a step has a comment.
- Of the 129 waiting steps on the 45+15 mismatched runs, only 48 have a title that is still in the template → a blanket catch-up would reshape them a lot. So no automatic catch-up.
- Worst case 223 open runs per template (83 not archived). Archived cards hold ~515 open runs.
- No uniqueness on (run_id, step_order); `workflow_live_run_id(p_task_id)` exists; triggers recompute card counters on insert/update/delete.

## Decisions (recommendations; Nick decides)
- A. New template step placed before work the card has already done: **don't add** to that card. Alt: add as next to run.
- B. Template step removed: **delete from the card if untouched** (no comment, no output, never claimed); keep and report otherwise. Alt: mark skipped.
- C. Archived cards: **skip** them. Alt: keep updating.
- D. Save message: **short report** (mock §2). Alt: unchanged UI.
- E. The 45 stranded cards: **no automatic catch-up**; add a preview (dry run) to resync so an agent can show the effect first.

## Design
Locked steps = any status other than pending (in_progress, awaiting_approval, completed, failed, skipped). Never changed, moved, renumbered or deleted.
Frontier F = highest step_order among locked steps (0 if none). "Tail" = pending steps with step_order > F. Pending steps before F (rare) get content updates only, never moved/deleted.

Matching (pure function, run steps ↔ template steps):
1. Title: normalised (trim, lowercase, collapse spaces); k-th duplicate pairs with k-th duplicate.
2. Within each gap between title-matched anchors: if both sides have the same number of unmatched steps, pair them in order (renames); otherwise pair only unique same-role pairs; rest unmatched.
K = highest template index matched to a locked step.
New tail, in template order = matched tail steps (any template index) + new steps for unmatched template steps with index > K. Unmatched tail steps: delete if untouched, else keep right after the step that preceded them. Tail renumbered from F+1.

Ruled out:
- Hidden ids on template steps copied to card steps (exact matching). Cleaner long-term, but needs a migration + backfill and old cards have no id anyway, so title matching is needed regardless.
- Matching purely by position (the card's own fallback, unsafe for reorder).
- Doing the matching inside SQL (hard to test). Plan computes in TypeScript, applies in one database function that re-checks under lock.

## Where things are
- `src/lib/workflow-helpers.ts` `propagateTemplateEdits` (~line 491) + tests `src/lib/workflow-helpers.test.ts` (~637, ~1309).
- `src/actions/workflow-templates.ts` `updateWorkflowTemplate` (~215), `resyncWorkflowTemplate` (~562).
- `mcp-server/src/tools/workflows.ts` update (~569), resync (~595); descriptions in `mcp-server/src/register-tools.ts` (~1403, ~1434).
- UI save messages: `src/components/board/workflows-tab.tsx` (~1003), `src/components/board/template-step-dialog.tsx` (~100).
- Guide: `src/app/guide/workflows/page.tsx` (~686) and check `src/app/guide/mcp-integration/page.tsx`.
- Live-run rule: `src/lib/workflow-current-run.ts`; SQL twin `workflow_live_run_id`.

## Build notes (stage 1)

Decisions A to E went in at the recommended answers (Nick: "3- yes").

- Migration number is 00212 (latest on master was 00211). It adds one database function, `reshape_workflow_run`, that applies a card's deletes, updates and inserts in one go and refuses (returns `changed`) if the card moved on since it was read. The real-schema run and the production apply are still owed and need Nick's approval. Column names were checked against the live schema read-only.
- Deviation from the plan: when a gap between matched steps holds the same number of old and new steps, the plan paired them in order as renames. That contradicted acceptance check 1 (a removed step plus a new step of a different kind must be a delete plus an add). Pairing now also requires the roles to match.
- Steps whose titles match but cross over (a reorder) are matched by title using the longest in-order run, then a leftover pass, so a reorder is not read as delete plus add.
- A card that has not started at all and has a different step count still uses the existing whole-swap function; if it refuses, the careful path runs.
- `updateWorkflowTemplate` now returns the template plus a `propagation` report so the screen can show the right toast.
- Toasts use the sonner toast with the wording from the mock (section 2): green and short when all went through; amber and persistent for kept steps or cards changed while saving. They have no screenshot comparison with the mock.
- Admin library templates (the template editor dialog) have no propagation and are unchanged.
- Old wording replaced: the two MCP tool descriptions and the guide's "Template Edit Propagation" paragraph. The step edit dialog's help line is still accurate.
- Not done by design (E): no automatic catch-up of the 45 stranded cards; use the `dry_run` preview on resync first.
