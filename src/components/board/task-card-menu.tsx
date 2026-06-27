"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  ArrowUpToLine,
  ArrowDownToLine,
  Archive,
  Trash2,
  MessagesSquare,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useBoardOps } from "./board-context";
import { useBoardLaunch } from "./board-launch-context";
import { LaunchClaudeCodeButton } from "./launch-claude-code-button";
import { computeWithinColumnMove } from "./move-position";
import type { MoveEnd } from "./move-position";
import { deleteBoardTask, updateBoardTask, moveBoardTask } from "@/actions/board";
import { convertTaskToDiscussion } from "@/actions/discussions";
import { logTaskActivity } from "@/lib/activity";
import type { BoardTaskWithAssignee } from "@/types";

interface TaskCardMenuProps {
  task: BoardTaskWithAssignee;
  ideaId: string;
  columnId: string;
  currentUserId: string;
  /** Sibling tasks in this column (id + position) — used for edge-disable + position math. */
  columnTasks: { id: string; position: number }[];
}

/**
 * Per-card ⋯ shortcut menu: Move to top / Move to bottom / Archive / Delete.
 * All actions are optimistic-first (mutate local board state, fire the server
 * action, roll back + toast.error on failure). Mirrors the trusted-local-move
 * guard drag-drop uses so Realtime echoes can't revert the card.
 *
 * Caller is responsible for read-only gating (this whole subtree is unrendered
 * when the board is read-only).
 */
