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
  Loader2,
  AlertTriangle,
  Clock,
  CircleCheck,
  Bell,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useBotRoles } from "@/components/bot-roles-context";
import { getRoleColor } from "@/lib/agent-colors";
import { getInitials } from "@/lib/utils";
import { TaskLabelBadges } from "./task-label-badges";
import { LabelPicker } from "./label-picker";
import { DueDateBadge } from "./due-date-badge";
import { createClient } from "@/lib/supabase/client";
import { TaskAutoOpenContext } from "./kanban-board";
import type { BoardTaskWithAssignee, BoardLabel, User } from "@/types";

const TaskDetailDialog = dynamic(() => import("./task-detail-dialog").then((m) => m.TaskDetailDialog), { ssr: false });

interface BoardTaskCardProps {
  task: BoardTaskWithAssignee;
  ideaId: string;
  columnId: string;
  teamMembers: User[];
  boardLabels: BoardLabel[];
  highlightQuery?: string;
  currentUserId: string;
  autoOpen?: boolean;
  ideaAgents?: User[];
  initialCoverUrl?: string;
  isReadOnly?: boolean;
  canUseAi?: boolean;
  hasByokKey?: boolean;
  starterCredits?: number;
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

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

function getWorkflowStatus(task: BoardTaskWithAssignee) {
  const { workflow_step_total, workflow_step_completed, workflow_step_failed, workflow_step_awaiting_approval, workflow_step_in_progress, workflow_step_started_at, workflow_active_step_title, workflow_active_agent_name } = task;
  if (workflow_step_total === 0) return null;

  // Priority: Failed > Approval > Stale > Active > Complete > Idle
  if (workflow_step_failed > 0) {
    return { type: "failed" as const, title: workflow_active_step_title };
  }
  if (workflow_step_awaiting_approval > 0) {
    return { type: "approval" as const, title: workflow_active_step_title };
  }
  if (workflow_step_in_progress > 0 && workflow_step_started_at) {
    const elapsed = Date.now() - new Date(workflow_step_started_at).getTime();
    if (elapsed >= STALE_THRESHOLD_MS) {
      const hours = Math.floor(elapsed / (60 * 60 * 1000));
      const timeLabel = hours >= 24 ? `${Math.floor(hours / 24)}d` : `${hours}h`;
      return { type: "stale" as const, title: workflow_active_step_title, timeLabel, agent: workflow_active_agent_name };
    }
    return { type: "active" as const, title: workflow_active_step_title, agent: workflow_active_agent_name };
  }
  if (workflow_step_completed === workflow_step_total) {
    return { type: "complete" as const, title: null };
  }
  return { type: "idle" as const, title: null };
}

function WorkflowStatusBadge({ task }: { task: BoardTaskWithAssignee }) {
  const status = getWorkflowStatus(task);
  if (!status) return null;

  const { workflow_step_completed, workflow_step_total } = task;
  const fraction = `${workflow_step_completed}/${workflow_step_total}`;

  switch (status.type) {
    case "active":
      return (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-blue-500/25 bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-400">
                <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />
                <span className="truncate">{status.title ?? "In progress"} in progress</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{status.title ? `${status.title} — in progress` : "Workflow step in progress"}{status.agent ? ` (${status.agent})` : ""} ({fraction})</TooltipContent>
          </Tooltip>
          <span className="text-[10px] font-medium text-muted-foreground font-mono">{fraction}</span>
        </>
      );
    case "approval":
      return (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-violet-500/25 bg-violet-500/[0.12] px-2 py-0.5 text-[10px] font-semibold text-violet-400">
                <Bell className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{status.title ?? "Needs approval"} needs approval</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{status.title ? `${status.title} — needs approval` : "Workflow step needs approval"} ({fraction})</TooltipContent>
          </Tooltip>
          <span className="text-[10px] font-medium text-muted-foreground font-mono">{fraction}</span>
        </>
      );
    case "failed":
      return (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{status.title ?? "Failed"} failed</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{status.title ? `${status.title} — failed` : "Workflow step failed"} ({fraction})</TooltipContent>
          </Tooltip>
          <span className="text-[10px] font-medium text-muted-foreground font-mono">{fraction}</span>
        </>
      );
    case "stale":
      return (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                <Clock className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{status.title ?? "Stale"} stale &middot; {status.timeLabel}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{status.title ? `${status.title} — stale for ${status.timeLabel}` : `Stale for ${status.timeLabel}`}{status.agent ? ` (${status.agent})` : ""} ({fraction})</TooltipContent>
          </Tooltip>
          <span className="text-[10px] font-medium text-muted-foreground font-mono">{fraction}</span>
        </>
      );
    case "complete":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
              <CircleCheck className="h-2.5 w-2.5 shrink-0" />
              {fraction} &middot; Done
            </span>
          </TooltipTrigger>
          <TooltipContent>All workflow steps complete</TooltipContent>
        </Tooltip>
      );
    case "idle":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
              <CheckSquare className="h-3 w-3" />
              {fraction}
            </span>
          </TooltipTrigger>
          <TooltipContent>Workflow steps</TooltipContent>
        </Tooltip>
      );
  }
}

