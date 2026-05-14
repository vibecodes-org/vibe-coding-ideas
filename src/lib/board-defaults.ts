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
