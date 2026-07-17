"use client";

// In-app local Claude Code terminal — the board bottom dock (browser leg).
//
// Renders the collapsible VS Code-style terminal dock and wires it to the opaque
// Cloudflare relay as the `browser` leg:
//
//   POST /api/terminal/session  →  { sessionId, browserToken, bridgeToken }
//   WebSocket  <relay>/?session&role=browser&token  →  xterm.js
//
// INSTALL-FIRST FIRST RUN (docs/install-first-terminal-ux.html, Compass UX; built on
// the ProdOwner Requirements): an unpaired browser lands on a calm numbered SETUP
// panel and NO `vibecodes://` deep link fires until the user explicitly presses
// Connect — so a first-timer with nothing installed never sees macOS's scary
// "no application set / Search App Store" dialog. On the first successful connection
// we set a localStorage paired flag; a paired browser then auto-connects on open and
// skips the setup wall. Non-Mac machines get a "coming soon" and never fire the link.
//
// The connection STATE MACHINE + close-code mapping + framing are pure and live in
// src/lib/terminal/connection.ts; the OS/arch detection, the paired-flag gate, and
// the first-run copy are pure and live in src/lib/terminal/{platform,paired-flag,
// first-run-copy}.ts (all unit-tested). This component owns only the side effects
// (fetch, socket, xterm, timers, the deep-link fire) and renders the visible states.
//
// GATING: off by default. Renders nothing unless NEXT_PUBLIC_TERMINAL_ENABLED is
// exactly "true" (checked here AND at the board page mount).

import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import {
  ChevronUp,
  ChevronDown,
  Circle,
  CircleDot,
  CircleDashed,
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
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon as XFitAddon } from "@xterm/addon-fit";
import {
  CONNECT_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  LINK_SILENT_CHECK_MS,
  RECONNECT_GRACE_MS,
  buildRelayUrl,
  decideResize,
  encodeHeartbeatFrame,
  encodeResizeMessage,
  initialConnectionState,
  isHeartbeatAckFrame,
  isInputEnabled,
  isPeerDegradedFrame,
  isPeerReattachedFrame,
  isTerminalEnabled,
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
import { type BrowserLaunchPayload, subscribeBrowserLaunch } from "@/lib/terminal/launch-mode";
import {
  buildCompactBootstrapPromptParts,
  enforcePromptLength,
  resolveAppUrl,
  resolveDefaultLaunchState,
  resolveLaunchCwd,
} from "@/lib/launch-claude-code";
import {
  type TerminalPlatform,
  TERMINAL_HELPER_DOWNLOAD_URL,
  readPlatformSignals,
  resolveTerminalPlatform,
} from "@/lib/terminal/platform";
import {
  isBrowserPaired,
  markBrowserPaired,
  resolveFirstRunEntry,
} from "@/lib/terminal/paired-flag";
import { FIRST_RUN_COPY } from "@/lib/terminal/first-run-copy";
import {
  type DockView,
  type LaunchPhase,
  nextLaunchPhaseOnTimeout,
  resolveDockView,
} from "@/lib/terminal/first-run-flow";

// How long we wait for the helper to attach after firing the deep link before
// dropping to the calm fallback (~8s, per the approved UX). This is the safety net
// for criterion #8: a custom-scheme link with no handler can't be reliably detected,
// so we always fall through here rather than spin forever.
const HELPER_OPEN_TIMEOUT_MS = 8000;

interface TerminalDockProps {
  ideaId: string;
  ideaTitle: string;
  /**
   * The idea's GitHub URL (or null). Needed so dock-initiated launches — paired
   * auto-connect and Retry, which never pass through the launch button — can
   * build the SAME board-level compact bootstrap prompt the button would
   * (shared resolveDefaultLaunchState + buildCompactBootstrapPromptParts).
   */
  ideaGithubUrl: string | null;
}

interface PairInfo {
  sessionId: string;
  bridgeToken: string;
  // Retained so a TRANSIENT drop can REATTACH to the SAME sid with no re-mint
  // (grace-window reconnect). `browserToken` re-opens the browser leg. Reattach is
  // bounded purely by RECONNECT_GRACE_MS — the relay waives token expiry for a
  // same-owner reattach to a live session (fix/terminal-expired-reattach), so no
  // client-side expiry gate exists here.
  browserToken: string;
}

interface StatusMeta {
  label: string;
  Icon: typeof Circle;
  spin?: boolean;
  className: string;
}

// Header pill — icon + text + colour (never colour alone), one per view.
function dockStatusMeta(view: DockView, state: TerminalConnectionState): StatusMeta {
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
      return { label: state.errorKind === "owner-mismatch" ? "Owner mismatch" : "Error", Icon: CircleAlert, className: "border-rose-500/55 bg-rose-500/10 text-rose-400" };
    default:
      return { label: "Terminal · off", Icon: Circle, className: "border-zinc-700 bg-zinc-800/60 text-zinc-400" };
  }
}

