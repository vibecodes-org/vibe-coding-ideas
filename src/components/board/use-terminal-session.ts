"use client";

// In-app local Claude Code terminal — the PER-SESSION hook (SLICE: multi-session
// stage 1, pure refactor).
//
// Extracted from terminal-dock.tsx (P1, single-session) with NO behaviour change:
// every timer, ref and effect here is the same one that lived in the component,
// just relocated behind a hook boundary so a future multi-session dock (stage 2+)
// can mount one instance of this hook PER TAB. See
// docs/design-terminal-multi-session-popout.html §4: "Each tab owns an independent
// instance of P1's terminalReducer, buffer, heartbeat watchdog and grace-window
// loop."
//
// Owns EVERYTHING one session needs:
//   - the connection state machine (terminalReducer) + install-first gate inputs
//     (platform / paired) + same-machine launch phase
//   - the WebSocket browser leg (mint → open → heartbeat/watchdog → grace-window
//     reattach → teardown)
//   - the xterm.js Terminal instance + fit addon, attached to `containerRef`
//   - resize handling (ResizeObserver + on-expand + on-connected retries)
//   - focus management (first-connect + on-expand)
//   - read-only gating (isInputEnabled)
//   - the vibecodes:// deep-link fire (same-machine auto-launch) + its ~8s timeout
//
// What it deliberately does NOT own (stays with the caller/consumer):
//   - `expanded` (is the dock panel open) — that's dock CHROME, shared by every
//     tab in stage 2, not a per-session concern. Passed in as an option; the hook
//     calls `requestExpand()` at the same points the old component called
//     `setExpanded(true)`.
//   - the launch-bus subscription (`subscribeBrowserLaunch`) — board-level wiring
//     that decides WHICH session a bus event targets. The caller forwards a
//     payload via `actions.launchFromBus`.
//   - all rendering (pills, panels, buttons) — presentational, driven by this
//     hook's return value.
//
// The connection STATE MACHINE + close-code mapping + framing are pure and live in
// src/lib/terminal/connection.ts — UNCHANGED, not touched by this refactor.

import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { usePostHog } from "posthog-js/react";
import { logger } from "@/lib/logger";
import { capReachedToastCopy, getTerminalSessionCap, RATE_LIMIT_MESSAGE } from "@/lib/terminal/session-cap";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon as XFitAddon } from "@xterm/addon-fit";
import {
  CONNECT_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  LINK_SILENT_CHECK_MS,
  RECONNECT_GRACE_MS,
  buildRelayUrl,
  claimConnectGeneration,
  decideResize,
  isConnectSuperseded,
  encodeHeartbeatFrame,
  encodeResizeMessage,
  initialConnectionState,
  isHeartbeatAckFrame,
  isInputEnabled,
  isPeerDegradedFrame,
  isPeerReattachedFrame,
  mapCloseCode,
  relayBaseUrl,
  shouldDeclareLinkSilent,
  terminalReducer,
  type TerminalConnectionState,
  type TerminalStatus,
} from "@/lib/terminal/connection";
import {
  MAX_LAUNCH_URL_LENGTH,
  buildLaunchDeepLink,
  redactDeepLinkToken,
} from "@/lib/terminal/deep-link";
import { type BrowserLaunchPayload } from "@/lib/terminal/launch-mode";
import {
  buildBoundedDeepLink,
  buildCompactPromptEssentials,
  resolveAppUrl,
  resolveDefaultLaunchState,
  resolveLaunchCwd,
} from "@/lib/launch-claude-code";
import {
  type TerminalPlatform,
  readPlatformSignals,
  resolveTerminalPlatform,
} from "@/lib/terminal/platform";
import { isBrowserPaired, markBrowserPaired, resolveFirstRunEntry } from "@/lib/terminal/paired-flag";
import { type LaunchPhase, nextLaunchPhaseOnTimeout } from "@/lib/terminal/first-run-flow";

// How long we wait for the helper to attach after firing the deep link before
// dropping to the calm fallback (~8s, per the approved UX). This is the safety net
// for criterion #8: a custom-scheme link with no handler can't be reliably detected,
// so we always fall through here rather than spin forever.
const HELPER_OPEN_TIMEOUT_MS = 8000;

/** The mint route's 409/429 refusal body shape (stage 3 — see route.ts). */
interface MintErrorBody {
  error?: string;
  code?: string;
  cap?: number;
}

/**
 * Module-scope (not a useCallback) — takes everything it needs as arguments so
 * it never has to be a dependency of `connect`. Shows the SERVER's error copy
 * either way (E1/E2's whole point is that copy lives in one place — session-cap.ts
 * — not duplicated client-side); the only client-side branching is which toast
 * shape and whether a "View my sessions" action + a `terminal_cap_hit` PostHog
 * event go with it.
 */
function reportMintFailure(
  status: number,
  body: MintErrorBody | null,
  posthog: { capture: (event: string, props?: Record<string, unknown>) => void } | undefined,
  onCapExceeded: (() => void) | undefined,
) {
  logger.error("Terminal session mint refused (client)", {
    status,
    code: body?.code,
    error: body?.error,
  });
  if (body?.code === "cap_exceeded") {
    const cap = typeof body.cap === "number" ? body.cap : getTerminalSessionCap();
    posthog?.capture("terminal_cap_hit", { cap });
    const copy = capReachedToastCopy(cap);
    toast.error(body.error || copy.title, {
      description: copy.description,
      action: onCapExceeded ? { label: "View my sessions", onClick: () => onCapExceeded() } : undefined,
    });
    return;
  }
  if (body?.code === "rate_limited") {
    toast.error(body.error || RATE_LIMIT_MESSAGE);
    return;
  }
  toast.error("Couldn't start a terminal session", {
    description: body?.error || `Session request failed (${status})`,
  });
}

/** What identifies the idea/board a session's launches are bootstrapped for. */
export interface TerminalSessionDescriptor {
  ideaId: string;
  ideaTitle: string;
  /**
   * The idea's GitHub URL (or null). Needed so hook-initiated launches — paired
   * auto-connect and Retry, which never pass through the launch button — can
   * build the SAME board-level compact bootstrap prompt the button would
   * (shared resolveDefaultLaunchState + buildCompactPromptEssentials).
   */
  ideaGithubUrl: string | null;
}

