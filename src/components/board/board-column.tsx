"use client";

import { useState, useMemo, memo } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { MoreHorizontal, Plus, Pencil, Trash2, GripVertical, CircleCheckBig, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { BoardTaskCard } from "./board-task-card";
import { useBoardOps } from "./board-context";
import { deleteBoardColumn, archiveColumnTasks } from "@/actions/board";
import { undoableAction } from "@/lib/undo-toast";
import type {
  BoardColumnWithTasks,
  BoardLabel,
  BoardChecklistItem,
  User,
} from "@/types";

const TaskEditDialog = dynamic(() => import("./task-edit-dialog").then((m) => m.TaskEditDialog), { ssr: false });
const ColumnEditDialog = dynamic(() => import("./column-edit-dialog").then((m) => m.ColumnEditDialog), { ssr: false });

const EMPTY_CHECKLIST: BoardChecklistItem[] = [];

interface BoardColumnProps {
  column: BoardColumnWithTasks;
  totalTaskCount: number;
  ideaId: string;
  teamMembers: User[];
  boardLabels: BoardLabel[];
  checklistItemsByTaskId: Record<string, BoardChecklistItem[]>;
  highlightQuery?: string;
  currentUserId: string;
  initialTaskId?: string;
  ideaAgents?: User[];
  coverImageUrls?: Record<string, string>;
  hasApiKey?: boolean;
  ideaDescription?: string;
  isReadOnly?: boolean;
  isDragTarget?: boolean;
}

export const BoardColumn = memo(function BoardColumn({
  column,
  totalTaskCount,
  ideaId,
  teamMembers,
  boardLabels,
  checklistItemsByTaskId,
  highlightQuery,
  currentUserId,
  initialTaskId,
  ideaAgents = [],
  coverImageUrls = {},
  hasApiKey = false,
  ideaDescription = "",
  isReadOnly = false,
  isDragTarget = false,
}: BoardColumnProps) {
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const ops = useBoardOps();

  const sortableData = useMemo(
    () => ({ type: "column" as const, columnId: column.id }),
    [column.id]
  );
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    data: sortableData,
    disabled: isReadOnly,
    transition: {
      duration: 120,
      easing: "cubic-bezier(0.25, 1, 0.5, 1)",
    },
  });

  const style = transform
    ? { transform: CSS.Transform.toString(transform), transition }
    : undefined;

  const taskIds = useMemo(() => column.tasks.map((t) => t.id), [column.tasks]);

  function handleDelete() {
    const rollback = ops.deleteColumn(column.id);
    ops.incrementPendingOps();
    undoableAction({
      message: `Deleted "${column.title}"`,
      execute: async () => {
        try {
          await deleteBoardColumn(column.id, ideaId);
        } finally {
          ops.decrementPendingOps();
        }
      },
      undo: () => {
        rollback();
        ops.decrementPendingOps();
      },
      errorMessage: "Failed to delete column",
    });
  }

  async function handleArchiveAll() {
    const count = column.tasks.filter((t) => !t.archived).length;
    if (count === 0) return;
    const rollback = ops.archiveColumnTasks(column.id);
    ops.incrementPendingOps();
    try {
      await archiveColumnTasks(column.id, ideaId);
      toast.success(`Archived ${count} task${count !== 1 ? "s" : ""}`);
    } catch {
      rollback();
      toast.error("Failed to archive tasks");
    } finally {
      ops.decrementPendingOps();
    }
  }

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        data-testid={`column-${column.id}`}
        className={`flex max-h-full min-w-[280px] max-w-[320px] shrink-0 snap-start flex-col rounded-lg border bg-muted/50 ${
          isDragTarget ? "ring-2 ring-primary/50 border-primary" : "border-border"
        } ${isDragging ? "opacity-50" : ""}`}
      >
        {/* Column header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-1.5">
            {!isReadOnly && (
              <button
                data-testid="column-drag-handle"
                className="-ml-1 cursor-grab p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing touch-none sm:-ml-0 sm:p-0"
                {...attributes}
                {...listeners}
              >
                <GripVertical className="h-4 w-4" />
              </button>
            )}
            <h3 className="flex items-center gap-1 text-sm font-semibold">
              {column.title}
              {column.is_done_column && <CircleCheckBig className="h-3.5 w-3.5 text-emerald-500" />}
              <span className="text-muted-foreground">({totalTaskCount})</span>
            </h3>
          </div>
          {!isReadOnly && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Column options</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                {column.is_done_column && column.tasks.length > 0 && (
                  <DropdownMenuItem onClick={handleArchiveAll}>
                    <Archive className="mr-2 h-4 w-4" />
                    Archive all
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Task list */}
        <div className="min-h-[60px] flex-1 space-y-2 overflow-y-auto p-2">
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            {column.tasks.length === 0 && (
              <div className="flex items-center justify-center rounded-md border border-dashed border-border py-8 text-center">
                <p className="text-xs text-muted-foreground">
                  {isReadOnly ? "No tasks in this column" : "No tasks yet — drag here or click + to add"}
                </p>
              </div>
            )}
            {column.tasks.map((task) => (
              <BoardTaskCard
                key={task.id}
                task={task}
                ideaId={ideaId}
                columnId={column.id}
                teamMembers={teamMembers}
                boardLabels={boardLabels}
                checklistItems={checklistItemsByTaskId[task.id] ?? EMPTY_CHECKLIST}
                highlightQuery={highlightQuery}
                currentUserId={currentUserId}
                autoOpen={task.id === initialTaskId}
                ideaAgents={ideaAgents}
                initialCoverUrl={task.cover_image_path ? coverImageUrls[task.cover_image_path] : undefined}
                isReadOnly={isReadOnly}
                hasApiKey={hasApiKey}
              />
            ))}
          </SortableContext>
        </div>

        {/* Add task button */}
        {!isReadOnly && (
          <div className="border-t border-border p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onClick={() => setAddTaskOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add task
            </Button>
          </div>
        )}
      </div>

      {!isReadOnly && (
        <>
          <TaskEditDialog
            open={addTaskOpen}
            onOpenChange={setAddTaskOpen}
            ideaId={ideaId}
            columnId={column.id}
            teamMembers={teamMembers}
            boardLabels={boardLabels}
            currentUserId={currentUserId}
            ideaAgents={ideaAgents}
            hasApiKey={hasApiKey}
            ideaDescription={ideaDescription}
          />
          <ColumnEditDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            columnId={column.id}
            ideaId={ideaId}
            currentTitle={column.title}
            currentIsDoneColumn={column.is_done_column}
          />
        </>
      )}
    </>
  );
});
