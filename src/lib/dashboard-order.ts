export type PanelPlacement = {
  id: string;
  column: 0 | 1;
};

export const SECTION_LABELS: Record<string, string> = {
  "active-boards": "Active Boards",
  "my-bots": "My Agents",
  "my-tasks": "My Tasks",
  "my-ideas": "My Ideas",
  collaborations: "Collaborations",
  "active-discussions": "Active Discussions",
  "recent-activity": "Recent Activity",
};

export const DEFAULT_PANEL_ORDER: PanelPlacement[] = [
  { id: "active-boards", column: 0 },
  { id: "my-bots", column: 0 },
  { id: "my-tasks", column: 0 },
  { id: "my-ideas", column: 1 },
  { id: "collaborations", column: 1 },
  { id: "active-discussions", column: 1 },
  { id: "recent-activity", column: 1 },
];

const STORAGE_KEY = "dashboard-panel-order";

export function readPanelOrder(): PanelPlacement[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // Validate shape
    for (const item of parsed) {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof item.id !== "string" ||
        (item.column !== 0 && item.column !== 1)
      ) {
        return null;
      }
    }
    return parsed as PanelPlacement[];
  } catch {
    return null;
  }
}

export function writePanelOrder(order: PanelPlacement[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    // localStorage unavailable
  }
}

export function resetPanelOrder(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable
  }
}

/**
 * Reconcile stored order with currently visible section IDs.
 * - Removes sections not in visibleIds
 * - Appends new sections (from defaults) that aren't in stored order
 */
export function reconcileOrder(
  stored: PanelPlacement[],
  visibleIds: string[]
): PanelPlacement[] {
  const visibleSet = new Set(visibleIds);
  // Keep only visible sections from stored order
  const filtered = stored.filter((p) => visibleSet.has(p.id));
  // Find sections in visibleIds but not in stored
  const storedIds = new Set(filtered.map((p) => p.id));
  const missing = visibleIds.filter((id) => !storedIds.has(id));
  // Append missing at their default positions
  for (const id of missing) {
    const defaultPlacement = DEFAULT_PANEL_ORDER.find((p) => p.id === id);
    filtered.push({ id, column: defaultPlacement?.column ?? 0 });
  }
  return filtered;
}

/**
 * Move a section up within its column (swap with the previous item in the same column).
 */
export function moveSectionUp(
  order: PanelPlacement[],
  id: string
): PanelPlacement[] {
  const idx = order.findIndex((p) => p.id === id);
  if (idx === -1) return order;
  const col = order[idx].column;

  // Find the previous item in the same column
  let prevIdx = -1;
  for (let i = idx - 1; i >= 0; i--) {
    if (order[i].column === col) {
      prevIdx = i;
      break;
    }
  }
  if (prevIdx === -1) return order; // Already at top

  const next = [...order];
  [next[prevIdx], next[idx]] = [next[idx], next[prevIdx]];
  return next;
}

/**
 * Move a section down within its column (swap with the next item in the same column).
 */
export function moveSectionDown(
  order: PanelPlacement[],
  id: string
): PanelPlacement[] {
  const idx = order.findIndex((p) => p.id === id);
  if (idx === -1) return order;
  const col = order[idx].column;

  // Find the next item in the same column
  let nextIdx = -1;
  for (let i = idx + 1; i < order.length; i++) {
    if (order[i].column === col) {
      nextIdx = i;
      break;
    }
  }
  if (nextIdx === -1) return order; // Already at bottom

  const next = [...order];
  [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
  return next;
}

/**
 * Move a section to the other column. Appends at the end of the target column.
 */
export function moveSectionToColumn(
  order: PanelPlacement[],
  id: string,
  targetColumn: 0 | 1
): PanelPlacement[] {
  const idx = order.findIndex((p) => p.id === id);
  if (idx === -1) return order;
  if (order[idx].column === targetColumn) return order;

  // Remove from current position
  const next = order.filter((p) => p.id !== id);
  // Find the last item in the target column to insert after
  let insertIdx = next.length;
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].column === targetColumn) {
      insertIdx = i + 1;
      break;
    }
  }
  // If no items in target column, find the boundary
  if (!next.some((p) => p.column === targetColumn)) {
    // Place after all column 0 items if moving to column 1, or at start if moving to column 0
    if (targetColumn === 1) {
      insertIdx = next.length;
    } else {
      insertIdx = 0;
    }
  }
  next.splice(insertIdx, 0, { id, column: targetColumn });
  return next;
}

/**
 * Get items for a specific column in order.
 */
export function getColumnItems(
  order: PanelPlacement[],
  column: 0 | 1
): PanelPlacement[] {
  return order.filter((p) => p.column === column);
}

/**
 * Check if a section is the first item in its column.
 */
export function isFirstInColumn(
  order: PanelPlacement[],
  id: string
): boolean {
  const item = order.find((p) => p.id === id);
  if (!item) return false;
  const colItems = getColumnItems(order, item.column);
  return colItems[0]?.id === id;
}

/**
 * Check if a section is the last item in its column.
 */
export function isLastInColumn(
  order: PanelPlacement[],
  id: string
): boolean {
  const item = order.find((p) => p.id === id);
  if (!item) return false;
  const colItems = getColumnItems(order, item.column);
  return colItems[colItems.length - 1]?.id === id;
}