export interface UseTerminalSessionOptions {
  /** Master feature gate — mirrors isTerminalEnabled(); effects no-op when false. */
  enabled: boolean;
  /**
   * Is THIS instance's terminal currently visible? P1 (one hook): the dock
   * panel's own open/closed state. Multi-session stage 2 (one hook per tab): the
   * dock panel open AND this tab the active one — a background tab must never
   * resize/refit or steal focus just because the dock is open on a DIFFERENT
   * tab. Passing `dockExpanded && isActiveTab` here is what scopes those
   * dock-wide P1 effects (resize-on-expand, focus-on-connect-or-expand, and —
   * see `autoConnectWhenExpanded` below — the paired auto-connect gate) to the
   * one tab actually on screen; switching tabs re-fires them for the newly
   * active one exactly like re-expanding the P1 dock did.
   */
  expanded: boolean;
  /**
   * Called at the same points the old component called `setExpanded(true)` —
   * opening/reopening a session should bring the (shared) dock panel into view.
   * `expanded` itself stays owned by the caller (dock chrome, not per-session).
   */
  requestExpand: () => void;
  /**
   * Gates the "paired browser auto-connects when the panel opens while idle"
   * effect (install-first criterion #6). Default true — unchanged P1 behaviour
   * for a lone/pristine instance. Multi-session stage 2 sets this to `false` for
   * every tab it creates via an EXPLICIT launch (task menu, toolbar, "+"): those
   * tabs mount with `expanded` already true (the dock is already open) and
   * deliver their own launch via `actions.launchFromBus` / `beginBrowserLaunch`
   * in the same tick — without this flag, THIS effect would independently see
   * "expanded, idle, paired" on that same mount and fire a SECOND, redundant
   * `connect()`, minting and immediately orphaning an extra relay session. Only
   * the board's one always-mounted pristine slot (never yet launched) needs this
   * ambient auto-connect, so the dock only ever passes `false` for tabs it mints
   * explicitly.
   */
  autoConnectWhenExpanded?: boolean;
  /**
   * Multi-session stage 3 (C1/C4): this tab's task identity, when the launch
   * was task-scoped — forwarded on mint so the `terminal_sessions` registry
   * row (and, from it, "My sessions") can show a task label instead of just
   * the idea. Undefined for a board-level launch.
   */
  taskId?: string;
  taskTitle?: string;
  /**
   * Called when a mint is refused for having hit the cap (E1) — the caller
   * (the dock) opens/points at the "My sessions" panel, the ONE place a
   * blocked user can see and end what's counting against them (design §7b).
   * Optional: a hook instance the dock doesn't wire this for just shows the
   * toast with no action button.
   */
  onCapExceeded?: () => void;
  /**
   * Multi-session stage 4 (D1/D2): attach directly to an ALREADY-MINTED
   * session's browser leg — no mint, no first-run/launch flow. Set by the
   * popped-out window (terminal-popout-view.tsx) once its hand-off payload
   * arrives over the same-origin BroadcastChannel (see
   * src/lib/terminal/popout-channel.ts) — this is exactly what a fresh
   * `/terminal/popout` document needs, since it never launched anything
   * itself and has no prior `pair`. Attaching with the SAME OWNER is what
   * PREEMPTS whichever OTHER browser leg is currently attached at the relay
   * — the existing 4001 "preempted" close (D1/F2); an expired token is fine,
   * the relay waives expiry for a same-owner reattach to a live session
   * (mirrors the grace-window reconnect's own waiver, fix/terminal-expired-reattach).
   *
   * Identity is keyed on `sessionId`: changing it (a NEW transferred pair)
   * re-attaches; the SAME object/value on a later render is a no-op (callers
   * don't need to memoize beyond keeping the sessionId stable).
   */
  attachExisting?: AttachExistingPair | null;
}

/** The minimum a popped-out window needs to attach to an existing session — see `attachExisting` above. */
export interface AttachExistingPair {
  sessionId: string;
  browserToken: string;
}

export interface PairInfo {
  sessionId: string;
  /**
   * Undefined for a session this window ATTACHED to (attachExisting) rather
   * than minted — a popped-out window never received the bridge token (it
   * isn't part of the pop-out payload; only the browser leg's credentials
   * cross the hand-off channel), so it can't offer "copy bridge command"
   * (that advanced panel only ever renders for the legacy-waiting view, which
   * an attached window has no path into a launch that would need it).
   */
  bridgeToken?: string;
  // Retained so a TRANSIENT drop can REATTACH to the SAME sid with no re-mint
  // (grace-window reconnect). `browserToken` re-opens the browser leg. Reattach is
  // bounded purely by RECONNECT_GRACE_MS — the relay waives token expiry for a
  // same-owner reattach to a live session (fix/terminal-expired-reattach), so no
  // client-side expiry gate exists here.
  browserToken: string;
}

export interface TerminalSessionActions {
  /** Mint a session and open the browser leg; autoLaunch fires the vibecodes:// deep link. */
  connect: (options?: { autoLaunch?: boolean }) => Promise<void>;
  /**
   * Install-first entry gate. This is the ONE place a browser "open" is turned into
   * either a setup panel, a coming-soon panel, or an auto-connect — the deep link is
   * never fired for an unpaired browser here (criterion #2).
   */
  beginBrowserLaunch: () => void;
  /**
   * Record the launch-bus payload (the launch button's resolved compact prompt) for
   * THIS session, then run the install-first gate. Keeping the mint in ONE place
   * means the session — and its bridge token — is never created twice.
   */
  launchFromBus: (payload: BrowserLaunchPayload | null) => void;
  /** Force an immediate reattach attempt (skip the backoff wait), or a fresh launch if the grace window is spent. */
  reconnectNow: () => void;
  /** User-initiated end. */
  end: () => void;
  setReadOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  copyBridgeCommand: () => void;
}

export interface UseTerminalSessionResult {
  /** Full connection state machine snapshot (status, sessionId, errorKind, endedReason, closeCode). */
  state: TerminalConnectionState;
  /** Same-machine auto-launch phase: "idle" | "opening" | "helper-timeout". */
  launchPhase: LaunchPhase;
  /** Grace-window "peer dropped, we're holding" hint. */
  peerDegraded: boolean;
  /** The minted session's ids/tokens (null before mint / after end). */
  pair: PairInfo | null;
  readOnly: boolean;
  /** isInputEnabled(state, readOnly) — convenience, the same predicate xterm's onData gates on. */
  inputEnabled: boolean;
  /** Install-first gate inputs, corrected client-side on mount (SSR default: unsupported/unpaired). */
  platform: TerminalPlatform;
  paired: boolean;
  /** True once the xterm instance is mounted into containerRef and ready to attach. */
  xtermReady: boolean;
  /** Attach this to the DOM node that should host the xterm viewport. */
  containerRef: RefObject<HTMLDivElement | null>;
  actions: TerminalSessionActions;
}

