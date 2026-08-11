"use client";

// In-app terminal — the session entry chooser (card cbe60db5, Option A,
// docs/design-terminal-session-entry-options.html §3). Renders INSIDE the
// dock body whenever `decideEntryBehaviour` (entry-decision.ts) says
// "chooser" — i.e. the user has any live session anywhere, or any recent
// (≤48h, recorded-folder) ended one. Nothing here mints or connects anything
// until a click (F1's whole point): "Start new session" is the only action
// that mints; every Reconnect attaches an already-minted session; every
// Resume launches a normal (capped) NEW session with `claude --continue`.
//
// Pure data derivation (dedupe, 48h window, task-match) lives in
// chooser-data.ts — this component only renders `ChooserSections` and wires
// clicks to the callbacks the dock supplies.

import { useEffect, useRef, useState } from "react";
import { Info, RefreshCw, Terminal as TerminalIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatSessionAge } from "@/lib/terminal/session-registry";
import { newSessionTooltip, getTerminalSessionCap, isNearSessionCap, terminalLimitLine } from "@/lib/terminal/session-cap";
import {
  findLiveSessionForTask,
  type ChooserSections,
  type ChooserLiveRow,
  type ChooserRecentRow,
} from "@/lib/terminal/chooser-data";
import { updateNudgeCopy, type HelperStatus } from "@/lib/terminal/helper-row";
import { MINIMUM_RECOMMENDED_HELPER_VERSION, shouldShowChooserHelperNudge } from "@/lib/terminal/helper-version";
import { TERMINAL_HELPER_DOWNLOAD_URL } from "@/lib/terminal/platform";
import { HelperUpdateButton } from "./terminal-helper-update-button";

// F3 (common foundations): the SAME generic warning, visible before every
// single Reconnect click — never conditional, never sniffed.
const TAKEOVER_LINE =
  "If this session is open somewhere else, reconnecting here takes it over.";

export interface TerminalSessionChooserProps {
  sections: ChooserSections;
  /** A task-scoped launch awaiting a decision (toolbar/task-menu bus event carrying a task identity), or null for a board-level open. */
  pendingTask?: { taskId: string; taskTitle: string } | null;
  /** Disables every action while a click's async work (reattach mint / resume launch) is in flight. */
  busy?: boolean;
  /** Reconnect a LIVE session on THIS board — attaches in place, no navigation. */
  onReconnectHere: (row: ChooserLiveRow) => void;
  /** Reconnect a LIVE session on ANOTHER board — navigates there with `?reconnect=<sid>`. */
  onOpenBoardAndReconnect: (row: ChooserLiveRow) => void;
  /** Resume a RECENT (ended) session — confirmed inline first (F4). */
  onResume: (row: ChooserRecentRow) => void;
  /** "Start new session" — the only action that mints (capped, rate-limited, exactly today's mint path). */
  onStartNew: () => void;
  cap?: number;
  /**
   * The caller's own last-known helper status (card cbe60db5, rework 3 —
   * Nick's field test: "I click Open and there's no indication I need to
   * update the helper"). The dock owns the fetch — the SAME
   * `/api/terminal/helper/status` response the My sessions panel polls
   * on-open (see terminal-my-sessions-panel.tsx's `load()`) — and passes the
   * result down, so this stays a pure render component like the rest of the
   * chooser; `undefined`/`null` (still loading, or the fetch failed) simply
   * renders no nudge, never an error state.
   */
  helperStatus?: HelperStatus | null;
}

