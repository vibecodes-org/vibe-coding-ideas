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

import { useCallback, useEffect, useRef, useState } from "react";
import { Info, Loader2, RefreshCw, Terminal as TerminalIcon, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { formatSessionAge } from "@/lib/terminal/session-registry";
import { newSessionTooltip, getTerminalSessionCap, isNearSessionCap, terminalLimitLine } from "@/lib/terminal/session-cap";
import { isFallbackSessionName } from "@/lib/terminal/resolve-session-name";
import { deriveTabLabel } from "./terminal-tabs";
import { SessionRenameField } from "./terminal-session-rename";
import {
  findLiveSessionForTask,
  visibleRecentRows,
  type ChooserSections,
  type ChooserLiveRow,
  type ChooserRecentRow,
} from "@/lib/terminal/chooser-data";
import { updateNudgeCopy, type HelperStatus } from "@/lib/terminal/helper-row";
import { MINIMUM_RECOMMENDED_HELPER_VERSION, shouldShowChooserHelperNudge } from "@/lib/terminal/helper-version";
import {
  UPDATE_CONFIRM_ACCEPT_LABEL,
  UPDATE_CONFIRM_CANCEL_LABEL,
  UPDATE_CONFIRM_HEADING,
  UPDATE_QUIESCE_TIMEOUT_COPY,
  UPDATE_READY_COPY,
  updateConfirmBody,
} from "@/lib/terminal/helper-update-flow";
import { useHelperUpdateFlow } from "@/lib/terminal/use-helper-update-flow";
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
  /**
   * Task c4ca2d95 ("Terminal starting model") — the passive launch-surface
   * line naming the resolved model and its source (design §4.2), e.g. "New
   * sessions start on Opus · platform default." Omitted entirely (render
   * nothing) when null/undefined — either the resolved value hasn't loaded
   * yet, or nothing would be passed at all (both platform and user unset).
   * See terminalLaunchModelLine in src/lib/terminal/model-resolution.ts.
   */
  modelLine?: string | null;
  /**
   * Task d3de150c ("Terminal mode" auto-accept toggle) — the amber chip
   * appended beside `modelLine` when the viewer's toggle is on (design §2.1),
   * e.g. "⚡ auto-accept on". Omitted entirely when null/undefined —
   * loading, or the toggle is off (byte-identical to today in that case).
   * See terminalLaunchAutoAcceptChip in src/lib/terminal/auto-accept-mode.ts.
   */
  autoAcceptChip?: string | null;
  /**
   * Persist a rename (card 3bf262ac) — the dock's shared `renameSession`:
   * PATCHes the session and, on success, keeps the dock's own registry rows
   * and any live tab entry in sync. This component owns its OWN optimistic
   * override per row (see `renameOverrides` below) so a row updates
   * INSTANTLY, ahead of the dock's next re-derive of `sections`. Omitted →
   * no pencil on any row (keeps the chooser usable standalone, e.g. tests).
   */
  onRenameSession?: (sid: string, next: string | null) => Promise<{ ok: boolean; displayName?: string | null }>;
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
  /**
   * Fires once the shared quiesce-then-download flow (below) has settled or
   * timed out, right before the download starts — mirrors the My sessions
   * panel's own post-quiesce `load()`. The dock owns the underlying
   * registry/status fetches, so it's the one that supplies this; omitted
   * (e.g. in tests) simply skips the refresh.
   */
  onHelperUpdateSettled?: () => void;
  /**
   * Back out without doing anything (Nick, 2026-08-19). When supplied, a
   * plain "Close" sits at the FOOT of the list as well as in the dialog's
   * corner — the corner X is easy to miss on a tall list you have to scroll,
   * and the bottom is where you end up once you've read every row and
   * decided none of them is what you wanted.
   */
  onDismiss?: () => void;
  /**
   * Fires whenever ANY row's rename editor opens/closes (card 3bf262ac).
   * When this chooser renders inside the dock's overlay `Dialog` (as
   * opposed to the body-swap `showingChooser` case, which has no Dialog to
   * fight with), Radix's Escape-to-dismiss listener runs in the CAPTURE
   * phase on `document` — BEFORE this component's own rename-input keydown
   * handler ever sees the event — so stopping propagation inside the input
   * cannot, by itself, stop the Dialog from also closing. The dock wires
   * this to `DialogContent`'s own `onEscapeKeyDown`, calling
   * `event.preventDefault()` while a rename is active so the FIRST Escape
   * cancels only the edit (design: "Escape cancels the edit only; the
   * chooser stays dismissable" — a second Escape, with no edit open, still
   * closes the chooser normally). Omitted is safe — it only degrades to
   * "Escape while renaming also closes the chooser", never a trap.
   */
  onRenamingActiveChange?: (active: boolean) => void;
}

