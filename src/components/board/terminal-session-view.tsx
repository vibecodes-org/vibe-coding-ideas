"use client";

// In-app terminal — ONE TAB's session chrome (multi-session stage 2).
//
// Mounts exactly one `useTerminalSession` instance and renders the P1 session
// panel (status pill, identity line, read-only/End controls, terminal viewport,
// reconnect/peer-degraded banners, input row) UNCHANGED from the single-session
// dock — this file is that markup, relocated so `terminal-dock.tsx` can mount
// ONE of these PER TAB (`SessionEntry`, see terminal-tabs.ts) instead of one for
// the whole board.
//
// Mount/visibility strategy (B2/B4): the dock renders EVERY entry's
// `TerminalSessionView` on EVERY render, always — never conditionally, never
// keyed out — so every tab's socket, xterm buffer, heartbeat watchdog and
// grace-window reconnect loop keep running while it's in the background. Only
// the ACTIVE tab's panel is visually shown; a background tab's panel gets
// Tailwind's `hidden` (display:none) via the `isActive` prop — CSS, never an
// unmount. `useTerminalSession`'s own effects don't care whether their
// container is visible (the pre-existing "container may be 0-size while
// collapsed" degradation already covers this — see that hook's xterm-init
// effect) — becoming active again just re-triggers its resize-on-expand /
// focus-on-expand effects (see the `expanded` prop below), exactly like
// re-opening the P1 dock did.
//
// This view does NOT own the tab strip, the collapsed bar, or launch-bus
// routing — those are board-wide (one dock, many tabs) and live in
// terminal-dock.tsx. It reports enough about its own session upward
// (`onReportSummary`) for the dock to build the tab glyph, the collapsed-bar
// worst-first summary, and the B10 dedupe check without lifting this session's
// full state out of the component that actually owns it.

import { useEffect, useRef, type ReactNode } from "react";
import {
  CircleDot,
  Loader2,
  WifiOff,
  Square,
  CircleAlert,
  Power,
  Lock,
  LockOpen,
  Copy,
  Clock,
  Info,
  Laptop,
  Terminal as TerminalIcon,
  RotateCw,
  Download,
  ChevronRight,
  Circle,
  CircleDashed,
  ExternalLink,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TerminalConnectionState, TerminalStatus } from "@/lib/terminal/connection";
import { type TerminalPlatform, TERMINAL_HELPER_DOWNLOAD_URL } from "@/lib/terminal/platform";
import { FIRST_RUN_COPY } from "@/lib/terminal/first-run-copy";
import { type DockView, type LaunchPhase, resolveDockView } from "@/lib/terminal/first-run-flow";
import {
  formatAttentionAnnouncement,
  shouldAnnounceAttention,
  type SessionEntry,
} from "./terminal-tabs";
import {
  useTerminalSession,
  type PairInfo,
  type TerminalSessionActions,
  type TerminalSessionDescriptor,
} from "./use-terminal-session";

/**
 * Everything the dock needs about ONE tab's session without lifting the whole
 * hook result out of the component that owns it. `launchPhase` /
 * `platformSupported` / `paired` exist ONLY so the collapsed bar can rebuild
 * the exact single-session pill `resolveDockView` + `dockStatusMeta` produced
 * pre-multi-session (B5: "single session keeps P1's existing copy") — with 2+
 * tabs the dock uses `summarizeSessionStatuses` over `status` instead and never
 * touches these three.
 */
export interface SessionSummary {
  status: TerminalStatus;
  sessionId: string | null;
  errorKind: TerminalConnectionState["errorKind"];
  launchPhase: LaunchPhase;
  platformSupported: boolean;
  paired: boolean;
  /**
   * Multi-session stage 4 (D1): the browser-leg token, mirrored up so the
   * dock can build a pop-out hand-off payload WITHOUT threading a second
   * imperative accessor through the actions registry — it changes in
   * lock-step with `sessionId` (both are set together by connect()/
   * attachToExisting), so it's always current whenever sessionId is. `null`
   * before a session exists (nothing to pop out).
   */
  browserToken: string | null;
  /** Mirrored so a pop-out payload can carry the CURRENT read-only toggle across into the popped window (D1). */
  readOnly: boolean;
}

