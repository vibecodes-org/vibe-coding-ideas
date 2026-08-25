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

import { useEffect, useRef, useState, type ReactNode } from "react";
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
  RefreshCw,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isSameOwnerPreemptedClose } from "@/lib/terminal/connection";
import type { TerminalConnectionState, TerminalStatus } from "@/lib/terminal/connection";
import { type TerminalPlatform, TERMINAL_HELPER_DOWNLOAD_URL } from "@/lib/terminal/platform";
import { shouldShowHelperUpdateNudge } from "@/lib/terminal/helper-version";
import type { BrowserLaunchPayload } from "@/lib/terminal/launch-mode";
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
import { paneAccessibleName, paneFocusWord } from "@/lib/terminal/split-view";
import { AUTO_ACCEPT_BADGE_LABEL, AUTO_ACCEPT_BADGE_TITLE } from "@/lib/terminal/auto-accept-mode";

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
  /**
   * Task d3de150c ("Terminal mode" auto-accept toggle) — mirrored the same
   * way `readOnly` is, so the dock's collapsed-bar indicator and a pop-out
   * payload can both read this session's launch-time fact without lifting
   * the whole hook result out of the component that owns it.
   */
  autoAccept: boolean;
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
  /**
   * Card cbe60db5 rework 6: this tab's leg was closed by a same-owner
   * takeover (`isSameOwnerPreemptedClose` — see the calm "Taken over" state
   * below) and the user clicked "Reconnect here". Reattaches THIS sid via
   * the SAME reattach-mint flow the session chooser's Reconnect uses (a
   * fresh browser token, no cap consumed — see terminal-dock.tsx's
   * `performReattach`); omitted hides the button (defensive — the state only
   * renders once a `pair` is known, so the sid is always available in
   * practice).
   */
  onReconnectTakenOver?: (sid: string) => void;
  /**
   * Reconnect-relaunch fix: Retry on the ~8s helper-open timeout panel (a
   * deep link fired but the helper never attached) AND on the stuck-pairing
   * watchdog's TimeoutPanel (`pairingTimedOut`) both used to call
   * `actions.connect({ autoLaunch: true })` — minting an entirely unrelated
   * NEW session instead of re-attempting the one the user is actually
   * looking at. Wired to THIS sid's reattach flow instead (the SAME
   * `performReattach` `onReconnectTakenOver` uses), so Retry fires a fresh
   * deep link for the ORIGINAL session. Falls back to a fresh
   * `connect({autoLaunch:true})` when omitted (defensive — mirrors the
   * pre-fix behaviour for any caller that doesn't wire this).
   */
  onRetryReconnect?: (sid: string) => void;
  /**
   * Card cbe60db5 rework 9 (Bug A — Nick's field test, 2026-08-14): the
   * session-ended overlay's "Resume this conversation" action for a
   * NON-user ending (idle / max-duration / a dropped-and-exhausted
   * reconnect) — the ended session's own `claudeSessionId`/`cwd` (this
   * hook's `session.claudeSessionId`/`session.cwd`, see use-terminal-
   * session.ts), carried into a FRESH mint via the SAME capped launch flow
   * the session chooser's own Resume uses (terminal-dock.tsx's
   * `handleChooserResume` → `mintAndDeliver`) — mirrors the
   * `onReconnectTakenOver` prop pattern above. Omitted hides the Resume
   * button entirely (defensive — the overlay itself already gates on
   * `session.cwd` being known before ever calling this).
   *
   * Cross-board resume fix (bug 62e57071): the payload now carries `ideaId:
   * entry.ideaId` (this tab's own recorded board — see SessionEntry.ideaId's
   * doc) and `sid` is passed alongside so the dock's handler
   * (`handleResumeEndedSession`) can apply the SAME board-correctness the
   * chooser's Resume does — a tab that was ever mis-filed onto the wrong
   * board must not re-mint under that same wrong board forever just because
   * the user clicked Resume from inside it.
   */
  onResumeEndedSession?: (payload: BrowserLaunchPayload, sid: string | null) => void;
  /**
   * Opens the dock's full session CHOOSER — live sessions AND the "Recent —
   * ended in the last 48h" rows you can resume. Rendered as a small tertiary
   * link under the ended-panel's button row: a user staring at one ended
   * session had no way to see their other live/recent ones.
   *
   * Deliberately NOT `onCapExceeded`'s "My sessions" panel, which this link
   * originally shared (Nick's field report 2026-08-19): that panel filters to
   * `status === "active"` by construction, so from an ended session it could
   * never show the one thing the link's own wording promises — the ended
   * sessions you might want to resume. Cap-exceeded still uses it correctly,
   * because a cap is about what's *running*.
   *
   * Omitted hides the link entirely (defensive, the same
   * optional-callback-gated-UI pattern `onPopOut`/`onResumeEndedSession`
   * already use in this file).
   */
  onBrowseSessions?: () => void;
  /**
   * Split view (task df7a0134, design §3/§9): set (to `true` or `false`)
   * exactly while this view is rendered as one of the split's two panes —
   * `undefined` (the default) means "tabbed mode", rendered exactly as
   * before. `true` = this is the pane that owns the keyboard: every
   * focus-clarity signal (border+glow, "⌨ Typing here", bright header,
   * solid cursor) renders. `false` = the other pane ("◇ Watching" — its
   * OUTPUT stays full-brightness; only chrome dims, via explicit colour
   * tokens, never opacity — Requirements §4 / Design Review §2).
   */
  paneFocused?: boolean;
  /**
   * Split view: clicking anywhere in this pane (header included; the three
   * control buttons opt out via their own `stopPropagation`) moves focus to
   * it. Omitted whenever `paneFocused` is undefined.
   */
  onFocusPane?: () => void;
  /**
   * Split view (design §9, "one keyboard owner, enforced not implied"):
   * forwarded straight to `useTerminalSession`'s same-named option — see
   * its doc there. Defaults to `true` (unchanged single-pane behaviour).
   */
  grabFocus?: boolean;
  /**
   * Split-view focus-sync defect fix (task df7a0134, QA rework): forwarded
   * straight to `useTerminalSession`'s `onKeyboardFocusChange` option — see
   * its doc there. Fires whenever xterm's real hidden input genuinely
   * gains/loses DOM focus, so the dock can keep `paneFocused` truthful no
   * matter how focus got there (not just `onFocusPane`'s click route).
   * Omitted whenever `paneFocused` is undefined, same as `onFocusPane`.
   */
  onPaneFocusChange?: (focused: boolean) => void;
  /**
   * Split view drag-to-dock (design §6.1, Design Review required change 2):
   * true for the whole lifetime of ANY tab being dragged toward a dock
   * zone — Escape must be consumed by the terminal (never sent to the PTY)
   * for every mounted session while a drag is live, since DOM focus could
   * still be sitting in whichever pane's xterm was focused before the drag
   * began. A ref, not a prop, so flipping it never forces a re-render or a
   * hook-effect re-subscription — see use-terminal-session.ts's doc.
   */
  dragActiveRef?: { current: boolean };
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
  onReconnectTakenOver,
  onRetryReconnect,
  onResumeEndedSession,
  onBrowseSessions,
  paneFocused,
  onFocusPane,
  grabFocus = true,
  dragActiveRef,
  onPaneFocusChange,
}: TerminalSessionViewProps) {
  const session = useTerminalSession(descriptor, {
    enabled: true,
    expanded,
    requestExpand: onRequestExpand,
    autoConnectWhenExpanded,
    taskId: entry.taskId,
    taskTitle: entry.taskTitle,
    displayName: entry.displayName,
    onCapExceeded,
    // Session entry chooser (card cbe60db5): a Reconnect/instant-continue
    // entry carries a ready-minted `attach` pair instead of a launch to
    // deliver — the hook's own attach-once-per-sid effect handles it below,
    // independent of `launchSeq`/`launchPayload` (see SessionEntry's doc).
    attachExisting: entry.attach ?? null,
    grabFocus,
    dragActiveRef,
    onKeyboardFocusChange: onPaneFocusChange,
  });
  const {
    state,
    launchPhase,
    peerDegraded,
    helperVersion,
    pair,
    cwd: sessionCwd,
    claudeSessionId,
    readOnly,
    autoAccept,
    inputEnabled,
    platform,
    paired,
    containerRef,
    pairingTimedOut,
    actions,
  } = session;
  // Non-blocking "update your terminal helper" nudge (release-gate rework 2a).
  // Per-session dismissal only (component-local state, not persisted) — simplest
  // thing that satisfies "dismissible", and a fresh tab/reload re-evaluating the
  // gate is exactly the desired behaviour (still-stale helper, nudge again).
  const [dismissedHelperNudge, setDismissedHelperNudge] = useState(false);
  // Common foundations F2: a reconnect/instant-continue entry with no fresh
  // snapshot to restore — the dismissible "history isn't shown here" note.
  const [dismissedReconnectNote, setDismissedReconnectNote] = useState(false);

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
      autoAccept,
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
    autoAccept,
  ]);

  // Keep the dock's action registry current so a tab strip close (×) — which
  // lives in the PARENT, not here — can call this session's own `end()`
  // without lifting the whole hook result out of this component.
  useEffect(() => {
    onRegisterActions(entry.key, actions);
  });
  useEffect(() => () => onRegisterActions(entry.key, null), [entry.key, onRegisterActions]);

  // Bring-back reveal (fix/terminal-popout-host-mounted): the host div was
  // `display:none` (0-size) for the whole time it was popped out, so the
  // usual `expanded`-keyed resize/focus effects in the hook never re-fire on
  // bring-back — `expanded` itself doesn't change, only `poppedOut` does.
  // Force a refit + resize-frame send + focus on the true→false transition
  // so typing works immediately without an extra click or window resize.
  const prevPoppedOutRef = useRef(poppedOut);
  useEffect(() => {
    const wasPoppedOut = prevPoppedOutRef.current;
    prevPoppedOutRef.current = poppedOut;
    if (wasPoppedOut && !poppedOut) actions.refreshView();
    // actions.refreshView is useCallback-stable (see resolveLaunchPromptParts-
    // style deps in the hook); depending on the specific property rather than
    // `actions` itself keeps this from re-running on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poppedOut, actions.refreshView]);

  const view = resolveDockView(state.status, launchPhase, platform.supported, paired);
  // Card cbe60db5 rework 6 (Nick's field-test item 4): the "error"/4001 state
  // legitimately stays the underlying mechanism (unchanged, same as the
  // popped-out window's isPreemptedClose) — this only swaps the PRESENTATION
  // for the one cause that's actually a deliberate, successful hand-off
  // rather than a failed attach. See connection.ts's isSameOwnerPreemptedClose
  // doc for why the close REASON (not just the 4001 code) is required to
  // tell the two apart.
  const takenOver = view === "error" && isSameOwnerPreemptedClose(state.closeCode, state.closeReason);
  const meta = takenOver ? TAKEN_OVER_META : dockStatusMeta(view, state.errorKind);
  const showStream = state.status === "connected" || state.status === "disconnected";
  // Only worth showing once there's an actual (live or reconnecting) bridge to
  // update — a setup/coming-soon/idle panel has nothing to nudge about yet.
  const showHelperNudge = showStream && !dismissedHelperNudge && shouldShowHelperUpdateNudge(helperVersion);
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
  // Card cbe60db5 rework 9 (Bug A): a NON-user ending (idle / max-duration /
  // an exhausted reconnect) is the whole point of this fix — the user didn't
  // choose to stop, so a "Resume this conversation" primary action beats a
  // blind fresh mint. A deliberate `endedReason === "user"` end keeps the
  // original single "Launch again" action untouched (excluded per the QA
  // root-cause: only the involuntary endings need the resume path). `cwd` is
  // REQUIRED to resume anything (legacy `--continue` still needs a folder);
  // `claudeSessionId` is optional — its absence just falls back to
  // `--continue` (same graceful degrade the chooser's own Resume already
  // does for a pre-rework-5 row, or a session whose bridge never announced
  // one, e.g. pre-0.3.3).
  const canResume =
    view === "session-ended" && state.endedReason !== "user" && !!sessionCwd && !!onResumeEndedSession;
  const handleResume = () => {
    if (!sessionCwd) return;
    onResumeEndedSession?.(
      {
        resume: claudeSessionId ? undefined : true,
        resumeId: claudeSessionId ?? undefined,
        cwd: sessionCwd,
        taskId: entry.taskId,
        taskTitle: entry.taskTitle,
        // Terminal sessions need names that stick (card 3bf262ac): carry a
        // renamed session's name into the fresh mint this resume produces,
        // the same way taskId/taskTitle already ride it.
        displayName: entry.displayName,
        // Cross-board resume fix: this tab's own recorded board, not
        // necessarily the board currently open (see SessionEntry.ideaId).
        ideaId: entry.ideaId,
      },
      pair?.sessionId ?? null,
    );
  };

  // Split view (task df7a0134): `paneFocused` is only ever set (true OR
  // false) while this view is one of the split's two panes — `undefined`
  // means tabbed mode, unchanged from before this feature. `inPane` gates
  // every bit of pane-only chrome below (border/glow wrapper, the header's
  // extra focus chip, the click-to-focus handler, tabpanel labelling).
  const inPane = paneFocused !== undefined;
  const handlePaneClick = () => {
    if (inPane && !paneFocused) onFocusPane?.();
  };

  return (
    <div
      className={cn(
        !isActive && "hidden",
        // Design §2 tokens: flex-1 so two panes share the dock body 50/50 in
        // the parent's flex row (terminal-dock.tsx); the focused pane gets a
        // sky perimeter border + soft glow, the unfocused a plain zinc one —
        // PRESENCE of the glow is the indicator, never a hue-vs-hue contrast
        // (design §3's contrast table treats it that way deliberately).
        inPane && "m-[3px] flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border",
        inPane && paneFocused && "border-sky-400 shadow-[0_0_0_1px_rgba(56,189,248,0.35),0_0_14px_rgba(56,189,248,0.12)]",
        inPane && !paneFocused && "border-zinc-800",
      )}
      aria-hidden={!isActive}
      role={inPane ? "tabpanel" : undefined}
      aria-label={inPane ? paneAccessibleName(label, !!paneFocused) : undefined}
      onClick={inPane ? handlePaneClick : undefined}
    >
      {/* Multi-session stage 4 (D2/D3, design §10b): once this tab has been
          popped out, show the placeholder INSTEAD OF the normal
          header/body/input. Both faces stay mounted here — only CSS `hidden`
          toggles which one is visible — because the terminal host div below
          must NEVER unmount: a `poppedOut` early-return used to tear down
          this whole subtree (including the host), orphaning the xterm
          instance the hook keeps alive underneath (buffer intact, socket
          writing invisibly, keyboard handler unreachable) — bring-back had
          nothing to re-attach to (fix/terminal-popout-host-mounted). The
          underlying `useTerminalSession` instance keeps running unaffected
          either way (its socket gets preempted by the relay moments after
          the popped window attaches, exactly like any other 4001 close) —
          this is purely this component's PRESENTATION. The tab strip above
          this component is unaffected (owned by terminal-dock.tsx). */}
      <div className={cn(!poppedOut && "hidden")} aria-hidden={!poppedOut}>
        {/* Sized to its own content, not `--vc-term-dock-h` (card 534d2049
            AC3: "popping it out ... gives the board its full height back").
            The dock ROOT's height is now MEASURED (terminal-dock-inset.ts's
            ResizeObserver), not asserted, so shrinking this placeholder is
            the entire fix — the dock (and the board padding reserved for it)
            shrinks with it, with no further wiring. */}
        <div data-testid="popped-out-placeholder" className="flex items-center gap-3 bg-[#0c0c0e] px-4 py-3">
          <span className="text-lg text-violet-400" aria-hidden="true">
            ⧉
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-violet-400">Popped out</div>
            <p className="truncate text-[11.5px] text-zinc-400">
              Running in another window — close it to bring this back.
            </p>
          </div>
          <Button
            size="xs"
            className="flex-none bg-sky-500 text-sky-950 hover:bg-sky-400"
            onClick={onBringBack}
            aria-label={`Bring back to dock: ${label}`}
          >
            <Undo2 className="h-3.5 w-3.5" /> Bring back to dock
          </Button>
        </div>
      </div>

      <div
        className={cn(poppedOut && "hidden", inPane && "flex min-h-0 flex-1 flex-col")}
        aria-hidden={poppedOut}
      >
        {/* Header: state · identity · controls (safest → most destructive).
            Split view (design §4 "pane header anatomy"): the focus-state chip
            renders FIRST — it's the answer to "where will my keys go?", so it
            sits where scanning starts — followed by the session's own name
            (the SAME string `deriveTabLabel` gave the tab, via this view's
            existing `label` prop; never re-derived, per the design's binding
            note). Header background steps one shade darker on the unfocused
            pane via an explicit token swap (never opacity — Requirements §4). */}
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2",
            inPane && !paneFocused ? "bg-[#101012]" : "bg-[#141417]",
          )}
        >
          {inPane && (
            <>
              <span
                className={cn(
                  "inline-flex flex-none items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold",
                  paneFocused
                    ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                    : "border-zinc-700 bg-transparent font-semibold text-zinc-400",
                )}
              >
                <span aria-hidden="true">{paneFocused ? "⌨" : "◇"}</span>
                {paneFocusWord(!!paneFocused)}
              </span>
              <span
                className={cn(
                  "min-w-0 max-w-[180px] truncate text-[12px]",
                  paneFocused ? "font-semibold text-zinc-100" : "font-normal text-zinc-400",
                )}
                title={label}
              >
                {label}
              </span>
            </>
          )}
          <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold", meta.className)}>
            <meta.Icon className={cn("h-3 w-3", meta.spin && "animate-spin")} />
            {meta.label}
          </span>
          {/* Auto-accept badge (task d3de150c, design §3.1) — deliberately
              NOT gated on `state.status === "connected"` like Read-only just
              below: this is a launch-time FACT about the session, not a
              live connection state, so it must show for the session's whole
              life (connected, disconnected, reconnecting) — the forget
              scenario the design is built around only works if the badge
              never disappears just because the connection blipped. */}
          {autoAccept && (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/55 bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-300"
              title={AUTO_ACCEPT_BADGE_TITLE}
            >
              <Zap className="h-3 w-3" /> {AUTO_ACCEPT_BADGE_LABEL}
            </span>
          )}
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
            {/* Split view (design §4): these three controls act WITHOUT
                first moving pane focus — ending or popping out the WATCHING
                pane must not steal the keyboard from the pane the user is
                actually typing in. `stopPropagation` is a no-op outside a
                pane (no `onClick` on the wrapper to reach). */}
            {showStream && onPopOut && (
              <Button
                variant="outline"
                size="xs"
                className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
                onClick={(e) => {
                  e.stopPropagation();
                  onPopOut();
                }}
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
                onClick={(e) => {
                  e.stopPropagation();
                  actions.setReadOnly((r) => !r);
                }}
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
                onClick={(e) => {
                  e.stopPropagation();
                  actions.end();
                }}
                aria-label="End session"
              >
                <Power className="h-3 w-3" /> End
              </Button>
            )}
          </span>
        </div>

        {/* Helper-update nudge (release-gate rework 2a) — non-blocking, dismissible.
            Missing version (every pre-2a helper) OR older than
            MINIMUM_RECOMMENDED_HELPER_VERSION shows this; the session itself is
            never gated on it. */}
        {showHelperNudge && (
          <div className="flex items-center gap-2 border-b border-sky-500/30 bg-sky-500/5 px-3 py-1.5 text-[11px] text-sky-300">
            <Info className="h-3 w-3 shrink-0" />
            <span className="flex-1">
              Update your terminal helper — faster and lighter on the relay.{" "}
              <a
                href={platform.downloadUrl ?? TERMINAL_HELPER_DOWNLOAD_URL}
                className="underline hover:text-sky-200"
              >
                Download
              </a>
            </span>
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

        {/* Session entry chooser — reconnect with no snapshot to restore
            (common foundations F2): never a silently blank screen. Shown
            once there's a stream to sit above; dismissible, per-session. */}
        {showStream && entry.showReconnectedNoHistoryNote && !dismissedReconnectNote && (
          <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-300">
            <Info className="h-3 w-3 shrink-0" />
            <span className="flex-1">
              History from before you reconnected isn&apos;t shown here — it&apos;s still in Claude&apos;s context.
            </span>
            <button
              type="button"
              className="shrink-0 text-amber-400 hover:text-amber-200"
              onClick={() => setDismissedReconnectNote(true)}
              aria-label="Dismiss reconnect notice"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Terminal body — the xterm host plus a state overlay. The host stays
            mounted under every state so scrollback is frozen + readable on end.
            HEIGHT (card b885ebfd): read from the `--vc-term-dock-h` CSS
            variable the dock sets on its root (user-resizable via the drag
            handle — terminal-dock-resize.tsx); `38vh` is the SSR/first-paint
            fallback. The popped-out placeholder above no longer matches this
            height — it sizes to its own (much shorter) content instead, so
            popping out hands the board back its full height (card 534d2049). */}
        <div className="relative h-[var(--vc-term-dock-h,38vh)] min-h-[160px]">
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
              takenOver={takenOver}
              canResume={canResume}
              pairingTimedOut={pairingTimedOut}
              onConnect={() => void actions.connect({ autoLaunch: true })}
              onRetry={() => {
                // Reconnect-relaunch fix: re-attempt THIS session (a fresh
                // reattach → fresh deep link) instead of minting an unrelated
                // new one — see onRetryReconnect's doc. `pair` is always known
                // by the time a Retry button can render (every view that
                // shows one — timeout-new/returning, or the watchdog's
                // pairingTimedOut — only reaches that state via a status the
                // reducer sets alongside session-created).
                const sid = pair?.sessionId;
                if (sid && onRetryReconnect) onRetryReconnect(sid);
                else void actions.connect({ autoLaunch: true });
              }}
              onLaunchAgain={actions.beginBrowserLaunch}
              onResume={handleResume}
              onCopyBridge={actions.copyBridgeCommand}
              onReconnectTakenOver={() => {
                if (pair) onReconnectTakenOver?.(pair.sessionId);
              }}
              onBrowseSessions={onBrowseSessions}
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
    case "ready":
      return { label: FIRST_RUN_COPY.pill.ready, Icon: Circle, className: "border-zinc-700 bg-zinc-800/60 text-zinc-400" };
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

// Same-owner takeover pill (card cbe60db5, rework 6): the underlying view
// legitimately stays "error"/4001 (that's the mechanism — see
// isSameOwnerPreemptedClose's doc) but a deliberate, successful hand-off to
// another tab is not an error — the rose "Error" pill dockStatusMeta would
// otherwise render for this state contradicts the calm overlay below it.
// Sky/informational, same family + wording as the popped-out window's own
// "Moved to dock" pill (terminal-popout-view.tsx's MOVED_TO_DOCK_META) for
// the analogous same-owner-preemption case.
const TAKEN_OVER_META: StatusMeta = {
  label: "Taken over",
  Icon: Undo2,
  className: "border-sky-500/50 bg-sky-500/10 text-sky-400",
};

// ── per-view centred overlays (icon + text + next step) ───────────────────────
function StateOverlay({
  view,
  state,
  pair,
  platform,
  canLaunch,
  takenOver,
  canResume,
  pairingTimedOut,
  onConnect,
  onRetry,
  onLaunchAgain,
  onResume,
  onCopyBridge,
  onReconnectTakenOver,
  onBrowseSessions,
}: {
  view: DockView;
  state: TerminalConnectionState;
  pair: PairInfo | null;
  platform: TerminalPlatform;
  canLaunch: boolean;
  /** Card cbe60db5 rework 6 — see the same-named const in TerminalSessionView. */
  takenOver: boolean;
  /** Card cbe60db5 rework 9 (Bug A) — see the same-named const in TerminalSessionView. */
  canResume: boolean;
  /**
   * Card cbe60db5 rework 10 (stuck-pairing watchdog): the hook's
   * legacy-waiting session has sat unpaired for a full RECONNECT_GRACE_MS
   * with no bridge ever attaching. Overrides the open-ended "legacy-waiting"
   * body (NOT the header pill) with the existing TimeoutPanel's "returning"
   * copy — reused as-is rather than resolveDockView's own paired-based
   * new/returning split, since a stuck-pairing recovery is always the
   * "we've seen this Mac before" framing regardless of the `paired` flag's
   * current value.
   */
  pairingTimedOut: boolean;
  onConnect: () => void;
  onRetry: () => void;
  onLaunchAgain: () => void;
  onResume: () => void;
  onCopyBridge: () => void;
  onReconnectTakenOver: () => void;
  /** See TerminalSessionViewProps' same-named prop. */
  onBrowseSessions?: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-[#0c0c0e]/95 px-6 py-6 text-center">
      {view === "coming-soon" && <ComingSoonPanel />}

      {view === "setup" && <SetupPanel platform={platform} onConnect={onConnect} />}

      {view === "ready" && <ReadyPanel onConnect={onConnect} onBrowseSessions={onBrowseSessions} />}

      {(view === "connecting" || view === "connecting-returning") && (
        <ConnectingPanel returning={view === "connecting-returning"} />
      )}

      {view === "timeout-new" && (
        <TimeoutPanel variant="new" downloadUrl={platform.downloadUrl} onRetry={onRetry} />
      )}
      {view === "timeout-returning" && (
        <TimeoutPanel variant="returning" downloadUrl={platform.downloadUrl} onRetry={onRetry} />
      )}

      {view === "legacy-waiting" && pairingTimedOut && (
        <TimeoutPanel variant="returning" downloadUrl={platform.downloadUrl} onRetry={onRetry} />
      )}

      {view === "legacy-waiting" && !pairingTimedOut && (
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
          {/* Card cbe60db5 rework 9 (Bug A, Nick's field test 2026-08-14): a
              timed-out/dropped session's only option used to be this ONE
              blind-new-mint button — no path back to the conversation that
              was running. When we know where to resume it (`canResume`),
              that becomes the primary action; the blind mint stays as an
              explicit, clearly-labelled fallback so it's never confused with
              resuming. A deliberate user End (or a session we have no
              cwd/claudeSessionId for — legacy pre-0.3.3) keeps the original
              single "Launch again" button. */}
          {canResume ? (
            <div className="flex flex-wrap justify-center gap-2.5">
              <Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={onResume}>
                <RefreshCw className="h-4 w-4" /> Resume this conversation
              </Button>
              <Button
                variant="outline"
                className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
                onClick={onLaunchAgain}
              >
                <TerminalIcon className="h-4 w-4" /> Start fresh
              </Button>
            </div>
          ) : (
            <Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={onLaunchAgain}>
              <TerminalIcon className="h-4 w-4" /> Launch again
            </Button>
          )}
          {/* Bug cbe60db5-followup-2 (low-medium): the ended panel used to be
              a dead end for anyone wanting their other sessions. Tertiary, so
              it never competes with the primary Resume/Launch-again action
              above. Opens the CHOOSER (live + resumable recent), not the
              running-only "My sessions" panel it originally shared with
              onCapExceeded — see onBrowseSessions' doc. */}
          {onBrowseSessions && (
            <button
              type="button"
              className="text-[11px] text-zinc-500 underline hover:text-zinc-300"
              onClick={onBrowseSessions}
            >
              View my other sessions
            </button>
          )}
        </>
      )}

      {/* Card cbe60db5 rework 6: a same-owner takeover is a deliberate,
          successful hand-off — not a failed attach — so it gets its own
          calm branch instead of falling into the generic error copy below
          (Nick's field-test item 4: "that's backwards"). */}
      {view === "error" && takenOver && (
        <>
          <Undo2 className="h-7 w-7 text-sky-400" />
          <div className="text-base font-semibold text-sky-400">Taken over</div>
          <p className="max-w-md text-[13px] text-zinc-400">
            This session was taken over in another tab.
          </p>
          <Button className="bg-sky-500 text-sky-950 hover:bg-sky-400" onClick={onReconnectTakenOver}>
            <RefreshCw className="h-3.5 w-3.5" /> Reconnect here
          </Button>
        </>
      )}

      {view === "error" && !takenOver && (
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

// Resting screen for a PAIRED Mac sitting idle — reached only after the user
// ended their last session (the dock suppresses the paired auto-connect so an
// explicit End never relaunches a session). Before this existed the idle
// branch fell through to the install wizard below, telling an already-set-up
// Mac to download the helper (Nick, 2026-08-25).
function ReadyPanel({ onConnect, onBrowseSessions }: { onConnect: () => void; onBrowseSessions?: () => void }) {
  return (
    <div className="flex max-w-md flex-col items-center gap-3" data-testid="ready-panel">
      <p className="text-sm font-semibold text-zinc-100">{FIRST_RUN_COPY.ready.title}</p>
      <p className="text-xs text-zinc-400">{FIRST_RUN_COPY.ready.body}</p>
      <button
        type="button"
        onClick={onConnect}
        className="mt-1 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
      >
        {FIRST_RUN_COPY.ready.cta}
      </button>
      {onBrowseSessions && (
        <button type="button" onClick={onBrowseSessions} className="text-xs text-zinc-400 underline hover:text-zinc-200">
          {FIRST_RUN_COPY.ready.browse}
        </button>
      )}
    </div>
  );
}

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
        {/* We can't reliably tell Apple Silicon from Intel client-side (see
            platform.ts), so the primary button always targets arm64 and Intel
            users self-identify via this opt-in link rather than being silently
            auto-detected onto a DMG that might be wrong. */}
        <p className="mt-2 text-[12px] text-zinc-500">
          Intel Mac?{" "}
          <a
            href={`${TERMINAL_HELPER_DOWNLOAD_URL}?arch=x64`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-zinc-300 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-100"
          >
            Download the x64 version
          </a>
        </p>
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
