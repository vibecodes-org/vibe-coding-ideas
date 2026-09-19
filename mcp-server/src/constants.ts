export const POSITION_GAP = 1000;

export const VIBECODES_USER_ID = "a0000000-0000-4000-a000-000000000001";

export const DEFAULT_BOARD_COLUMNS = [
  { title: "Backlog", position: 0, is_done_column: false },
  { title: "To Do", position: 1000, is_done_column: false },
  { title: "Blocked/Requires User Input", position: 2000, is_done_column: false },
  { title: "In Progress", position: 3000, is_done_column: false },
  { title: "Verify", position: 4000, is_done_column: false },
  { title: "Done", position: 5000, is_done_column: true },
];

/**
 * Canonical title of the "actively being worked" column. A non-workflow task
 * only counts as "an agent is working on it" while it sits here — see
 * `src/lib/board-defaults.ts` for the full rationale. Kept in sync with the
 * Next.js copy across the package boundary.
 */
export const IN_PROGRESS_COLUMN_TITLE = "In Progress";

export function isInProgressColumnTitle(title: string | null | undefined): boolean {
  return (title ?? "").trim().toLowerCase() === IN_PROGRESS_COLUMN_TITLE.toLowerCase();
}

export const VALID_LABEL_COLORS = [
  "red", "orange", "amber", "yellow", "lime", "green",
  "blue", "cyan", "violet", "purple", "pink", "rose",
  "emerald", "zinc",
];