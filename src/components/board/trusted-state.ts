/**
 * "Trusted local state" for the kanban board's drag-drop sync.
 *
 * The board applies optimistic moves immediately, then reconciles against
 * server snapshots delivered by Realtime (`router.refresh()` → RSC re-fetch).
 * Those RSC fetches read from a Postgres **read replica** that lags the primary
 * (and the Realtime WAL stream) by tens to hundreds of ms. After a move, a
 * refresh can therefore return a *stale* snapshot showing the task still in its
 * source column — and the board's cooldown only DELAYS applying that snapshot,
 * it doesn't validate it. Result: the task bounces back to its old column, then
 * forward again once the replica catches up. (See task 717be78d.)
 *
 * Fix: after a local move, remember where we put the task for a short window.
 * Before applying any server snapshot, merge the trusted state over it so a
 * lagging replica can't revert a move the user just made. An entry is dropped
 * once (a) its window expires, (b) the server agrees, or (c) the task is gone.
 *
 * This module is intentionally pure (no React) so it can be unit-tested in
 * isolation and so the kanban-board wiring stays small.
 */

/** How long a local move is trusted over server snapshots. ~15× typical replica lag. */
export const TRUST_WINDOW_MS = 3000;

export interface TrustedTaskState {
  /** Column the task was moved into. */
  columnId: string;
  /** Position assigned within that column. */
  position: number;
  /** Epoch ms after which the entry is no longer trusted. */
  trustedUntil: number;
}

interface MinTask {
  id: string;
  position: number;
}
interface MinColumn<T extends MinTask> {
  id: string;
  tasks: T[];
}

/**
 * Merge trusted local moves over a server snapshot.
 *
 * Returns the (possibly rebuilt) columns plus the ids of trusted entries that
 * are now resolved (expired / server agrees / task gone) and should be pruned
 * by the caller. When no entry overrides the server, the original
 * `serverColumns` reference is returned unchanged to minimise re-render churn.
 */
export function mergeTrustedState<T extends MinTask, C extends MinColumn<T>>(
  serverColumns: C[],
  trusted: Map<string, TrustedTaskState>,
  now: number
): { columns: C[]; resolved: string[] } {
  const resolved: string[] = [];
  if (trusted.size === 0) return { columns: serverColumns, resolved };

  // Where the server currently places each task.
  const serverLoc = new Map<string, { columnId: string; position: number }>();
  const taskById = new Map<string, T>();
  for (const col of serverColumns) {
    for (const t of col.tasks) {
      serverLoc.set(t.id, { columnId: col.id, position: t.position });
      taskById.set(t.id, t);
    }
  }

  // Decide which trusted entries still need to override the server.
  const overrides = new Map<string, TrustedTaskState>();
  for (const [taskId, ts] of trusted) {
    if (now >= ts.trustedUntil) {
      resolved.push(taskId); // window expired
      continue;
    }
    const loc = serverLoc.get(taskId);
    if (!loc) {
      resolved.push(taskId); // task no longer exists (archived/deleted)
      continue;
    }
    if (loc.columnId === ts.columnId && loc.position === ts.position) {
      resolved.push(taskId); // server has caught up
      continue;
    }
    overrides.set(taskId, ts);
  }

  if (overrides.size === 0) return { columns: serverColumns, resolved };

  const overriddenIds = new Set(overrides.keys());
  const columns = serverColumns.map((col) => {
    // Drop any overridden task from wherever the server put it.
    let tasks = col.tasks.filter((t) => !overriddenIds.has(t.id));
    // Add overridden tasks whose trusted column is this one, at their position.
    const incoming: T[] = [];
    for (const [taskId, ts] of overrides) {
      if (ts.columnId !== col.id) continue;
      const original = taskById.get(taskId);
      if (original) incoming.push({ ...original, position: ts.position });
    }
    if (incoming.length === 0) {
      // Only changed if we removed something from this column.
      return tasks.length === col.tasks.length ? col : { ...col, tasks };
    }
    tasks = [...tasks, ...incoming].sort((a, b) => a.position - b.position);
    return { ...col, tasks };
  });

  return { columns, resolved };
}