export function useTerminalSession(
  descriptor: TerminalSessionDescriptor,
  options: UseTerminalSessionOptions,
): UseTerminalSessionResult {
  const { ideaId, ideaTitle, ideaGithubUrl } = descriptor;
  const {
    enabled,
    expanded,
    requestExpand,
    autoConnectWhenExpanded = true,
    taskId,
    taskTitle,
    onCapExceeded,
    attachExisting = null,
  } = options;
  const posthog = usePostHog();
  const posthogRef = useRef(posthog);
  const onCapExceededRef = useRef(onCapExceeded);
  posthogRef.current = posthog;
  onCapExceededRef.current = onCapExceeded;

  const [state, dispatch] = useReducer(terminalReducer, initialConnectionState);
  const [readOnly, setReadOnly] = useState(false);
  const [pair, setPair] = useState<PairInfo | null>(null);
  const [xtermReady, setXtermReady] = useState(false);
  // Same-machine auto-launch UI (the vibecodes:// deep-link path). "idle" = the
  // manual cross-machine flow (copy a command); "opening" = we fired a deep link and
  // are waiting on the local helper; "helper-timeout" = the calm ~8s fallback.
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>("idle");
  // Install-first gate inputs. Initialised SSR-safe (server → unsupported/unpaired)
  // then corrected on mount; the dock body is only visible after an explicit open,
  // which always re-reads these first.
  const [platform, setPlatform] = useState<TerminalPlatform>(() =>
    resolveTerminalPlatform(readPlatformSignals()),
  );
  const [paired, setPaired] = useState<boolean>(() => isBrowserPaired());
  // Grace-window degrade hint: the relay told us our peer (the bridge) dropped and
  // it's HOLDING the session. The terminal stays visible; we show a subtle
  // "reconnecting" hint until peer-reattached (or the window expires).
  const [peerDegraded, setPeerDegraded] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<XFitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const helperTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launchIframeRef = useRef<HTMLIFrameElement | null>(null);
  const lastDimsRef = useRef<string>("");
  // Single-flight guard: every connect() bumps this and captures its value. If a
  // newer connect() starts while an older one is still awaiting its session mint,
  // the older one aborts before minting a 2nd session / firing a 2nd deep link —
  // otherwise two sessions + two bridges race and the relay tears both down
  // (single-attach / peer-gone). This is the fix for the "connect fires twice" bug.
  const connectGenRef = useRef(0);
  // Grace-window reconnect bookkeeping. `reconnectDeadlineRef.current === 0` means
  // "healthy, not reconnecting"; it's set on the first transient drop and cleared
  // once a byte proves the link healthy again. The pair (sid + retained tokens) is
  // mirrored into a ref so the timer-driven reconnect loop reads current creds
  // without re-binding. `scheduleReconnectRef` breaks the openBrowserLeg ⇄
  // scheduleReconnect cycle. `degradeTimerRef` bounds the peer-degraded wait.
  const reconnectDeadlineRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const degradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pairRef = useRef<PairInfo | null>(null);
  const scheduleReconnectRef = useRef<() => void>(() => {});
  // Silent-link watchdog bookkeeping (fix/terminal-dock-heartbeat).
  // `lastInboundAtRef` is stamped on EVERY inbound frame (PTY bytes, control
  // frames, hb-acks); `hbArmedRef` is a PER-SOCKET latch set on the socket's first
  // hb-ack — an old relay never acks, so the watchdog stays disarmed there and the
  // pre-watchdog behaviour is unchanged (version-skew gate). Both are reset in
  // openBrowserLeg when a fresh socket is opened.
  const lastInboundAtRef = useRef(0);
  const hbArmedRef = useRef(false);
  // The compact bootstrap prompt ESSENTIALS (BUG5 follow-through, 4th rework
  // cycle) the LAST launch-bus event carried — i.e. what the launch button
  // resolved. Hook-initiated launches with no bus payload (paired auto-connect
  // on open, Retry) fall back to building the board-level essentials themselves
  // via the same shared builder (see resolveLaunchPromptParts), so every launch
  // is primed.
  const promptPartsRef = useRef<BrowserLaunchPayload | null>(null);

  // Mirror live state into refs so the stable xterm onData handler + socket handlers
  // read current values without re-binding on every render.
  const statusRef = useRef(state.status);
  const readOnlyRef = useRef(readOnly);
  const pairedRef = useRef(paired);
  statusRef.current = state.status;
  readOnlyRef.current = readOnly;
  pairedRef.current = paired;
  pairRef.current = pair;

  // Previous connection status, updated ONLY by the first-connect focus effect
  // below (fix/terminal-dock-launch-defects) — so it reflects status "as of the
  // last time that effect ran" rather than every render, letting it tell a
  // genuine first connect (prev connecting/waiting-to-pair) apart from a
  // grace-window reattach (prev disconnected), which must NOT steal focus.
  const prevStatusRef = useRef<TerminalStatus>(state.status);

  // ── lazy, client-only xterm init ────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let term: XTerm | null = null;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !containerRef.current) return;

      term = new Terminal({
        convertEol: false,
        cursorBlink: true,
        fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
        fontSize: 12.5,
        theme: { background: "#0c0c0e", foreground: "#cfd8df", cursor: "#cfd8df" },
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      try {
        fit.fit();
      } catch {
        /* container may be 0-size while collapsed — refit on expand */
      }

      // Keystrokes → relay (binary). Guarded by the pure input-enabled predicate so
      // read-only / non-connected states never reach the PTY.
      term.onData((data) => {
        if (statusRef.current !== "connected" || readOnlyRef.current) return;
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data));
        }
      });

      termRef.current = term;
      fitRef.current = fit;
      setXtermReady(true);
    })().catch((err) => {
      logger.error("Terminal xterm init failed", { error: err instanceof Error ? err.message : String(err) });
    });

    return () => {
      disposed = true;
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [enabled]);

  // Correct the install-first gate inputs on mount (navigator is only reliable
  // client-side; the SSR defaults above assume unsupported/unpaired).
  useEffect(() => {
    if (!enabled) return;
    setPlatform(resolveTerminalPlatform(readPlatformSignals()));
    setPaired(isBrowserPaired());
  }, [enabled]);

  // Fit + emit a resize control frame (TEXT) matching the bridge's framing.
  //
  // Deferred via decideResize (fix/terminal-dock-launch-defects,
  // fix/terminal-dock-cold-launch-resize): a resize can only REACH the PTY once the
  // socket is OPEN *and* the bridge/peer is attached (status "connected") — the
  // relay drops browser→bridge frames with no buffering while unpaired, so socket
  // OPEN alone is not sufficient (see the `ResizeDecision` doc comment in
  // connection.ts). On a cold autolaunch the browser's wss handshake beats the
  // helper→bridge attach by hundreds of ms to seconds, so the ResizeObserver /
  // expand-rAF below fire while the socket is OPEN but still unpaired — sending
  // then would be silently dropped by the relay. A "defer" leaves lastDimsRef
  // untouched, so the SAME key resolves to a "send" once the connected-transition
  // effect re-fires this (below).
  const sendResize = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    try {
      fit.fit();
    } catch {
      return;
    }
    const msg = encodeResizeMessage(term.cols, term.rows);
    if (!msg) return;
    const key = `${term.cols}x${term.rows}`;
    const ws = wsRef.current;
    const isReachable = ws?.readyState === WebSocket.OPEN && statusRef.current === "connected";
    const decision = decideResize(key, lastDimsRef.current, isReachable);
    if (decision.action !== "send") return;
    lastDimsRef.current = decision.nextLastKey;
    ws?.send(msg);
  }, []);

  // Refit on container resize and whenever the dock expands.
  useEffect(() => {
    if (!xtermReady || !containerRef.current) return;
    const ro = new ResizeObserver(() => sendResize());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [xtermReady, sendResize]);

  useEffect(() => {
    if (expanded) {
      // Next paint, once the body has non-zero size.
      const id = window.requestAnimationFrame(() => sendResize());
      return () => window.cancelAnimationFrame(id);
    }
  }, [expanded, sendResize]);

  // Resend on the transition to "connected" (fix/terminal-dock-cold-launch-resize).
  // The bridge/peer only becomes reachable the moment status flips to "connected"
  // (first inbound PTY byte), so any resize computed BEFORE that point — the
  // ResizeObserver / expand-rAF above fire well before this on a cold autolaunch —
  // was deferred with its key un-advanced. Re-running sendResize() here is exactly
  // the retry that resolves that deferred key to a real "send" now that it can
  // reach the PTY. Fires on every transition INTO "connected", so it also covers a
  // grace-window reattach; when dims are unchanged that's just a "skip" (harmless).
  useEffect(() => {
    if (state.status === "connected") sendResize();
  }, [state.status, sendResize]);

  // ── launch focus (fix/terminal-dock-launch-defects, Defect 2) ──────────────
  // Nothing previously called termRef.current.focus() — a freshly connected
  // terminal never had keyboard focus, so the first keystroke was silently lost
  // (isInputEnabled gates on state.status === "connected", but the DOM node never
  // had focus for the browser to route the keystroke to).
  //
  // First-connect focus: fires only on a genuine "we just reached the bridge for
  // the first time" transition (prior status connecting/waiting-to-pair), never on
  // a grace-window reattach (prior status disconnected) — a user typing mid-drop
  // must not have their cursor/scroll position hijacked by an automatic reattach.
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (
      state.status === "connected" &&
      (prev === "connecting" || prev === "waiting-to-pair") &&
      expanded
    ) {
      termRef.current?.focus();
    }
    prevStatusRef.current = state.status;
  }, [state.status, expanded]);

  // Expand focus: a user-initiated expand of an already-live session (e.g.
  // collapse then re-expand while connected) should also land focus in the
  // terminal. Keyed ONLY on `expanded` (not state.status) so a background status
  // change — e.g. a reattach completing while the dock is already expanded —
  // never re-triggers this and steals focus; it reads the current status from
  // closure at the moment `expanded` itself transitions.
  useEffect(() => {
    if (!expanded || state.status !== "connected") return;
    // Next paint, mirroring the expand-rAF resize above — the container must be
    // un-hidden before focus() can land.
    const id = window.requestAnimationFrame(() => termRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
    // Deliberately excludes state.status: see comment above (must only re-run on
    // `expanded` transitions, not on every status change, or a background
    // reattach while already expanded would steal focus).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const clearConnectTimer = useCallback(() => {
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  }, []);

  const clearHelperTimer = useCallback(() => {
    if (helperTimerRef.current) {
      clearTimeout(helperTimerRef.current);
      helperTimerRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearDegradeTimer = useCallback(() => {
    if (degradeTimerRef.current) {
      clearTimeout(degradeTimerRef.current);
      degradeTimerRef.current = null;
    }
  }, []);

  // Remove the hidden probe iframe used to fire the deep link (see fireLaunchDeepLink).
  const removeLaunchIframe = useCallback(() => {
    const frame = launchIframeRef.current;
    launchIframeRef.current = null;
    if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
  }, []);

  // The compact bootstrap prompt ESSENTIALS + cwd for THIS launch: the payload
  // the launch button put on the bus (its exact resolved state — task- or
  // board-level) or, for hook-initiated launches (paired auto-connect / Retry),
  // the board-level essentials built here from the SAME shared state resolver +
  // builder the button uses — so the in-browser prompt is byte-identical to the
  // terminal-window deep link's for the same state, and never duplicated. BUG5
  // follow-through (4th rework cycle): built as ESSENTIALS (buildCompactPromptEssentials),
  // not the unconditional buildCompactBootstrapPromptParts this used to call —
  // that builder bakes the worktree-isolation protocol into a never-trimmed
  // head, so fireLaunchDeepLink's own budget clamp had no clean way to drop it
  // on overflow. The fallback's cwd uses the same shared rule (resolveLaunchCwd);
  // the hook has no recordedProjectPaths, so it passes no effective cwd — a
  // pinned existing-mode folder still resolves (rule 1), while the
  // recorded-path injection only flows through the button payload, exactly as
  // the terminal-window default path would behave.
  const resolveLaunchPromptParts = useCallback((): BrowserLaunchPayload => {
    const carried = promptPartsRef.current;
    if (carried) return carried;
    const s = resolveDefaultLaunchState(ideaId, ideaTitle, ideaGithubUrl);
    const essentials = buildCompactPromptEssentials({
      appUrl: resolveAppUrl(),
      ideaId,
      ideaTitle,
      mode: s.mode,
      repoUrl: ideaGithubUrl,
      newProject: s.mode === "new" ? { newProjectPath: s.path } : undefined,
      // Parity with the launch button: a pinned existing folder emits the same
      // verify-folder step. The hook has no recorded DB paths, so this only fires
      // for a user-pinned localStorage path (resolveDefaultLaunchState → existing).
      existingPath:
        s.mode === "existing" && s.path.trim() ? s.path.trim() : undefined,
    });
    return { essentials, cwd: resolveLaunchCwd(s, undefined) };
  }, [ideaId, ideaTitle, ideaGithubUrl]);

  // Fire the signed vibecodes:// deep link so a same-machine helper attaches as the
  // bridge leg with no copied command. The bridge token is a secret — it travels in
  // the link but is NEVER logged (only the redacted form is). The link also carries
  // the compact bootstrap prompt as an INERT string: the helper/bridge hold it and
  // only pass it to a spawned claude AFTER the relay accepts the owner-bound token
  // (R1); an old helper simply ignores the unknown param (graceful cold launch).
  //
  // BEST-EFFORT dialog mitigation (criterion #8): we fire via a hidden, detached
  // iframe rather than a top-level window.location.assign. A top-level navigation to
  // an unhandled custom scheme is the surest way to trigger macOS's "no application
  // set / Search App Store" dialog; routing it through a probe iframe suppresses that
  // dialog in most Chromium builds. It is NOT a cross-browser guarantee (Safari /
  // Firefox may still surface a milder prompt) — the ~8s timeout below is the real
  // safety net, and the authoritative success signal is the first byte from the
  // bridge (ws.onmessage), which proves the helper actually opened AND attached.
  const fireLaunchDeepLink = useCallback(
    (sessionId: string, bridgeToken: string) => {
      let link: string;
      let urlChars = 0;
      let hasCwd = false;
      let droppedCwd = false;
      try {
        const { essentials, cwd } = resolveLaunchPromptParts();
        hasCwd = !!cwd;
        // Budget the prompt against the vibecodes:// URL ceiling via
        // buildBoundedDeepLink (FIX A, QA BUG A) — the SAME shared helper the
        // claude-cli:// deep link uses. BUG5 follow-through (4th rework
        // cycle): it routes through fitCompactWorktreeProtocol so the
        // worktree-isolation protocol rides the head only when it fits whole
        // (never a half-truncated fragment, essentials always prioritised
        // over the best-effort protocol). New this cycle: it ALSO guarantees
        // the fired URL is never over-cap when `cwd` ITSELF (not just the
        // prompt) is long enough to blow the cap alone — the vibecodes://
        // `prompt=` param key is only present once the prompt is non-empty,
        // so `promptKeyOverhead` reserves room for it up front (mirrors the
        // manual `- "&prompt=".length` this replaces).
        const result = buildBoundedDeepLink({
          essentials,
          cwd,
          cap: MAX_LAUNCH_URL_LENGTH,
          promptKeyOverhead: "&prompt=".length,
          buildLink: ({ prompt, cwd: linkCwd }) =>
            buildLaunchDeepLink({
              relay: relayBaseUrl(),
              session: sessionId,
              token: bridgeToken,
              cwd: linkCwd,
              prompt,
            }),
        });
        if (!result.ok) {
          logger.error("Terminal deep-link build failed", {
            reason: "path_too_long",
          });
          toast.error("Project path too long to launch — open the folder manually and run Claude Code there");
          setLaunchPhase("helper-timeout");
          return;
        }
        link = result.url;
        droppedCwd = result.droppedCwd;
        urlChars = link.length;
      } catch (err) {
        logger.error("Terminal deep-link build failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        setLaunchPhase("helper-timeout");
        return;
      }
      // redactDeepLinkToken elides BOTH the token (secret) and the prompt (user
      // content); the cwd (a local filesystem path) is stripped here too — only
      // its PRESENCE and the prompt's length are logged.
      logger.info("Terminal firing launch deep link", {
        sessionId,
        url: redactDeepLinkToken(link).replace(/([?&]cwd=)[^&]*/g, "$1***"),
        urlChars,
        hasCwd,
        droppedCwd,
      });
      setLaunchPhase("opening");

      removeLaunchIframe();
      try {
        const frame = document.createElement("iframe");
        frame.setAttribute("aria-hidden", "true");
        frame.style.display = "none";
        frame.src = link;
        document.body.appendChild(frame);
        launchIframeRef.current = frame;
      } catch {
        // Iframe path unavailable — fall back to a direct assign.
        try {
          window.location.assign(link);
        } catch {
          setLaunchPhase("helper-timeout");
          return;
        }
      }

      // If the helper doesn't stream within ~8s, drop to the calm fallback (never an
      // infinite spinner — criterion #8).
      clearHelperTimer();
      helperTimerRef.current = setTimeout(() => {
        removeLaunchIframe();
        setLaunchPhase(nextLaunchPhaseOnTimeout);
      }, HELPER_OPEN_TIMEOUT_MS);
    },
    [clearHelperTimer, removeLaunchIframe, resolveLaunchPromptParts],
  );

  const teardownSocket = useCallback(() => {
    clearConnectTimer();
    // Cancel any in-flight grace-window reconnect loop / degrade wait, and reset the
    // reconnect budget. Nulling the socket's handlers below means a teardown-initiated
    // close never re-triggers the reconnect loop (only genuine drops do).
    clearReconnectTimer();
    clearDegradeTimer();
    reconnectDeadlineRef.current = 0;
    reconnectAttemptRef.current = 0;
    setPeerDegraded(false);
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    }
  }, [clearConnectTimer, clearReconnectTimer, clearDegradeTimer]);

  // Open (or RE-open) the BROWSER leg to the relay and wire its handlers. Shared by
  // connect() (fresh session) and the grace-window reconnect loop (same sid, retained
  // token — NO re-mint). `reconnect` skips the hard 30s connect-timeout→error: while
  // reconnecting the grace-window scheduler bounds the retries instead.
  const openBrowserLeg = useCallback(
    (sessionId: string, browserToken: string, opts?: { reconnect?: boolean }) => {
      const reconnect = opts?.reconnect ?? false;
      const url = buildRelayUrl(relayBaseUrl(), sessionId, browserToken);
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        logger.error("Terminal relay socket open failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        dispatch({ type: "closed", code: 1006 });
        return;
      }
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      // Fresh socket → fresh watchdog: disarm until ITS first hb-ack and restart
      // the silence clock (an inherited stale stamp must never condemn a new leg).
      hbArmedRef.current = false;
      lastInboundAtRef.current = Date.now();

      if (!reconnect) {
        connectTimerRef.current = setTimeout(() => {
          dispatch({ type: "connect-timeout" });
          teardownSocket();
        }, CONNECT_TIMEOUT_MS);
      }

      ws.onopen = () => {
        clearConnectTimer();
        dispatch({ type: "relay-open" });
        // No sendResize() retry here (fix/terminal-dock-cold-launch-resize): OPEN
        // means the socket reached the relay, but the bridge/peer may not be
        // attached yet, so decideResize would just "defer" again — a wasted call.
        // The connected-transition effect (see sendResize's call sites) is the one
        // retry that matters: it fires once reachability is actually true.
      };
      ws.onmessage = (ev) => {
        // ANY inbound frame proves the link carried something just now — feed the
        // silent-link watchdog before any classification.
        lastInboundAtRef.current = Date.now();
        // TEXT = relay control frame on the BROWSER leg. The grace-window notices
        // arrive here (the R1 `attached` frame goes to the bridge leg only).
        if (typeof ev.data === "string") {
          if (isHeartbeatAckFrame(ev.data)) {
            // The relay's liveness echo — arm the watchdog for THIS socket. Never
            // written to the xterm and never logged as content.
            hbArmedRef.current = true;
            return;
          }
          if (isPeerDegradedFrame(ev.data)) {
            // Our peer (the bridge) dropped; the relay is HOLDING the session. Keep
            // the terminal, show a subtle hint, and bound the wait to the grace window.
            setPeerDegraded(true);
            if (!degradeTimerRef.current) {
              degradeTimerRef.current = setTimeout(() => {
                degradeTimerRef.current = null;
                setPeerDegraded(false);
                dispatch({ type: "reconnect-exhausted" });
                try {
                  wsRef.current?.close(1000, "reconnect-grace-expired");
                } catch {
                  /* already closing */
                }
              }, RECONNECT_GRACE_MS);
            }
          } else if (isPeerReattachedFrame(ev.data)) {
            // The pair is whole again inside the window — resume. Proves the pipe is
            // restored even before the next byte, so drop back to connected + reset
            // the reconnect budget (a scenario-1 already-connected leg no-ops).
            clearDegradeTimer();
            setPeerDegraded(false);
            reconnectDeadlineRef.current = 0;
            reconnectAttemptRef.current = 0;
            dispatch({ type: "data" });
          }
          return;
        }
        // BINARY = opaque PTY bytes → the bridge is streaming; the link is HEALTHY.
        // Clear the launch nudges, mark paired on first success, and reset every
        // reconnect/degrade timer + budget so a later drop starts a fresh window.
        clearHelperTimer();
        removeLaunchIframe();
        setLaunchPhase("idle");
        clearDegradeTimer();
        setPeerDegraded(false);
        reconnectDeadlineRef.current = 0;
        reconnectAttemptRef.current = 0;
        if (!pairedRef.current) {
          markBrowserPaired();
          setPaired(true);
        }
        dispatch({ type: "data" });
        termRef.current?.write(new Uint8Array(ev.data as ArrayBuffer));
      };
      ws.onerror = () => {
        logger.warn("Terminal relay socket error", { sessionId });
      };
      ws.onclose = (ev) => {
        clearConnectTimer();
        wsRef.current = null;
        dispatch({ type: "closed", code: ev.code, reason: ev.reason });
        // Grace-window reconnect: a transient drop AFTER a live stream (PEER_GONE /
        // abnormal 1006) is recoverable → keep reattaching within the window. Any
        // terminal / clean-end code maps to a non-disconnected state and stops here.
        // A teardown-initiated close nulled these handlers, so it never reaches this.
        const mapped = mapCloseCode(ev.code, ev.reason, statusRef.current);
        if (mapped.status === "disconnected") scheduleReconnectRef.current();
      };
    },
    [teardownSocket, clearConnectTimer, clearHelperTimer, removeLaunchIframe, clearDegradeTimer],
  );

  // Drive the grace-window reconnect loop: reattach to the SAME sid with the retained
  // browser token, with jittered exponential backoff, bounded purely by the grace
  // window (the relay waives token expiry for a same-owner reattach to a live
  // session, so an AGED session reconnects too — fix/terminal-expired-reattach).
  // When the window is spent with no reattach, end honestly (reconnect-exhausted →
  // the calm "session ended, start a new one" overlay). No re-mint, no deep link —
  // a bounded, silent reattach.
  const scheduleReconnect = useCallback(() => {
    clearDegradeTimer();
    const p = pairRef.current;
    const now = Date.now();
    if (reconnectDeadlineRef.current === 0) reconnectDeadlineRef.current = now + RECONNECT_GRACE_MS;
    if (!p || now >= reconnectDeadlineRef.current) {
      reconnectDeadlineRef.current = 0;
      reconnectAttemptRef.current = 0;
      dispatch({ type: "reconnect-exhausted" });
      return;
    }
    const attempt = reconnectAttemptRef.current++;
    const delay = Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
    clearReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      const pp = pairRef.current;
      if (!pp || Date.now() >= reconnectDeadlineRef.current) {
        reconnectDeadlineRef.current = 0;
        reconnectAttemptRef.current = 0;
        dispatch({ type: "reconnect-exhausted" });
        return;
      }
      openBrowserLeg(pp.sessionId, pp.browserToken, { reconnect: true });
    }, delay);
  }, [openBrowserLeg, clearReconnectTimer, clearDegradeTimer]);
  scheduleReconnectRef.current = scheduleReconnect;

  // ── silent-link watchdog (fix/terminal-dock-heartbeat) ─────────────────────
  // The watchdog verdict landed: the socket still LOOKS open but nothing inbound
  // (PTY bytes or hb-acks) arrived for the whole silence threshold — a silent link
  // death (wifi off / network switch; macOS never RSTs, so no close event ever
  // fires). Tear down the ZOMBIE socket exactly like teardownSocket's socket step
  // — null the handlers FIRST so its eventual close can't double-drive the state —
  // then route into the EXISTING reattach machinery: disconnected + the
  // grace-window reconnect loop (same sid, retained token, no re-mint).
  const declareLinkSilent = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    }
    clearDegradeTimer();
    setPeerDegraded(false);
    dispatch({ type: "link-silent" });
    scheduleReconnectRef.current();
  }, [clearDegradeTimer]);

  // While CONNECTED: probe the relay with the app-level heartbeat every
  // HEARTBEAT_INTERVAL_MS and run the silence check every LINK_SILENT_CHECK_MS.
  // The check computes WALL-CLOCK elapsed (a hidden tab's clamped timers can only
  // delay a tick, never fake recency) and re-runs immediately when the tab becomes
  // visible or the browser flips online/offline — the moments a silent death is
  // most likely to be discovered.
  useEffect(() => {
    if (!enabled || state.status !== "connected") return;

    const sendHeartbeat = () => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(encodeHeartbeatFrame());
    };
    const check = () => {
      if (statusRef.current !== "connected") return;
      if (shouldDeclareLinkSilent(lastInboundAtRef.current, Date.now(), hbArmedRef.current)) {
        logger.warn("Terminal link silent — declaring dead, reattaching", {
          silentMs: Date.now() - lastInboundAtRef.current,
        });
        declareLinkSilent();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") check();
    };

    // Probe immediately so the watchdog ARMS on the first ack instead of waiting a
    // whole interval (matters when a drop happens right after connecting).
    sendHeartbeat();
    const sendTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    const checkTimer = setInterval(check, LINK_SILENT_CHECK_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => {
      clearInterval(sendTimer);
      clearInterval(checkTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
    };
  }, [enabled, state.status, declareLinkSilent]);

  // ── connect (browser leg) ───────────────────────────────────────────────────
  // `autoLaunch` = the same-machine path: after minting, fire the vibecodes:// deep
  // link so the local helper attaches automatically (no copied command). Without it
  // (manual reconnect), we stay in the cross-machine "copy a command" flow. Callers
  // must gate autoLaunch behind the install-first flow (setup Connect / paired
  // auto-connect / Retry) — never on a bare "open" for an unpaired browser.
  const connect = useCallback(async (opts?: { autoLaunch?: boolean }) => {
    // Claim this attempt's generation. A later connect() bumps it, which makes this
    // one abort at the post-mint checkpoint below instead of racing a 2nd session.
    const gen = (connectGenRef.current = claimConnectGeneration(connectGenRef.current));
    const autoLaunch = opts?.autoLaunch ?? false;
    teardownSocket();
    clearHelperTimer();
    removeLaunchIframe();
    setLaunchPhase(autoLaunch ? "opening" : "idle");
    requestExpand();
    lastDimsRef.current = "";
    dispatch({ type: "connect" });

    let data: { sessionId: string; browserToken: string; bridgeToken: string; expiresAt: number };
    try {
      const res = await fetch("/api/terminal/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ideaId,
          ...(taskId ? { taskId } : {}),
          ...(taskTitle ? { taskTitle } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as MintErrorBody | null;
        // Superseded while minting → let the newer attempt own the outcome
        // (a stale refusal toast for an attempt nobody's waiting on anymore).
        if (isConnectSuperseded(gen, connectGenRef.current)) return;
        dispatch({ type: "session-mint-failed" });
        reportMintFailure(res.status, body, posthogRef.current, onCapExceededRef.current);
        return;
      }
      data = await res.json();
    } catch (err) {
      // Superseded while minting → let the newer attempt own the outcome.
      if (isConnectSuperseded(gen, connectGenRef.current)) return;
      logger.error("Terminal session mint failed (client)", {
        error: err instanceof Error ? err.message : String(err),
      });
      dispatch({ type: "session-mint-failed" });
      toast.error("Couldn't start a terminal session", {
        description: err instanceof Error ? err.message : undefined,
      });
      return;
    }

    // A newer connect() started while we awaited the mint → abort BEFORE firing a
    // second deep link or opening a second socket. The newer attempt already ran
    // teardownSocket() + dispatch(connect); doing anything here would orphan a
    // bridge and trip the relay's single-attach. This is the double-connect fix.
    if (isConnectSuperseded(gen, connectGenRef.current)) return;

    dispatch({ type: "session-created", sessionId: data.sessionId });
    // Retain the browser token too, so a transient drop can REATTACH to this same
    // sid with no re-mint (grace-window reconnect).
    setPair({
      sessionId: data.sessionId,
      bridgeToken: data.bridgeToken,
      browserToken: data.browserToken,
    });
    // A fresh mint starts a fresh reconnect budget.
    reconnectDeadlineRef.current = 0;
    reconnectAttemptRef.current = 0;
    termRef.current?.clear();

    // Best-effort identity PATCH (C4): the browser already resolves a cwd to
    // build the launch prompt — forward it to the registry row so "My
    // sessions" can show it. Never awaited/blocking: a failure here changes
    // nothing about the terminal itself, the identity line is just honestly
    // blank until it lands (or forever, if there's no cwd to report).
    try {
      const { cwd } = resolveLaunchPromptParts();
      if (cwd && cwd.trim()) {
        void fetch(`/api/terminal/session/${encodeURIComponent(data.sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: cwd.trim() }),
        }).catch(() => {});
      }
    } catch {
      /* best-effort only — never blocks the terminal actually connecting */
    }

    // Same-machine: hand the bridge token to the local helper via the deep link.
    if (autoLaunch) fireLaunchDeepLink(data.sessionId, data.bridgeToken);

    openBrowserLeg(data.sessionId, data.browserToken);
  }, [
    ideaId,
    taskId,
    taskTitle,
    teardownSocket,
    clearHelperTimer,
    removeLaunchIframe,
    requestExpand,
    resolveLaunchPromptParts,
    fireLaunchDeepLink,
    openBrowserLeg,
  ]);

  // ── attach-existing (multi-session stage 4, D1/D2) ─────────────────────────
  // The popped-out window's whole entry point: no fetch, no deep link, no
  // install-first gate — just open the browser leg for a session that was
  // ALREADY minted elsewhere (the dock tab that popped it out). Deliberately
  // mirrors connect()'s bookkeeping (teardown, timer resets, dispatch
  // sequence, setPair, fresh reconnect budget) minus everything that assumes
  // this window is the one originating the session.
  const attachToExisting = useCallback(
    (p: AttachExistingPair) => {
      const gen = (connectGenRef.current = claimConnectGeneration(connectGenRef.current));
      teardownSocket();
      clearHelperTimer();
      removeLaunchIframe();
      setLaunchPhase("idle");
      lastDimsRef.current = "";
      // Two dispatches back-to-back, no await between them — React folds them
      // through the reducer IN ORDER against the queued (not the stale
      // closure) state, so "session-created"'s `state.status !== "connecting"`
      // guard sees the "connect" transition that just landed ahead of it.
      // Same guarantee connect() relies on across its own await gap.
      dispatch({ type: "connect" });
      dispatch({ type: "session-created", sessionId: p.sessionId });
      setPair({ sessionId: p.sessionId, browserToken: p.browserToken });
      reconnectDeadlineRef.current = 0;
      reconnectAttemptRef.current = 0;
      termRef.current?.clear();
      // A newer attach/connect raced this one while it was doing its
      // (synchronous, but still checked for symmetry with connect()) setup —
      // abort before opening a socket that a newer attempt would immediately
      // have to tear down again.
      if (isConnectSuperseded(gen, connectGenRef.current)) return;
      openBrowserLeg(p.sessionId, p.browserToken);
    },
    [teardownSocket, clearHelperTimer, removeLaunchIframe, openBrowserLeg],
  );

  // Fire attachToExisting once per distinct transferred session id — the
  // popped window's `attachExisting` prop starts `null` (no payload yet) and
  // becomes non-null asynchronously, whenever the hand-off channel delivers it
  // (see terminal-popout-view.tsx). NOT gated on xtermReady: connect() itself
  // opens the browser leg with no such gate (an inbound byte arriving before
  // xterm has mounted is already a pre-existing, harmless no-op there —
  // `termRef.current?.write(...)` — so attach-existing keeps the same
  // characteristics rather than inventing a stricter rule for one path).
  const attachedSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !attachExisting) return;
    if (attachedSessionIdRef.current === attachExisting.sessionId) return;
    attachedSessionIdRef.current = attachExisting.sessionId;
    attachToExisting(attachExisting);
  }, [enabled, attachExisting, attachToExisting]);

  // Manual "Reconnect now" — force an immediate reattach attempt (skip the backoff
  // wait) using the retained token, or fall back to a clean fresh launch if the
  // grace window is spent. Fixes the old button, which minted an EMPTY session with
  // no autoLaunch and timed out after 30s.
  const reconnectNow = useCallback(() => {
    const p = pairRef.current;
    const now = Date.now();
    const withinWindow =
      reconnectDeadlineRef.current === 0 || now < reconnectDeadlineRef.current;
    if (p && withinWindow) {
      clearReconnectTimer();
      if (reconnectDeadlineRef.current === 0) reconnectDeadlineRef.current = now + RECONNECT_GRACE_MS;
      openBrowserLeg(p.sessionId, p.browserToken, { reconnect: true });
    } else {
      void connect({ autoLaunch: true });
    }
  }, [openBrowserLeg, clearReconnectTimer, connect]);

  // Install-first entry gate. This is the ONE place a browser "open" is turned into
  // either a setup panel, a coming-soon panel, or an auto-connect — the deep link is
  // never fired for an unpaired browser here (criterion #2).
  const beginBrowserLaunch = useCallback(() => {
    requestExpand();
    const fresh = resolveTerminalPlatform(readPlatformSignals());
    setPlatform(fresh);
    const nowPaired = isBrowserPaired();
    setPaired(nowPaired);
    const entry = resolveFirstRunEntry({ supported: fresh.supported, paired: nowPaired });
    if (entry === "connecting") {
      // Paired browser deliberately reopening its session → auto-connect (fires the
      // deep link). "setup" / "coming-soon" just show the overlay; no link fires.
      void connect({ autoLaunch: true });
    }
  }, [connect, requestExpand]);

  // The "In the browser" menu item (board toolbar) fires the launch bus; the caller
  // forwards its payload here. The payload (the button's resolved compact prompt, as
  // head/tail parts) is remembered so this launch AND a later Retry carry the exact
  // prompt the user launched with; a payload-less event falls back to the
  // hook-built board-level prompt.
  const launchFromBus = useCallback(
    (payload: BrowserLaunchPayload | null) => {
      promptPartsRef.current = payload;
      beginBrowserLaunch();
    },
    [beginBrowserLaunch],
  );

  const endSession = useCallback(() => {
    dispatch({ type: "user-end" });
    clearHelperTimer();
    removeLaunchIframe();
    setLaunchPhase("idle");
    const sid = pairRef.current?.sessionId;
    const ws = wsRef.current;
    if (ws) {
      try {
        ws.close(1000, "user-end");
      } catch {
        /* already closing */
      }
    }
    teardownSocket();
    // Additive (C3): keep the registry truthful for "My sessions" — the socket
    // teardown above is unchanged/authoritative for the terminal itself; this
    // is fire-and-forget bookkeeping only, never awaited, never surfaced to
    // the user on failure (the relay end route is itself skew-safe/best-effort).
    if (sid) {
      void fetch("/api/terminal/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid }),
      }).catch(() => {});
    }
  }, [teardownSocket, clearHelperTimer, removeLaunchIframe]);

  // Clean up the socket + helper timer + probe iframe if the hook unmounts mid-flow.
  useEffect(() => () => teardownSocket(), [teardownSocket]);
  useEffect(() => () => clearHelperTimer(), [clearHelperTimer]);
  useEffect(() => () => removeLaunchIframe(), [removeLaunchIframe]);

  // The carried payload is scoped to ONE launch intent: it survives Retry (same
  // intent, fresh session/token) but is dropped once the session ENDS (user End
  // or a relay idle/max close), so a stale task prompt can never ride a later
  // paired auto-connect — that launch rebuilds the board-level default instead.
  useEffect(() => {
    if (state.status === "session-ended") promptPartsRef.current = null;
  }, [state.status]);

  // Auto-connect a paired browser whenever the panel becomes visible while idle — so
  // a returning user who simply expands the dock also skips the setup wall
  // (criterion #6). Unpaired / unsupported browsers never satisfy this guard, so no
  // deep link fires for them.
  useEffect(() => {
    if (!enabled || !autoConnectWhenExpanded) return;
    if (
      expanded &&
      state.status === "idle" &&
      platform.supported &&
      paired &&
      launchPhase === "idle"
    ) {
      void connect({ autoLaunch: true });
    }
  }, [
    enabled,
    autoConnectWhenExpanded,
    expanded,
    state.status,
    platform.supported,
    paired,
    launchPhase,
    connect,
  ]);

  const copyBridgeCommand = useCallback(() => {
    // No bridge token to copy for an attached (not minted) session — see
    // PairInfo.bridgeToken's doc. The legacy-waiting panel that renders this
    // button isn't reachable from attachExisting anyway, but stay honest
    // rather than emit a command with a literal "undefined" in it.
    if (!pair || !pair.bridgeToken) return;
    const cmd = `RELAY_URL=${relayBaseUrl()} SESSION_ID=${pair.sessionId} BRIDGE_TOKEN=${pair.bridgeToken} node terminal/bridge/src/index.js --cmd bash`;
    navigator.clipboard
      .writeText(cmd)
      .then(() => toast.success("Bridge command copied"))
      .catch(() => toast.error("Couldn't copy the command"));
  }, [pair]);

  return {
    state,
    launchPhase,
    peerDegraded,
    pair,
    readOnly,
    inputEnabled: isInputEnabled(state, readOnly),
    platform,
    paired,
    xtermReady,
    containerRef,
    actions: {
      connect,
      beginBrowserLaunch,
      launchFromBus,
      reconnectNow,
      end: endSession,
      setReadOnly,
      copyBridgeCommand,
    },
  };
}
