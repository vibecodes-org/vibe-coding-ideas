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
// ARCHITECTURE (multi-session stage 1, docs/design-terminal-multi-session-popout.html):
// everything ONE session needs — the connection state machine, the WebSocket browser
// leg, xterm + resize/focus, the heartbeat watchdog, the grace-window reattach loop,
// and the vibecodes:// deep-link fire — lives behind `useTerminalSession` (see
// use-terminal-session.ts). This component owns the DOCK CHROME shared across
// sessions (collapsed bar, expanded panel, `expanded` open/close) and the launch-bus
// wiring, and renders the states that hook exposes. The connection STATE MACHINE +
// close-code mapping + framing are pure and live in src/lib/terminal/connection.ts;
// the OS/arch detection, the paired-flag gate, and the first-run copy are pure and
// live in src/lib/terminal/{platform,paired-flag,first-run-copy}.ts (all
// unit-tested).
//
// GATING: off by default. Renders nothing unless NEXT_PUBLIC_TERMINAL_ENABLED is
// exactly "true" (checked here AND at the board page mount).

import { useCallback, useEffect, useState, type ReactNode } from "react";
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  isTerminalEnabled,
  type TerminalConnectionState,
  type TerminalStatus,
} from "@/lib/terminal/connection";
import { subscribeBrowserLaunch } from "@/lib/terminal/launch-mode";
import { type TerminalPlatform, TERMINAL_HELPER_DOWNLOAD_URL } from "@/lib/terminal/platform";
import { FIRST_RUN_COPY } from "@/lib/terminal/first-run-copy";
import { type DockView, resolveDockView } from "@/lib/terminal/first-run-flow";
import { useTerminalSession, type PairInfo } from "./use-terminal-session";

interface TerminalDockProps {
  ideaId: string;
  ideaTitle: string;
  /**
   * The idea's GitHub URL (or null). Needed so hook-initiated launches — paired
   * auto-connect and Retry, which never pass through the launch button — can
   * build the SAME board-level compact bootstrap prompt the button would.
   */
  ideaGithubUrl: string | null;
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
  const [expanded, setExpanded] = useState(false);

  // Dock CHROME: shared by every session (only one today; stage 2 adds a tab strip
  // over the same expanded/collapsed panel). The hook calls this at the same points
  // the old single-session component called `setExpanded(true)` directly.
  const requestExpand = useCallback(() => setExpanded(true), []);

  const session = useTerminalSession(
    { ideaId, ideaTitle, ideaGithubUrl },
    { enabled, expanded, requestExpand },
  );
  const { state, launchPhase, peerDegraded, pair, readOnly, inputEnabled, platform, paired, containerRef, actions } = session;

  // The "In the browser" menu item (board toolbar) fires the launch bus; pick it up
  // here and forward it to the session. Board-level wiring — in stage 2 this is
  // where a NEW tab (and its own hook instance) would be created instead.
  const { launchFromBus } = actions;
  useEffect(() => {
    if (!enabled) return;
    return subscribeBrowserLaunch((payload) => {
      launchFromBus(payload ?? null);
    });
  }, [enabled, launchFromBus]);

  if (!enabled) return null;

  const view = resolveDockView(state.status, launchPhase, platform.supported, paired);
  const meta = dockStatusMeta(view, state);
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
              onConnect={() => void actions.connect({ autoLaunch: true })}
              onRetry={() => void actions.connect({ autoLaunch: true })}
              onLaunchAgain={actions.beginBrowserLaunch}
              onCopyBridge={actions.copyBridgeCommand}
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
              <button className="ml-2 underline hover:text-amber-200" onClick={actions.reconnectNow}>
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
