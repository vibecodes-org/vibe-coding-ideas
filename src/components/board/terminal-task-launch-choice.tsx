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
  /** Back out entirely — launches nothing. Close button, Escape and outside-click all route here. */
  onCancel: () => void;
  /**
   * Task c4ca2d95 ("Terminal starting model") — the terse launch-surface line
   * (design §4.3 / Design Review note 2: "Starts on Sonnet · your setting"),
   * scoped to "Start fresh" since Reconnect/Resume keep the session's own
   * model (AC-8). See terminalDialogModelLine in
   * src/lib/terminal/model-resolution.ts. Omitted when null/undefined.
   */
  modelLine?: string | null;
  /**
   * Task d3de150c ("Terminal mode" auto-accept toggle) — the terser chip
   * counterpart to `modelLine`, same "Start fresh" scoping (Reconnect/Resume
   * never carry the flag). See terminalLaunchAutoAcceptChip in
   * src/lib/terminal/auto-accept-mode.ts. Omitted when null/undefined.
   */
  autoAcceptChip?: string | null;
}

export function TerminalTaskLaunchChoice({
  open,
  taskTitle,
  match,
  busy = false,
  onReconnect,
  onStartFresh,
  onCancel,
  modelLine = null,
  autoAcceptChip = null,
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      {/* Nick, 2026-08-19: this used to be undismissable (no close button,
          Escape and outside-click both suppressed) so the launch had to
          resolve to reconnect-or-fresh. But no session is minted until one
          of those buttons is clicked, so backing out costs nothing and
          leaves nothing behind — and a dialog you can't close is a trap. */}
      <DialogContent
        className="max-w-sm gap-0 border-zinc-700 bg-[#141417] p-0 text-zinc-200"
        data-testid="terminal-task-launch-choice"
      >
        {/* min-w-0 on both grid children (Nick, 27 Aug 2026): DialogContent is
            a CSS grid, and a grid item's default `min-width: auto` lets the
            nowrap (truncate) task title force the whole column wider than the
            card. Everything in that column — the text AND the footer — then
            hangs off the card's right edge. min-w-0 lets the column shrink to
            the card, so truncate actually truncates and the footer wraps. */}
        <div className="min-w-0 px-4 pt-4 pr-8 pb-3">
          <DialogTitle className="text-[13px] font-semibold text-zinc-100">
            {isLive ? "This task already has a terminal running" : "This task has a recent session"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[11.5px] text-zinc-500">
            <span className="block truncate">{taskTitle}</span>
            <span className="font-mono">{ageLabel}</span>
            {!canReconnect && <span className="block text-zinc-600">No folder was recorded for it — can&apos;t resume.</span>}
          </DialogDescription>
          {/* Task c4ca2d95: scoped to "Start fresh" — Reconnect/Resume keep
              the session's own model (AC-8), so this line is deliberately
              silent about them. */}
          {modelLine && (
            <p className="mt-1.5 text-[11px] text-zinc-500">
              {modelLine}
              {autoAcceptChip && <span className="ml-1 font-semibold text-amber-400">· {autoAcceptChip}</span>}
            </p>
          )}
          {/* Task d3de150c: fresh-launches-only reminder — Reconnect/Resume
              above never carry the flag, only "Start fresh anyway" does. */}
          {autoAcceptChip && (
            <p className="mt-1 text-[11px] text-zinc-500">Only starting fresh applies auto-accept.</p>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <Button variant="ghost" size="xs" className="text-zinc-400 hover:text-zinc-100" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="ghost" size="xs" disabled={busy} onClick={onStartFresh}>
            <TerminalIcon className="h-3 w-3" /> Start fresh anyway
          </Button>
          {canReconnect && (
            <Button
              size="xs"
              // Resume (recent match) mints a brand-new process that picks up an
              // old conversation — a "start something new" action, not an attach —
              // so it takes the same emerald styling as TerminalSessionChooser's
              // "start new" buttons. Reconnect (live match) keeps the sky
              // "attach to what's already running" color used everywhere else.
              className={
                isLive ? "bg-sky-500 text-sky-950 hover:bg-sky-400" : "bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
              }
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
