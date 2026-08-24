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