export function TaskCardMenu({
  task,
  ideaId,
  columnId,
  currentUserId,
  columnTasks,
}: TaskCardMenuProps) {
  const ops = useBoardOps();
  const launch = useBoardLaunch();
  const router = useRouter();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmConvertOpen, setConfirmConvertOpen] = useState(false);
  const [converting, setConverting] = useState(false);

  const canTop = computeWithinColumnMove(columnTasks, task.id, "top") !== null;
  const canBottom = computeWithinColumnMove(columnTasks, task.id, "bottom") !== null;

  function handleMove(end: MoveEnd) {
    const move = computeWithinColumnMove(columnTasks, task.id, end);
    if (!move) return; // no-op (edge / single card)

    const rollback = ops.moveTaskWithinColumn(task.id, columnId, end, move.newPosition);
    // Trust this move over lagging Realtime snapshots, exactly as drag-drop does.
    ops.trustMove(task.id, columnId, move.newPosition);
    ops.incrementPendingOps();

    moveBoardTask(task.id, ideaId, columnId, move.newPosition)
      .then(() => {
        logTaskActivity(task.id, ideaId, currentUserId, "moved", {
          to: end,
        });
      })
      .catch(() => {
        rollback();
        ops.trustMove(task.id, columnId, null); // don't trust a rejected move
        toast.error("Couldn't move task");
      })
      .finally(() => {
        ops.decrementPendingOps();
      });
  }

  function handleArchive() {
    const rollback = ops.archiveTask(task.id, columnId);
    ops.incrementPendingOps();
    ops.trustRemoval(task.id); // suppress a lagging-replica snapshot re-showing it

    updateBoardTask(task.id, ideaId, { archived: true })
      .then(() => {
        logTaskActivity(task.id, ideaId, currentUserId, "archived");
      })
      .catch(() => {
        rollback();
        ops.trustRemoval(task.id, false); // rolled back — stop trusting the removal
        toast.error("Couldn't archive task");
      })
      .finally(() => {
        ops.decrementPendingOps();
      });
  }

  function handleDelete() {
    setConfirmDeleteOpen(false);
    const rollback = ops.deleteTask(task.id, columnId);
    ops.incrementPendingOps();
    ops.trustRemoval(task.id); // suppress a lagging-replica snapshot re-showing it

    deleteBoardTask(task.id, ideaId)
      .catch(() => {
        rollback();
        ops.trustRemoval(task.id, false); // rolled back — stop trusting the removal
        toast.error("Couldn't delete task");
      })
      .finally(() => {
        ops.decrementPendingOps();
      });
  }

  async function handleConvert() {
    // Same optimistic recipe as Archive — the card leaves the board immediately
    // and a lagging Realtime snapshot can't re-show it. We await the action
    // (unlike Archive) because we need the new discussion id for the toast link.
    setConverting(true);
    const rollback = ops.archiveTask(task.id, columnId);
    ops.incrementPendingOps();
    ops.trustRemoval(task.id);

    try {
      const discussionId = await convertTaskToDiscussion(task.id, ideaId);
      logTaskActivity(task.id, ideaId, currentUserId, "converted_to_discussion");
      setConfirmConvertOpen(false);
      toast.success("Converted to a conversation", {
        description:
          "The task was archived and linked to the new conversation.",
        action: {
          label: "View conversation",
          onClick: () =>
            router.push(`/ideas/${ideaId}/discussions/${discussionId}`),
        },
      });
    } catch {
      rollback();
      ops.trustRemoval(task.id, false); // rolled back — stop trusting the removal
      setConfirmConvertOpen(false);
      toast.error("Couldn't convert task", {
        description: "The task is back on the board — try again.",
      });
    } finally {
      ops.decrementPendingOps();
      setConverting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid={`task-card-menu-${task.id}`}
            aria-label="Task actions"
            // Mirror the drag-handle reveal recipe: always visible on mobile,
            // hover-revealed on desktop, plus keyboard focus + open state.
            className="absolute right-1.5 top-1.5 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground sm:h-7 sm:w-7 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:opacity-100 data-[state=open]:bg-accent data-[state=open]:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onClick={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuItem
            disabled={!canTop}
            onSelect={() => handleMove("top")}
            className="py-2.5 sm:py-1.5"
          >
            <ArrowUpToLine className="mr-2 h-4 w-4" />
            Move to top
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canBottom}
            onSelect={() => handleMove("bottom")}
            className="py-2.5 sm:py-1.5"
          >
            <ArrowDownToLine className="mr-2 h-4 w-4" />
            Move to bottom
          </DropdownMenuItem>
          {launch && (
            <>
              <DropdownMenuSeparator />
              <LaunchClaudeCodeButton
                variant="task-menu-item"
                ideaId={launch.ideaId}
                ideaTitle={launch.ideaTitle}
                ideaGithubUrl={launch.ideaGithubUrl}
                recordedProjectPaths={launch.recordedProjectPaths}
                taskId={task.id}
                taskTitle={task.title}
              />
            </>
          )}
          {!task.archived && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setConfirmConvertOpen(true)}
                className="py-2.5 sm:py-1.5"
              >
                <MessagesSquare className="mr-2 h-4 w-4" />
                Convert to conversation
              </DropdownMenuItem>
            </>
          )}
          {!task.archived && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleArchive}
                className="py-2.5 sm:py-1.5"
              >
                <Archive className="mr-2 h-4 w-4" />
                Archive
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setConfirmDeleteOpen(true)}
            className="py-2.5 sm:py-1.5"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{task.title}&rdquo; will be permanently removed, along with
              its comments, checklist, and attachments. This can&rsquo;t be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmConvertOpen}
        // Keep the dialog open (and the busy state visible) while converting.
        onOpenChange={(open) => {
          if (!converting) setConfirmConvertOpen(open);
        }}
      >
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert to a conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{task.title}&rdquo; will be moved into a new conversation
              where the team can discuss it. The task is archived, not deleted
              &mdash; it and its comments stay intact and linked to the new
              conversation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {task.workflow_step_total > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>
                This task has an attached workflow. Its steps and progress
                won&rsquo;t carry over to the conversation.
              </span>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={converting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={converting}
              // preventDefault so Radix doesn't auto-close before the await resolves.
              onClick={(e) => {
                e.preventDefault();
                void handleConvert();
              }}
            >
              {converting ? "Converting…" : "Convert"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
