"use client";

import { useState, useMemo, useEffect, useCallback, useRef, useContext, memo } from "react";
import dynamic from "next/dynamic";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  CheckSquare,
  Paperclip,
  MessageSquare,
  Archive,
  X,
  Bot,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { TaskLabelBadges } from "./task-label-badges";
import { LabelPicker } from "./label-picker";
import { DueDateBadge } from "./due-date-badge";
import { createClient } from "@/lib/supabase/client";
import { TaskAutoOpenContext } from "./kanban-board";
import type { BoardTaskWithAssignee, BoardLabel, BoardChecklistItem, User } from "@/types";

const TaskDetailDialog = dynamic(() => import("./task-detail-dialog").then((m) => m.TaskDetailDialog), { ssr: false });

interface BoardTaskCardProps {
  task: BoardTaskWithAssignee;
  ideaId: string;
  columnId: string;
  teamMembers: User[];
  boardLabels: BoardLabel[];
  checklistItems: BoardChecklistItem[];
  highlightQuery?: string;
  currentUserId: string;
  autoOpen?: boolean;
  ideaAgents?: User[];
  initialCoverUrl?: string;
  isReadOnly?: boolean;
  hasApiKey?: boolean;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;

  const regex = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-500/30 rounded-sm">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export const BoardTaskCard = memo(function BoardTaskCard({
  task,
  ideaId,
  columnId,
  teamMembers,
  boardLabels,
  checklistItems,
  highlightQuery,
  currentUserId,
  autoOpen = false,
  ideaAgents = [],
  initialCoverUrl,
  isReadOnly = false,
  hasApiKey = false,
}: BoardTaskCardProps) {
  // Use context for auto-open — bypasses memo chain and reacts to URL navigation
  const { autoOpenTaskId, onAutoOpenConsumed } = useContext(TaskAutoOpenContext);
  const shouldAutoOpen = autoOpen || task.id === autoOpenTaskId;

  const [detailOpen, setDetailOpen] = useState(shouldAutoOpen);
  const [initialTab, setInitialTab] = useState<string | undefined>(undefined);
  const [coverUrl, setCoverUrl] = useState<string | null>(
    initialCoverUrl ?? null,
  );
  const [coverPreviewOpen, setCoverPreviewOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const wasAutoOpenRef = useRef(shouldAutoOpen);

  // Sync auto-open from both prop and context (e.g. notification click while on the same board)
  useEffect(() => {
    if (shouldAutoOpen) {
      setDetailOpen(true);
      wasAutoOpenRef.current = true;
    }
  }, [shouldAutoOpen]);

  // When the auto-opened detail dialog closes, scroll into view and highlight
  useEffect(() => {
    if (wasAutoOpenRef.current && !detailOpen) {
      wasAutoOpenRef.current = false;
      onAutoOpenConsumed();
      const el = cardRef.current;
      if (el) {
        // Small delay to let the dialog unmount and DOM settle
        requestAnimationFrame(() => {
          el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
          setHighlighted(true);
          setTimeout(() => setHighlighted(false), 2000);
        });
      }
    }
  }, [detailOpen, onAutoOpenConsumed]);

  // Update URL when dialog opens/closes
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setDetailOpen(open);
      const url = new URL(window.location.href);
      if (open) {
        url.searchParams.set("taskId", task.id);
      } else {
        url.searchParams.delete("taskId");
      }
      // Use replaceState to avoid polluting browser history
      window.history.replaceState({}, "", url.toString());
    },
    [task.id],
  );

  const isArchived = task.archived;
  const attachmentCount = task.attachment_count;
  const commentCount = task.comment_count;
  const coverImagePath = task.cover_image_path;

  // Close lightbox on Escape
  const closeLightbox = useCallback(() => setCoverPreviewOpen(false), []);
  useEffect(() => {
    if (!coverPreviewOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [coverPreviewOpen, closeLightbox]);

  // Fetch signed URL for cover image only when path changes after mount
  // (initial URL is provided server-side via batch creation)
  const prevCoverPathRef = useRef(coverImagePath);
  useEffect(() => {
    // Skip if path hasn't changed (initial render uses server-provided URL)
    if (coverImagePath === prevCoverPathRef.current && coverUrl) return;
    prevCoverPathRef.current = coverImagePath;

    if (!coverImagePath) {
      setCoverUrl(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    supabase.storage
      .from("task-attachments")
      .createSignedUrl(coverImagePath, 3600)
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) setCoverUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [coverImagePath]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortableData = useMemo(
    () => ({ type: "task" as const, columnId }),
    [columnId]
  );
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: sortableData,
    disabled: !!isArchived || isReadOnly,
    transition: {
      duration: 120,
      easing: "cubic-bezier(0.25, 1, 0.5, 1)",
    },
  });

  const style = transform
    ? { transform: CSS.Transform.toString(transform), transition }
    : undefined;

  const assigneeInitials = useMemo(
    () =>
      task.assignee?.full_name
        ?.split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase() ?? null,
    [task.assignee?.full_name],
  );

  return (
    <>
      <div
        ref={(node) => {
          setNodeRef(node);
          (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }}
        style={style}
        data-testid={`task-card-${task.id}`}
        className={`group cursor-pointer overflow-hidden rounded-md border bg-background shadow-sm transition-all duration-500 ${
          highlighted
            ? "border-primary ring-2 ring-primary/50"
            : "border-border"
        } ${isDragging ? "opacity-50" : ""} ${isArchived ? "opacity-50" : ""}`}
        onClick={() => {
          setInitialTab(undefined);
          handleOpenChange(true);
        }}
      >
        {coverUrl && (
          <div
            className="h-32 w-full cursor-zoom-in"
            onClick={(e) => {
              e.stopPropagation();
              setCoverPreviewOpen(true);
            }}
          >
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <div className="flex items-start gap-2 p-3">
          {!isArchived && !isReadOnly && (
            <button
              data-testid="task-drag-handle"
              className="-ml-2 -mt-1 cursor-grab p-2 text-muted-foreground opacity-100 transition-opacity sm:-ml-0.5 sm:-mt-0.5 sm:p-0.5 sm:opacity-0 sm:group-hover:opacity-100 active:cursor-grabbing touch-none"
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            {/* Labels */}
            {task.labels.length > 0 && (
              <div className="mb-1.5">
                {isReadOnly ? (
                  <TaskLabelBadges labels={task.labels} />
                ) : (
                  <LabelPicker
                    boardLabels={boardLabels}
                    taskLabels={task.labels}
                    taskId={task.id}
                    ideaId={ideaId}
                    currentUserId={currentUserId}
                  >
                    <div onClick={(e) => e.stopPropagation()} className="cursor-pointer">
                      <TaskLabelBadges labels={task.labels} />
                    </div>
                  </LabelPicker>
                )}
              </div>
            )}

            <p className="text-sm font-medium leading-snug">
              {highlightQuery ? <HighlightedText text={task.title} query={highlightQuery} /> : task.title}
            </p>

            {task.description && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                {highlightQuery ? <HighlightedText text={task.description} query={highlightQuery} /> : task.description}
              </p>
            )}

            {/* Metadata row */}
            <div className="mt-2 flex items-center gap-2">
              <div className="flex flex-1 flex-wrap items-center gap-1.5">
                {isArchived && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                    <Archive className="h-3 w-3" />
                    Archived
                  </span>
                )}
                {task.due_date && <DueDateBadge dueDate={task.due_date} />}
                {task.checklist_total > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-medium ${
                          task.checklist_done === task.checklist_total ? "text-emerald-400" : "text-muted-foreground"
                        }`}
                      >
                        <CheckSquare className="h-3 w-3" />
                        {task.checklist_done}/{task.checklist_total}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Checklist</TooltipContent>
                  </Tooltip>
                )}
                {!!attachmentCount && attachmentCount > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex cursor-pointer items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setInitialTab("files");
                          handleOpenChange(true);
                        }}
                      >
                        <Paperclip className="h-3 w-3" />
                        {attachmentCount}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Attachments</TooltipContent>
                  </Tooltip>
                )}
                {!!commentCount && commentCount > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex cursor-pointer items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setInitialTab("comments");
                          handleOpenChange(true);
                        }}
                      >
                        <MessageSquare className="h-3 w-3" />
                        {commentCount}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Comments</TooltipContent>
                  </Tooltip>
                )}
              </div>
              {task.assignee && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="relative">
                      <Avatar className="h-5 w-5">
                        <AvatarImage src={task.assignee.avatar_url ?? undefined} />
                        <AvatarFallback className="text-[10px]">{assigneeInitials}</AvatarFallback>
                      </Avatar>
                      {task.assignee.is_bot && (
                        <Bot className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-primary" />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {task.assignee.full_name ?? "Assigned"}
                    {task.assignee.is_bot ? " (agent)" : ""}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </div>
      {detailOpen && (
        <TaskDetailDialog
          open={detailOpen}
          onOpenChange={handleOpenChange}
          task={task}
          ideaId={ideaId}
          boardLabels={boardLabels}
          checklistItems={checklistItems}
          teamMembers={teamMembers}
          currentUserId={currentUserId}
          initialTab={initialTab}
          ideaAgents={ideaAgents}
          isReadOnly={isReadOnly}
          hasApiKey={hasApiKey}
        />
      )}
      {/* Cover image lightbox */}
      {coverPreviewOpen && coverUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setCoverPreviewOpen(false)}
        >
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 text-white hover:bg-white/20"
            onClick={() => setCoverPreviewOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
          <img
            src={coverUrl}
            alt=""
            className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
});