export const BoardTaskCard = memo(function BoardTaskCard({
  task,
  ideaId,
  columnId,
  teamMembers,
  boardLabels,
  highlightQuery,
  currentUserId,
  autoOpen = false,
  ideaAgents = [],
  initialCoverUrl,
  isReadOnly = false,
  canUseAi = false,
  hasByokKey = false,
  starterCredits = 0,
}: BoardTaskCardProps) {
  const botRoles = useBotRoles();
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
      task.assignee ? getInitials(task.assignee.full_name) : null,
    [task.assignee?.full_name],
  );

  // Derive current label display data from boardLabels prop (always up-to-date)
  // instead of task.labels snapshot (stale after label edits until full page reload)
  const currentLabels = useMemo(() => {
    const labelMap = new Map(boardLabels.map((l) => [l.id, l]));
    return task.labels
      .map((tl) => labelMap.get(tl.id))
      .filter((l): l is BoardLabel => l !== undefined);
  }, [task.labels, boardLabels]);

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
            : task.workflow_step_awaiting_approval > 0
              ? "border-violet-500/40 ring-1 ring-violet-500/20 shadow-[0_0_12px_rgba(167,139,250,0.25)]"
              : task.workflow_step_failed > 0
                ? "border-l-2 border-l-red-500 border-border"
                : task.workflow_step_in_progress > 0 && task.workflow_step_started_at && (Date.now() - new Date(task.workflow_step_started_at).getTime()) >= STALE_THRESHOLD_MS
                  ? "border-l-2 border-l-amber-500 border-border"
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
            {currentLabels.length > 0 && (
              <div className="mb-1.5">
                {isReadOnly ? (
                  <TaskLabelBadges labels={currentLabels} />
                ) : (
                  <LabelPicker
                    boardLabels={boardLabels}
                    taskLabels={currentLabels}
                    taskId={task.id}
                    ideaId={ideaId}
                    currentUserId={currentUserId}
                  >
                    <div onClick={(e) => e.stopPropagation()} className="cursor-pointer">
                      <TaskLabelBadges labels={currentLabels} />
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
                {task.workflow_step_total > 0 && (
                  <WorkflowStatusBadge task={task} />
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
                      {(() => {
                        const ac = task.assignee.is_bot ? getRoleColor(botRoles?.[task.assignee.id]) : null;
                        return (
                          <Avatar className="h-5 w-5">
                            <AvatarImage src={task.assignee.avatar_url ?? undefined} />
                            <AvatarFallback className={`text-[10px] ${ac ? `${ac.avatarBg} ${ac.avatarText}` : ""}`}>{assigneeInitials}</AvatarFallback>
                          </Avatar>
                        );
                      })()}
                      {task.assignee.is_bot && (
                        <Bot className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-primary" />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {task.assignee.full_name ?? "Assigned"}
                    {task.assignee.is_bot
                      ? ` (${botRoles?.[task.assignee.id] ?? "Agent"})`
                      : ""}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Active agent row — shown when an agent is working on a step */}
            {task.workflow_active_agent_name && task.workflow_step_in_progress > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 border-t border-border/50 pt-1.5">
                <Bot className="h-3 w-3 shrink-0 text-blue-400" />
                <span className="text-[10px] text-muted-foreground">{task.workflow_active_agent_name}</span>
              </div>
            )}
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
          teamMembers={teamMembers}
          currentUserId={currentUserId}
          initialTab={initialTab}
          ideaAgents={ideaAgents}
          isReadOnly={isReadOnly}
          canUseAi={canUseAi}
          hasByokKey={hasByokKey}
          starterCredits={starterCredits}

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