export function TerminalSessionChooser({
  sections,
  pendingTask = null,
  busy = false,
  onReconnectHere,
  onOpenBoardAndReconnect,
  onResume,
  onStartNew,
  cap,
  helperStatus = null,
}: TerminalSessionChooserProps) {
  const [confirmingResumeSid, setConfirmingResumeSid] = useState<string | null>(null);
  const firstFocusRef = useRef<HTMLButtonElement | null>(null);

  // Helper-update nudge (card cbe60db5, rework 3): dismissed for the rest of
  // the browser session only — component-local state, not persisted, same
  // mechanism as `dismissedHelperNudge` in terminal-session-view.tsx.
  const [dismissedHelperNudge, setDismissedHelperNudge] = useState(false);
  const showHelperNudge = !dismissedHelperNudge && shouldShowChooserHelperNudge(helperStatus?.version);

  // Focus the first row's primary action when the chooser opens (design:
  // "focus lands on the first live session's primary action when the choice
  // surface opens"); a row badged "was open in this tab" takes priority so
  // Enter reconnects it immediately.
  useEffect(() => {
    firstFocusRef.current?.focus();
    // Only on mount — re-focusing on every prop change would steal focus
    // back from whatever the user is doing (e.g. mid-confirm on Resume).
  }, []);

  const taskMatch = pendingTask ? findLiveSessionForTask(sections, pendingTask.taskId) : null;
  const wasOpenSid =
    sections.liveHere.find((r) => r.wasOpenInThisTab)?.sid ??
    sections.liveElsewhere.find((r) => r.wasOpenInThisTab)?.sid ??
    null;

  // Resume confirm's honesty limit line (Nick's sign-off change 1): shown only
  // when the user is close enough to the cap that resuming matters — the live
  // count is every session this browser already knows about across BOTH live
  // sections (the cap itself is per-user, not per-board).
  const resolvedCap = cap ?? getTerminalSessionCap();
  const liveCount = sections.liveHere.length + sections.liveElsewhere.length;
  const limitLine = isNearSessionCap(liveCount, resolvedCap) ? terminalLimitLine(liveCount, resolvedCap) : null;

  const startNewLabel = pendingTask
    ? `Start new session for this task — ${pendingTask.taskTitle}`
    : "Start new session";

  return (
    <div className="max-h-[60vh] overflow-y-auto" data-testid="terminal-session-chooser">
      {showHelperNudge && (
        <div className="flex items-center gap-2 border-b border-sky-500/30 bg-sky-500/5 px-3.5 py-1.5 text-[11px] text-sky-300">
          <Info className="h-3 w-3 shrink-0" />
          <span className="flex-1">{updateNudgeCopy(MINIMUM_RECOMMENDED_HELPER_VERSION)}</span>
          <HelperUpdateButton href={TERMINAL_HELPER_DOWNLOAD_URL} />
          <button
            type="button"
            className="shrink-0 text-sky-400 hover:text-sky-200"
            onClick={() => setDismissedHelperNudge(true)}
            aria-label="Dismiss helper update notice"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {taskMatch && (
        <div className="flex items-center gap-2.5 border-b border-sky-500/25 bg-sky-500/5 px-3.5 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-sky-300">already running for this task</div>
            <div className="truncate text-[11.5px] text-zinc-500">{taskMatch.taskTitle}</div>
          </div>
          <Button
            ref={firstFocusRef}
            size="xs"
            className="flex-none bg-sky-500 text-sky-950 hover:bg-sky-400"
            disabled={busy}
            onClick={() =>
              (sections.liveHere.some((r) => r.sid === taskMatch.sid) ? onReconnectHere : onOpenBoardAndReconnect)(
                taskMatch,
              )
            }
          >
            <RefreshCw className="h-3 w-3" /> Reconnect
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2.5 border-b border-zinc-800 px-3.5 py-3">
        <Button
          ref={taskMatch ? undefined : firstFocusRef}
          className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
          disabled={busy}
          onClick={onStartNew}
        >
          <TerminalIcon className="h-4 w-4" /> {startNewLabel}
        </Button>
        <span className="text-[11.5px] text-zinc-500">{newSessionTooltip(cap).replace(/^New terminal — /, "")}</span>
      </div>

      {sections.liveHere.length > 0 && (
        <ChooserSection label="Running now — this board">
          {sections.liveHere.map((row) => (
            <LiveRow
              key={row.sid}
              row={row}
              busy={busy}
              badge={row.wasOpenInThisTab ? "was open in this tab" : null}
              buttonLabel="Reconnect"
              autoFocusRef={!taskMatch && row.sid === wasOpenSid ? firstFocusRef : undefined}
              onClick={() => onReconnectHere(row)}
            />
          ))}
        </ChooserSection>
      )}

      {sections.liveElsewhere.length > 0 && (
        <ChooserSection label="Running now — other boards">
          {sections.liveElsewhere.map((row) => (
            <LiveRow
              key={row.sid}
              row={row}
              busy={busy}
              badge={row.wasOpenInThisTab ? "was open in this tab" : null}
              buttonLabel="Open board & reconnect"
              autoFocusRef={!taskMatch && sections.liveHere.length === 0 && row.sid === wasOpenSid ? firstFocusRef : undefined}
              onClick={() => onOpenBoardAndReconnect(row)}
            />
          ))}
        </ChooserSection>
      )}

      {sections.recent.length > 0 && (
        <ChooserSection label="Recent — ended in the last 48h">
          {sections.recent.map((row) => (
            <RecentRow
              key={row.sid}
              row={row}
              busy={busy}
              confirming={confirmingResumeSid === row.sid}
              limitLine={limitLine}
              onRequestConfirm={() => setConfirmingResumeSid(row.sid)}
              onCancelConfirm={() => setConfirmingResumeSid(null)}
              onConfirm={() => {
                setConfirmingResumeSid(null);
                onResume(row);
              }}
            />
          ))}
        </ChooserSection>
      )}
    </div>
  );
}

function ChooserSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="border-t border-zinc-800 bg-[#111114] px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function LiveRow({
  row,
  busy,
  badge,
  buttonLabel,
  autoFocusRef,
  onClick,
}: {
  row: ChooserLiveRow;
  busy: boolean;
  badge: string | null;
  buttonLabel: string;
  autoFocusRef?: React.RefObject<HTMLButtonElement | null>;
  onClick: () => void;
}) {
  const label = row.taskTitle?.trim() || row.ideaTitle || row.sid.slice(0, 8);
  const identity = [row.machineLabel, row.cwd].filter(Boolean).join(" · ") || `session ${row.sid.slice(0, 8)}`;
  return (
    <div className="flex items-start gap-2.5 border-t border-zinc-800 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-zinc-100">
          <span className="truncate">{label}</span>
          {row.ideaTitle && <span className="text-[11px] font-normal text-zinc-500">{row.ideaTitle}</span>}
          {badge && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-300">
              {badge}
            </span>
          )}
        </div>
        <div className="truncate font-mono text-[11px] text-zinc-500">
          {identity} · started {formatSessionAge(row.createdAt)} ago
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">{TAKEOVER_LINE}</div>
      </div>
      <Button
        ref={autoFocusRef}
        size="xs"
        className="flex-none bg-sky-500 text-sky-950 hover:bg-sky-400"
        disabled={busy}
        onClick={onClick}
      >
        <RefreshCw className="h-3 w-3" /> {buttonLabel}
      </Button>
    </div>
  );
}

function RecentRow({
  row,
  busy,
  confirming,
  limitLine,
  onRequestConfirm,
  onCancelConfirm,
  onConfirm,
}: {
  row: ChooserRecentRow;
  busy: boolean;
  confirming: boolean;
  /** Resume confirm's honesty limit line (Nick's sign-off change 1) — null unless the user is near the cap. */
  limitLine: string | null;
  onRequestConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirm: () => void;
}) {
  const label = row.taskTitle?.trim() || row.ideaTitle || row.sid.slice(0, 8);
  return (
    <div className={cn("border-t border-zinc-800 px-3.5 py-2.5", confirming && "bg-emerald-500/5")}>
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-zinc-100">
            <span className="truncate">{label}</span>
            {row.ideaTitle && <span className="text-[11px] font-normal text-zinc-500">{row.ideaTitle}</span>}
          </div>
          <div className="truncate font-mono text-[11px] text-zinc-500">
            {row.cwd} · ended {formatSessionAge(row.endedAt)} ago
          </div>
        </div>
        {!confirming && (
          <Button
            size="xs"
            className="flex-none bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
            disabled={busy}
            onClick={onRequestConfirm}
          >
            Resume
          </Button>
        )}
      </div>
      {confirming && (
        <div className="mt-2 border-l-2 border-emerald-500 pl-2.5 text-[11.5px] text-zinc-400">
          <p>
            {row.claudeSessionId ? (
              <>
                Continues this exact conversation in{" "}
                <span className="font-mono text-zinc-300">{row.cwd}</span>.
              </>
            ) : (
              <>
                Starts a new terminal that picks up the most recent conversation in{" "}
                <span className="font-mono text-zinc-300">{row.cwd}</span>.
              </>
            )}
          </p>
          {limitLine && <p className="mt-1">{limitLine}</p>}
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button variant="ghost" size="xs" onClick={onCancelConfirm} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="xs"
              className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
              disabled={busy}
              onClick={onConfirm}
            >
              Resume
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
