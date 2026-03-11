"use client";

import { useEffect, useRef, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Columns3, ListTodo, Tags } from "lucide-react";
import type { ImportTask, ColumnMapping } from "@/lib/import";
import type { BoardColumnWithTasks, BoardLabel } from "@/types";

interface ImportPreviewTableProps {
  tasks: ImportTask[];
  columns: BoardColumnWithTasks[];
  columnMapping: ColumnMapping;
  defaultColumnId: string;
  /** When true, auto-scrolls to bottom as new tasks appear and shows a streaming indicator */
  streaming?: boolean;
  /** Board labels — used to detect new labels */
  boardLabels?: BoardLabel[];
  /** Which task indices are checked (optional — no checkboxes when omitted) */
  selectedIndices?: Set<number>;
  /** Callback when selection changes */
  onSelectionChange?: (indices: Set<number>) => void;
}

export function ImportPreviewTable({
  tasks,
  columns,
  columnMapping,
  defaultColumnId,
  streaming,
  boardLabels,
  selectedIndices,
  onSelectionChange,
}: ImportPreviewTableProps) {
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const selectable = selectedIndices !== undefined && onSelectionChange !== undefined;

  const existingLabelNames = useMemo(() => {
    if (!boardLabels) return new Set<string>();
    return new Set(boardLabels.map((l) => l.name.toLowerCase()));
  }, [boardLabels]);

  // Auto-scroll to bottom when new tasks arrive during streaming
  useEffect(() => {
    if (streaming && tasks.length > prevCountRef.current) {
      scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCountRef.current = tasks.length;
  }, [tasks.length, streaming]);

  // Stat chips data
  const stats = useMemo(() => {
    const colNames = new Set<string>();
    const newCols = new Set<string>();
    const labelNames = new Set<string>();
    const newLabels = new Set<string>();

    for (const task of tasks) {
      if (task.columnName) {
        colNames.add(task.columnName);
        if (columnMapping[task.columnName] === "__new__") {
          newCols.add(task.columnName);
        }
      }
      for (const l of task.labels ?? []) {
        labelNames.add(l);
        if (!existingLabelNames.has(l.toLowerCase())) {
          newLabels.add(l);
        }
      }
    }

    return {
      taskCount: tasks.length,
      columnCount: colNames.size,
      newColumnCount: newCols.size,
      labelCount: labelNames.size,
      newLabelCount: newLabels.size,
    };
  }, [tasks, columnMapping, existingLabelNames]);

  function resolveColumnName(task: ImportTask): { name: string; isNew: boolean } {
    if (!task.columnName) {
      const col = columns.find((c) => c.id === defaultColumnId);
      return { name: col?.title ?? "Default", isNew: false };
    }
    const mappedId = columnMapping[task.columnName];
    if (mappedId === "__new__") return { name: task.columnName, isNew: true };
    const col = columns.find((c) => c.id === mappedId);
    return { name: col?.title ?? task.columnName, isNew: false };
  }

  function isLabelNew(label: string): boolean {
    return !existingLabelNames.has(label.toLowerCase());
  }

  function toggleIndex(index: number) {
    if (!selectable) return;
    const next = new Set(selectedIndices);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    onSelectionChange(next);
  }

  function selectAll() {
    if (!onSelectionChange) return;
    onSelectionChange(new Set(tasks.map((_, i) => i)));
  }

  function deselectAll() {
    if (!onSelectionChange) return;
    onSelectionChange(new Set());
  }

  if (tasks.length === 0 && !streaming) return null;

  const displayed = tasks.slice(0, 100);
  const hasMore = tasks.length > 100;

  return (
    <div className="space-y-3">
      {/* Stat chips */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium">
          <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
          {stats.taskCount} task{stats.taskCount !== 1 ? "s" : ""}
          {streaming && <span className="enhance-streaming-cursor" />}
        </div>
        {stats.columnCount > 0 && (
          <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium">
            <Columns3 className="h-3.5 w-3.5 text-muted-foreground" />
            {stats.columnCount} column{stats.columnCount !== 1 ? "s" : ""}
            {stats.newColumnCount > 0 && (
              <Badge variant="outline" className="ml-0.5 border-violet-500/30 bg-violet-500/10 px-1.5 py-0 text-[10px] text-violet-400">
                {stats.newColumnCount} new
              </Badge>
            )}
          </div>
        )}
        {stats.labelCount > 0 && (
          <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium">
            <Tags className="h-3.5 w-3.5 text-muted-foreground" />
            {stats.labelCount} label{stats.labelCount !== 1 ? "s" : ""}
            {stats.newLabelCount > 0 && (
              <Badge variant="outline" className="ml-0.5 border-violet-500/30 bg-violet-500/10 px-1.5 py-0 text-[10px] text-violet-400">
                {stats.newLabelCount} new
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Selection bar */}
      {selectable && !streaming && tasks.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {selectedIndices.size} of {tasks.length} selected
          </span>
          <span className="text-border">|</span>
          <button
            type="button"
            onClick={selectAll}
            className="text-primary hover:underline"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={deselectAll}
            className="text-primary hover:underline"
          >
            Deselect all
          </button>
        </div>
      )}

      {tasks.length > 500 && (
        <p className="text-xs text-amber-400">
          Only the first 500 tasks will be imported.
        </p>
      )}

      <ScrollArea className="max-h-[50vh] min-h-[200px] rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="border-b">
              {selectable && (
                <th className="w-8 px-2 py-1.5" />
              )}
              <th className="px-2 py-1.5 text-left font-medium">Title</th>
              <th className="w-[120px] px-2 py-1.5 text-left font-medium">Column</th>
              <th className="w-[160px] px-2 py-1.5 text-left font-medium">Labels</th>
              <th className="w-[90px] px-2 py-1.5 text-left font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((task, i) => {
              const isSelected = selectable ? selectedIndices.has(i) : true;
              const isNewest = streaming && i === tasks.length - 1;
              const col = resolveColumnName(task);

              return (
                <tr
                  key={i}
                  className={`border-b border-border/50 transition-colors ${
                    isNewest ? "bg-violet-500/[0.06]" : ""
                  } ${selectable && !isSelected ? "opacity-40" : ""} ${
                    streaming ? "animate-in fade-in duration-300" : ""
                  }`}
                >
                  {selectable && (
                    <td className="px-2 py-1">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleIndex(i)}
                        aria-label={`Select task: ${task.title}`}
                      />
                    </td>
                  )}
                  <td
                    className={`min-w-0 px-2 py-1.5 ${selectable && !isSelected ? "line-through" : ""}`}
                    title={task.title}
                  >
                    <span className="line-clamp-2">
                      {task.title}
                      {task.checklistItems && task.checklistItems.length > 0 && (
                        <span className="ml-1 text-muted-foreground">
                          ({task.checklistItems.length} steps)
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-muted-foreground">
                    <span className="flex items-center gap-1">
                      {col.name}
                      {col.isNew && (
                        <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 px-1 py-0 text-[9px] text-violet-400">
                          new
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap gap-0.5">
                      {task.labels?.slice(0, 3).map((l) => (
                        <Badge
                          key={l}
                          variant="secondary"
                          className={`px-1 py-0 text-[10px] ${isLabelNew(l) ? "border border-violet-500/30 bg-violet-500/10 text-violet-400" : ""}`}
                        >
                          {l}
                          {isLabelNew(l) && (
                            <span className="ml-0.5 text-[8px] opacity-70">new</span>
                          )}
                        </Badge>
                      ))}
                      {(task.labels?.length ?? 0) > 3 && (
                        <span className="text-muted-foreground">
                          +{task.labels!.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1 text-muted-foreground">
                    {task.dueDate ?? ""}
                  </td>
                </tr>
              );
            })}
            {/* Skeleton rows during streaming */}
            {streaming && (
              <>
                <tr className="border-b border-border/50">
                  {selectable && <td className="px-2 py-1.5" />}
                  <td className="px-2 py-1.5" colSpan={4}>
                    <div className="enhance-skeleton-line w-3/4" />
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  {selectable && <td className="px-2 py-1.5" />}
                  <td className="px-2 py-1.5" colSpan={4}>
                    <div className="enhance-skeleton-line w-1/2 opacity-50" />
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
        {hasMore && (
          <p className="px-2 py-1 text-center text-xs text-muted-foreground">
            ... and {tasks.length - 100} more
          </p>
        )}
        <div ref={scrollEndRef} />
      </ScrollArea>
    </div>
  );
}
