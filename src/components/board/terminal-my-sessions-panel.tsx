"use client";

// In-app terminal — the global "My sessions" panel (multi-session stage 3,
// design §9). A popover (not a modal — it must never block the board) opened
// from the dock's "My sessions" button. Lists EVERY active session across ALL
// of the user's ideas, newest first, each with an End button (no confirm —
// design §9a: "per-session End uses no confirm, single/visible/reversible").
// The footer's "End all sessions" is the panic button and DOES confirm
// inline (binding note) before calling the same end route with `{ all: true }`.
//
// Fetch-on-open + refresh-after-action (no realtime, per the stage brief).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePostHog } from "posthog-js/react";
import { Loader2, Power, RefreshCw, Terminal as TerminalIcon, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { slugifyIdeaTitle } from "@/lib/launch-claude-code";
import { formatSessionAge, formatSessionIdentity } from "@/lib/terminal/session-registry";
import { deriveTabLabel } from "./terminal-tabs";
import {
  MINIMUM_RECOMMENDED_HELPER_VERSION,
  shouldShowHelperUpdateNudge,
} from "@/lib/terminal/helper-version";
import { TERMINAL_HELPER_DOWNLOAD_URL } from "@/lib/terminal/platform";
import { recordHelperIdleQuitObserved } from "@/lib/terminal/helper-relaunch-signal";
import {
  ALWAYS_ON_CONSENT_BODY,
  ALWAYS_ON_LABEL,
  HELPER_ROW_STOP_FAILED_TOAST,
  HELPER_ROW_STOP_TOAST,
  STOP_CONFIRM_HEADING,
  deriveHelperChip,
  formatHelperEventAge,
  shouldShowStopButton,
  stopButtonLabel,
  stopConfirmBody,
  updateNudgeCopy,
  type HelperChip,
  type HelperChipKind,
  type HelperStatus,
} from "@/lib/terminal/helper-row";
import {
  INITIAL_UPDATE_FLOW_STATE,
  QUIESCE_TIMEOUT_MS,
  UPDATE_CONFIRM_ACCEPT_LABEL,
  UPDATE_CONFIRM_CANCEL_LABEL,
  UPDATE_CONFIRM_HEADING,
  UPDATE_QUIESCE_TIMEOUT_COPY,
  UPDATE_READY_COPY,
  updateConfirmBody,
  updateFlowReducer,
  type UpdateFlowState,
} from "@/lib/terminal/helper-update-flow";

interface ListedSession {
  sid: string;
  ideaId: string;
  ideaTitle: string | null;
  taskId: string | null;
  taskTitle: string | null;
  machineLabel: string | null;
  cwd: string | null;
  createdAt: string;
  /** Session entry chooser (card cbe60db5): the list route now also returns
   *  recently-ended rows (for the chooser) — this panel still shows only
   *  "Running", so it filters on this field client-side (see `running` below). */
  status: "active" | "ended";
  endedAt: string | null;
}

type LoadState = "idle" | "loading" | "ready" | "error";

/** Tailwind classes per chip kind (design §7: status is never colour-alone —
 *  every chip here also carries an icon dot + text label). */
function helperChipClassName(kind: HelperChipKind): string {
  switch (kind) {
    case "running":
      return "border-emerald-500/50 bg-emerald-500/10 text-emerald-400";
    case "winding-down":
      return "border-amber-500/50 bg-amber-500/10 text-amber-400";
    case "stopped-unexpectedly":
      return "border-rose-500/55 bg-rose-500/10 text-rose-400";
    case "not-running":
      return "border-zinc-600 bg-zinc-800/60 text-zinc-300";
  }
}

interface TerminalMySessionsPanelProps {
  /** Fires whenever the panel's RUNNING session count is known/changes, so the dock's badge stays in sync. */
  onCountChange?: (count: number) => void;
  /** Imperative open control — the cap-refusal toast's action opens this panel (design §7b). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Session entry chooser (card cbe60db5, design item 9): "live rows gain
   * Reconnect wired to the same flow (the panel already reaches the dock)".
   * Called with a running row's sid + ideaId; the dock decides whether that's
   * an in-place reattach (this board) or a navigate-and-reconnect (another
   * board). Omitted → no Reconnect button (keeps the panel usable standalone,
   * e.g. in tests).
   */
  onReconnect?: (sid: string, ideaId: string) => void;
  children: ReactNode;
}

export function TerminalMySessionsPanel({
  onCountChange,
  open,
  onOpenChange,
  onReconnect,
  children,
}: TerminalMySessionsPanelProps) {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [sessions, setSessions] = useState<ListedSession[]>([]);
  const [endingSid, setEndingSid] = useState<string | null>(null);
  const [confirmingEndAll, setConfirmingEndAll] = useState(false);
  const [endingAll, setEndingAll] = useState(false);
  const posthog = usePostHog();
  // The panel still shows only "Running" (the chooser is the front door for
  // Recent/Resume now — design item 9) — the list route returns recently-
  // ended rows too (for the chooser), so this filters them back out.
  const running = useMemo(() => sessions.filter((s) => s.status === "active"), [sessions]);

  // ── Helper row state (card cc74a067) ────────────────────────────────────────
  const [helperStatus, setHelperStatus] = useState<HelperStatus | null>(null);
  const [confirmingStopHelper, setConfirmingStopHelper] = useState(false);
  const [stoppingHelper, setStoppingHelper] = useState(false);
  const [dismissedHelperNudge, setDismissedHelperNudge] = useState(false);
  const [updateFlow, setUpdateFlow] = useState<UpdateFlowState>(INITIAL_UPDATE_FLOW_STATE);
  const [alwaysOnConsentOpen, setAlwaysOnConsentOpen] = useState(false);
  const [togglingAlwaysOn, setTogglingAlwaysOn] = useState(false);
  // Last chip kind we observed, so `load()` can notice a winding-down ->
  // not-running transition (an idle-quit) across opens/refreshes — the panel
  // never polls continuously (fetch-on-open + refresh-after-action, same as
  // the session list above), so this is only ever compared across those.
  const prevHelperChipKindRef = useRef<HelperChipKind | null>(null);
  // Set true right before WE deliberately end the helper (Stop / an
  // update-triggered quiesce) so that resulting transition is never
  // mis-recorded as an "idle-quit" — see helper-relaunch-signal.ts's header
  // comment on how this observation is derived.
  const suppressIdleQuitSignalRef = useRef(false);

  const load = useCallback(async () => {
    setLoadState((s) => (s === "idle" ? "loading" : s));
    try {
      const [sessionsRes, helperRes] = await Promise.all([
        fetch("/api/terminal/session/list"),
        fetch("/api/terminal/helper/status"),
      ]);
      if (!sessionsRes.ok) throw new Error(`Failed to load sessions (${sessionsRes.status})`);
      const body = (await sessionsRes.json()) as { sessions: ListedSession[] };
      setSessions(body.sessions);
      const runningCount = body.sessions.filter((s) => s.status === "active").length;
      onCountChange?.(runningCount);

      if (helperRes.ok) {
        const nextStatus = (await helperRes.json()) as HelperStatus;
        const nextChip = deriveHelperChip(nextStatus, runningCount);
        const prevKind = prevHelperChipKindRef.current;
        if (prevKind === "winding-down" && nextChip?.kind === "not-running") {
          if (suppressIdleQuitSignalRef.current) suppressIdleQuitSignalRef.current = false;
          else recordHelperIdleQuitObserved();
        }
        prevHelperChipKindRef.current = nextChip?.kind ?? null;
        setHelperStatus(nextStatus);
      }
      // A helper-status fetch failure is non-fatal to the panel — the session
      // list is the load-bearing part; the Helper row just keeps its last
      // known state (or stays blank) until the next open/refresh succeeds.

      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [onCountChange]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // A stale "Ready to update" / timeout notice must not linger forever once
  // the popover is closed and reopened later — the update flow's own state is
  // otherwise held in this always-mounted component (PopoverContent unmounts
  // on close, this doesn't), same as confirmingEndAll already does.
  useEffect(() => {
    if (!open) return;
    setUpdateFlow((s) => (s.phase === "ready" || s.phase === "quiesce-timeout" ? INITIAL_UPDATE_FLOW_STATE : s));
  }, [open]);

  const endOne = useCallback(
    async (sid: string) => {
      setEndingSid(sid);
      try {
        await fetch("/api/terminal/session/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sid }),
        });
      } catch {
        toast.error("Couldn't end that session — try again.");
      } finally {
        setEndingSid(null);
        void load();
      }
    },
    [load],
  );

  const endAll = useCallback(async () => {
    setEndingAll(true);
    posthog?.capture("terminal_end_all_used", { count: running.length });
    try {
      await fetch("/api/terminal/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      toast.error("Couldn't end all sessions — try again.");
    } finally {
      setEndingAll(false);
      setConfirmingEndAll(false);
      void load();
    }
  }, [load, posthog, running.length]);

  // ── Helper row actions (card cc74a067) ──────────────────────────────────────
  const stopHelper = useCallback(async () => {
    setStoppingHelper(true);
    suppressIdleQuitSignalRef.current = true; // a deliberate Stop is never an "idle-quit"
    try {
      const res = await fetch("/api/terminal/helper/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "stop" }),
      });
      const body = (await res.json().catch(() => null)) as { delivered?: boolean } | null;
      if (res.ok && body?.delivered) toast.success(HELPER_ROW_STOP_TOAST);
      else toast.error(HELPER_ROW_STOP_FAILED_TOAST);
    } catch {
      toast.error(HELPER_ROW_STOP_FAILED_TOAST);
    } finally {
      setStoppingHelper(false);
      setConfirmingStopHelper(false);
      void load();
    }
  }, [load]);

  const setAlwaysOnRemote = useCallback(
    async (value: boolean) => {
      setTogglingAlwaysOn(true);
      try {
        const res = await fetch("/api/terminal/helper/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: "set-always-on", value }),
        });
        const body = (await res.json().catch(() => null)) as { delivered?: boolean } | null;
        if (!res.ok || !body?.delivered) toast.error(HELPER_ROW_STOP_FAILED_TOAST);
      } catch {
        toast.error(HELPER_ROW_STOP_FAILED_TOAST);
      } finally {
        setTogglingAlwaysOn(false);
        void load();
      }
    },
    [load],
  );

  // The toggle's own click never flips the setting directly for the ON
  // direction — turning it on always passes through the consent expansion
  // first (design §3 flow F: "before anything changes"). Turning it OFF is
  // reversible/low-stakes and needs no extra step.
  const handleAlwaysOnToggle = useCallback((next: boolean) => {
    if (next) setAlwaysOnConsentOpen(true);
    else void setAlwaysOnRemote(false);
  }, [setAlwaysOnRemote]);

  const confirmAlwaysOn = useCallback(() => {
    setAlwaysOnConsentOpen(false);
    void setAlwaysOnRemote(true);
  }, [setAlwaysOnRemote]);

  const startHelperUpdate = useCallback(() => {
    setUpdateFlow(updateFlowReducer(INITIAL_UPDATE_FLOW_STATE, { type: "update-clicked", sessionCount: running.length }));
  }, [running.length]);

  // Drive the "quiescing" phase: end any live sessions first (only reached via
  // "confirming" when sessions existed), send the quiesce command, then poll
  // helper status until it reports not-connected or QUIESCE_TIMEOUT_MS elapses
  // (design §3 flow A's fallback notice) — the download starts regardless
  // (§3 flow A caption), just with a different notice.
  useEffect(() => {
    if (updateFlow.phase !== "quiescing") return;
    let cancelled = false;
    suppressIdleQuitSignalRef.current = true; // an update-triggered quiesce is not an idle-quit
    const hadSessions = running.length > 0;
    (async () => {
      if (hadSessions) {
        try {
          await fetch("/api/terminal/session/end", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ all: true }),
          });
        } catch {
          /* best effort — the quiesce command below still proceeds */
        }
      }
      try {
        await fetch("/api/terminal/helper/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: "quiesce" }),
        });
      } catch {
        /* best effort — the poll below still resolves via timeout */
      }

      const deadline = Date.now() + QUIESCE_TIMEOUT_MS;
      while (!cancelled) {
        let settled = false;
        try {
          const res = await fetch("/api/terminal/helper/status");
          if (res.ok) {
            const status = (await res.json()) as HelperStatus;
            settled = status.connected === false;
          }
        } catch {
          /* transient — keep polling until the deadline */
        }
        if (cancelled) return;
        if (settled) {
          setUpdateFlow((s) => updateFlowReducer(s, { type: "quiesce-settled" }));
          return;
        }
        if (Date.now() >= deadline) {
          setUpdateFlow((s) => updateFlowReducer(s, { type: "quiesce-timed-out" }));
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [updateFlow.phase, running.length]);

  // Either outcome of quiescing starts the download (design: the whole point
  // is drag-to-Applications always succeeds because nothing is running by
  // now) and refreshes the row so it reflects the now-quiesced helper.
  useEffect(() => {
    if (updateFlow.phase !== "ready" && updateFlow.phase !== "quiesce-timeout") return;
    window.location.assign(TERMINAL_HELPER_DOWNLOAD_URL);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateFlow.phase]);

  const helperChip: HelperChip | null = deriveHelperChip(helperStatus, running.length);
  const showHelperNudge =
    updateFlow.phase === "idle" &&
    !dismissedHelperNudge &&
    shouldShowHelperUpdateNudge(helperStatus?.version ?? null);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" aria-label="My terminal sessions">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3.5 py-2.5 text-[13px] font-bold text-zinc-200">
          My sessions
          <span className="ml-auto text-[11.5px] font-normal text-zinc-500">runs on your machines</span>
        </div>

        {loadState === "loading" && (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-[12.5px] text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}

        {loadState === "error" && (
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-[12.5px] text-zinc-400">
            Couldn&apos;t load your sessions.
            <Button variant="outline" size="xs" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        {loadState === "ready" && running.length === 0 && (
          <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
            <TerminalIcon className="h-5 w-5 text-zinc-600" />
            <p className="text-[13px] font-semibold text-zinc-300">No terminals running.</p>
            <p className="max-w-[240px] text-[12px] text-zinc-500">
              Launch one from an idea board — Launch Claude Code → In the browser.
            </p>
          </div>
        )}

        {loadState === "ready" && running.length > 0 && onReconnect && (
          <div className="border-t border-zinc-800 px-3.5 py-1.5 text-[11px] text-zinc-500">
            Reconnecting takes over if a session is open in another window or browser — that view stops receiving
            output.
          </div>
        )}
        {loadState === "ready" && running.length > 0 && (
          <ul className="max-h-80 overflow-y-auto">
            {running.map((s) => {
              const ideaSlug = slugifyIdeaTitle(s.ideaTitle ?? "");
              const label = deriveTabLabel({
                taskTitle: s.taskTitle,
                ideaSlug,
                sessionId: s.sid,
              });
              const identity = formatSessionIdentity({
                machineLabel: s.machineLabel,
                cwd: s.cwd,
                sid: s.sid,
              });
              const ending = endingSid === s.sid;
              return (
                <li key={s.sid} className="flex items-center gap-2.5 border-t border-zinc-800 px-3.5 py-2.5 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-zinc-100">
                      <span className="truncate">{label}</span>
                      {s.ideaTitle && (
                        <span className="flex-none truncate text-[11.5px] font-normal text-zinc-500">
                          {s.ideaTitle}
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[11px] text-zinc-500">{identity}</div>
                  </div>
                  <span className="flex-none text-[11.5px] text-zinc-500">{formatSessionAge(s.createdAt)}</span>
                  {onReconnect && (
                    <Button
                      variant="outline"
                      size="xs"
                      className="flex-none border-sky-500/45 bg-transparent text-sky-400 hover:bg-sky-500/10"
                      disabled={ending}
                      onClick={() => onReconnect(s.sid, s.ideaId)}
                      aria-label={`Reconnect: ${label}`}
                    >
                      <RefreshCw className="h-3 w-3" /> Reconnect
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="xs"
                    className="flex-none border-rose-500/45 bg-transparent text-rose-400 hover:bg-rose-500/10"
                    disabled={ending}
                    onClick={() => void endOne(s.sid)}
                    aria-label={`End session: ${label}`}
                  >
                    {ending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />} End
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {loadState === "ready" && running.length > 0 && (
          <div
            className={cn(
              "flex items-center gap-2.5 border-t border-zinc-800 px-3.5 py-2.5",
              confirmingEndAll && "border-l-2 border-l-rose-500 bg-rose-500/5",
            )}
          >
            {confirmingEndAll ? (
              <>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-bold text-rose-400">End all {running.length} sessions?</div>
                  <div className="text-[11px] text-zinc-500">
                    Claude stops on your machine in every one. Unpushed worktree changes stay on disk.
                  </div>
                </div>
                <Button variant="ghost" size="xs" onClick={() => setConfirmingEndAll(false)} disabled={endingAll}>
                  Cancel
                </Button>
                <Button
                  size="xs"
                  className="flex-none bg-rose-500 text-rose-950 hover:bg-rose-400"
                  onClick={() => void endAll()}
                  disabled={endingAll}
                >
                  {endingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />} End all
                </Button>
              </>
            ) : (
              <>
                <span className="text-[11.5px] text-zinc-500">{running.length} sessions</span>
                <Button
                  variant="outline"
                  size="xs"
                  className="ml-auto flex-none border-rose-500/45 bg-transparent text-rose-400 hover:bg-rose-500/10"
                  onClick={() => setConfirmingEndAll(true)}
                >
                  <Power className="h-3 w-3" /> End all sessions
                </Button>
              </>
            )}
          </div>
        )}

        {/* Helper row (design §5a) — lives beneath sessions, above nothing
            else, so "what's running for me on this Mac" has one home. */}
        {loadState === "ready" && helperChip && (
          <div className="flex items-center gap-2.5 border-t border-zinc-800 bg-white/[0.015] px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold",
                    helperChipClassName(helperChip.kind),
                  )}
                >
                  <span className="h-1.5 w-1.5 flex-none rounded-full bg-current" />
                  {helperChip.label}
                </span>
                {helperChip.kind !== "not-running" && (helperStatus?.version || helperStatus?.machineLabel) && (
                  <span className="text-[11.5px] text-zinc-500">
                    {[helperStatus?.version ? `v${helperStatus.version}` : null, helperStatus?.machineLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
                {helperChip.kind === "stopped-unexpectedly" && helperStatus?.lastEventAt != null && (
                  <span className="text-[11.5px] text-zinc-500">
                    {formatHelperEventAge(helperStatus.lastEventAt)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11.5px] text-zinc-500">{helperChip.subline}</div>
            </div>
            {shouldShowStopButton(helperChip) && (
              <Button
                variant="outline"
                size="xs"
                className="flex-none"
                onClick={() => setConfirmingStopHelper(true)}
                disabled={stoppingHelper}
              >
                {stopButtonLabel(helperChip)}
              </Button>
            )}
          </div>
        )}

        {confirmingStopHelper && (
          <div className="border-t border-l-2 border-l-rose-500 bg-rose-500/5 px-3.5 py-2.5">
            <div className="text-[12.5px] font-bold text-rose-400">{STOP_CONFIRM_HEADING}</div>
            <div className="text-[11px] text-zinc-500">{stopConfirmBody(running.length)}</div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button variant="ghost" size="xs" onClick={() => setConfirmingStopHelper(false)} disabled={stoppingHelper}>
                Cancel
              </Button>
              <Button
                size="xs"
                className="bg-rose-500 text-rose-950 hover:bg-rose-400"
                onClick={() => void stopHelper()}
                disabled={stoppingHelper}
              >
                {stoppingHelper ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />} Stop helper
              </Button>
            </div>
          </div>
        )}

        {showHelperNudge && (
          <div className="flex items-center gap-2 border-t border-sky-500/30 bg-sky-500/5 px-3.5 py-1.5 text-[11.5px] text-sky-300">
            <span className="flex-1">{updateNudgeCopy(MINIMUM_RECOMMENDED_HELPER_VERSION)}</span>
            <Button size="xs" className="flex-none bg-sky-500 text-sky-950 hover:bg-sky-400" onClick={startHelperUpdate}>
              Update now
            </Button>
            <button
              type="button"
              className="flex-none text-sky-400 hover:text-sky-200"
              onClick={() => setDismissedHelperNudge(true)}
              aria-label="Dismiss helper update notice"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {updateFlow.phase === "confirming" && (
          <div className="border-t border-l-2 border-l-sky-500 bg-sky-500/5 px-3.5 py-2.5">
            <div className="text-[12.5px] font-bold text-sky-300">{UPDATE_CONFIRM_HEADING}</div>
            <div className="text-[11px] text-zinc-500">{updateConfirmBody(updateFlow.sessionCount)}</div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button variant="ghost" size="xs" onClick={() => setUpdateFlow((s) => updateFlowReducer(s, { type: "cancelled" }))}>
                {UPDATE_CONFIRM_CANCEL_LABEL}
              </Button>
              <Button
                size="xs"
                className="bg-sky-500 text-sky-950 hover:bg-sky-400"
                onClick={() => setUpdateFlow((s) => updateFlowReducer(s, { type: "confirmed" }))}
              >
                {UPDATE_CONFIRM_ACCEPT_LABEL}
              </Button>
            </div>
          </div>
        )}

        {updateFlow.phase === "quiescing" && (
          <div className="flex items-center gap-2 border-t border-sky-500/30 bg-sky-500/5 px-3.5 py-1.5 text-[11.5px] text-sky-300">
            <Loader2 className="h-3 w-3 flex-none animate-spin" /> Closing the helper…
          </div>
        )}

        {(updateFlow.phase === "ready" || updateFlow.phase === "quiesce-timeout") && (
          <div
            className={cn(
              "border-t px-3.5 py-2 text-[11.5px]",
              updateFlow.phase === "ready"
                ? "border-sky-500/30 bg-sky-500/5 text-sky-300"
                : "border-amber-500/30 bg-amber-500/5 text-amber-300",
            )}
          >
            {updateFlow.phase === "ready" ? UPDATE_READY_COPY : UPDATE_QUIESCE_TIMEOUT_COPY}
          </div>
        )}

        {/* "Keep helper ready" — approved for v1 (card cc74a067's design-review
            note). The consent expansion below is the moment before anything
            changes (design §3 flow F); turning it off needs no such step. */}
        {loadState === "ready" && helperStatus && (
          <div className="flex items-center gap-2 border-t border-zinc-800 px-3.5 py-2">
            <span className="flex-1 text-[12px] font-medium text-zinc-300">{ALWAYS_ON_LABEL}</span>
            <Switch
              size="sm"
              checked={helperStatus.alwaysOn}
              onCheckedChange={handleAlwaysOnToggle}
              disabled={togglingAlwaysOn}
              aria-label={ALWAYS_ON_LABEL}
            />
          </div>
        )}
        {alwaysOnConsentOpen && (
          <div className="border-t border-l-2 border-l-emerald-500 bg-emerald-500/5 px-3.5 py-2.5">
            <div className="text-[11px] text-zinc-400">{ALWAYS_ON_CONSENT_BODY}</div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button variant="ghost" size="xs" onClick={() => setAlwaysOnConsentOpen(false)}>
                Cancel
              </Button>
              <Button
                size="xs"
                className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
                onClick={confirmAlwaysOn}
                disabled={togglingAlwaysOn}
              >
                Turn on
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
