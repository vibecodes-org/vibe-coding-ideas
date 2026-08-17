"use client";

// Task-launch-skip-chooser (Nick's explicit product decision, 2026-08-16):
// the per-task "Launch Claude Code" (task-card menu item, task-detail
// terminal icon — anything that fires the launch bus with a `taskId`) never
// shows the full cross-board `TerminalSessionChooser` any more. The ONE
// exception is THIS component: it renders only when
// `findTaskSessionMatch` (chooser-data.ts) finds a live-or-recent (≤48h)
// session for the EXACT task being launched — dedupe-for-this-exact-task,
// nothing more. No other tasks, no other boards, no Recent/Running-now
// section headers — just "here's the one match, reconnect/resume it or
// start fresh anyway."

import { RefreshCw, Terminal as TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatSessionAge } from "@/lib/terminal/session-registry";
import type { TaskSessionMatch } from "@/lib/terminal/chooser-data";

export interface TerminalTaskLaunchChoiceProps {
  open: boolean;
  taskTitle: string;
  match: TaskSessionMatch;
  /** Disables both actions while a click's async work (reattach/resume) is in flight. */
  busy?: boolean;
  /** Live match → reattach (this board attaches in place, another board navigates). Recent match → resume (`claude --continue`/`--resume`). */
  onReconnect: () => void;
  /** The "start fresh anyway" escape hatch — mints a brand-new session for this task, ignoring the match entirely. */
  onStartFresh: () => void;
}

export function TerminalTaskLaunchChoice({
  open,
  taskTitle,
  match,
  busy = false,
  onReconnect,
  onStartFresh,
}: TerminalTaskLaunchChoiceProps) {
  // Narrow on `match.kind` directly at each use (rather than a derived
  // boolean) — `ChooserLiveRow`/`ChooserRecentRow` don't share a `createdAt`/
  // `endedAt` field, so TS can only follow the discriminant through a direct
  // check on `match.kind` itself.
  const isLive = match.kind !== "recent";
  const reconnectLabel = match.kind === "recent" ? "Resume" : "Reconnect";
  const ageLabel =
    match.kind === "recent"
      ? `Ended ${formatSessionAge(match.row.endedAt)} ago`
      : `Started ${formatSessionAge(match.row.createdAt)} ago`;
  // Null-cwd fix (bug 9fb9fced): a "recent" match with no recorded folder
  // still surfaces here (chooser-data.ts no longer hides it), but Resume has
  // no folder to reopen — same rule as the cross-board chooser's RecentRow.
  const canReconnect = match.kind !== "recent" || !!match.row.cwd;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="max-w-sm gap-0 border-zinc-700 bg-[#141417] p-0 text-zinc-200"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        data-testid="terminal-task-launch-choice"
      >
        <div className="px-4 pt-4 pb-3">
          <DialogTitle className="text-[13px] font-semibold text-zinc-100">
            {isLive ? "This task already has a terminal running" : "This task has a recent session"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[11.5px] text-zinc-500">
            <span className="block truncate">{taskTitle}</span>
            <span className="font-mono">{ageLabel}</span>
            {!canReconnect && <span className="block text-zinc-600">No folder was recorded for it — can&apos;t resume.</span>}
          </DialogDescription>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <Button variant="ghost" size="xs" disabled={busy} onClick={onStartFresh}>
            <TerminalIcon className="h-3 w-3" /> Start fresh anyway
          </Button>
          {canReconnect && (
            <Button
              size="xs"
              className="bg-sky-500 text-sky-950 hover:bg-sky-400"
              disabled={busy}
              onClick={onReconnect}
              autoFocus
            >
              <RefreshCw className="h-3 w-3" /> {reconnectLabel}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
