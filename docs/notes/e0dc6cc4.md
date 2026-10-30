# e0dc6cc4: click a workflow template step to edit it

Card: "If i click on an individual workflow step, it should allow me to edit it" (+ text boxes must grow / scroll).
Related card folded in (recommended, pending Nick): 12a0e9e8 "Expected Deliverables box doesn't grow with its text".

## IMPORTANT: build from origin/master
The main checkout was on an old branch (feat/step-independence-check, base 6c346dc) that predates the step Effort
setting. The first plan was written against it and missed Effort; Nick sent it back (30 Oct). All line refs below are
origin/master 0c5ea62. The builder must branch from current master.

## Field inventory (origin/master 0c5ea62)
`WorkflowTemplateStep` (src/types/database.ts): title, description, role, requires_approval, deliverables, model_tier, effort. Seven settings, nothing else.
| Setting | Card step box (step-detail-dialog.tsx ~708-786) | Admin editor (admin/template-editor-dialog.tsx ~240-330) | Board editors (workflows-tab StepEditor, create-/add-template-dialog) |
|---|---|---|---|
| title | "Title" Input maxLength 200 | "Title" | "Title" |
| description | "Description" Textarea (grows) | "Description" one-line Input | one-line Input |
| role | "Agent Role" RoleCombobox + helper "Matched against agents when template is applied" | "Role" compact | "Role" compact |
| model_tier | ModelTierSelect variant=full "Model tier" | compact "Model tier" | compact |
| effort | same ModelTierSelect, `effort`+`onEffortChange` -> "Effort" dropdown (Tier's own / Low..Max), disabled while tier is Auto; one shared helper line under both | compact "Effort" | compact "Effort" |
| deliverables | "Expected Deliverables" one-line Input, placeholder "Comma-separated, e.g. Design doc, API schema" | "Deliverables" one-line | one-line |
| requires_approval | Switch "Requires human approval", after deliverables, before Save; no help line | Switch "Gate", no help line | Switch "Approval" |
Validator (src/lib/validation.ts ~294-306) rejects effort on a step with no tier; ModelTierSelect clears effort itself when tier goes to Auto.

## Live data (read-only query, this board's templates)
26 template steps; description median 538 chars, max 2,445; 2 contain line breaks; longest deliverables 230 chars.

## Decisions (recommendations; awaiting Nick)
1. Click opens the dialog straight into the edit form. Read-only viewers: same dialog, fields disabled, no Save.
2. New help line at top: "Saving changes this template. Cards already using it pick up the change on any step that hasn't started yet."
3. Closing with unsaved changes discards them (matches card box).
4. Fold 12a0e9e8 in: every step editor, including the card's own step box, gets growing Description + Deliverables.
5. Deliverables split on commas AND line breaks; new hint "Separate items with commas or new lines." under Expected Deliverables (here and on the card's box).
6. Admin's "Gate" label left as is (out of scope).

## Ruled out
- Editing in place inside the row (cramped).
- Reusing step-detail-dialog itself (built around a live card step: status, comments, output). New small dialog copying its edit form instead.

## Risks
- One-line inputs drop line breaks once typed in (HTML rule, not reproduced). Growing boxes fix it.
- Saving one step sends the whole steps array (same as the existing editor); concurrent edits overwrite.
- Mock not checked in an automated browser (local server refused); Nick opens it directly.

## Mock
`docs/template-step-edit-mock.html` (untracked). Card attachments: template-step-edit-mock.html (v1, superseded, missing Effort), template-step-edit-mock-v2.html (current).

## Build (30 Oct, branch feat/template-step-edit from origin/master 0c5ea62)
- New `template-step-dialog.tsx`: seven fields in the card box's order; Effort via the shared full-size ModelTierSelect. Read-only is a disabled fieldset (RoleCombobox has no disabled prop).
- `deliverables-text.ts` shared helper: commas AND new lines split. Used by the card box, create/add/admin dialogs and a small local-text box in the board StepEditor (raw text kept locally so a trailing separator survives typing).
- Description/Deliverables are growing Textareas everywhere steps are edited (field-sizing-content is already in the shared Textarea); caps 45vh / 30vh / 150px in compact rows.
- Deviation: no new E2E spec (could not run Playwright here); unit tests cover the dialog and the editor box. Browser check at 375/1280 not run (no local database); owed to review/test.
