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
import {
  capReachedToastCopy,
  getTerminalSessionCap,
  RATE_LIMIT_MESSAGE,
  DAILY_RELAY_BUDGET_MESSAGE,
} from "@/lib/terminal/session-cap";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon as XFitAddon } from "@xterm/addon-fit";
import {
  CONNECT_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  LINK_SILENT_CHECK_MS,
  RECONNECT_GRACE_MS,
  buildRelayUrl,
  claimConnectGeneration,
  decideReconnectNow,
  decideResize,
  isConnectSuperseded,
  isValidDim,
  encodeHeartbeatFrame,
  encodeResizeMessage,
  initialConnectionState,
  isBridgeVersionFrame,
  isHeartbeatAckFrame,
  isInputEnabled,
  isPeerDegradedFrame,
  isPeerReattachedFrame,
  mapCloseCode,
  parseBridgeVersionFrame,
  parseBridgeVersionHost,
  parseBridgeVersionConv,
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
  resolveEffectiveLaunchTarget,
  resolveLaunchCwd,
  type RecordedProjectPath,
} from "@/lib/launch-claude-code";
import {
  type TerminalPlatform,
  readPlatformSignals,
  resolveTerminalPlatform,
} from "@/lib/terminal/platform";
import { isBrowserPaired, markBrowserPaired, resolveFirstRunEntry } from "@/lib/terminal/paired-flag";
import { getMachineIdentity, setMachineIdentity } from "@/lib/terminal/machine-identity";
import { type LaunchPhase, nextLaunchPhaseOnTimeout } from "@/lib/terminal/first-run-flow";
import { consumeRecentHelperIdleQuit } from "@/lib/terminal/helper-relaunch-signal";
import {
  restoreScrollback,
  serializeScrollback,
  SCROLLBACK_TRANSFER_CAP_BYTES,
  type TransferredBuffer,
} from "@/lib/terminal/scrollback-transfer";
import {
  saveSessionSnapshot,
  clearSessionSnapshot,
  rememberLastTabSid,
  SNAPSHOT_SAVE_INTERVAL_MS,
} from "@/lib/terminal/session-snapshot";
import { matchFocusMoveChord } from "@/lib/terminal/split-view";

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
  if (body?.code === "daily_relay_budget") {
    // MITIGATION 3 — account-wide breaker (relay-budget.ts). Deliberately no
    // "View my sessions" action: unlike the per-user cap, ending a session of
    // your own does nothing to free up account-wide headroom.
    toast.error(body.error || DAILY_RELAY_BUDGET_MESSAGE);
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
  /**
   * Bug cbe60db5-followup-2 (fallback connect() never resolves a recorded
   * folder): absolute paths the agent recorded for this user + idea, one per
   * machine (idea_project_paths, RLS-scoped to the human) — the SAME data the
   * launch button already threads through resolveEffectiveLaunchTarget
   * (launch-claude-code-button.tsx). Hook-initiated launches (paired
   * auto-connect on open, Retry) never go through the button, so without
   * this `resolveLaunchPromptParts` always passed `undefined` for the
   * recorded-path slot — a session started this way recorded `cwd=null` even
   * when a real folder was on file, so the ended-session overlay's Resume
   * button (which requires a known `cwd` — see terminal-session-view.tsx's
   * `canResume`) never showed. Optional; undefined/empty behaves exactly like
   * before (falls through to "new project" — see resolveDefaultLaunchState).
   */
  recordedProjectPaths?: RecordedProjectPath[];
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
   * Terminal sessions need names that stick (card 3bf262ac): this tab's own
   * user-set name, if it has one — forwarded on mint the same way
   * `taskId`/`taskTitle` are, so a renamed row's name rides a fresh mint
   * (resume) instead of being lost. Undefined for every launch that isn't
   * reviving a renamed row.
   */
  displayName?: string;
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
  /**
   * Split view (task df7a0134, design §9 "one keyboard owner, enforced not
   * implied"): with two panes visible at once, `expanded` alone can no
   * longer mean "this is the one instance that should grab the keyboard" —
   * BOTH panes are visible (and so both need the resize/refit effects below,
   * which stay keyed on `expanded`), but only ONE may steal focus. Defaults
   * to `true` — every existing single-pane caller (tabbed mode, the
   * pop-out window) is unaffected, since there `expanded` already implied
   * "the one visible instance". The dock passes `false` for the pane that
   * ISN'T the split's `focusedPaneKey`; that pane still refits on every
   * geometry change, it just never calls `termRef.current?.focus()`.
   */
  grabFocus?: boolean;
  /**
   * Split view drag-to-dock (design §6.1, Design Review required change 2):
   * while `.current` is true, Escape is swallowed from reaching the PTY —
   * see `dragActiveRef`'s doc on TerminalSessionViewProps for why this is a
   * ref (read fresh inside the xterm custom-key handler below) rather than a
   * prop this hook would need to re-subscribe effects on.
   */
  dragActiveRef?: { current: boolean };
}

