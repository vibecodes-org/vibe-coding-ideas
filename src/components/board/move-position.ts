/**
 * Pure position math for the task card "Move to top" / "Move to bottom"
 * shortcut actions.
 *
 * Mirrors the gap-based positioning used by drag-drop (`handleDragEnd` in
 * kanban-board.tsx): top = firstInColumn.position - POSITION_GAP,
 * bottom = lastInColumn.position + POSITION_GAP. Kept pure (no React) so the
 * edge cases (empty / single-card column, already-at-edge) are unit-testable
 * in isolation.
 */
import { POSITION_GAP } from "@/lib/constants";

interface PositionedTask {
  id: string;
  position: number;
}

export type MoveEnd = "top" | "bottom";

export interface WithinColumnMove {
  /** New position to persist for the moved task. */
  newPosition: number;
  /** The reordered task ids (top → bottom) for optimistic local state. */
  orderedIds: string[];
}

/**
 * Compute the new position + resulting order for moving a task to the top or
 * bottom of its current column.
 *
 * Returns `null` when the move is a no-op: the task isn't in the column, the
 * column has 0 or 1 tasks, or the task is already at the requested edge.
 */
export function computeWithinColumnMove(
  tasks: PositionedTask[],
  taskId: string,
  end: MoveEnd
): WithinColumnMove | null {
  // Work on a position-sorted copy so callers can pass tasks in any order.
  const sorted = [...tasks].sort((a, b) => a.position - b.position);
  const index = sorted.findIndex((t) => t.id === taskId);
  if (index === -1) return null;

  // Nothing to reorder in an empty or single-card column.
  if (sorted.length <= 1) return null;

  if (end === "top") {
    if (index === 0) return null; // already first
    const newPosition = sorted[0].position - POSITION_GAP;
    const moved = sorted[index];
    const rest = sorted.filter((t) => t.id !== taskId);
    return { newPosition, orderedIds: [moved.id, ...rest.map((t) => t.id)] };
  }

  // end === "bottom"
  const last = sorted.length - 1;
  if (index === last) return null; // already last
  const newPosition = sorted[last].position + POSITION_GAP;
  const moved = sorted[index];
  const rest = sorted.filter((t) => t.id !== taskId);
  return { newPosition, orderedIds: [...rest.map((t) => t.id), moved.id] };
}

/**
 * Whether a "Move to top" action is available for the task (i.e. not a no-op).
 * Used to gate/disable the menu item at the edge.
 */
export function canMoveToTop(tasks: PositionedTask[], taskId: string): boolean {
  return computeWithinColumnMove(tasks, taskId, "top") !== null;
}

/** Whether a "Move to bottom" action is available for the task. */
export function canMoveToBottom(tasks: PositionedTask[], taskId: string): boolean {
  return computeWithinColumnMove(tasks, taskId, "bottom") !== null;
}
