"use client";

// In-app terminal — the POPPED-OUT window's own session chrome (multi-session
// stage 4, docs/design-terminal-multi-session-popout.html §10a, D1-D7).
//
// Deliberately its OWN small component rather than a reuse of
// terminal-session-view.tsx: that component's contract is tab-strip-shaped
// (a `SessionEntry`, an `onReportSummary`/`onRegisterActions` pair the dock
// consumes, a `poppedOut` placeholder branch it renders INSTEAD of a body) —
// none of that applies inside the popped window itself, which has no tabs, no
// dock, and exactly one thing to show: "status · identity · read-only · End"
// (the binding note's P1 header quartet) plus the stream. Reusing the dock's
// component here would mean threading a pile of no-op callbacks through it for
// a context it was never shaped for; a small dedicated view is the more honest
// fit. `dockStatusMeta` / `resolveDockView` (pure, already exported) ARE
// reused, so the pill language matches the dock everywhere.
//
// This view ATTACHES to an already-minted session (via `useTerminalSession`'s
// `attachExisting` option) — it never mints, never fires a deep link, never
// runs the install-first gate. See use-terminal-session.ts's `attachExisting`
// doc for why that's safe (same-owner reattach, relay's existing 4001 path).

import { useEffect, useState } from "react";
import { CircleAlert, Info, Loader2, Lock, LockOpen, Power, Square, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveDockView, type DockView } from "@/lib/terminal/first-run-flow";
import type { TerminalConnectionState } from "@/lib/terminal/connection";
import { isPreemptedClose, type PopoutPayload } from "@/lib/terminal/popout-channel";
import { dockStatusMeta } from "./terminal-session-view";
import {
  useTerminalSession,
  type AttachExistingPair,
  type TerminalSessionDescriptor,
} from "./use-terminal-session";

interface TerminalPopoutViewProps {
  payload: PopoutPayload;
}

export function TerminalPopoutView({ payload }: TerminalPopoutViewProps) {
  const descriptor: TerminalSessionDescriptor = {
    ideaId: payload.ideaId,
    ideaTitle: payload.ideaTitle,
    // No launch prompt is ever built in this window (attachExisting skips
    // the whole launch path), so the GitHub URL that path would need is
    // simply never read here.
    ideaGithubUrl: null,
  };
  const attach: AttachExistingPair = { sessionId: payload.sid, browserToken: payload.browserToken };

  const session = useTerminalSession(descriptor, {
    enabled: true,
    // The popped window has no collapse/expand concept — it's always "open".
    expanded: true,
    requestExpand: () => {},
    // Critical: without this, the pristine/paired auto-connect effect would
    // see "expanded, idle, paired" on THIS window too and mint a SECOND,
    // orphaned session the instant it mounts. attachExisting is this
    // window's only entry point.
    autoConnectWhenExpanded: false,
    attachExisting: attach,
  });
  const { state, readOnly, inputEnabled, launchPhase, platform, paired, containerRef, actions } = session;

  // Apply the read-only toggle state the dock tab was in at the moment of
  // pop-out (D1's payload) — once, on mount. `actions.setReadOnly` is the
  // hook's own `useState` setter, so it's referentially stable; this is safe
  // to run exactly once despite the empty dependency array.
  useEffect(() => {
    actions.setReadOnly(payload.readOnly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.title = `Terminal · ${payload.label}`;
  }, [payload.label]);

  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const view = resolveDockView(state.status, launchPhase, platform.supported, paired);
  const meta = dockStatusMeta(view, state.errorKind);
  const showStream = state.status === "connected" || state.status === "disconnected";
  const showEnd =
    view === "connected" || view === "disconnected" || view === "connecting" || view === "connecting-returning";

  // The binding note's special case: THIS window's own leg was preempted
  // (4001) — within this feature that has exactly one cause, "Bring back to
  // dock" (explicit or via this window's own close-signal racing it). Show a
  // calm hand-off message, never the generic "duplicate session" error copy.
  const broughtBack = state.status === "error" && isPreemptedClose(state.closeCode);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-[#141417] px-3 py-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold",
            meta.className,
          )}
        >
          <meta.Icon className={cn("h-3 w-3", meta.spin && "animate-spin")} />
          {meta.label}
        </span>
        {readOnly && state.status === "connected" && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/55 bg-violet-500/10 px-2 py-1 text-[11px] font-bold text-violet-300">
            <Lock className="h-3 w-3" /> Read-only
          </span>
        )}
        <span className="font-mono text-xs text-zinc-500">{payload.identity}</span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          {showStream && (
            <Button
              variant="outline"
              size="xs"
              className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
              onClick={() => actions.setReadOnly((r) => !r)}
              aria-pressed={readOnly}
              aria-label={readOnly ? "Read-only is on — click to allow input" : "Switch to read-only"}
            >
              {readOnly ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
              {readOnly ? "Read-only · on" : "Read-only"}
            </Button>
          )}
          {showEnd && (
            <Button
              variant="outline"
              size="xs"
              className="border-rose-500/45 bg-transparent text-rose-400 hover:bg-rose-500/10"
              onClick={actions.end}
              aria-label="End session"
            >
              <Power className="h-3 w-3" /> End
            </Button>
          )}
        </span>
      </div>

      {/* One-time MVP scrollback honesty (D5, AC 17): dismissible, never
          reappears once closed. Disappears entirely once a future
          serialize-addon transfer ships real scrollback (design §10a). */}
      {showStream && !noticeDismissed && (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-sky-500/25 bg-sky-500/[0.07] px-3 py-1.5 text-[11.5px] text-sky-300"
        >
          <Info className="h-3.5 w-3.5 flex-none" />
          Showing output from pop-out onward.
          <button
            type="button"
            className="ml-auto flex-none text-sky-400/70 hover:text-sky-200"
            aria-label="Dismiss notice"
            onClick={() => setNoticeDismissed(true)}
          >
            ✕
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className={cn("h-full w-full px-3 py-2", state.status === "disconnected" && "opacity-45")}
        />
        {broughtBack ? (
          <BroughtBackOverlay />
        ) : (
          !showStream && <PopoutOverlay view={view} state={state} onRetry={actions.reconnectNow} />
        )}
        {state.status === "disconnected" && !broughtBack && (
          <div className="absolute inset-x-0 bottom-0 border-t border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            <b>Reconnecting to your session…</b> Your machine may have slept or dropped Wi-Fi. Your agent keeps
            running locally while we reattach.
            <button className="ml-2 underline hover:text-amber-200" onClick={actions.reconnectNow}>
              Reconnect now
            </button>
          </div>
        )}
      </div>

      {state.status === "connected" &&
        (inputEnabled ? (
          <div className="flex items-center gap-2 border-t border-zinc-800 bg-[#141417] px-3 py-2 text-xs text-zinc-500">
            <span className="font-mono text-emerald-400">›</span>
            <span>Click the terminal and type to steer the agent. Enter sends.</span>
          </div>
        ) : (
          <div className="border-t border-zinc-800 bg-violet-500/5 px-3 py-2 text-[11px] text-zinc-400">
            <Lock className="mr-1 inline h-3 w-3 text-violet-300" />
            <b className="text-violet-300">Read-only is on.</b> You&apos;re watching live; keystrokes are frozen.
            <button className="ml-2 underline hover:text-zinc-200" onClick={() => actions.setReadOnly(false)}>
              Allow input
            </button>
          </div>
        ))}
    </div>
  );
}

// The calm "the dock took this back" state (binding note) — replaces the
// generic P1 "duplicate session" error copy for exactly this one cause.
function BroughtBackOverlay() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0c0c0e]/95 px-6 py-6 text-center">
      <Undo2 className="h-7 w-7 text-sky-400" />
      <div className="text-base font-semibold text-sky-400">Brought back to the dock</div>
      <p className="max-w-md text-[13px] text-zinc-400">
        This session moved back to its board tab — you can close this window.
      </p>
      <Button
        variant="outline"
        className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
        onClick={() => window.close()}
      >
        Close window
      </Button>
    </div>
  );
}

