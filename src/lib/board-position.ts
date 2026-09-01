import { POSITION_GAP } from "@/lib/constants";

/**
 * Computes the `position` for a task inserted above the current first card
 * in a column (used by the header "+" quick-add). Mirrors the gap-based
 * scheme used everywhere else on the board: the new card lands
 * `POSITION_GAP` below the lowest existing position.
 *
 * For an empty column there's nothing to sit above, so it falls back to 0 —
 * the same value `createBoardTask` produces for the first task added via the
 * bottom "Add task" dialog (maxPos starts at `-POSITION_GAP`, so
 * `maxPos + POSITION_GAP === 0`).
 */
export function computeTopInsertPosition(existingPositions: number[]): number {
  if (existingPositions.length === 0) return 0;
  return Math.min(...existingPositions) - POSITION_GAP;
}

/**
 * Computes the `position` for a task appended to the bottom of a column —
 * the mirror image of `computeTopInsertPosition`. Used by `move_task`'s
 * "bottom" placement (mcp-server/src/tools/board-write.ts) so the caller
 * never has to guess an absolute number in the internal gap-based space.
 */
export function computeBottomInsertPosition(existingPositions: number[]): number {
  if (existingPositions.length === 0) return 0;
  return Math.max(...existingPositions) + POSITION_GAP;
}

/**
 * Thrown by `computeAdjacentInsertPosition` when the gap between the two
 * neighbors it would split is too small (< 2) to produce an integer strictly
 * between them. `board_tasks.position` is a Postgres `integer` column, so a
 * fractional midpoint (e.g. splitting 1000/2000 repeatedly: 1500, 1250, 1125,
 * 1062.5, ...) would get silently rounded on write and can collide with an
 * existing sibling's position — reproducing the exact "positions collide,
 * order becomes arbitrary" bug this whole scheme exists to prevent.
 *
 * Callers must catch this and rebalance the column (see
 * `rebalanceColumnPositions`) before retrying the insert.
 */
export class PositionGapExhaustedError extends Error {
  constructor() {
    super(
      "No integer position is available between these two neighbors — the column needs rebalancing before this insert can proceed."
    );
    this.name = "PositionGapExhaustedError";
  }
}

/**
 * Computes the `position` for a task inserted directly `"before"` or
 * `"after"` a specific sibling, given the sibling's own position and the
 * positions of every OTHER task already in the column (the task being
 * moved excluded). Splits the gap to the next task on that side; when the
 * sibling is first/last on that side, steps a full `POSITION_GAP` past it
 * instead (nothing to split against).
 *
 * Throws `PositionGapExhaustedError` when the gap has been split so many
 * times there's no integer left to split it further — the caller must
 * rebalance the column and retry.
 *
 * Used by `move_task`'s `before_task_id` / `after_task_id` placement.
 */
export function computeAdjacentInsertPosition(
  siblingPosition: number,
  side: "before" | "after",
  otherPositions: number[]
): number {
  if (side === "before") {
    const lower = otherPositions.filter((p) => p < siblingPosition);
    return lower.length === 0
      ? siblingPosition - POSITION_GAP
      : splitIntegerGap(Math.max(...lower), siblingPosition);
  }
  const higher = otherPositions.filter((p) => p > siblingPosition);
  return higher.length === 0
    ? siblingPosition + POSITION_GAP
    : splitIntegerGap(siblingPosition, Math.min(...higher));
}

/**
 * Splits the integer gap between two adjacent positions (`lowerPosition <
 * upperPosition`), returning a whole number strictly between them. Because
 * every other position in the column is guaranteed to be `<= lowerPosition`
 * or `>= upperPosition` (they're the two immediate neighbors), the result
 * can never collide with anything else already in the column.
 */
function splitIntegerGap(lowerPosition: number, upperPosition: number): number {
  if (upperPosition - lowerPosition < 2) {
    throw new PositionGapExhaustedError();
  }
  return Math.floor((lowerPosition + upperPosition) / 2);
}

/**
 * Recomputes clean, evenly-spaced integer positions (`POSITION_GAP` apart,
 * starting at `POSITION_GAP`) for every task in a column, preserving
 * whatever relative order `orderedTasks` is already in — pass tasks sorted
 * the same way `get_board` sorts them (`position`, then `id` as tiebreak) so
 * the rebalance never reorders anything, it only spreads the gaps back out.
 *
 * Used to recover from `PositionGapExhaustedError`: rebalance the whole
 * column, write the new positions back, then retry the insert against the
 * freshly-spaced positions.
 */
export function rebalanceColumnPositions(orderedTaskIds: string[]): Map<string, number> {
  const result = new Map<string, number>();
  orderedTaskIds.forEach((id, index) => {
    result.set(id, (index + 1) * POSITION_GAP);
  });
  return result;
}