/** The minimum a popped-out window needs to attach to an existing session — see `attachExisting` above. */
export interface AttachExistingPair {
  sessionId: string;
  browserToken: string;
  /**
   * Scrollback transfer (card 35cffc10, Flow A): the dock's serialized
   * buffer at the moment of pop-out, restored into this window's terminal
   * AFTER it opens but BEFORE the socket attaches — so handed-over history
   * sits above the live stream with nothing interleaved. `null`/absent
   * covers deploy skew (an old dock never sent one) and the case where the
   * dock had nothing to serialize yet — the terminal just starts empty,
   * today's pre-this-card behaviour.
   */
  initialBuffer?: TransferredBuffer | null;
  /**
   * Bug cbe60db5-followup: the registry's own record of the folder/
   * conversation this session was running, forwarded by the reattach route
   * (`/api/terminal/session/reattach`) for reload-reattach / instant-
   * continue / chooser-Reconnect. `attachToExisting` seeds `sessionCwd`/
   * `claudeSessionId` from these — mirroring exactly what `connect()` seeds
   * from `resolveLaunchPromptParts()` — so a session that later ends for a
   * non-user reason can still offer "Resume this conversation" (`canResume`
   * in terminal-session-view.tsx requires `sessionCwd`). Undefined/null for
   * a popped-out window's hand-off (terminal-popout-view.tsx never carries
   * these — the pop-out channel doesn't transfer them) or a pre-this-fix
   * reattach response — falls back to the pre-existing null/no-resume
   * behaviour, same as any other missing optional field here.
   */
  cwd?: string | null;
  claudeSessionId?: string | null;
  /**
   * Reconnect-relaunch fix: the reattach route (`/api/terminal/session/
   * reattach`) now mints a fresh BRIDGE token alongside the browser token it
   * always minted — the credential `fireLaunchDeepLink` needs to relaunch the
   * local helper. Without this, Reconnect opened a browser leg and then
   * waited passively forever: the local helper auto-quits when idle, and
   * nothing ever told it to come back. `attachToExisting` fires the deep
   * link when this is present, exactly like `connect({autoLaunch:true})`
   * does for a fresh mint. Absent for a popped-out window's hand-off
   * (terminal-popout-view.tsx never carries it — the bridge is already
   * attached elsewhere, nothing to relaunch) or a pre-this-fix reattach
   * response — attachToExisting simply doesn't fire a deep link then, same
   * as today's behaviour.
   */
  bridgeToken?: string;
  /**
   * The matching HELPER-role token (card cc74a067) — rides the SAME deep
   * link as `bridgeToken` so the same click also (re)establishes the
   * helper's standing control connection. See `bridgeToken`'s doc; optional
   * for the same reasons.
   */
  helperToken?: string;
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
  /**
   * Force a refit + resize-frame send + focus, for a reveal that un-hides
   * the host WITHOUT `expanded` itself changing — e.g. the caller's own
   * `poppedOut` prop flipping false on bring-back (fix/terminal-popout-host-
   * mounted). The container was `display:none` (0-size) the whole time it
   * was hidden that way, so the `expanded`-keyed resize/focus effects above
   * never re-fire for it; this is the same recovery those effects already do
   * on a dock re-expand, just triggered on demand instead of by `expanded`.
   * Split view: pass `{ focus: false }` for a pane the caller does NOT want
   * to steal the keyboard for (the unfocused pane in a 2-up layout) — the
   * refit still happens either way. Omitted/`{}` keeps the original
   * always-focus behaviour every pre-existing caller relies on.
   */
  refreshView: (opts?: { focus?: boolean }) => void;
  /**
   * Scrollback transfer (card 35cffc10, design §7): serialize THIS
   * session's live terminal right now, capped at 1 MiB — the dock calls this
   * fresh inside its pop-out payload builder on every send (including
   * retries), and the popped window calls it to answer `bring-back-request`
   * / its own `pagehide`. `null` before the xterm instance has mounted
   * (nothing to serialize yet) — never throws otherwise
   * (serializeScrollback's own contract).
   */
  serializeNow: () => TransferredBuffer | null;
  /**
   * Restore a previously-serialized buffer into THIS session's live
   * terminal (full reset first — see restoreScrollback's doc). Used by the
   * dock on both bring-back paths (Flow B's reply, Flow C's stash) to
   * replace its hidden terminal's history with the popped window's more
   * complete copy (D1). A no-op if the xterm instance hasn't mounted yet.
   */
  restoreBuffer: (buffer: TransferredBuffer) => void;
}

export interface UseTerminalSessionResult {
  /** Full connection state machine snapshot (status, sessionId, errorKind, endedReason, closeCode). */
  state: TerminalConnectionState;
  /** Same-machine auto-launch phase: "idle" | "opening" | "helper-timeout". */
  launchPhase: LaunchPhase;
  /** Grace-window "peer dropped, we're holding" hint. */
  peerDegraded: boolean;
  /**
   * The bridge's announced helper version (release-gate rework 2a), or null
   * before one arrives — includes every pre-2a helper, which never announces
   * one at all. Feed this to `shouldShowHelperUpdateNudge` (src/lib/terminal/
   * helper-version.ts) to decide whether to show the update notice.
   */
  helperVersion: string | null;
  /** The minted session's ids/tokens (null before mint / after end). */
  pair: PairInfo | null;
  /**
   * Card cbe60db5 rework 9 (Bug A): the folder this tab's current/just-ended
   * session launched into. See the `sessionCwd` state doc above for the full
   * lifecycle — unlike `pair`, this is never cleared on session-ended, so the
   * session-ended overlay's "Resume this conversation" action can read it.
   */
  cwd: string | null;
  /**
   * Card cbe60db5 rework 9 (Bug A): the id of the claude conversation this
   * tab's current/just-ended session is running, once known. See the
   * `claudeSessionId` state doc above. Null → the session-ended overlay's
   * Resume falls back to the legacy `--continue` resume (or hides Resume
   * entirely if `cwd` is also unknown), exactly like the chooser's Resume.
   */
  claudeSessionId: string | null;
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
  /**
   * Card cbe60db5 (2026-08-14 incident): true once the stuck-pairing
   * watchdog has fired — the session sat on "waiting-to-pair" with an
   * idle launchPhase (the "legacy-waiting" view) for a full
   * RECONNECT_GRACE_MS with no bridge ever attaching, and this wasn't the
   * one legitimate indefinite-wait case (a manual `connect({autoLaunch:
   * false})`). The consumer should surface the existing TimeoutPanel's
   * "returning" variant instead of the open-ended legacy-waiting panel,
   * with Retry wired to `actions.connect({ autoLaunch: true })`. Resets to
   * false the instant the stuck condition clears (fresh connect/attach,
   * data arrives, an error/end supersedes it, …).
   */
  pairingTimedOut: boolean;
  actions: TerminalSessionActions;
}

