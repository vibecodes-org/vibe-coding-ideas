"use client";

// In-app local Claude Code terminal — the board bottom dock (SLICE 3, browser leg).
//
// Renders the collapsible VS Code-style terminal dock from the approved design
// (docs/in-app-terminal-design.html) and wires it to the opaque Cloudflare relay
// as the `browser` leg:
//
//   POST /api/terminal/session  →  { sessionId, browserToken, bridgeToken }
//   WebSocket  <relay>/?session&role=browser&token  →  xterm.js
//
// The connection STATE MACHINE + close-code mapping + framing are pure and live in
// src/lib/terminal/connection.ts (unit-tested); this component owns only the side
// effects (fetch, socket, xterm, timers) and renders the six visible states.
//
// GATING: off by default. Renders nothing unless NEXT_PUBLIC_TERMINAL_ENABLED is
// exactly "true" (checked here AND at the board page mount). xterm is imported
// dynamically (client-only) so there is no SSR / window access at module load.

import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  Circle,
  CircleDot,
  Loader2,
  WifiOff,
  Square,
  CircleAlert,
  Power,
  Lock,
  LockOpen,
  Copy,
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
  buildRelayUrl,
  encodeResizeMessage,
  initialConnectionState,
  isInputEnabled,
  isTerminalEnabled,
  relayBaseUrl,
  terminalReducer,
  type TerminalConnectionState,
  type TerminalStatus,
} from "@/lib/terminal/connection";
import { buildLaunchDeepLink, redactDeepLinkToken } from "@/lib/terminal/deep-link";
import { subscribeBrowserLaunch } from "@/lib/terminal/launch-mode";

// Where the dock points the user when no helper catches the vibecodes:// link.
// Slice 7 ships the signed, notarized macOS helper (terminal/helper/) whose
// install lives at this path. HOSTING TODO: publish the notarized .dmg there and
// have this page link to it (see terminal/helper/BUILD-AND-SIGN.md → "Hosting").
const HELPER_INSTALL_URL = "/download/terminal-helper";
// How long to wait for the helper to attach before nudging "install it / Advanced".
const HELPER_OPEN_TIMEOUT_MS = 6000;

/** Launch UI phase for the same-machine deep-link auto-launch path. */
type LaunchPhase = "idle" | "opening" | "helper-timeout";

interface TerminalDockProps {
  ideaId: string;
  ideaTitle: string;
}

interface PairInfo {
  sessionId: string;
  bridgeToken: string;
}

interface StatusMeta {
  label: string;
  Icon: typeof Circle;
  spin?: boolean;
  className: string;
}

