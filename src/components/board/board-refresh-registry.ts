/**
 * Cross-component channel letting BoardRealtime trigger KanbanBoard's
 * server-merge refetch without a shared React subtree.
 *
 * BoardRealtime and KanbanBoard are SIBLINGS under the board page's Server
 * Component — BoardRealtime is rendered directly on the page, KanbanBoard is
 * nested a couple of levels down inside BoardPageTabs. Neither can reach the
 * other via BoardOpsContext (scoped to KanbanBoard's own subtree) without
 * threading a new prop through the Server Component page. Module-level
 * registry, keyed by ideaId, mirrors the pattern already used by
 * local-mutation-signal.ts for the same sibling-communication problem.
 */
type RefreshFn = () => Promise<void>;

const registry = new Map<string, RefreshFn>();

/**
 * KanbanBoard registers its refetch-and-merge callback on mount (and
 * whenever it changes). Returns an unregister function for cleanup.
 */
export function registerBoardRefresh(ideaId: string, fn: RefreshFn): () => void {
  registry.set(ideaId, fn);
  return () => {
    // Only clear if we still own the slot — avoids a race where a newer
    // mount already replaced us before our cleanup runs.
    if (registry.get(ideaId) === fn) registry.delete(ideaId);
  };
}

/**
 * BoardRealtime calls this instead of router.refresh(). Resolves to a no-op
 * if KanbanBoard hasn't mounted/registered yet (e.g. a very early Realtime
 * event racing initial render).
 */
export function refreshBoard(ideaId: string): Promise<void> {
  const fn = registry.get(ideaId);
  return fn ? fn() : Promise.resolve();
}