export function useTerminalSession(
  descriptor: TerminalSessionDescriptor,
  options: UseTerminalSessionOptions,
): UseTerminalSessionResult {
  const { ideaId, ideaTitle, ideaGithubUrl, recordedProjectPaths } = descriptor;
  const {
    enabled,
    expanded,
    requestExpand,
    autoConnectWhenExpanded = true,
    taskId,
    taskTitle,
    displayName,
    onCapExceeded,
    attachExisting = null,
    grabFocus = true,
    dragActiveRef,
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
  // Card cbe60db5 rework 9 (Bug A — timeout resume): the folder + claude
  // conversation id THIS tab's current/just-ended session launched with,
  // captured at connect()-time and (unlike `promptPartsRef`, which clears on
  // session-ended — see that effect below) kept around so the session-ended
  // overlay's "Resume this conversation" action has something to carry into
  // a fresh mint. `sessionCwd` is set from the same resolveLaunchPromptParts()
  // the deep link itself used; `claudeSessionId` is seeded from this launch's
  // own carried `resumeId` (if it WAS a resume) and overwritten the moment
  // the bridge announces its actual `conv` (rework 5's exact-conversation
  // Resume, see the bridge-version-frame handler below). Both null before any
  // connect() on this tab, or forever for a plain launch whose bridge is too
  // old to ever announce a conversation id.
  const [sessionCwd, setSessionCwd] = useState<string | null>(null);
  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null);
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
  // Release-gate rework 2a: the bridge's own announced version, forwarded by the
  // relay as a `bridge-version` control frame (attach-ordering independent — see
  // connection.ts's doc comment). null until one arrives — includes every
  // pre-2a helper, which never sends one at all; the dock treats that identically
  // to "known stale" (src/lib/terminal/helper-version.ts).
  const [helperVersion, setHelperVersion] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<XFitAddon | null>(null);
  // Scrollback transfer (card 35cffc10): `attachToExisting` can run BEFORE
  // the async xterm-init effect below has finished mounting the terminal
  // (attach isn't gated on xtermReady — see attachToExisting's own doc) —
  // when that happens the buffer it was handed has nowhere to land yet, so
  // it's stashed here and applied the moment the xterm-init effect sets
  // `termRef.current`, instead of being silently dropped.
  const pendingInitialBufferRef = useRef<TransferredBuffer | null>(null);
  // Squashed-reattach fix (task 6ac2cd44, 2026-08-17 follow-up to 27d19c68):
  // mirrors `pendingInitialBufferRef` immediately above — `attachToExisting`
  // can ALSO run before xterm has mounted (it fires synchronously, no await,
  // in the same effect-flush pass as the dispatches that trigger this tab's
  // fresh mount), and firing the reattach relaunch deep link then means
  // `currentLaunchDims()` (which reads `termRef`/`fitRef` — see its own doc
  // comment) is GUARANTEED to return null on a fresh mount, not just
  // "unlikely to". The bridge then spawns the remote PTY at its hardcoded
  // 80x24 fallback inside a much wider panel — the "squashed" symptom — and
  // the later resize correction (the connected-transition effect around
  // `sendResize`) can't retroactively re-wrap text already printed at the
  // narrow width. Stashed here instead of fired with null dims, and flushed
  // from the SAME xterm-init effect below that already flushes
  // `pendingInitialBufferRef`, right after `termRef`/`fitRef` are populated —
  // so `currentLaunchDims()` reads real values by the time it actually
  // fires. `gen` is the `connectGenRef` snapshot at queue time, so a newer
  // `connect()`/`attachToExisting` superseding this one drops the stale fire
  // at flush time instead of duplicate-firing alongside the newer one.
  const pendingDeepLinkRef = useRef<{
    gen: number;
    sessionId: string;
    bridgeToken: string;
    helperToken?: string;
    opts: { trigger: "attach-existing"; forceResumeCwd?: string | null; forceResumeId?: string | null };
  } | null>(null);
  // Ref-mirror of `fireLaunchDeepLink` (same idiom as `scheduleReconnectRef`
  // below) so the xterm-init effect above can call the LATEST callback
  // without needing it in that effect's dependency array — `fireLaunchDeepLink`
  // is declared much later in this hook, and adding it as a dependency would
  // re-run (and re-mount) the whole xterm terminal every time ITS OWN deps
  // change, which is never what we want for a mount-once effect.
  const fireLaunchDeepLinkRef = useRef<
    (
      sessionId: string,
      bridgeToken: string,
      helperToken: string | undefined,
      opts: { trigger: "attach-existing"; forceResumeCwd?: string | null; forceResumeId?: string | null },
    ) => void
  >(() => {});
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
  // Reload-reattach instant-continue (card cbe60db5, design item 5): true
  // once output has arrived since the last snapshot save — the periodic
  // snapshot effect below only writes to sessionStorage when this is set, so
  // a quiet connected session doesn't re-serialize+re-write an unchanged
  // buffer every 20s. Cleared the instant a snapshot is taken.
  const snapshotDirtyRef = useRef(false);
  // Silent-link watchdog bookkeeping (fix/terminal-dock-heartbeat).
  // `lastInboundAtRef` is stamped on EVERY inbound frame (PTY bytes, control
  // frames, hb-acks); `hbArmedRef` is a PER-SOCKET latch set on the socket's first
  // hb-ack — an old relay never acks, so the watchdog stays disarmed there and the
  // pre-watchdog behaviour is unchanged (version-skew gate). Both are reset in
  // openBrowserLeg when a fresh socket is opened.
  const lastInboundAtRef = useRef(0);
  const hbArmedRef = useRef(false);
  // Machine identity (Nick's sign-off change 2): once-per-session guard so a
  // bridge that re-announces the SAME host on every attach (grace-window
  // reconnect, etc.) doesn't re-fire the identity PATCH each time — keyed by
  // sessionId so a genuinely NEW session (a fresh mint) always fires again.
  const machineIdentityAnnouncedSidRef = useRef<string | null>(null);
  // Exact-conversation Resume (rework 5, card cbe60db5): the SAME once-per-
  // session pattern for the claude conversation id the bridge announces
  // (relay `bridge-version` frame's `conv` field) — keyed by sessionId so a
  // fresh mint always re-fires, but a grace-window reconnect re-announcing
  // the SAME id doesn't re-PATCH on every reattach.
  const convIdAnnouncedSidRef = useRef<string | null>(null);
  // The compact bootstrap prompt ESSENTIALS (BUG5 follow-through, 4th rework
  // cycle) the LAST launch-bus event carried — i.e. what the launch button
  // resolved. Hook-initiated launches with no bus payload (paired auto-connect
  // on open, Retry) fall back to building the board-level essentials themselves
  // via the same shared builder (see resolveLaunchPromptParts), so every launch
  // is primed.
  const promptPartsRef = useRef<BrowserLaunchPayload | null>(null);

  // ── stuck-pairing recovery watchdog (card cbe60db5, 2026-08-14 incident) ───
  // Nothing re-fires the vibecodes:// deep link for an already-minted sid
  // except a fresh connect({autoLaunch:true}) — so a session that reaches
  // "waiting-to-pair" with launchPhase "idle" (the "legacy-waiting" view,
  // "Waiting for your machine to attach") has NO timeout unless something
  // arms one: the existing helperTimerRef only bounds the "opening" phase of
  // a FRESH same-pageview launch, which this state has already passed
  // through (or, for attachToExisting/fresh-attach-reset, never entered at
  // all). OPT-OUT design: every path that expects its own auto-attach to
  // eventually resolve (or time out) arms this true; the ONE legitimate
  // indefinite wait — a literal manual `connect({autoLaunch:false})`, the
  // "Advanced — pair a remote machine by hand" cross-machine flow — leaves
  // it false so that panel keeps waiting forever, as designed.
  const expectsAutoAttachRef = useRef(true);
  const pairingWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Surfaces the existing TimeoutPanel ("returning" copy) over the
  // legacy-waiting overlay once the watchdog below expires. Reset back to
  // false the instant we're no longer sitting in the stuck condition (a
  // fresh connect/attach moves launchPhase off "idle", data arriving moves
  // status off "waiting-to-pair", etc.) — see the arming effect.
  const [pairingTimedOut, setPairingTimedOut] = useState(false);

  const clearPairingWatchdog = useCallback(() => {
    if (pairingWatchdogRef.current) {
      clearTimeout(pairingWatchdogRef.current);
      pairingWatchdogRef.current = null;
    }
  }, []);

  // Arm/disarm the watchdog whenever the "legacy-waiting" condition
  // (status === "waiting-to-pair" && launchPhase === "idle" — see
  // first-run-flow.ts's resolveDockView) becomes true or false. Re-runs on
  // every status/launchPhase change, so the effect's own cleanup (returned
  // below) clears any pending timer before re-evaluating — the same
  // React-managed cleanup the other per-status effects in this hook rely on,
  // no separate unmount effect needed. `expectsAutoAttachRef` is a ref (read
  // at arm-time, not a dependency) so a manual-pairing session that later
  // times out some OTHER way never retroactively arms a stale watchdog.
  useEffect(() => {
    clearPairingWatchdog();
    const stuck = state.status === "waiting-to-pair" && launchPhase === "idle" && expectsAutoAttachRef.current;
    if (!stuck) {
      setPairingTimedOut(false);
      return;
    }
    pairingWatchdogRef.current = setTimeout(() => {
      setPairingTimedOut(true);
    }, RECONNECT_GRACE_MS);
    return clearPairingWatchdog;
  }, [state.status, launchPhase, clearPairingWatchdog]);

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

      // Split view (task df7a0134, design §5.4 + §6.1, Design Review required
      // change 2): intercept BEFORE xterm processes the keydown, so neither
      // the pane-focus chord nor a drag-cancelling Escape ever reaches the
      // PTY as input — `false` stops xterm's own handling (no data sent,
      // cursor untouched) but does NOT call preventDefault/stopPropagation on
      // the native event, so it still bubbles normally to the dock's own
      // window-level listener, which performs the actual pane-focus move (or
      // lets dnd-kit's own Escape-cancel run — see terminal-dock.tsx).
      // Unconditional on the chord (harmless outside split view — nothing
      // else claims Ctrl+Shift+←/→); Escape is gated on `dragActiveRef` so a
      // NON-drag Escape keeps its ordinary terminal meaning.
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        if (matchFocusMoveChord(event)) return false;
        if (event.key === "Escape" && dragActiveRef?.current) return false;
        return true;
      });

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
      // A buffer arrived (attachToExisting ran) before the terminal itself
      // was ready to receive it — apply it now that it is (see
      // pendingInitialBufferRef's doc).
      if (pendingInitialBufferRef.current) {
        restoreScrollback(term, pendingInitialBufferRef.current);
        pendingInitialBufferRef.current = null;
      }
      // Squashed-reattach fix: a reattach relaunch deep link queued by
      // attachToExisting above because xterm wasn't mounted yet — flush it
      // now that termRef/fitRef (just above) are populated, so
      // currentLaunchDims() reads real values instead of null. Drop it
      // instead of firing if a newer connect()/attachToExisting has since
      // superseded this attempt (see pendingDeepLinkRef's own doc).
      if (pendingDeepLinkRef.current) {
        const pending = pendingDeepLinkRef.current;
        pendingDeepLinkRef.current = null;
        if (!isConnectSuperseded(pending.gen, connectGenRef.current)) {
          fireLaunchDeepLinkRef.current(pending.sessionId, pending.bridgeToken, pending.helperToken, pending.opts);
        }
      }
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
    // `dragActiveRef` is a ref (stable identity, read fresh via `.current`
    // inside the customKeyEventHandler at call time, not captured by value)
    // — including it here would only force a pointless re-init of xterm
    // itself whenever the dock passes a differently-identified ref object,
    // which it never does (one ref, created once, shared by every session).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Real panel size for the NEXT launch's PTY spawn (Bug B, card cbe60db5 —
  // Nick's field test 2026-08-15): a promptless (Resume) launch's PTY used to
  // spawn at a hardcoded 80x24 because `sendResize()` above can't reach it
  // until status flips to "connected" — which can't happen before something
  // spawns and streams a byte (see its own doc comment). Reading dims via the
  // SAME fit-addon call, right before firing the launch deep link, sidesteps
  // that entirely: the bridge gets the real size in the SAME request that
  // tells it what to spawn (terminal/bridge/src/spawn-dims.js), no wire
  // round-trip or connection-state race involved. `null` when xterm hasn't
  // mounted yet (an unlikely fast-click race, or a brand-new tab whose xterm
  // dynamic import is still in flight) — the caller then omits cols/rows and
  // the bridge falls back to its pre-existing hardcoded default, exactly like
  // before this fix (never worse than today).
  const currentLaunchDims = useCallback((): { cols: number; rows: number } | null => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return null;
    try {
      fit.fit();
    } catch {
      return null;
    }
    return isValidDim(term.cols) && isValidDim(term.rows) ? { cols: term.cols, rows: term.rows } : null;
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
  // Split view: also gated on `grabFocus` — the pane that ISN'T the split's
  // focused one refits (see the resize effects above, keyed on `expanded`
  // alone) but must never steal the keyboard out from under the pane the
  // user is actually typing in (design §9).
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (
      state.status === "connected" &&
      (prev === "connecting" || prev === "waiting-to-pair") &&
      expanded &&
      grabFocus
    ) {
      termRef.current?.focus();
    }
    prevStatusRef.current = state.status;
  }, [state.status, expanded, grabFocus]);

  // Expand focus: a user-initiated expand of an already-live session (e.g.
  // collapse then re-expand while connected) should also land focus in the
  // terminal. Keyed ONLY on `expanded` (not state.status) so a background status
  // change — e.g. a reattach completing while the dock is already expanded —
  // never re-triggers this and steals focus; it reads the current status from
  // closure at the moment `expanded` itself transitions. Also gated on
  // `grabFocus` — see the first-connect effect above for why.
  useEffect(() => {
    if (!expanded || !grabFocus || state.status !== "connected") return;
    // Next paint, mirroring the expand-rAF resize above — the container must be
    // un-hidden before focus() can land.
    const id = window.requestAnimationFrame(() => termRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
    // Deliberately excludes state.status: see comment above (must only re-run on
    // `expanded`/`grabFocus` transitions, not on every status change, or a
    // background reattach while already expanded would steal focus).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, grabFocus]);

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
  // on overflow. Bug cbe60db5-followup-2: `effectiveTarget` mirrors the launch
  // button's own resolveEffectiveLaunchTarget call — the hook now DOES have
  // recordedProjectPaths (threaded via the descriptor), so a hook-initiated
  // launch picks up a recorded DB folder exactly like the button does, instead
  // of always falling to "new project" (the bug: cwd=null recorded even when a
  // real folder was on file, hiding the ended-session overlay's Resume button).
  const resolveLaunchPromptParts = useCallback((): BrowserLaunchPayload => {
    const carried = promptPartsRef.current;
    if (carried) return carried;
    const effectiveTarget = resolveEffectiveLaunchTarget({
      hasRepo: !!ideaGithubUrl,
      recordedPaths: recordedProjectPaths,
      // Read fresh rather than captured: this runs at launch time, and a bridge
      // may have announced this machine's hostname earlier in THIS session (see
      // setMachineIdentity below) — the button's render-time snapshot can't see
      // that, but a launch fired afterwards should.
      realHostname: getMachineIdentity(),
    });
    const s = resolveDefaultLaunchState(ideaId, ideaTitle, ideaGithubUrl, effectiveTarget);
    const essentials = buildCompactPromptEssentials({
      appUrl: resolveAppUrl(),
      ideaId,
      ideaTitle,
      mode: s.mode,
      repoUrl: ideaGithubUrl,
      newProject: s.mode === "new" ? { newProjectPath: s.path } : undefined,
      // Parity with the launch button: a pinned existing folder (localStorage
      // or, now, a recorded DB path) emits the same verify-folder step.
      existingPath:
        s.mode === "existing" && s.path.trim() ? s.path.trim() : undefined,
    });
    return { essentials, cwd: resolveLaunchCwd(s, effectiveTarget.cwd) };
  }, [ideaId, ideaTitle, ideaGithubUrl, recordedProjectPaths]);

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
  // Fire `link` via the hidden-iframe (falling back to a direct assign) and
  // arm the ~8s helper-open timeout — the tail every launch variant shares,
  // whether it built a bootstrap prompt or a bare resume link. Returns false
  // when even the fallback assign threw, so the caller can set the honest
  // "helper-timeout" phase itself (its own log fields differ per variant, so
  // logging stays with the caller).
  const openLaunchLinkAndArmTimeout = useCallback(
    (link: string): boolean => {
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
          return false;
        }
      }

      // If the helper doesn't stream within ~8s, drop to the calm fallback (never an
      // infinite spinner — criterion #8).
      clearHelperTimer();
      helperTimerRef.current = setTimeout(() => {
        removeLaunchIframe();
        setLaunchPhase(nextLaunchPhaseOnTimeout);
      }, HELPER_OPEN_TIMEOUT_MS);
      return true;
    },
    [clearHelperTimer, removeLaunchIframe],
  );

  const fireLaunchDeepLink = useCallback(
    (
      sessionId: string,
      bridgeToken: string,
      helperToken?: string,
      opts?: {
        /**
         * Reattach-vs-connect visibility (Reproduce & Investigate step's
         * logging-gap note): which call site fired this link, so the
         * structured logs below can tell a fresh mint's autoLaunch apart
         * from a reattach's relaunch without cross-referencing timestamps.
         * Defaults to "connect" so connect()'s existing call site (which
         * predates this option) doesn't need updating just for the log field.
         */
        trigger?: "connect" | "attach-existing";
        /**
         * URGENT reattach fix (task 27d19c68, 2026-08-17 incident — a hard
         * refresh AND a cross-tab Reconnect both killed a live conversation
         * and replaced it with an empty boot screen): when set, this fire is
         * FORCED resume-shaped, bypassing the promptPartsRef-based branch
         * below entirely. `attachToExisting` passes the reattach API's own
         * `cwd`/`claudeSessionId` here — the terminal_sessions registry
         * row's ground truth for the session actually being reattached to —
         * instead of relying on `promptPartsRef`, which is reliably null in
         * exactly the cases that broke this: wiped by a hard refresh
         * (in-memory ref, not persisted), and never populated at all by a
         * brand-new tab reconnecting to someone else's already-live
         * session. With `promptPartsRef` null, this branch used to fall
         * through to the fresh-launch path below — spawning a brand-new
         * `claude` process that the relay's preempt logic then let win,
         * killing the original. A genuinely active/live session's reattach
         * payload carries a `cwd` (confirmed via production evidence in the
         * task), so this covers the real incident; a row with no recorded
         * `cwd` at all (edge case — e.g. a "new project" launch that never
         * resolved one) falls through to the pre-existing fresh-launch
         * branch, logged below so that gap stays visible instead of
         * silently regressing.
         */
        forceResumeCwd?: string | null;
        forceResumeId?: string | null;
      },
    ) => {
      const trigger = opts?.trigger ?? "connect";
      // Session entry chooser — Resume (card cbe60db5, design item 7/F4): a
      // resume launch carries no bootstrap prompt at all — a minimal link
      // with `resumeId` (exact-conversation, rework 5) or the legacy
      // `resume: true` + the ended session's recorded `cwd`, so the local
      // bridge runs `claude --resume <id>` or `claude --continue` there
      // instead of building a prompt (see terminal/bridge/src/index.js).
      // Checked FIRST so the normal essentials/budgeting path below never
      // runs for a resume. The resume source is EITHER a forced reattach
      // override (opts.forceResumeCwd — see its doc; checked first so a
      // stale/unrelated promptPartsRef can never veto a real reattach) OR
      // the legacy promptPartsRef-carried intent (a chooser Resume click
      // via launchFromBus/connect).
      // Bug B (card cbe60db5): computed ONCE per fire, used on whichever
      // buildLaunchDeepLink call below actually runs — see
      // `currentLaunchDims`'s own doc comment for why this is read here
      // rather than left to a post-spawn resize.
      const dims = currentLaunchDims();
      const carriedForResume = promptPartsRef.current;
      const forcedCwd = opts?.forceResumeCwd?.trim() || null;
      const resumeSource = forcedCwd
        ? { cwd: forcedCwd, resumeId: opts?.forceResumeId ?? undefined, forced: true }
        : carriedForResume?.resume || carriedForResume?.resumeId
          ? { cwd: carriedForResume.cwd, resumeId: carriedForResume.resumeId, forced: false }
          : null;
      if (resumeSource) {
        const { cwd, resumeId, forced } = resumeSource;
        if (!cwd) {
          // Should never happen — the chooser only offers Resume for a row
          // with a recorded folder (F4) — but stay honest rather than fire a
          // directory-less resume.
          logger.error("Terminal resume launch missing cwd — refusing to fire");
          toast.error("Couldn't resume — no folder was recorded for that session");
          setLaunchPhase("helper-timeout");
          return;
        }
        let link: string;
        try {
          link = buildLaunchDeepLink({
            relay: relayBaseUrl(),
            session: sessionId,
            token: bridgeToken,
            helperToken,
            cwd,
            resume: resumeId ? undefined : true,
            resumeId,
            cols: dims?.cols,
            rows: dims?.rows,
          });
        } catch (err) {
          logger.error("Terminal resume deep-link build failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          setLaunchPhase("helper-timeout");
          return;
        }
        logger.info("Terminal firing resume deep link", {
          sessionId,
          trigger,
          forced,
          exact: !!resumeId,
          url: redactDeepLinkToken(link).replace(/([?&]cwd=)[^&]*/g, "$1***"),
          urlChars: link.length,
        });
        if (!openLaunchLinkAndArmTimeout(link)) setLaunchPhase("helper-timeout");
        return;
      }

      // Reattach relaunch with nowhere to resume into (the registry row
      // itself never recorded a cwd) — falls through to the fresh-launch
      // branch below same as before this fix, but say so loudly: this is
      // the ONE gap the reattach fix (task 27d19c68) doesn't close, and it
      // must stay visible rather than silently look identical to a normal
      // fresh mint in the logs.
      if (trigger === "attach-existing") {
        logger.warn(
          "Terminal reattach relaunch has no recorded cwd — falling back to fresh-launch deep link (will not resume)",
          { sessionId },
        );
      }

      let link: string;
      let urlChars = 0;
      let hasCwd = false;
      let droppedCwd = false;
      try {
        const { essentials, cwd } = resolveLaunchPromptParts();
        if (!essentials) {
          // Only reachable for a resume-shaped payload that somehow bypassed
          // the branch above — defensive, never expected in practice (see
          // BrowserLaunchPayload's doc: essentials is optional ONLY for resume).
          logger.error("Terminal deep-link build failed", { reason: "missing_essentials" });
          setLaunchPhase("helper-timeout");
          return;
        }
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
              helperToken,
              cwd: linkCwd,
              prompt,
              cols: dims?.cols,
              rows: dims?.rows,
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
        trigger,
        url: redactDeepLinkToken(link).replace(/([?&]cwd=)[^&]*/g, "$1***"),
        urlChars,
        hasCwd,
        droppedCwd,
      });
      if (!openLaunchLinkAndArmTimeout(link)) setLaunchPhase("helper-timeout");
    },
    [resolveLaunchPromptParts, openLaunchLinkAndArmTimeout, currentLaunchDims],
  );
  fireLaunchDeepLinkRef.current = fireLaunchDeepLink;

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
          if (isBridgeVersionFrame(ev.data)) {
            // The bridge announced its helper version (2a) — never written to the
            // xterm; the dock decides whether it's stale enough to nudge
            // (src/lib/terminal/helper-version.ts). A malformed `v` parses to null,
            // which leaves helperVersion at whatever it already was (never
            // regresses a known-good value to "unknown").
            const v = parseBridgeVersionFrame(ev.data);
            if (v) setHelperVersion(v);
            // Machine identity (Nick's sign-off change 2): the SAME frame
            // optionally carries the bridge's hostname. Recorded once per
            // session (see machineIdentityAnnouncedSidRef's doc) — (1) as this
            // browser's own remembered identity (machine-identity.ts, read by
            // the chooser's Recent filter), and (2) a best-effort PATCH onto
            // the registry row so OTHER browsers can filter against it too.
            // Never awaited/blocking — an old bridge that omits `host` simply
            // never triggers this (parses to null, nothing to record).
            const host = parseBridgeVersionHost(ev.data);
            if (host && machineIdentityAnnouncedSidRef.current !== sessionId) {
              machineIdentityAnnouncedSidRef.current = sessionId;
              setMachineIdentity(host);
              void fetch(`/api/terminal/session/${encodeURIComponent(sessionId)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ machineLabel: host }),
              }).catch(() => {});
            }
            // Exact-conversation Resume (rework 5): the SAME frame optionally
            // carries the id of the claude conversation this bridge just
            // spawned/resumed. Best-effort PATCH onto the registry row (same
            // once-per-session guard as machine identity above) so a FUTURE
            // Resume of this row can pass `--resume <id>` instead of falling
            // back to `--continue` — never awaited/blocking, and an old
            // bridge that omits `conv` simply never triggers this.
            const conv = parseBridgeVersionConv(ev.data);
            if (conv && convIdAnnouncedSidRef.current !== sessionId) {
              convIdAnnouncedSidRef.current = sessionId;
              // Bug A: the bridge's own announcement is the authoritative id —
              // supersedes whatever `claudeSessionId` was seeded with at
              // connect()-time (a carried resumeId, or null).
              setClaudeSessionId(conv);
              void fetch(`/api/terminal/session/${encodeURIComponent(sessionId)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ claudeSessionId: conv }),
              }).catch(() => {});
            }
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
        // Reload-reattach instant-continue (design item 5): mark the buffer
        // dirty so the periodic snapshot effect below has something new to
        // save next tick.
        snapshotDirtyRef.current = true;
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

  // ── reload-reattach instant-continue (card cbe60db5, design item 5) ────────
  // Mirror this session's live scrollback into THIS TAB's own sessionStorage
  // while connected: every SNAPSHOT_SAVE_INTERVAL_MS (20s) if output arrived
  // since the last save (snapshotDirtyRef), and unconditionally on pagehide
  // (a refresh/close is exactly the moment a fresh snapshot matters most —
  // worth the write even if nothing changed since the last tick). A same-tab
  // reload within SNAPSHOT_FRESHNESS_MS (60s) then lets the dock's
  // `decideEntryBehaviour` skip the chooser and reattach automatically,
  // restoring this buffer with the "reconnected" divider (design's veto
  // note — Nick: yes).
  const doSnapshotNow = useCallback(() => {
    const sid = pairRef.current?.sessionId;
    const term = termRef.current;
    if (!sid || !term || !snapshotDirtyRef.current) return;
    const buffer = serializeScrollback(term, SCROLLBACK_TRANSFER_CAP_BYTES);
    saveSessionSnapshot(sid, buffer);
    snapshotDirtyRef.current = false;
  }, []);

  useEffect(() => {
    if (!enabled || state.status !== "connected") return;
    const interval = setInterval(doSnapshotNow, SNAPSHOT_SAVE_INTERVAL_MS);
    window.addEventListener("pagehide", doSnapshotNow);
    return () => {
      clearInterval(interval);
      window.removeEventListener("pagehide", doSnapshotNow);
    };
  }, [enabled, state.status, doSnapshotNow]);

  // Remember this tab's own sid the moment a pair is established (mint,
  // attach-existing, or a fresh-attach-reset reconnect) — independent of the
  // snapshot's own freshness, this is the chooser's "was open in this tab"
  // badge (session-snapshot.ts's `rememberLastTabSid`).
  useEffect(() => {
    if (pair?.sessionId) rememberLastTabSid(pair.sessionId);
  }, [pair?.sessionId]);

  // Clear this session's snapshot on any terminal end (user End, idle,
  // max-duration, or a reconnect-grace exhaustion) — a later reload must
  // never restore a dead session's output as if it were still live.
  useEffect(() => {
    if (state.status !== "session-ended") return;
    const sid = pairRef.current?.sessionId;
    if (sid) clearSessionSnapshot(sid);
  }, [state.status]);

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
    // Stuck-pairing watchdog (card cbe60db5): the ONE opt-out — a literal
    // manual connect({autoLaunch:false}) is the legitimate indefinite-wait
    // cross-machine flow, so it alone leaves this false.
    expectsAutoAttachRef.current = autoLaunch;
    setLaunchPhase(autoLaunch ? "opening" : "idle");
    requestExpand();
    lastDimsRef.current = "";
    setHelperVersion(null);
    dispatch({ type: "connect" });

    let data: { sessionId: string; browserToken: string; bridgeToken: string; helperToken?: string; expiresAt: number };
    try {
      const res = await fetch("/api/terminal/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ideaId,
          ...(taskId ? { taskId } : {}),
          ...(taskTitle ? { taskTitle } : {}),
          ...(displayName ? { displayName } : {}),
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
    // Cheap cross-component telemetry (card cc74a067, design §9): pairs THIS
    // mint with a previously observed helper idle-quit (the Helper row's own
    // status-transition detection — see helper-relaunch-signal.ts) if one
    // happened within the last 2 minutes. Consumed at most once per pairing.
    if (consumeRecentHelperIdleQuit()) {
      posthogRef.current?.capture("terminal_helper_relaunch_within_2m");
    }
    // A fresh mint starts a fresh reconnect budget.
    reconnectDeadlineRef.current = 0;
    reconnectAttemptRef.current = 0;
    termRef.current?.clear();

    // Bug A (card cbe60db5 rework 9): seed this tab's own resume bookkeeping
    // for THIS mint. `claudeSessionId` starts as whatever resumeId this very
    // launch carried (if it WAS a resume) — the bridge-version-frame handler
    // above overwrites it with the bridge's own announced `conv` once that
    // arrives, which is the more authoritative id.
    setClaudeSessionId(promptPartsRef.current?.resumeId ?? null);

    // Best-effort identity PATCH (C4): the browser already resolves a cwd to
    // build the launch prompt — forward it to the registry row so "My
    // sessions" can show it. Never awaited/blocking: a failure here changes
    // nothing about the terminal itself, the identity line is just honestly
    // blank until it lands (or forever, if there's no cwd to report).
    try {
      const { cwd } = resolveLaunchPromptParts();
      setSessionCwd(cwd && cwd.trim() ? cwd.trim() : null);
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
    if (autoLaunch) fireLaunchDeepLink(data.sessionId, data.bridgeToken, data.helperToken, { trigger: "connect" });

    openBrowserLeg(data.sessionId, data.browserToken);
  }, [
    ideaId,
    taskId,
    taskTitle,
    displayName,
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
      // Stuck-pairing watchdog (card cbe60db5): a reload-reattach / instant-
      // continue / chooser Reconnect all expect the bridge to show back up
      // on its own — no deep link fires here, so nothing else times this
      // out. See expectsAutoAttachRef's doc above.
      expectsAutoAttachRef.current = true;
      lastDimsRef.current = "";
      setHelperVersion(null);
      // Two dispatches back-to-back, no await between them — React folds them
      // through the reducer IN ORDER against the queued (not the stale
      // closure) state, so "session-created"'s `state.status !== "connecting"`
      // guard sees the "connect" transition that just landed ahead of it.
      // Same guarantee connect() relies on across its own await gap.
      dispatch({ type: "connect" });
      dispatch({ type: "session-created", sessionId: p.sessionId });
      setPair({ sessionId: p.sessionId, browserToken: p.browserToken });
      // Bug cbe60db5-followup: mirror connect()'s cwd/claudeSessionId seeding
      // (lines ~1443/1452 above) so a reload-reattach / instant-continue /
      // chooser-Reconnect / pop-out bring-back can still resume once this
      // session later ends for a non-user reason. `p.cwd`/`p.claudeSessionId`
      // come from the reattach route's registry read; a pop-out hand-off
      // (attachExisting prop, no reattach round-trip) simply omits them, same
      // as today's null/no-resume behaviour. The bridge's own bridge-version
      // "conv" announcement (line ~1124 above) is still authoritative and
      // will overwrite this the moment it arrives — last-write-wins, same as
      // it already does over connect()'s seeded resumeId.
      setSessionCwd(p.cwd ?? null);
      setClaudeSessionId(p.claudeSessionId ?? null);
      reconnectDeadlineRef.current = 0;
      reconnectAttemptRef.current = 0;
      // Scrollback transfer (card 35cffc10, Flow A): a handed-over buffer
      // REPLACES the plain clear() below — restoreScrollback does its own
      // full reset before writing the history, so the two are mutually
      // exclusive, never both. No buffer (deploy skew, or the dock had
      // nothing to serialize yet) falls back to today's plain clear().
      if (p.initialBuffer) {
        if (termRef.current) {
          restoreScrollback(termRef.current, p.initialBuffer);
        } else {
          // Terminal hasn't mounted yet — the xterm-init effect applies this
          // the moment it does (pendingInitialBufferRef's doc).
          pendingInitialBufferRef.current = p.initialBuffer;
        }
      } else {
        termRef.current?.clear();
      }
      // A newer attach/connect raced this one while it was doing its
      // (synchronous, but still checked for symmetry with connect()) setup —
      // abort before opening a socket that a newer attempt would immediately
      // have to tear down again.
      if (isConnectSuperseded(gen, connectGenRef.current)) return;
      // Reconnect-relaunch fix: a bridgeToken riding the attach pair means
      // this came through the reattach route (My sessions / chooser /
      // ?reconnect=<sid> Reconnect), not a popped-out window's hand-off —
      // fire the SAME deep link connect({autoLaunch:true}) fires for a fresh
      // mint, so the local helper actually relaunches instead of the browser
      // leg waiting passively forever. Mirrors connect()'s own
      // `if (autoLaunch) fireLaunchDeepLink(...)` call exactly, just gated on
      // the token being present instead of an autoLaunch flag.
      //
      // URGENT reattach fix (task 27d19c68, 2026-08-17): that relaunch used
      // to be UNCONDITIONALLY fresh-boot-shaped (decided by promptPartsRef,
      // which is null on both a hard refresh and a brand-new tab's
      // Reconnect — see fireLaunchDeepLink's forceResumeCwd doc). The local
      // helper always forks a brand-new bridge with no liveness check, and
      // the relay always lets it preempt the still-live original — so that
      // fresh-boot deep link was what killed the running conversation and
      // replaced it with an empty boot screen, even though the server-side
      // session record never changed. `p.cwd`/`p.claudeSessionId` are the
      // reattach route's OWN read of the registry row being reattached to —
      // passing them here forces this relaunch to always be resume-shaped
      // for a genuinely live session, instead of depending on a ref that's
      // reliably empty in exactly this path.
      if (p.bridgeToken) {
        const deepLinkOpts = {
          trigger: "attach-existing" as const,
          forceResumeCwd: p.cwd,
          forceResumeId: p.claudeSessionId,
        };
        // Squashed-reattach fix (task 6ac2cd44, 2026-08-17 follow-up): on a
        // FRESH mount (hard refresh, or a brand-new tab with no pristine
        // slot to reuse) xterm is still loading via the async import() above
        // — termRef/fitRef are guaranteed null at this exact point, so
        // firing straight through would make currentLaunchDims() return
        // null every time, spawning the remote PTY at the bridge's narrow
        // 80x24 fallback (the squash). Mirrors pendingInitialBufferRef's own
        // pattern a few lines above for the identical not-yet-mounted
        // problem: fire immediately if xterm is already up (the fast path —
        // e.g. a same-tab Reconnect reusing a pristine slot whose xterm was
        // already showing something), otherwise queue and let the
        // xterm-init effect's flush (see pendingDeepLinkRef's doc) fire it
        // once real dims are actually readable.
        if (termRef.current && fitRef.current) {
          logger.info("Terminal reattach firing relaunch deep link", {
            sessionId: p.sessionId,
            hasResumeCwd: !!(p.cwd && p.cwd.trim()),
            hasClaudeSessionId: !!p.claudeSessionId,
            promptPartsPopulated: !!promptPartsRef.current,
          });
          fireLaunchDeepLink(p.sessionId, p.bridgeToken, p.helperToken, deepLinkOpts);
        } else {
          logger.info("Terminal reattach relaunch deferred — xterm not mounted yet", {
            sessionId: p.sessionId,
          });
          pendingDeepLinkRef.current = {
            gen,
            sessionId: p.sessionId,
            bridgeToken: p.bridgeToken,
            helperToken: p.helperToken,
            opts: deepLinkOpts,
          };
        }
      }
      openBrowserLeg(p.sessionId, p.browserToken);
    },
    [teardownSocket, clearHelperTimer, removeLaunchIframe, fireLaunchDeepLink, openBrowserLeg],
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
  //
  // A THIRD case (fix/terminal-bringback-state-reset): "Bring back to dock" after a
  // pop-out also lands here. The dock's OWN leg was preempted when the pop-out
  // attached (relay close 4001 → errorKind "duplicate") while the "Popped out"
  // placeholder masked it, so the underlying state machine is stuck in "error".
  // decideReconnectNow (connection.ts) routes THAT case to "fresh-attach-reset"
  // instead of the ambient "grace-reconnect" path below — grace-reconnect opens
  // with {reconnect:true} and dispatches nothing, which is exactly the bug: the
  // reducer has no forward edge out of "error" for `relay-open`/`data` (see its
  // comment on the "data" case), so the socket came back healthy while the UI
  // stayed on the stale duplicate-error screen. The fresh-attach-reset branch is
  // the ONE sanctioned exit from "error" — see connection.ts's decideReconnectNow
  // doc for the full reasoning.
  const reconnectNow = useCallback(() => {
    const p = pairRef.current;
    const now = Date.now();
    const decision = decideReconnectNow(statusRef.current, !!p, now, reconnectDeadlineRef.current);

    if (decision === "full-connect" || !p) {
      // connect({autoLaunch:true}) arms expectsAutoAttachRef itself — no
      // separate wiring needed here (card cbe60db5's watchdog).
      void connect({ autoLaunch: true });
      return;
    }

    if (decision === "fresh-attach-reset") {
      // Claim a fresh connect generation, exactly as attachToExisting does, so a
      // newer connect()/reconnectNow() racing this one wins cleanly.
      const gen = (connectGenRef.current = claimConnectGeneration(connectGenRef.current));
      // Tear down first (mirrors attachToExisting): nulls the old socket's
      // handlers so a lingering, already-dead socket can't fire a late event
      // into this fresh attempt, and clears the reconnect timer/bookkeeping.
      teardownSocket();
      reconnectDeadlineRef.current = 0;
      reconnectAttemptRef.current = 0;
      // Stuck-pairing watchdog (card cbe60db5): this branch never touches
      // launchPhase (it stays whatever it already was — typically "idle"),
      // and opens with reconnect:false's honest CONNECT_TIMEOUT_MS bounding
      // only the RELAY handshake, not the bridge showing back up once
      // relay-open lands us on "waiting-to-pair". Without arming here, a
      // bring-back/pop-out reattach whose peer never comes back hangs on
      // legacy-waiting forever, same as attachToExisting's case.
      expectsAutoAttachRef.current = true;
      // Two dispatches back-to-back, no await between them — the documented
      // two-dispatch pattern (see attachToExisting): React folds them through
      // the reducer in order against the queued state, so "session-created"'s
      // `state.status !== "connecting"` guard sees the "connect" transition
      // that just landed ahead of it.
      dispatch({ type: "connect" });
      dispatch({ type: "session-created", sessionId: p.sessionId });
      if (isConnectSuperseded(gen, connectGenRef.current)) return;
      // reconnect:false (the default) arms CONNECT_TIMEOUT_MS, so a dead relay
      // produces an honest connect-timeout error instead of hanging in
      // "connecting" forever — unlike grace-reconnect below, nothing else is
      // bounding this attempt.
      openBrowserLeg(p.sessionId, p.browserToken);
      return;
    }

    // decision === "grace-reconnect" — unchanged, prod-proven path. No
    // watchdog wiring needed (card cbe60db5): this reopens with
    // {reconnect:true} against a status that's "disconnected" (never
    // "connecting"), and the reducer's `relay-open` case only advances to
    // "waiting-to-pair" from "connecting" — so this path never reaches
    // legacy-waiting at all. It stays "disconnected" until either `data`
    // (→ connected) or the grace window's own existing exhaustion
    // (→ session-ended via reconnect-exhausted), both already bounded.
    clearReconnectTimer();
    if (reconnectDeadlineRef.current === 0) reconnectDeadlineRef.current = now + RECONNECT_GRACE_MS;
    openBrowserLeg(p.sessionId, p.browserToken, { reconnect: true });
  }, [openBrowserLeg, clearReconnectTimer, connect, teardownSocket]);

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

  // See `refreshView`'s doc on TerminalSessionActions. Mirrors the expand-rAF
  // resize + expand-focus effects above (next paint, so the container has
  // already been un-hidden before fit()/focus() land) — just callable
  // directly rather than gated on `expanded`. Split view (task df7a0134,
  // design §9): a pane transitioning hidden→visible needs the SAME forced
  // refit bring-back already uses, but only the split's focused pane should
  // also grab the keyboard — `focus` defaults to `true` so every pre-existing
  // caller (pop-out bring-back) is unchanged; the dock passes `focus: false`
  // when forcing a refit on the UNFOCUSED pane.
  const refreshView = useCallback(
    (opts?: { focus?: boolean }) => {
      const focus = opts?.focus ?? true;
      window.requestAnimationFrame(() => {
        sendResize();
        if (focus) termRef.current?.focus();
      });
    },
    [sendResize],
  );

  // Scrollback transfer (card 35cffc10, design §7). See TerminalSessionActions'
  // doc on both for the full contract — these are thin, stable-identity
  // wrappers around the pure scrollback-transfer.ts functions, reading
  // termRef fresh on every call (never a stale-closure risk, same pattern
  // as sendResize/refreshView above).
  const serializeNow = useCallback((): TransferredBuffer | null => {
    const term = termRef.current;
    if (!term) return null;
    return serializeScrollback(term, SCROLLBACK_TRANSFER_CAP_BYTES);
  }, []);

  const restoreBuffer = useCallback((buffer: TransferredBuffer) => {
    const term = termRef.current;
    if (!term) return;
    restoreScrollback(term, buffer);
  }, []);

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
    helperVersion,
    pair,
    cwd: sessionCwd,
    claudeSessionId,
    readOnly,
    inputEnabled: isInputEnabled(state, readOnly),
    platform,
    paired,
    xtermReady,
    containerRef,
    pairingTimedOut,
    actions: {
      connect,
      beginBrowserLaunch,
      launchFromBus,
      reconnectNow,
      end: endSession,
      setReadOnly,
      copyBridgeCommand,
      refreshView,
      serializeNow,
      restoreBuffer,
    },
  };
}
