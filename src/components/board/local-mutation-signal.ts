/**
 * Cross-component signal recording when the local user last optimistically
 * mutated a board (e.g. a drag-and-drop move).
 *
 * `BoardRealtime` refreshes the board via `router.refresh()` whenever Realtime
 * reports a row change. For the local user's OWN change that refresh is pure
 * cost: the KanbanBoard already shows the new state optimistically (held by
 * trusted-state), and the first `router.refresh()` after a page load re-enters
 * the force-dynamic segment's `loading.tsx` skeleton — the visible "blank flash"
 * on the first drag. By marking local activity here, BoardRealtime can defer
 * that refresh until the user is idle, so a self-originated echo never flashes
 * the skeleton while external changes are still eventually reconciled.
 *
 * Module-level (not React state) so the two sibling components share it without
 * a context/provider round-trip. Keyed by ideaId so multiple boards don't
 * cross-talk.
 */
const lastLocalMutationAt = new Map<string, number>();

export function markLocalBoardMutation(ideaId: string, now: number = Date.now()): void {
  lastLocalMutationAt.set(ideaId, now);
}

/** Milliseconds since the local user last mutated this board, or Infinity if never. */
export function msSinceLocalBoardMutation(ideaId: string, now: number = Date.now()): number {
  const last = lastLocalMutationAt.get(ideaId);
  return last === undefined ? Infinity : now - last;
}