// Header pill — icon + text + colour (never colour alone), one per status.
function statusMeta(state: TerminalConnectionState): StatusMeta {
  switch (state.status) {
    case "connected":
      return { label: "Connected", Icon: CircleDot, className: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400" };
    case "connecting":
      return { label: "Connecting…", Icon: Loader2, spin: true, className: "border-amber-500/50 bg-amber-500/10 text-amber-400" };
    case "waiting-to-pair":
      return { label: "Waiting to pair", Icon: Loader2, spin: true, className: "border-sky-500/50 bg-sky-500/10 text-sky-400" };
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

export function TerminalDock({ ideaId, ideaTitle }: TerminalDockProps) {
  // Defence-in-depth: also gated at the page mount. When off, render nothing —
  // no dock, no entry point, board unchanged.
  const enabled = isTerminalEnabled();

  const [state, dispatch] = useReducer(terminalReducer, initialConnectionState);
  const [expanded, setExpanded] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [pair, setPair] = useState<PairInfo | null>(null);
  const [xtermReady, setXtermReady] = useState(false);
  // Same-machine auto-launch UI (the vibecodes:// deep-link path). "idle" = the
  // manual cross-machine flow (copy a command); "opening"/"helper-timeout" = we
  // fired a deep link and are waiting on the local helper.
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>("idle");

  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<XFitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const helperTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDimsRef = useRef<string>("");

  // Mirror live state into refs so the stable xterm onData handler reads current
  // values without re-binding on every render.
  const statusRef = useRef(state.status);
  const readOnlyRef = useRef(readOnly);
  statusRef.current = state.status;
  readOnlyRef.current = readOnly;

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

  // Fit + emit a resize control frame (TEXT) matching the bridge's framing.
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
    if (key === lastDimsRef.current) return;
    lastDimsRef.current = key;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(msg);
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

  // Fire the signed vibecodes:// deep link so a same-machine helper attaches as the
  // bridge leg with no copied command. The bridge token is a secret — it travels in
  // the link but is NEVER logged (only the redacted form is). The OS routing of the
  // scheme to the installed helper is slice 7 (packaging); here we just fire it and
  // fall back to the Advanced manual command if nothing attaches.
  const fireLaunchDeepLink = useCallback(
    (sessionId: string, bridgeToken: string) => {
      let link: string;
      try {
        link = buildLaunchDeepLink({ relay: relayBaseUrl(), session: sessionId, token: bridgeToken });
      } catch (err) {
        logger.error("Terminal deep-link build failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        setLaunchPhase("helper-timeout");
        return;
      }
      logger.info("Terminal firing launch deep link", { sessionId, url: redactDeepLinkToken(link) });
      setLaunchPhase("opening");
      try {
        window.location.assign(link);
      } catch {
        // Some browsers throw synchronously on a blocked/unknown custom scheme.
        setLaunchPhase("helper-timeout");
        return;
      }
      // If the helper doesn't attach within a few seconds, nudge install / Advanced.
      clearHelperTimer();
      helperTimerRef.current = setTimeout(() => {
        setLaunchPhase((p) => (p === "opening" ? "helper-timeout" : p));
      }, HELPER_OPEN_TIMEOUT_MS);
    },
    [clearHelperTimer],
  );

  const teardownSocket = useCallback(() => {
    clearConnectTimer();
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
  }, [clearConnectTimer]);

  // ── connect (browser leg) ───────────────────────────────────────────────────
  // `autoLaunch` = the same-machine path: after minting, fire the vibecodes:// deep
  // link so the local helper attaches automatically (no copied command). Without it
  // (manual reconnect), we stay in the cross-machine "copy a command" flow.
  const connect = useCallback(async (options?: { autoLaunch?: boolean }) => {
    const autoLaunch = options?.autoLaunch ?? false;
    teardownSocket();
    clearHelperTimer();
    setLaunchPhase(autoLaunch ? "opening" : "idle");
    setExpanded(true);
    lastDimsRef.current = "";
    dispatch({ type: "connect" });

    let data: { sessionId: string; browserToken: string; bridgeToken: string };
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
      logger.error("Terminal session mint failed (client)", {
        error: err instanceof Error ? err.message : String(err),
      });
      dispatch({ type: "session-mint-failed" });
      toast.error("Couldn't start a terminal session", {
        description: err instanceof Error ? err.message : undefined,
      });
      return;
    }

    dispatch({ type: "session-created", sessionId: data.sessionId });
    setPair({ sessionId: data.sessionId, bridgeToken: data.bridgeToken });
    termRef.current?.clear();

    // Same-machine: hand the bridge token to the local helper via the deep link.
    if (autoLaunch) fireLaunchDeepLink(data.sessionId, data.bridgeToken);

    const url = buildRelayUrl(relayBaseUrl(), data.sessionId, data.browserToken);
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

    connectTimerRef.current = setTimeout(() => {
      dispatch({ type: "connect-timeout" });
      teardownSocket();
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      clearConnectTimer();
      dispatch({ type: "relay-open" });
    };
    ws.onmessage = (ev) => {
      // BINARY = opaque PTY bytes → xterm. TEXT = control frame (none expected from
      // the bridge today); ignore so it never reaches the screen as garbage.
      if (typeof ev.data === "string") return;
      // The helper attached and is streaming — the launch succeeded; drop the
      // "opening helper / install it" nudge.
      clearHelperTimer();
      setLaunchPhase("idle");
      dispatch({ type: "data" });
      termRef.current?.write(new Uint8Array(ev.data as ArrayBuffer));
    };
    ws.onerror = () => {
      // A 'close' with the real code follows; just log metadata here.
      logger.warn("Terminal relay socket error", { sessionId: data.sessionId });
    };
    ws.onclose = (ev) => {
      clearConnectTimer();
      wsRef.current = null;
      dispatch({ type: "closed", code: ev.code, reason: ev.reason });
    };
  }, [ideaId, teardownSocket, clearConnectTimer, clearHelperTimer, fireLaunchDeepLink]);

  const endSession = useCallback(() => {
    dispatch({ type: "user-end" });
    clearHelperTimer();
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
  }, [teardownSocket, clearHelperTimer]);

  // Clean up the socket if the dock unmounts mid-session.
  useEffect(() => () => teardownSocket(), [teardownSocket]);

  // Clear the helper-open timer on unmount.
  useEffect(() => () => clearHelperTimer(), [clearHelperTimer]);

  // The "In the browser" menu item (board toolbar) fires the launch bus; pick it up
  // here and run the auto-launch (mint → open browser leg → fire deep link). Keeping
  // the mint in ONE place (the dock) means the session — and its bridge token — is
  // never created twice.
  useEffect(() => {
    if (!enabled) return;
    return subscribeBrowserLaunch(() => void connect({ autoLaunch: true }));
  }, [enabled, connect]);

  const copyBridgeCommand = useCallback(() => {
    if (!pair) return;
    const cmd = `RELAY_URL=${relayBaseUrl()} SESSION_ID=${pair.sessionId} BRIDGE_TOKEN=${pair.bridgeToken} node terminal/bridge/src/index.js --cmd bash`;
    navigator.clipboard
      .writeText(cmd)
      .then(() => toast.success("Bridge command copied"))
      .catch(() => toast.error("Couldn't copy the command"));
  }, [pair]);

  if (!enabled) return null;

  const meta = statusMeta(state);
  const inputEnabled = isInputEnabled(state, readOnly);
  const showStream = state.status === "connected" || state.status === "disconnected";
  const canLaunch =
    state.status === "idle" ||
    state.status === "error" ||
    state.status === "session-ended" ||
    state.status === "disconnected";

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
            {(showStream || state.status === "connecting" || state.status === "waiting-to-pair") && (
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
              state={state}
              pair={pair}
              canLaunch={canLaunch}
              launchPhase={launchPhase}
              onLaunch={() => void connect({ autoLaunch: true })}
              onReconnect={() => void connect()}
              onCopyBridge={copyBridgeCommand}
            />
          )}
          {state.status === "disconnected" && (
            <div className="absolute inset-x-0 bottom-0 border-t border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300">
              <WifiOff className="mr-1 inline h-3 w-3" />
              <b>Lost the connection.</b> Your machine may have slept or dropped Wi-Fi. The agent keeps running locally.
              <button className="ml-2 underline hover:text-amber-200" onClick={() => void connect()}>
                Reconnect now
              </button>
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

// ── per-state centred overlays (icon + text + next step) ──────────────────────
function StateOverlay({
  state,
  pair,
  canLaunch,
  launchPhase,
  onLaunch,
  onReconnect,
  onCopyBridge,
}: {
  state: TerminalConnectionState;
  pair: PairInfo | null;
  canLaunch: boolean;
  launchPhase: LaunchPhase;
  onLaunch: () => void;
  onReconnect: () => void;
  onCopyBridge: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0c0c0e]/95 px-6 text-center">
      {state.status === "idle" && (
        <>
          <TerminalIcon className="h-7 w-7 text-emerald-400" />
          <div className="text-base font-semibold text-emerald-400">Ready when you are</div>
          <p className="max-w-md text-[13px] text-zinc-400">
            Start Claude Code on your machine and mirror it here. Your code stays on your computer — we only relay the screen.
          </p>
          <Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={onLaunch}>
            <TerminalIcon className="h-4 w-4" /> Launch in browser
          </Button>
        </>
      )}

      {state.status === "connecting" && (
        <>
          <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
          <div className="text-base font-semibold text-amber-400">Starting your session…</div>
          <p className="max-w-md text-[13px] text-zinc-400">
            Opening the encrypted relay — usually instant. <span className="text-zinc-600">(waiting up to 30s)</span>
          </p>
        </>
      )}

      {state.status === "waiting-to-pair" && (
        <>
          {launchPhase === "opening" && (
            <>
              <Loader2 className="h-7 w-7 animate-spin text-sky-400" />
              <div className="text-base font-semibold text-sky-400">Opening the VibeCodes helper…</div>
              <p className="max-w-md text-[13px] text-zinc-400">
                Your computer may ask to open VibeCodes — click <b className="text-zinc-200">Open</b>. The helper
                starts Claude Code and attaches here automatically.
              </p>
            </>
          )}

          {launchPhase === "helper-timeout" && (
            <>
              <Download className="h-7 w-7 text-sky-400" />
              <div className="text-base font-semibold text-sky-200">Don&apos;t have the helper?</div>
              <p className="max-w-md text-[13px] text-zinc-400">
                Nothing opened. Install the small VibeCodes helper once, then launch again — or pair another
                machine by hand under Advanced.
              </p>
              <a
                href={HELPER_INSTALL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-sm font-semibold text-sky-950 hover:bg-sky-400"
              >
                <Download className="h-4 w-4" /> Install the helper
              </a>
            </>
          )}

          {launchPhase === "idle" && (
            <>
              <Loader2 className="h-7 w-7 animate-spin text-sky-400" />
              <div className="text-base font-semibold text-sky-400">Waiting for your machine to attach</div>
              <p className="max-w-md text-[13px] text-zinc-400">
                The relay is up. Start a bridge on your computer for this session to go live.
              </p>
            </>
          )}

          {/* Advanced ▾ — cross-machine fallback: copy the manual bridge command. */}
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

      {state.status === "session-ended" && (
        <>
          <Square className="h-7 w-7 text-zinc-400" />
          <div className="text-base font-semibold text-zinc-300">{endedTitle(state)}</div>
          <p className="max-w-md text-[13px] text-zinc-400">{endedMessage(state)}</p>
          <Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={onLaunch}>
            <TerminalIcon className="h-4 w-4" /> Launch again
          </Button>
        </>
      )}

      {state.status === "error" && (
        <>
          <CircleAlert className="h-7 w-7 text-rose-400" />
          <div className="text-base font-semibold text-rose-400">{errorTitle(state)}</div>
          <p className="max-w-md text-[13px] text-zinc-400">{errorMessage(state)}</p>
          {canLaunch && state.errorKind !== "owner-mismatch" && (
            <Button
              variant="outline"
              size="sm"
              className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
              onClick={onReconnect}
            >
              <RotateCw className="h-3.5 w-3.5" /> Try again
            </Button>
          )}
        </>
      )}
    </div>
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
    default:
      return "Session ended";
  }
}

function endedMessage(state: TerminalConnectionState): string {
  switch (state.endedReason) {
    case "idle":
    case "max-duration":
      return "We closed the session to keep things tidy and safe. Nothing went wrong — your work on your machine is untouched.";
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
      return "Couldn't reach the relay";
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
      return "The session token was invalid or expired. Launch again to mint a fresh one.";
    case "duplicate":
      return "Another browser tab is already attached to this session. Close it, then launch again.";
    case "connect-timeout":
      return "We waited 30s but nothing connected. Is a bridge running and allowed to open?";
    case "relay-unreachable":
      return "The terminal relay didn't respond. Check it's running, then try again.";
    case "session-mint-failed":
      return "The session request failed. Check your connection and try again.";
    default:
      return "The terminal session failed. Try launching again.";
  }
}