interface TerminalSessionViewProps {
  entry: SessionEntry;
  descriptor: TerminalSessionDescriptor;
  /** This tab's label, for the a11y announcer ("Terminal "<label>": reconnecting"). */
  label: string;
  isActive: boolean;
  /** Is the dock panel open AND is this the active tab? See use-terminal-session's doc. */
  expanded: boolean;
  onRequestExpand: () => void;
  /**
   * Only the pristine (never-launched) entry auto-connects when a paired
   * browser opens the panel — every explicitly-launched tab delivers its own
   * launch below instead (see the module doc on `UseTerminalSessionOptions`
   * in use-terminal-session.ts for why both firing together would double-mint).
   */
  autoConnectWhenExpanded: boolean;
  onReportSummary: (key: string, summary: SessionSummary) => void;
  onRegisterActions: (key: string, actions: TerminalSessionActions | null) => void;
  onAnnounce: (text: string) => void;
  /** Opens the dock's "My sessions" panel on a cap refusal (E1, design §7b). */
  onCapExceeded?: () => void;
  /**
   * Multi-session stage 4 (D1-D7): true once the dock has popped this tab's
   * session out into its own window. Renders the "Popped out" placeholder
   * (design §10b) INSTEAD OF the normal header/body/input — the underlying
   * `useTerminalSession` instance keeps running unaffected (its socket gets
   * preempted by the relay moments after the popped window attaches, exactly
   * like any other 4001 close), it's purely this component's PRESENTATION
   * that changes. Omitted/false renders exactly as before (P1 unchanged).
   */
  poppedOut?: boolean;
  /** "Pop out" header control (D1/D2) — omitted hides the button entirely. */
  onPopOut?: () => void;
  /** "Bring back to dock" (D3) — only rendered while `poppedOut`. */
  onBringBack?: () => void;
}

