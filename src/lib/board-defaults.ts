/**
 * Default board columns that get auto-created when a board is first initialised.
 *
 * Mirrored from `mcp-server/src/constants.ts` to avoid cross-package imports
 * (the mcp-server is a separate workspace not in `@/*` paths). Keep these in sync —
 * the MCP server uses its copy when initialising real columns; the Next.js side uses
 * this copy to render placeholder columns when a board has no columns yet.
 */

export interface BoardColumnDefault {
  title: string;
  position: number;
  is_done_column: boolean;
}

export const DEFAULT_BOARD_COLUMNS: readonly BoardColumnDefault[] = [
  { title: "Backlog", position: 0, is_done_column: false },
  { title: "To Do", position: 1000, is_done_column: false },
  { title: "Blocked/Requires User Input", position: 2000, is_done_column: false },
  { title: "In Progress", position: 3000, is_done_column: false },
  { title: "Verify", position: 4000, is_done_column: false },
  { title: "Done", position: 5000, is_done_column: true },
] as const;

/**
 * Canonical title of the "actively being worked" column.
 *
 * A non-workflow task only counts as "an agent is actively working on it" while
 * it sits in this column — assigning a bot elsewhere just records ownership and
 * must never show a live "working" spinner (see board cards 74699f20 / 61a127fb).
 * Columns carry no dedicated in-progress flag (only `is_done_column`), so we match
 * on the canonical title. A board that renames this column simply won't show the
 * manual working chip — a deliberate fail-safe: no false spinner is far better
 * than a stuck one.
 */
export const IN_PROGRESS_COLUMN_TITLE = "In Progress";

export function isInProgressColumnTitle(title: string | null | undefined): boolean {
  return (title ?? "").trim().toLowerCase() === IN_PROGRESS_COLUMN_TITLE.toLowerCase();
}
