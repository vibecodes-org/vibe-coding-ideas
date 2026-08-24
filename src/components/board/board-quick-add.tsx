"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useBoardOps } from "./board-context";
import { createBoardTaskAtTop } from "@/actions/board";
import { logTaskActivity } from "@/lib/activity";
import { computeTopInsertPosition } from "@/lib/board-position";
import type { BoardTaskWithAssignee } from "@/types";

interface BoardQuickAddProps {
  columnId: string;
  columnTitle: string;
  ideaId: string;
  currentUserId: string;
  /** Positions of the column's current tasks, used to compute where a new task lands. */
  existingPositions: number[];
  /** Called whenever the composer wants to close — Esc, submit-cancel, blur, etc. */
  onClose: () => void;
}

/**
 * Inline "quick add" composer rendered as the first item of a column's task
 * list (see board-column.tsx). Not a modal or popover — closing it is always
 * free, per the terminal-dock "never trap the user" rule this project
 * already applies elsewhere.
 */
export function BoardQuickAdd({
  columnId,
  columnTitle,
  ideaId,
  currentUserId,
  existingPositions,
  onClose,
}: BoardQuickAddProps) {
  const ops = useBoardOps();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (!containerRef.current || containerRef.current.contains(e.target as Node)) return;

      if (text.trim().length === 0) {
        onClose();
        return;
      }

      // Deliberate deviation from "always close on outside click": unsaved
      // text survives the first outside click, with a hint, and only
      // discards on a second one (or Escape, which always discards).
      if (confirmDiscard) {
        onClose();
      } else {
        setConfirmDiscard(true);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [text, confirmDiscard, onClose]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;

    setError(null);
    setConfirmDiscard(false);

    const tempId = `temp-${crypto.randomUUID()}`;
    const position = computeTopInsertPosition(existingPositions);
    const tempTask: BoardTaskWithAssignee = {
      id: tempId,
      idea_id: ideaId,
      column_id: columnId,
      title: trimmed,
      description: null,
      assignee_id: null,
      assignee: null,
      labels: [],
      position,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      due_date: null,
      archived: false,
      workflow_step_total: 0,
      workflow_step_completed: 0,
      workflow_step_in_progress: 0,
      workflow_step_failed: 0,
      workflow_step_awaiting_approval: 0,
      workflow_step_started_at: null,
      workflow_active_step_title: null,
      workflow_active_agent_name: null,
      workflow_template_name: null,
      attachment_count: 0,
      cover_image_path: null,
      comment_count: 0,
      discussion_id: null,
      working_started_at: null,
    };

    // Optimistically insert & keep the composer open (cleared) for rapid multi-add.
    const rollback = ops.createTaskAtTop(columnId, tempTask);
    ops.incrementPendingOps();
    setText("");

    try {
      const taskId = await createBoardTaskAtTop(ideaId, columnId, trimmed);
      logTaskActivity(taskId, ideaId, currentUserId, "created");
      textareaRef.current?.focus();
    } catch {
      rollback();
      toast.error("Failed to create task");
      // Put the failed text back so nothing is lost, and let the user retry.
      setText(trimmed);
      setError("Couldn't create the task. Your text is kept — retry, or cancel to discard.");
    } finally {
      ops.decrementPendingOps();
    }
  }

  return (
    <div
      ref={containerRef}
      className={`rounded-md border bg-background p-2 shadow-sm ${
        error ? "border-destructive" : "border-border focus-within:ring-2 focus-within:ring-ring"
      }`}
    >
      <Label htmlFor={`quick-add-${columnId}`} className="sr-only">
        Task title
      </Label>
      <Textarea
        id={`quick-add-${columnId}`}
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (confirmDiscard) setConfirmDiscard(false);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Task title…"
        rows={2}
        className="min-h-[38px] resize-none border-0 p-0 shadow-none focus-visible:ring-0"
        aria-label={`Add task to top of ${columnTitle}`}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <Button type="button" size="sm" onClick={() => void handleSubmit()} disabled={!text.trim()}>
          {error ? "Retry" : "Add task"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {confirmDiscard && !error && (
          <span className="ml-auto text-xs text-muted-foreground">Press Esc again to discard</span>
        )}
      </div>
      {error && (
        <div role="alert" className="mt-2 flex items-start gap-1.5 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
