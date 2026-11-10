import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { BoardColumnWithTasks } from "@/types";

interface Options {
  autoOpenTaskId: string | undefined;
  columns: BoardColumnWithTasks[];
  filteredColumns: BoardColumnWithTasks[];
  /** Called once the notice has been shown, so the board stops trying to open the card. */
  onShown: () => void;
  /** Called by the "Clear filters" button. Receives the card id so it can be opened afterwards. */
  onClearFilters: (taskId: string) => void;
}

const hasTask = (cols: BoardColumnWithTasks[], id: string) =>
  cols.some((col) => col.tasks.some((t) => t.id === id));

/**
 * When a board is opened from a link to a card that the current filters hide,
 * tell the user once. The effect re-runs on every board change, so we remember
 * which card we already told them about and hand the link back to the board.
 */
export function useHiddenLinkedTaskNotice({
  autoOpenTaskId,
  columns,
  filteredColumns,
  onShown,
  onClearFilters,
}: Options) {
  const notifiedForRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!autoOpenTaskId) return;
    if (notifiedForRef.current === autoOpenTaskId) return;
    if (!hasTask(columns, autoOpenTaskId)) return; // not on this board at all
    if (hasTask(filteredColumns, autoOpenTaskId)) return; // visible: opens normally

    notifiedForRef.current = autoOpenTaskId;
    const taskId = autoOpenTaskId;
    toast.info("The linked task is hidden by current filters", {
      action: { label: "Clear filters", onClick: () => onClearFilters(taskId) },
    });
    onShown();
  }, [autoOpenTaskId, columns, filteredColumns, onShown, onClearFilters]);
}