export function TerminalSessionView({
  entry,
  descriptor,
  label,
  isActive,
  expanded,
  onRequestExpand,
  autoConnectWhenExpanded,
  onReportSummary,
  onRegisterActions,
  onAnnounce,
  onCapExceeded,
  poppedOut = false,
  onPopOut,
  onBringBack,
}: TerminalSessionViewProps) {
  const session = useTerminalSession(descriptor, {
    enabled: true,
    expanded,
    requestExpand: onRequestExpand,
    autoConnectWhenExpanded,
    taskId: entry.taskId,
    taskTitle: entry.taskTitle,
    onCapExceeded,
  });
  const { state, launchPhase, peerDegraded, pair, readOnly, inputEnabled, platform, paired, containerRef, actions } =
    session;

  // Deliver this entry's launch exactly once per `launchSeq` bump (B7/B10): a
  // real bus payload goes through `launchFromBus` (carries the resolved
  // task/board prompt); a payload-less launch (the "+" affordance, or the
  // pristine slot's very first bus delivery with nothing carried) runs the same
  // install-first gate the hook's own Connect button and paired auto-connect
  // use, via `beginBrowserLaunch`.
  const deliveredSeqRef = useRef(0);
  useEffect(() => {
    if (entry.launchSeq === 0) return;
    if (deliveredSeqRef.current === entry.launchSeq) return;
    deliveredSeqRef.current = entry.launchSeq;
    if (entry.launchPayload) actions.launchFromBus(entry.launchPayload);
    else actions.beginBrowserLaunch();
    // launchFromBus/beginBrowserLaunch are useCallback-stable across renders
    // (their own deps are just the descriptor + internal refs), so depending on
    // them directly — not on `actions` itself, which is a fresh object every
    // render — keeps this effect from re-running on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.launchSeq, entry.launchPayload, actions.launchFromBus, actions.beginBrowserLaunch]);

  // Report this tab's status/sessionId upward on every change (tab glyph,
  // collapsed-bar summary, B10 dedupe candidates) and — only for a BACKGROUND
  // tab entering a needs-attention state — fire the single shared aria-live
  // announcement (a11y, design §14).
  const prevStatusRef = useRef<TerminalStatus | undefined>(undefined);
  useEffect(() => {
    onReportSummary(entry.key, {
      status: state.status,
      sessionId: pair?.sessionId ?? null,
      errorKind: state.errorKind,
      launchPhase,
      platformSupported: platform.supported,
      paired,
      browserToken: pair?.browserToken ?? null,
      readOnly,
    });
    if (shouldAnnounceAttention(prevStatusRef.current, state.status, isActive)) {
      onAnnounce(formatAttentionAnnouncement(label, state.status));
    }
    prevStatusRef.current = state.status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    entry.key,
    state.status,
    state.errorKind,
    pair?.sessionId,
    launchPhase,
    platform.supported,
    paired,
    isActive,
    label,
    readOnly,
  ]);

  // Keep the dock's action registry current so a tab strip close (×) — which
  // lives in the PARENT, not here — can call this session's own `end()`
  // without lifting the whole hook result out of this component.
  useEffect(() => {
    onRegisterActions(entry.key, actions);
  });
  useEffect(() => () => onRegisterActions(entry.key, null), [entry.key, onRegisterActions]);

  const view = resolveDockView(state.status, launchPhase, platform.supported, paired);
  const meta = dockStatusMeta(view, state.errorKind);
  const showStream = state.status === "connected" || state.status === "disconnected";
  const canLaunch =
    state.status === "idle" ||
    state.status === "error" ||
    state.status === "session-ended" ||
    state.status === "disconnected";
  const showEnd =
    view === "connected" ||
    view === "disconnected" ||
    view === "connecting" ||
    view === "connecting-returning" ||
    view === "legacy-waiting";

  // Multi-session stage 4 (D2/D3, design §10b): once this tab has been popped
  // out, its whole body becomes the placeholder — no header/pill/stream/input.
  // The underlying `useTerminalSession` instance above keeps running (its
  // socket will shortly be preempted by the relay, or already has been); we
  // just don't SHOW any of that here. The tab strip above this component is
  // unaffected (owned by terminal-dock.tsx).
  if (poppedOut) {
    return (
      <div className={cn(!isActive && "hidden")} aria-hidden={!isActive}>
        <div className="flex h-[38vh] min-h-[220px] flex-col items-center justify-center gap-3 bg-[#0c0c0e] px-6 py-6 text-center">
          <span className="text-2xl text-violet-400" aria-hidden="true">
            ⧉
          </span>
          <div className="text-base font-semibold text-violet-400">Popped out</div>
          <p className="max-w-md text-[13px] text-zinc-400">
            This session is open in another window. It keeps running there — close that window and it
            returns here automatically.
          </p>
          <Button
            className="bg-sky-500 text-sky-950 hover:bg-sky-400"
            onClick={onBringBack}
            aria-label={`Bring back to dock: ${label}`}
          >
            <Undo2 className="h-4 w-4" /> Bring back to dock
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(!isActive && "hidden")} aria-hidden={!isActive}>
      {/* Header: state · identity · controls (safest → most destructive) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-[#141417] px-3 py-2">
        <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold", meta.className)}>
          <meta.Icon className={cn("h-3 w-3", meta.spin && "animate-spin")} />
          {meta.label}
        </span>
        {readOnly && state.status === "connected" && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/55 bg-violet-500/10 px-2 py-1 text-[11px] font-bold text-violet-300">
            <Lock className="h-3 w-3" /> Read-only
          </span>
        )}
        <span className="hidden font-mono text-xs text-zinc-500 sm:inline">
          {descriptor.ideaTitle}
          {pair && <span className="text-zinc-600"> · session {pair.sessionId.slice(0, 8)}</span>}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          {/* Pop out (D1/D2, design §4 "one new header control, in the old
              header") — left of Read-only/End, per the design's control
              cluster ordering (safest → most destructive). Gated on
              `showStream` like Read-only: popping out only makes sense once
              there's a live/reconnecting stream to move into another window;
              `onPopOut` itself is dock-only (the popped window's own view
              never renders this component with a handler wired). */}
          {showStream && onPopOut && (
            <Button
              variant="outline"
              size="xs"
              className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
              onClick={onPopOut}
              aria-label="Pop this session out into its own window"
            >
              <ExternalLink className="h-3 w-3" /> Pop out
            </Button>
          )}
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

      {/* Terminal body — the xterm host plus a state overlay. The host stays
          mounted under every state so scrollback is frozen + readable on end. */}
      <div className="relative h-[38vh] min-h-[220px]">
        <div
          ref={containerRef}
          className={cn("h-full w-full px-3 py-2", state.status === "disconnected" && "opacity-45")}
        />
        {!showStream && (
          <StateOverlay
            view={view}
            state={state}
            pair={pair}
            platform={platform}
            canLaunch={canLaunch}
            onConnect={() => void actions.connect({ autoLaunch: true })}
            onRetry={() => void actions.connect({ autoLaunch: true })}
            onLaunchAgain={actions.beginBrowserLaunch}
            onCopyBridge={actions.copyBridgeCommand}
          />
        )}
        {state.status === "disconnected" && (
          <div className="absolute inset-x-0 bottom-0 border-t border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            <b>Reconnecting to your session…</b> Your machine may have slept or dropped Wi-Fi. Your agent keeps running locally while we reattach.
            <button className="ml-2 underline hover:text-amber-200" onClick={actions.reconnectNow}>
              Reconnect now
            </button>
          </div>
        )}
        {state.status === "connected" && peerDegraded && (
          <div className="absolute inset-x-0 bottom-0 border-t border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            <b>Connection interrupted — reconnecting…</b> Your machine may have slept; we&apos;re holding your session and will resume automatically.
          </div>
        )}
      </div>

      {/* Input affordance — read-write bar, or the read-only explanatory note. */}
      {state.status === "connected" && (
        inputEnabled ? (
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
        )
      )}
    </div>
  );
}

export interface StatusMeta {
  label: string;
  Icon: typeof Circle;
  spin?: boolean;
  className: string;
}

// Header pill — icon + text + colour (never colour alone), one per view. Exported
// so the dock can rebuild the IDENTICAL single-session collapsed-bar pill (B5:
// "single session keeps P1's existing copy") from a reported SessionSummary
// without duplicating this table.
export function dockStatusMeta(
  view: DockView,
  errorKind: TerminalConnectionState["errorKind"],
): StatusMeta {
  switch (view) {
    case "connected":
      return { label: "Connected", Icon: CircleDot, className: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400" };
    case "connecting":
    case "connecting-returning":
      return { label: "Connecting…", Icon: Loader2, spin: true, className: "border-amber-500/50 bg-amber-500/10 text-amber-400" };
    case "legacy-waiting":
      return { label: "Waiting to pair", Icon: Loader2, spin: true, className: "border-sky-500/50 bg-sky-500/10 text-sky-400" };
    case "timeout-new":
    case "timeout-returning":
      return { label: FIRST_RUN_COPY.pill.notConnected, Icon: CircleDashed, className: "border-zinc-600 bg-zinc-800/60 text-zinc-300" };
    case "setup":
      return { label: FIRST_RUN_COPY.pill.setup, Icon: Circle, className: "border-zinc-700 bg-zinc-800/60 text-zinc-400" };
    case "coming-soon":
      return { label: FIRST_RUN_COPY.pill.comingSoon, Icon: Clock, className: "border-zinc-700 bg-zinc-800/60 text-zinc-400" };
    case "disconnected":
      return { label: "Reconnecting…", Icon: WifiOff, className: "border-zinc-600 bg-zinc-800/60 text-zinc-300" };
    case "session-ended":
      return { label: "Session ended", Icon: Square, className: "border-zinc-600 bg-zinc-800/60 text-zinc-300" };
    case "error":
      return { label: errorKind === "owner-mismatch" ? "Owner mismatch" : "Error", Icon: CircleAlert, className: "border-rose-500/55 bg-rose-500/10 text-rose-400" };
    default:
      return { label: "Terminal · off", Icon: Circle, className: "border-zinc-700 bg-zinc-800/60 text-zinc-400" };
  }
}

// ── per-view centred overlays (icon + text + next step) ───────────────────────
function StateOverlay({
  view,
  state,
  pair,
  platform,
  canLaunch,
  onConnect,
  onRetry,
  onLaunchAgain,
  onCopyBridge,
}: {
  view: DockView;
  state: TerminalConnectionState;
  pair: PairInfo | null;
  platform: TerminalPlatform;
  canLaunch: boolean;
  onConnect: () => void;
  onRetry: () => void;
  onLaunchAgain: () => void;
  onCopyBridge: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-[#0c0c0e]/95 px-6 py-6 text-center">
      {view === "coming-soon" && <ComingSoonPanel />}

      {view === "setup" && <SetupPanel platform={platform} onConnect={onConnect} />}

      {(view === "connecting" || view === "connecting-returning") && (
        <ConnectingPanel returning={view === "connecting-returning"} />
      )}

      {view === "timeout-new" && (
        <TimeoutPanel variant="new" downloadUrl={platform.downloadUrl} onRetry={onRetry} />
      )}
      {view === "timeout-returning" && (
        <TimeoutPanel variant="returning" downloadUrl={platform.downloadUrl} onRetry={onRetry} />
      )}

      {view === "legacy-waiting" && (
        <>
          <Loader2 className="h-7 w-7 animate-spin text-sky-400" />
          <div className="text-base font-semibold text-sky-400">Waiting for your machine to attach</div>
          <p className="max-w-md text-[13px] text-zinc-400">
            The link is up. Start a bridge on your computer for this session to go live.
          </p>
          {pair && (
            <details className="mt-1 w-full max-w-md text-left">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-300 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-3 w-3" /> Advanced — pair a remote machine by hand
              </summary>
              <div className="mt-2 flex flex-col items-start gap-1.5 rounded-md border border-zinc-800 bg-[#0a0a0b] px-3 py-2.5">
                <code className="font-mono text-xs tracking-wide text-sky-300">
                  session {pair.sessionId.slice(0, 8)}
                </code>
                <Button
                  variant="outline"
                  size="xs"
                  className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
                  onClick={onCopyBridge}
                >
                  <Copy className="h-3 w-3" /> Copy bridge command
                </Button>
                <span className="text-[11px] text-zinc-600">Single-use · expires ~5 min · bound to your account</span>
              </div>
            </details>
          )}
        </>
      )}

      {view === "session-ended" && (
        <>
          <Square className="h-7 w-7 text-zinc-400" />
          <div className="text-base font-semibold text-zinc-300">{endedTitle(state)}</div>
          <p className="max-w-md text-[13px] text-zinc-400">{endedMessage(state)}</p>
          <Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={onLaunchAgain}>
            <TerminalIcon className="h-4 w-4" /> Launch again
          </Button>
        </>
      )}

      {view === "error" && (
        <>
          <CircleAlert className="h-7 w-7 text-rose-400" />
          <div className="text-base font-semibold text-rose-400">{errorTitle(state)}</div>
          <p className="max-w-md text-[13px] text-zinc-400">{errorMessage(state)}</p>
          {canLaunch && state.errorKind !== "owner-mismatch" && (
            <Button
              variant="outline"
              size="sm"
              className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
              onClick={onLaunchAgain}
            >
              <RotateCw className="h-3.5 w-3.5" /> Try again
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ── install-first panels ──────────────────────────────────────────────────────

// Screen ① — the numbered one-time setup (unpaired). No deep link has fired here.
function SetupPanel({ platform, onConnect }: { platform: TerminalPlatform; onConnect: () => void }) {
  const copy = FIRST_RUN_COPY.setup;
  return (
    <div className="flex w-full max-w-lg flex-col text-left">
      <div className="mb-3 text-center">
        <TerminalIcon className="mx-auto h-6 w-6 text-emerald-400" />
        <h4 className="mt-2 text-[17px] font-bold text-zinc-100">{copy.heading}</h4>
        <p className="mt-1 text-[13px] text-zinc-400">{copy.subheading}</p>
      </div>

      <SetupStep n={1} title={copy.step1Title}>
        <p className="mb-2.5 text-[12.5px] text-zinc-400">{copy.step1Desc}</p>
        <a
          href={platform.downloadUrl ?? TERMINAL_HELPER_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
        >
          <Download className="h-4 w-4" /> {platform.downloadLabel}
        </a>
      </SetupStep>

      <SetupStep n={2} title={copy.step2Title}>
        <p className="text-[12.5px] text-zinc-400">{copy.step2Desc}</p>
      </SetupStep>

      <SetupStep n={3} title={copy.step3Title}>
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/35 bg-amber-500/[0.06] px-3 py-2.5 text-[12.5px] text-amber-200/90">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
          <span>{copy.openPrompt}</span>
        </div>
        <Button
          className="min-h-[44px] w-full bg-emerald-500 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
          onClick={onConnect}
        >
          {copy.connect}
        </Button>
        <p className="mt-2 text-center text-[11.5px] text-zinc-500">{copy.alreadyInstalled}</p>
      </SetupStep>
    </div>
  );
}

function SetupStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3.5 border-t border-zinc-800 py-3.5 first-of-type:border-t-0">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/[0.12] text-[13px] font-bold text-emerald-400">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 text-sm font-semibold text-zinc-200">{title}</div>
        {children}
      </div>
    </div>
  );
}

// Screen ② — connecting (after Connect, or auto-connect for a returning user).
function ConnectingPanel({ returning }: { returning: boolean }) {
  const copy = FIRST_RUN_COPY.connecting;
  return (
    <>
      <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
      <div className="text-base font-semibold text-amber-400">{copy.heading}</div>
      <p className="max-w-md text-[13px] text-zinc-400">{returning ? copy.returningBody : copy.body}</p>
      <p className="max-w-md text-[12.5px] text-zinc-500">{copy.openNudge}</p>
    </>
  );
}

// Screen ④ — the calm ~8s fallback. `variant` picks the first-timer vs returning copy.
function TimeoutPanel({
  variant,
  downloadUrl,
  onRetry,
}: {
  variant: "new" | "returning";
  downloadUrl: string | null;
  onRetry: () => void;
}) {
  const copy = variant === "new" ? FIRST_RUN_COPY.timeoutNew : FIRST_RUN_COPY.timeoutReturning;
  const href = downloadUrl ?? TERMINAL_HELPER_DOWNLOAD_URL;
  const secondaryLabel = variant === "new" ? FIRST_RUN_COPY.timeoutNew.download : FIRST_RUN_COPY.timeoutReturning.reinstall;
  const footer = variant === "new" ? FIRST_RUN_COPY.timeoutNew.hint : FIRST_RUN_COPY.timeoutReturning.reassure;
  return (
    <>
      <CircleDashed className="h-7 w-7 text-sky-400" />
      <div className="text-base font-semibold text-zinc-200">{copy.heading}</div>
      <p className="max-w-md text-[13px] text-zinc-400">{copy.body}</p>
      <div className="flex w-full flex-wrap justify-center gap-2.5">
        <Button
          className="min-h-[44px] bg-sky-500 px-4 text-sm font-semibold text-sky-950 hover:bg-sky-400"
          onClick={onRetry}
        >
          <RotateCw className="h-4 w-4" /> {copy.retry}
        </Button>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-zinc-700 bg-zinc-800/60 px-4 text-sm font-semibold text-zinc-200 hover:bg-zinc-700"
        >
          <Download className="h-4 w-4" /> {secondaryLabel}
        </a>
      </div>
      <p className="text-[11.5px] text-zinc-500">{footer}</p>
    </>
  );
}

// Screen ⑥ — non-Mac / unsupported machine. No deep link, gated download.
function ComingSoonPanel() {
  const copy = FIRST_RUN_COPY.comingSoon;
  return (
    <>
      <Laptop className="h-7 w-7 text-zinc-300" />
      <div className="text-base font-semibold text-zinc-100">{copy.heading}</div>
      <p className="max-w-md text-[13px] text-zinc-400">{copy.body}</p>
      <Button
        disabled
        aria-disabled="true"
        className="min-h-[44px] cursor-not-allowed border border-zinc-800 bg-zinc-900 text-sm font-semibold text-zinc-500"
      >
        {copy.download}
      </Button>
      <p className="text-[11.5px] text-zinc-500">{copy.hint}</p>
    </>
  );
}

function endedTitle(state: TerminalConnectionState): string {
  switch (state.endedReason) {
    case "user":
      return "You ended the session";
    case "idle":
      return "Ended after being idle";
    case "max-duration":
      return "Reached the session time limit";
    case "reconnect-failed":
      return "This session ended";
    default:
      return "Session ended";
  }
}

function endedMessage(state: TerminalConnectionState): string {
  switch (state.endedReason) {
    case "idle":
    case "max-duration":
      return "We closed the session to keep things tidy and safe. Nothing went wrong — your work on your machine is untouched.";
    case "reconnect-failed":
      return "We couldn't reattach in time after the connection dropped. Your saved work is safe — start a new session to pick things back up.";
    default:
      return "Claude Code on your machine stopped. The scrollback above is kept.";
  }
}

function errorTitle(state: TerminalConnectionState): string {
  switch (state.errorKind) {
    case "owner-mismatch":
      return "This bridge belongs to another account";
    case "bad-token":
      return "Couldn't verify this session";
    case "duplicate":
      return "This session is already open elsewhere";
    case "connect-timeout":
    case "relay-unreachable":
      return "Couldn't reach your machine";
    case "session-mint-failed":
      return "Couldn't start a session";
    default:
      return "Something went wrong";
  }
}

function errorMessage(state: TerminalConnectionState): string {
  switch (state.errorKind) {
    case "owner-mismatch":
      return "For safety, a bridge only attaches to the person who launched it. Start your own bridge, or sign in as the owning account.";
    case "bad-token":
      return "The session couldn't be verified. Launch again to start a fresh one.";
    case "duplicate":
      return "Another browser tab is already attached to this session. Close it, then launch again.";
    case "connect-timeout":
      return "We waited a while but nothing connected. Is the helper running and allowed to open?";
    case "relay-unreachable":
      return "We couldn't set up the secure link. Check your connection, then try again.";
    case "session-mint-failed":
      return "The session request didn't go through. Check your connection and try again.";
    default:
      return "The terminal session didn't start. Try launching again.";
  }
}