export function TerminalSessionChooser({
  sections,
  pendingTask = null,
  busy = false,
  onReconnectHere,
  onOpenBoardAndReconnect,
  onResume,
  onStartNew,
  modelLine = null,
  autoAcceptChip = null,
  onRenameSession,
  cap,
  helperStatus = null,
  onHelperUpdateSettled,
  onDismiss,
  onRenamingActiveChange,
}: TerminalSessionChooserProps) {
  const [confirmingResumeSid, setConfirmingResumeSid] = useState<string | null>(null);
  const firstFocusRef = useRef<HTMLButtonElement | null>(null);

  // Rename (card 3bf262ac) — `renamingSid` hides a row's OTHER actions while
  // its editor is open (design: "one job at a time"); `renameOverrides` is
  // this component's OWN optimistic layer so a row updates the INSTANT save
  // is requested, ahead of the dock re-deriving `sections` from its next
  // registry state (see `onRenameSession`'s doc). Cleared once the async
  // persist settles either way — on success `sections` has (or will
  // imminently) caught up; on failure the row must revert to its prior name.
  const [renamingSid, setRenamingSid] = useState<string | null>(null);
  const [renameOverrides, setRenameOverrides] = useState<Record<string, string | null>>({});

  // See `onRenamingActiveChange`'s doc — lets the dock suppress the overlay
  // Dialog's Escape-to-dismiss (a capture-phase, document-level listener
  // that fires before any row's own input can stop it) while a row is mid-edit.
  useEffect(() => {
    onRenamingActiveChange?.(renamingSid !== null);
  }, [renamingSid, onRenamingActiveChange]);

  const commitRename = useCallback(
    (sid: string, next: string | null, resolvedName: string) => {
      setRenameOverrides((prev) => ({ ...prev, [sid]: next }));
      void (async () => {
        try {
          const result = await onRenameSession?.(sid, next);
          if (!result?.ok) throw new Error("rename failed");
        } catch (err) {
          logger.error("Terminal session rename failed (chooser)", {
            sid,
            error: err instanceof Error ? err.message : String(err),
          });
          // Clearing the override below reverts the row to `resolvedName`
          // (whatever `sections` still says, since the PATCH never landed).
          toast.error(`Couldn't rename the session — it's still called "${resolvedName}".`, {
            action: { label: "Retry", onClick: () => commitRename(sid, next, resolvedName) },
          });
        } finally {
          setRenameOverrides((prev) => {
            if (!(sid in prev)) return prev;
            const { [sid]: _discard, ...rest } = prev;
            return rest;
          });
        }
      })();
    },
    [onRenameSession],
  );

  // Helper-update nudge (card cbe60db5, rework 3): dismissed for the rest of
  // the browser session only — component-local state, not persisted, same
  // mechanism as `dismissedHelperNudge` in terminal-session-view.tsx.
  const [dismissedHelperNudge, setDismissedHelperNudge] = useState(false);

  // Every session this browser already knows about across BOTH live sections
  // (the cap is per-user, not per-board) — also the universe the shared
  // quiesce flow below needs to end before it can safely download, mirroring
  // the My sessions panel's own `running` list.
  const liveCount = sections.liveHere.length + sections.liveElsewhere.length;

  // Shared quiesce-then-download flow (src/lib/terminal/use-helper-update-flow.ts,
  // same hook the My sessions panel drives) — Nick's binding instruction:
  // "both buttons need to stop the old version first".
  const {
    phase: updateFlowPhase,
    confirmSessionCount,
    start: startHelperUpdate,
    confirm: confirmHelperUpdate,
    cancel: cancelHelperUpdate,
  } = useHelperUpdateFlow({
    sessionCount: liveCount,
    onSettled: onHelperUpdateSettled,
  });
  const showHelperNudge =
    updateFlowPhase === "idle" && !dismissedHelperNudge && shouldShowChooserHelperNudge(helperStatus?.version);

  // Focus the first row's primary action when the chooser opens (design:
  // "focus lands on the first live session's primary action when the choice
  // surface opens"); a row badged "was open in this tab" takes priority so
  // Enter reconnects it immediately.
  useEffect(() => {
    firstFocusRef.current?.focus();
    // Only on mount — re-focusing on every prop change would steal focus
    // back from whatever the user is doing (e.g. mid-confirm on Resume).
  }, []);

  // Display-only filter (Nick's field report, 2026-08-17): rows with no
  // recorded folder ("Can't resume — no folder recorded") have nothing to
  // click, so they're dropped from what's actually shown here — but
  // `sections.recent` itself stays unfiltered (see visibleRecentRows's doc
  // comment in chooser-data.ts): `findTaskSessionMatch` above this component
  // and `entry-decision.ts`'s registry read both still need the full set.
  const visibleRecent = visibleRecentRows(sections.recent);

  const taskMatch = pendingTask ? findLiveSessionForTask(sections, pendingTask.taskId) : null;
  const wasOpenSid =
    sections.liveHere.find((r) => r.wasOpenInThisTab)?.sid ??
    sections.liveElsewhere.find((r) => r.wasOpenInThisTab)?.sid ??
    null;

  // Resume confirm's honesty limit line (Nick's sign-off change 1): shown only
  // when the user is close enough to the cap that resuming matters.
  const resolvedCap = cap ?? getTerminalSessionCap();
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
          <HelperUpdateButton onClick={startHelperUpdate} />
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

      {/* Shared quiesce-then-download flow (same states/copy as the My
          sessions panel's Helper row — helper-update-flow.ts): the old
          helper is always stood down before the new DMG downloads, whether
          "Update now" was clicked here or from that panel. */}
      {updateFlowPhase === "confirming" && (
        <div className="border-b border-l-2 border-l-sky-500 bg-sky-500/5 px-3.5 py-2.5">
          <div className="text-[12.5px] font-bold text-sky-300">{UPDATE_CONFIRM_HEADING}</div>
          <div className="text-[11px] text-zinc-500">{updateConfirmBody(confirmSessionCount)}</div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button variant="ghost" size="xs" onClick={cancelHelperUpdate}>
              {UPDATE_CONFIRM_CANCEL_LABEL}
            </Button>
            <Button
              size="xs"
              className="bg-sky-500 text-sky-950 hover:bg-sky-400"
              onClick={confirmHelperUpdate}
            >
              {UPDATE_CONFIRM_ACCEPT_LABEL}
            </Button>
          </div>
        </div>
      )}

      {updateFlowPhase === "quiescing" && (
        <div className="flex items-center gap-2 border-b border-sky-500/30 bg-sky-500/5 px-3.5 py-1.5 text-[11px] text-sky-300">
          <Loader2 className="h-3 w-3 flex-none animate-spin" /> Closing the helper…
        </div>
      )}

      {(updateFlowPhase === "ready" || updateFlowPhase === "quiesce-timeout") && (
        <div
          className={cn(
            "border-b px-3.5 py-2 text-[11px]",
            updateFlowPhase === "ready"
              ? "border-sky-500/30 bg-sky-500/5 text-sky-300"
              : "border-amber-500/30 bg-amber-500/5 text-amber-300",
          )}
        >
          {updateFlowPhase === "ready" ? UPDATE_READY_COPY : UPDATE_QUIESCE_TIMEOUT_COPY}
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

      <div className="border-b border-zinc-800 px-3.5 py-3">
        <div className="flex items-center gap-2.5">
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
        {/* Task c4ca2d95: passive launch-surface visibility (design §4.2) —
            no dialog, no "Change" link in v1 (kept intentionally terse; see
            the implementation report for the scope trim). */}
        {modelLine && (
          <p className="mt-1.5 text-[11px] text-zinc-500">
            {modelLine}
            {autoAcceptChip && <span className="ml-1 font-semibold text-amber-400">· {autoAcceptChip}</span>}
          </p>
        )}
        {/* Task d3de150c: fresh-launches-only reminder, shown only when the
            toggle is actually on — a reconnect/resume in the sections below
            never carries the flag, and this is the one place that matters
            for a reader deciding whether to reconnect or start fresh. */}
        {autoAcceptChip && (
          <p className="mt-1 text-[11px] text-zinc-500">
            Only a fresh session starts in auto-accept mode — reconnecting or resuming keeps asking.
          </p>
        )}
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
              renameOverride={renameOverrides[row.sid]}
              renaming={renamingSid === row.sid}
              onEditingChange={(editing) => setRenamingSid(editing ? row.sid : null)}
              onRenameSession={onRenameSession && commitRename}
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
              renameOverride={renameOverrides[row.sid]}
              renaming={renamingSid === row.sid}
              onEditingChange={(editing) => setRenamingSid(editing ? row.sid : null)}
              onRenameSession={onRenameSession && commitRename}
            />
          ))}
        </ChooserSection>
      )}

      {visibleRecent.length > 0 && (
        <ChooserSection label="Recent — ended in the last 48h">
          {visibleRecent.map((row) => (
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
              renameOverride={renameOverrides[row.sid]}
              renaming={renamingSid === row.sid}
              onEditingChange={(editing) => setRenamingSid(editing ? row.sid : null)}
              onRenameSession={onRenameSession && commitRename}
            />
          ))}
        </ChooserSection>
      )}

      {onDismiss && (
        <div className="flex justify-end border-t border-zinc-800 bg-[#111114] px-3.5 py-2">
          <Button
            variant="ghost"
            size="xs"
            className="text-zinc-400 hover:text-zinc-100"
            onClick={onDismiss}
          >
            <X className="h-3 w-3" /> Close
          </Button>
        </div>
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
  renameOverride,
  renaming = false,
  onEditingChange,
  onRenameSession,
}: {
  row: ChooserLiveRow;
  busy: boolean;
  badge: string | null;
  buttonLabel: string;
  autoFocusRef?: React.RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  /** This component's own optimistic rename layer — see the chooser's `renameOverrides` doc. Undefined → fall back to `row.displayName`. */
  renameOverride?: string | null;
  renaming?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onRenameSession?: (sid: string, next: string | null, resolvedName: string) => void;
}) {
  const userName = renameOverride !== undefined ? renameOverride : row.displayName;
  // Naming rule unification (card 3bf262ac): was `row.taskTitle?.trim() ||
  // row.ideaTitle || row.sid.slice(0, 8)` — a DIFFERENT shape from the tab/
  // panel's `deriveTabLabel`. Now the same helper, same precedence, same
  // fallback everywhere.
  const label = deriveTabLabel({ displayName: userName, taskTitle: row.taskTitle, ideaTitle: row.ideaTitle, sessionId: row.sid });
  // Suppress the secondary idea chip when the label is already the fallback
  // ("<idea title> · <sid4>") — otherwise a never-renamed toolbar session
  // shows the idea title twice (design §1, "De-duplication rule for rows").
  const showIdeaChip = Boolean(row.ideaTitle) && !isFallbackSessionName({ displayName: userName, taskTitle: row.taskTitle });
  const identity = [row.machineLabel, row.cwd].filter(Boolean).join(" · ") || `session ${row.sid.slice(0, 8)}`;
  return (
    <div className="flex items-start gap-2.5 border-t border-zinc-800 px-3.5 py-2.5">
      {!renaming && (
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-zinc-100">
            <span className="truncate" title={label}>
              {label}
            </span>
            {showIdeaChip && <span className="text-[11px] font-normal text-zinc-500">{row.ideaTitle}</span>}
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
      )}
      {onRenameSession && (
        <SessionRenameField
          resolvedName={label}
          userName={userName}
          onSave={(next) => onRenameSession(row.sid, next, label)}
          onEditingChange={onEditingChange}
        />
      )}
      {!renaming && (
        <Button
          ref={autoFocusRef}
          size="xs"
          className="flex-none bg-sky-500 text-sky-950 hover:bg-sky-400"
          disabled={busy}
          onClick={onClick}
        >
          <RefreshCw className="h-3 w-3" /> {buttonLabel}
        </Button>
      )}
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
  renameOverride,
  renaming = false,
  onEditingChange,
  onRenameSession,
}: {
  row: ChooserRecentRow;
  busy: boolean;
  confirming: boolean;
  /** Resume confirm's honesty limit line (Nick's sign-off change 1) — null unless the user is near the cap. */
  limitLine: string | null;
  onRequestConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirm: () => void;
  /** This component's own optimistic rename layer — see the chooser's `renameOverrides` doc. Undefined → fall back to `row.displayName`. */
  renameOverride?: string | null;
  renaming?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onRenameSession?: (sid: string, next: string | null, resolvedName: string) => void;
}) {
  const userName = renameOverride !== undefined ? renameOverride : row.displayName;
  // Naming rule unification (card 3bf262ac) — see LiveRow's identical note.
  // Renaming an ENDED row is exactly the case Nick needs most (Requirements
  // §2's PATCH-route gap, fixed in the API layer this UI now relies on).
  const label = deriveTabLabel({ displayName: userName, taskTitle: row.taskTitle, ideaTitle: row.ideaTitle, sessionId: row.sid });
  // Suppress the secondary idea chip when the label is already the fallback
  // — see LiveRow's identical note (design §1, "De-duplication rule for rows").
  const showIdeaChip = Boolean(row.ideaTitle) && !isFallbackSessionName({ displayName: userName, taskTitle: row.taskTitle });
  // Null-cwd handling: kept defensive even though the caller (this file's
  // `visibleRecent`, via `visibleRecentRows`) now filters null-cwd rows out
  // before they ever reach this component — see chooser-data.ts's
  // `visibleRecentRows` doc comment for why the underlying `ChooserSections`
  // itself is never filtered at the source. If `row.cwd` is ever null here,
  // Resume is simply omitted (never a disabled ghost button) with an honest
  // inline note instead of silently doing nothing.
  return (
    <div className={cn("border-t border-zinc-800 px-3.5 py-2.5", confirming && "bg-emerald-500/5")}>
      <div className="flex items-start gap-2.5">
        {!renaming && (
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-zinc-100">
              <span className="truncate" title={label}>
                {label}
              </span>
              {showIdeaChip && <span className="text-[11px] font-normal text-zinc-500">{row.ideaTitle}</span>}
            </div>
            <div className="truncate font-mono text-[11px] text-zinc-500">
              {row.cwd ?? "no recorded folder"} · ended {formatSessionAge(row.endedAt)} ago
            </div>
          </div>
        )}
        {onRenameSession && (
          <SessionRenameField
            resolvedName={label}
            userName={userName}
            onSave={(next) => onRenameSession(row.sid, next, label)}
            onEditingChange={onEditingChange}
          />
        )}
        {!renaming && !confirming && row.cwd && (
          <Button
            size="xs"
            className="flex-none bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
            disabled={busy}
            onClick={onRequestConfirm}
          >
            Resume
          </Button>
        )}
        {!renaming && !confirming && !row.cwd && (
          <span className="flex-none text-[11px] text-zinc-600">Can&apos;t resume — no folder recorded</span>
        )}
      </div>
      {confirming && row.cwd && (
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