// A small dot for the collapsed bar that echoes the live state at a glance.
function dotClass(status: TerminalStatus): string {
  switch (status) {
    case "connected":
      return "text-emerald-400";
    case "connecting":
    case "waiting-to-pair":
      return "text-amber-400";
    case "error":
      return "text-rose-400";
    default:
      return "text-zinc-500";
  }
}

export function TerminalDock({ ideaId, ideaTitle, ideaGithubUrl }: TerminalDockProps) {
  // Defence-in-depth: also gated at the page mount. When off, render nothing —
  // no dock, no entry point, board unchanged.
  const enabled = isTerminalEnabled();

  const [state, dispatch] = useReducer(terminalReducer, initialConnectionState);
  const [expanded, setExpanded] = useState(false);
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
  // The compact bootstrap prompt (head/tail parts) the LAST launch-bus event
  // carried — i.e. what the launch button resolved. Dock-initiated launches with
  // no bus payload (paired auto-connect on open, Retry) fall back to building the
  // board-level prompt themselves via the same shared builder (see
  // resolveLaunchPromptParts), so every launch is primed.
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

  // The compact bootstrap prompt + cwd for THIS launch: the payload the launch
  // button put on the bus (its exact resolved state — task- or board-level) or,
  // for dock-initiated launches (paired auto-connect / Retry), the board-level
  // prompt built here from the SAME shared state resolver + builder the button
  // uses — so the in-browser prompt is byte-identical to the terminal-window deep
  // link's for the same state, and never duplicated. The fallback's cwd uses the
  // same shared rule (resolveLaunchCwd); the dock has no recordedProjectPaths, so
  // it passes no effective cwd — a pinned existing-mode folder still resolves
  // (rule 1), while the recorded-path injection only flows through the button
  // payload, exactly as the terminal-window default path would behave.
  const resolveLaunchPromptParts = useCallback((): BrowserLaunchPayload => {
    const carried = promptPartsRef.current;
    if (carried) return carried;
    const state = resolveDefaultLaunchState(ideaId, ideaTitle, ideaGithubUrl);
    const { head, tail } = buildCompactBootstrapPromptParts({
      appUrl: resolveAppUrl(),
      ideaId,
      ideaTitle,
      mode: state.mode,
      repoUrl: ideaGithubUrl,
      newProject: state.mode === "new" ? { newProjectPath: state.path } : undefined,
      // Parity with the launch button: a pinned existing folder emits the same
      // verify-folder step. The dock has no recorded DB paths, so this only fires
      // for a user-pinned localStorage path (resolveDefaultLaunchState → existing).
      existingPath:
        state.mode === "existing" && state.path.trim() ? state.path.trim() : undefined,
    });
    return { promptHead: head, promptTail: tail, cwd: resolveLaunchCwd(state, undefined) };
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
      let promptChars = 0;
      let hasCwd = false;
      try {
        const { promptHead, promptTail, cwd } = resolveLaunchPromptParts();
        hasCwd = !!cwd;
        // Budget the prompt against the vibecodes:// URL ceiling: everything the
        // base link needs (relay/session/token, and the cwd when present) is
        // spent first, the prompt gets the rest. enforcePromptLength trims only
        // the work-step tail and always keeps the MCP-setup head (+ the
        // …(truncated) marker on overflow).
        const base = buildLaunchDeepLink({
          relay: relayBaseUrl(),
          session: sessionId,
          token: bridgeToken,
          cwd,
        });
        const budget = MAX_LAUNCH_URL_LENGTH - base.length - "&prompt=".length;
        const prompt = enforcePromptLength(promptHead, promptTail, budget);
        promptChars = prompt.length;
        link = buildLaunchDeepLink({
          relay: relayBaseUrl(),
          session: sessionId,
          token: bridgeToken,
          cwd,
          prompt,
        });
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
        promptChars,
        hasCwd,
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
  // auto-connect / Retry) — never on a bare dock open for an unpaired browser.
  const connect = useCallback(async (options?: { autoLaunch?: boolean }) => {
    // Claim this attempt's generation. A later connect() bumps it, which makes this
    // one abort at the post-mint checkpoint below instead of racing a 2nd session.
    const gen = ++connectGenRef.current;
    const autoLaunch = options?.autoLaunch ?? false;
    teardownSocket();
    clearHelperTimer();
    removeLaunchIframe();
    setLaunchPhase(autoLaunch ? "opening" : "idle");
    setExpanded(true);
    lastDimsRef.current = "";
    dispatch({ type: "connect" });

    let data: { sessionId: string; browserToken: string; bridgeToken: string; expiresAt: number };
    try {
      const res = await fetch("/api/terminal/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `Session request failed (${res.status})`);
      }
      data = await res.json();
    } catch (err) {
      // Superseded while minting → let the newer attempt own the outcome.
      if (gen !== connectGenRef.current) return;
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
    if (gen !== connectGenRef.current) return;

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

    // Same-machine: hand the bridge token to the local helper via the deep link.
    if (autoLaunch) fireLaunchDeepLink(data.sessionId, data.bridgeToken);

    openBrowserLeg(data.sessionId, data.browserToken);
  }, [ideaId, teardownSocket, clearHelperTimer, removeLaunchIframe, fireLaunchDeepLink, openBrowserLeg]);

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
    setExpanded(true);
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
  }, [connect]);

  const endSession = useCallback(() => {
    dispatch({ type: "user-end" });
    clearHelperTimer();
    removeLaunchIframe();
    setLaunchPhase("idle");
    const ws = wsRef.current;
    if (ws) {
      try {
        ws.close(1000, "user-end");
      } catch {
        /* already closing */
      }
    }
    teardownSocket();
  }, [teardownSocket, clearHelperTimer, removeLaunchIframe]);

  // Clean up the socket + helper timer + probe iframe if the dock unmounts mid-flow.
  useEffect(() => () => teardownSocket(), [teardownSocket]);
  useEffect(() => () => clearHelperTimer(), [clearHelperTimer]);
  useEffect(() => () => removeLaunchIframe(), [removeLaunchIframe]);

  // The "In the browser" menu item (board toolbar) fires the launch bus; pick it up
  // here and run the install-first gate. Keeping the mint in ONE place (the dock)
  // means the session — and its bridge token — is never created twice. The payload
  // (the button's resolved compact prompt, as head/tail parts) is remembered so
  // this launch AND a later Retry carry the exact prompt the user launched with;
  // a payload-less event falls back to the dock-built board-level prompt.
  useEffect(() => {
    if (!enabled) return;
    return subscribeBrowserLaunch((payload) => {
      promptPartsRef.current = payload ?? null;
      beginBrowserLaunch();
    });
  }, [enabled, beginBrowserLaunch]);

  // The carried payload is scoped to ONE launch intent: it survives Retry (same
  // intent, fresh session/token) but is dropped once the session ENDS (user End
  // or a relay idle/max close), so a stale task prompt can never ride a later
  // paired auto-connect — that launch rebuilds the board-level default instead.
  useEffect(() => {
    if (state.status === "session-ended") promptPartsRef.current = null;
  }, [state.status]);

  // Auto-connect a paired browser whenever the body becomes visible while idle — so
  // a returning user who simply expands the dock also skips the setup wall
  // (criterion #6). Unpaired / unsupported browsers never satisfy this guard, so no
  // deep link fires for them.
  useEffect(() => {
    if (!enabled) return;
    if (
      expanded &&
      state.status === "idle" &&
      platform.supported &&
      paired &&
      launchPhase === "idle"
    ) {
      void connect({ autoLaunch: true });
    }
  }, [enabled, expanded, state.status, platform.supported, paired, launchPhase, connect]);

  const copyBridgeCommand = useCallback(() => {
    if (!pair) return;
    const cmd = `RELAY_URL=${relayBaseUrl()} SESSION_ID=${pair.sessionId} BRIDGE_TOKEN=${pair.bridgeToken} node terminal/bridge/src/index.js --cmd bash`;
    navigator.clipboard
      .writeText(cmd)
      .then(() => toast.success("Bridge command copied"))
      .catch(() => toast.error("Couldn't copy the command"));
  }, [pair]);

  if (!enabled) return null;

  const view = resolveDockView(state.status, launchPhase, platform.supported, paired);
  const meta = dockStatusMeta(view, state);
  const inputEnabled = isInputEnabled(state, readOnly);
  const showStream = state.status === "connected" || state.status === "disconnected";
  const canLaunch =
    state.status === "idle" ||
    state.status === "error" ||
    state.status === "session-ended" ||
    state.status === "disconnected";
  // The End control is only meaningful once a session exists and is still live/opening.
  const showEnd =
    view === "connected" ||
    view === "disconnected" ||
    view === "connecting" ||
    view === "connecting-returning" ||
    view === "legacy-waiting";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-700 bg-[#141417] text-zinc-200 shadow-[0_-8px_30px_rgba(0,0,0,0.4)]">
      {/* Collapsed dock bar — always visible */}
      <div className="flex items-center gap-2.5 px-3 py-1.5">
        <span className="inline-flex items-center gap-2 text-xs font-semibold">
          <Circle className={cn("h-2.5 w-2.5 fill-current", dotClass(state.status))} />
          <TerminalIcon className="h-3.5 w-3.5 text-zinc-400" />
          <span className="hidden sm:inline">Terminal</span>
          {pair && (
            <span className="hidden font-mono text-[11px] font-normal text-zinc-500 md:inline">
              · session {pair.sessionId.slice(0, 8)}
            </span>
          )}
        </span>
        <span className="ml-auto inline-flex items-center" />
        <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold", meta.className)}>
          <meta.Icon className={cn("h-3 w-3", meta.spin && "animate-spin")} />
          {meta.label}
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="text-zinc-300 hover:text-zinc-100"
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? "Collapse terminal panel" : "Expand terminal panel"}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{expanded ? "Collapse" : "Expand"}</span>
        </Button>
      </div>

      {/* Expanded body — kept mounted (hidden when collapsed) so the xterm instance
          and its scrollback survive collapse/expand and live bytes are never lost. */}
      <div className={cn("border-t border-zinc-800 bg-[#0c0c0e]", !expanded && "hidden")}>
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
            {ideaTitle}
            {pair && <span className="text-zinc-600"> · session {pair.sessionId.slice(0, 8)}</span>}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            {showStream && (
              <Button
                variant="outline"
                size="xs"
                className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
                onClick={() => setReadOnly((r) => !r)}
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
                onClick={endSession}
                aria-label="End session"
              >
                <Power className="h-3 w-3" /> End
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-zinc-300 hover:text-zinc-100"
              onClick={() => setExpanded(false)}
              aria-label="Collapse terminal panel"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
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
              onConnect={() => void connect({ autoLaunch: true })}
              onRetry={() => void connect({ autoLaunch: true })}
              onLaunchAgain={beginBrowserLaunch}
              onCopyBridge={copyBridgeCommand}
            />
          )}
          {/* Our OWN link dropped — we're actively REATTACHING to the same session
              within the grace window (retained token, no re-mint). Copy only claims
              what's true DURING the window: the agent is held/running locally and we
              reconnect automatically; if the window lapses the overlay switches to the
              honest "session ended" end state. */}
          {state.status === "disconnected" && (
            <div className="absolute inset-x-0 bottom-0 border-t border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300">
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
              <b>Reconnecting to your session…</b> Your machine may have slept or dropped Wi-Fi. Your agent keeps running locally while we reattach.
              <button className="ml-2 underline hover:text-amber-200" onClick={reconnectNow}>
                Reconnect now
              </button>
            </div>
          )}
          {/* Peer (the bridge) dropped but our link is fine — the relay is HOLDING the
              session. Keep the live terminal visible; just show a subtle hint. */}
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
              <button className="ml-2 underline hover:text-zinc-200" onClick={() => setReadOnly(false)}>
                Allow input
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
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
          {/* Advanced ▾ — cross-machine fallback: copy the manual bridge command.
              Untouched by the install-first redesign (per the approved UX scope guard). */}
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
      // The grace window / token validity lapsed before the link came back. Honest,
      // reassuring, and the "Launch again" button below starts a clean fresh session.
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
