"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Settings2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type PanelPlacement,
  SECTION_LABELS,
  readPanelOrder,
  writePanelOrder,
  resetPanelOrder,
  reconcileOrder,
  getColumnItems,
} from "@/lib/dashboard-order";

interface DashboardGridProps {
  sections: Record<string, ReactNode>;
  defaultOrder: PanelPlacement[];
}

export function DashboardGrid({ sections, defaultOrder }: DashboardGridProps) {
  const visibleIds = Object.keys(sections);
  const [panelOrder, setPanelOrder] = useState<PanelPlacement[]>(() =>
    reconcileOrder(defaultOrder, visibleIds)
  );
  const [customizing, setCustomizing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const stored = readPanelOrder();
    if (stored) {
      setPanelOrder(reconcileOrder(stored, visibleIds));
    }
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback((order: PanelPlacement[]) => {
    setPanelOrder(order);
    writePanelOrder(order);
  }, []);

  const handleReset = useCallback(() => {
    resetPanelOrder();
    setPanelOrder(reconcileOrder(defaultOrder, visibleIds));
  }, [defaultOrder, visibleIds]);

  // Use default order before mount to avoid hydration mismatch
  const activeOrder = mounted ? panelOrder : reconcileOrder(defaultOrder, visibleIds);

  const col0 = getColumnItems(activeOrder, 0);
  const col1 = getColumnItems(activeOrder, 1);
  const col0Ids = col0.map((p) => p.id);
  const col1Ids = col1.map((p) => p.id);

  // DnD sensors — require 8px movement to start drag (avoids accidental drags)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  function findColumn(id: string): 0 | 1 | null {
    const item = activeOrder.find((p) => p.id === id);
    return item ? item.column : null;
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeItemId = active.id as string;
    const overId = over.id as string;

    const activeCol = findColumn(activeItemId);
    // Determine target column: if over a droppable column container, use that; otherwise use the item's column
    let overCol: 0 | 1 | null;
    if (overId === "column-0") {
      overCol = 0;
    } else if (overId === "column-1") {
      overCol = 1;
    } else {
      overCol = findColumn(overId);
    }

    if (activeCol === null || overCol === null || activeCol === overCol) return;

    // Move item to the new column
    setPanelOrder((prev) => {
      const next = prev.map((p) =>
        p.id === activeItemId ? { ...p, column: overCol as 0 | 1 } : p
      );
      return next;
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeItemId = active.id as string;
    const overId = over.id as string;

    // If dropped on a column container (empty column), just persist current state
    if (overId === "column-0" || overId === "column-1") {
      persist(panelOrder);
      return;
    }

    if (activeItemId === overId) {
      persist(panelOrder);
      return;
    }

    // Reorder within the same column
    const activeCol = findColumn(activeItemId);
    const overCol = findColumn(overId);

    if (activeCol === null || overCol === null) return;

    // Both should be in the same column at this point (handleDragOver moved it)
    if (activeCol === overCol) {
      setPanelOrder((prev) => {
        const colItems = prev.filter((p) => p.column === activeCol);
        const otherItems = prev.filter((p) => p.column !== activeCol);

        const oldIndex = colItems.findIndex((p) => p.id === activeItemId);
        const newIndex = colItems.findIndex((p) => p.id === overId);

        if (oldIndex === -1 || newIndex === -1) return prev;

        // Move item from oldIndex to newIndex
        const reordered = [...colItems];
        const [removed] = reordered.splice(oldIndex, 1);
        reordered.splice(newIndex, 0, removed);

        // Rebuild full order preserving relative positions
        const result: PanelPlacement[] = [];
        let colIdx = 0;
        let otherIdx = 0;
        for (const p of prev) {
          if (p.column === activeCol) {
            if (colIdx < reordered.length) {
              result.push(reordered[colIdx]);
              colIdx++;
            }
          } else {
            result.push(otherItems[otherIdx]);
            otherIdx++;
          }
        }
        // Append any remaining
        while (colIdx < reordered.length) {
          result.push(reordered[colIdx++]);
        }

        const next = result;
        writePanelOrder(next);
        return next;
      });
    } else {
      persist(panelOrder);
    }
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  const activeSection = activeId ? sections[activeId] : null;

  return (
    <>
      {/* Customize toggle */}
      <div className="mt-4 sm:mt-8 flex items-center justify-end gap-2">
        {customizing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="gap-1.5 text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        )}
        <Button
          variant={customizing ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setCustomizing((v) => !v)}
          className="gap-1.5"
        >
          <Settings2 className="h-3.5 w-3.5" />
          {customizing ? "Done" : "Customize"}
        </Button>
      </div>

      {/* Two-column grid */}
      {customizing ? (
        <DndContext
          id="dashboard-grid"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="mt-2 grid gap-4 sm:gap-6 lg:grid-cols-2">
            <DroppableColumn id="column-0" items={col0Ids}>
              {col0.map((p) => (
                <SortablePanel key={p.id} id={p.id} activeId={activeId}>
                  {sections[p.id]}
                </SortablePanel>
              ))}
            </DroppableColumn>
            <DroppableColumn id="column-1" items={col1Ids}>
              {col1.map((p) => (
                <SortablePanel key={p.id} id={p.id} activeId={activeId}>
                  {sections[p.id]}
                </SortablePanel>
              ))}
            </DroppableColumn>
          </div>
          <DragOverlay dropAnimation={null}>
            {activeId && activeSection ? (
              <div className="rounded-lg border border-primary/40 bg-background/95 shadow-lg opacity-90">
                <div className="flex items-center gap-2 rounded-t-lg border-b border-primary/20 bg-primary/5 px-3 py-1.5">
                  <GripVertical className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium text-primary">
                    {SECTION_LABELS[activeId] ?? activeId}
                  </span>
                </div>
                <div className="pointer-events-none p-1">
                  {activeSection}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="mt-2 grid gap-4 sm:gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-4 sm:space-y-6">
            {col0.map((p) => (
              <div key={p.id}>{sections[p.id]}</div>
            ))}
          </div>
          <div className="min-w-0 space-y-4 sm:space-y-6">
            {col1.map((p) => (
              <div key={p.id}>{sections[p.id]}</div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* --- Droppable column container --- */

import { useDroppable } from "@dnd-kit/core";

function DroppableColumn({
  id,
  items,
  children,
}: {
  id: string;
  items: string[];
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <SortableContext items={items} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={`min-w-0 min-h-[100px] space-y-4 sm:space-y-6 rounded-lg border-2 border-dashed p-2 transition-colors ${
          isOver
            ? "border-primary/50 bg-primary/5"
            : "border-transparent"
        }`}
      >
        {children}
      </div>
    </SortableContext>
  );
}

/* --- Sortable panel item --- */

function SortablePanel({
  id,
  activeId,
  children,
}: {
  id: string;
  activeId: string | null;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${isDragging ? "opacity-30" : ""}`}
    >
      {/* Drag handle bar */}
      <div className="mb-1.5 flex items-center gap-2 rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-1.5">
        <button
          className="cursor-grab touch-none text-primary/60 hover:text-primary active:cursor-grabbing"
          aria-label={`Drag ${SECTION_LABELS[id] ?? id} to reorder`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="text-xs font-medium text-primary">
          {SECTION_LABELS[id] ?? id}
        </span>
      </div>
      {children}
    </div>
  );
}