// Every OTHER overlay this window can realistically hit — attach-in-progress,
// an honest error, or the session having ended entirely. Deliberately not a
// reuse of terminal-session-view.tsx's install-first StateOverlay: none of
// its setup/coming-soon/timeout branches are reachable from attachExisting
// (no mint, no deep link ever fires here), so a small tailored overlay is
// clearer than importing states that can't occur.
function PopoutOverlay({
  view,
  state,
  onRetry,
}: {
  view: DockView;
  state: TerminalConnectionState;
  onRetry: () => void;
}) {
  if (view === "session-ended") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0c0c0e]/95 px-6 py-6 text-center">
        <Square className="h-7 w-7 text-zinc-400" />
        <div className="text-base font-semibold text-zinc-300">Session ended</div>
        <p className="max-w-md text-[13px] text-zinc-400">
          Claude Code on your machine stopped. The scrollback above is kept — you can close this window, or check
          the board for what happened.
        </p>
      </div>
    );
  }

  if (view === "error") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0c0c0e]/95 px-6 py-6 text-center">
        <CircleAlert className="h-7 w-7 text-rose-400" />
        <div className="text-base font-semibold text-rose-400">Couldn&apos;t reattach</div>
        <p className="max-w-md text-[13px] text-zinc-400">
          {state.errorKind === "owner-mismatch"
            ? "For safety, a session only attaches for the account that owns it."
            : "We couldn't reconnect this window to your session. Your work on your machine is safe."}
        </p>
        {state.errorKind !== "owner-mismatch" && (
          <Button
            variant="outline"
            size="sm"
            className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
            onClick={onRetry}
          >
            Try again
          </Button>
        )}
      </div>
    );
  }

  // connecting / connecting-returning / legacy-waiting / timeout-* / idle —
  // all read as "still attaching" from this window's point of view (it's
  // reattaching to a session that was already live a moment ago in another
  // window, so this is normally near-instant).
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0c0c0e]/95 px-6 py-6 text-center">
      <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
      <div className="text-base font-semibold text-amber-400">Reattaching…</div>
      <p className="max-w-md text-[13px] text-zinc-400">Connecting this window to your session.</p>
    </div>
  );
}
