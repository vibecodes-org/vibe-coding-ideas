# beba2bf2 - review list showed only first 100 tasks

Changes what users see: the review list now shows every task (scrolling), so all can be unticked before Apply.

Cause: `ImportPreviewTable` (src/components/board/import-preview-table.tsx) did `tasks.slice(0, 100)` and rendered "... and N more" - a display cap from the original import feature. Selection state and Apply used the full list, so hidden rows stayed ticked. Shared by AI Generate, CSV, JSON and bulk-text tabs.

Decision: removed the cap, no virtualised list / new dependency. Import already caps at 500 (existing amber notice), and rendering 500 rows in the component test took well under a second (jsdom), so a plain scrolling table is fine.
Tests: "renders a row and checkbox for all 126 tasks..." failed before (100 rows), passes now; 500-row timing test added.
