// In-app terminal — pure connection logic (SLICE 3, browser leg).
//
// The browser-side terminal dock attaches to the opaque Cloudflare relay as the
// `browser` leg and mirrors the bridge's PTY. This module holds the LOAD-BEARING,
// side-effect-free pieces so they can be unit-tested in isolation:
//
//   - the connection STATE MACHINE (reducer over a small event set),
//   - the relay close-code → state MAPPING (incl. the owner-mismatch / bad-token
//     cases from relay codes 4005 / 4006 / 4001),
//   - the relay attach URL builder + the resize control-frame framing (which must
//     match the bridge's framing in terminal/bridge/src/framing.js),
//   - the feature flag + relay base-url readers.
//
// xterm DOM rendering lives in the component; everything here is testable without
// a DOM, a socket, or React.

/** How long we wait for the relay handshake before declaring an error (≈30s). */
export const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Reconnect grace window (ms). THE ONE SHARED NUMBER — equal to the relay grace
 * (terminal/relay/src/pairing.js → RECONNECT_GRACE_MS) and the bridge budget
 * (terminal/bridge/src/index.js → BRIDGE_RECONNECT_MS). This window is the SOLE
 * bound on reattach: a transient drop REATTACHES to the same sid with the ORIGINAL
 * browser token, no re-mint — the relay waives token expiry for a same-owner
 * reattach to a live session (fix/terminal-expired-reattach), so even a session
 * older than the 300s token TTL reconnects. Beyond the window the session ends
 * honestly and the UX falls back to a clean fresh launch.
 */
export const RECONNECT_GRACE_MS = 90_000;

/** Default dev relay (overridable via NEXT_PUBLIC_TERMINAL_RELAY_URL). */
export const DEFAULT_RELAY_URL = "ws://127.0.0.1:8787";

// Relay close codes (application-private range). These MUST stay in sync with
// terminal/relay/src/pairing.js → CLOSE. Duplicated (not imported) because the
// relay module is plain .mjs outside the app's TS build graph; the test pins the
// values so a drift is caught.
export const RELAY_CLOSE = Object.freeze({
  DUP_BROWSER: 4001,
  DUP_BRIDGE: 4002,
  PEER_GONE: 4004,
  OWNER_MISMATCH: 4005,
  BAD_TOKEN: 4006,
});

export type TerminalStatus =
  | "idle"
  | "connecting"
  | "waiting-to-pair"
  | "connected"
  | "disconnected"
  | "session-ended"
  | "error";

export type TerminalErrorKind =
  | "owner-mismatch"
  | "bad-token"
  | "duplicate"
  | "connect-timeout"
  | "relay-unreachable"
  | "session-mint-failed"
  | "unknown";

export type EndedReason = "user" | "remote" | "idle" | "max-duration" | "reconnect-failed";

export interface TerminalConnectionState {
  status: TerminalStatus;
  sessionId: string | null;
  errorKind: TerminalErrorKind | null;
  endedReason: EndedReason | null;
  /** The WebSocket close code that produced the current state (when applicable). */
  closeCode: number | null;
}

export type TerminalEvent =
  | { type: "connect" }
  | { type: "session-created"; sessionId: string }
  | { type: "session-mint-failed" }
  | { type: "relay-open" }
  | { type: "data" }
  | { type: "user-end" }
  | { type: "connect-timeout" }
  | { type: "reconnect-exhausted" }
  | { type: "link-silent" }
  | { type: "closed"; code: number; reason?: string }
  | { type: "reset" };

export const initialConnectionState: TerminalConnectionState = {
  status: "idle",
  sessionId: null,
  errorKind: null,
  endedReason: null,
  closeCode: null,
};

/** A status that means "we are mid-handshake, no bridge stream yet". */
function isHandshaking(status: TerminalStatus): boolean {
  return status === "connecting" || status === "waiting-to-pair";
}

/**
 * Map a relay/WebSocket close into the resulting connection state. Pure so the
 * close-code policy is unit-tested independently of the socket.
 *
 * `priorStatus` disambiguates the generic/abnormal codes: an abnormal close while
 * still handshaking means "we never reached your machine" (error), whereas the
 * same code after a live stream means "the link dropped" (recoverable disconnect).
 */
export function mapCloseCode(
  code: number,
  reason: string | undefined,
  priorStatus: TerminalStatus,
): Pick<TerminalConnectionState, "status" | "errorKind" | "endedReason"> {
  switch (code) {
    case RELAY_CLOSE.OWNER_MISMATCH:
      return { status: "error", errorKind: "owner-mismatch", endedReason: null };
    case RELAY_CLOSE.BAD_TOKEN:
      return { status: "error", errorKind: "bad-token", endedReason: null };
    case RELAY_CLOSE.DUP_BROWSER:
    case RELAY_CLOSE.DUP_BRIDGE:
      return { status: "error", errorKind: "duplicate", endedReason: null };
    case RELAY_CLOSE.PEER_GONE:
      // The bridge leg went away. Could be a clean exit or a drop — the relay
      // can't tell us which, so treat it as a (recoverable) disconnect.
      return { status: "disconnected", errorKind: null, endedReason: null };
    case 1000:
      // Normal closure — a clean session end. Parse the reason for the calm
      // idle / max-duration copy when the bridge supplied it.
      return { status: "session-ended", errorKind: null, endedReason: parseEndedReason(reason) };
    default:
      // 1005 (no status), 1006 (abnormal) and anything unexpected.
      if (isHandshaking(priorStatus)) {
        return { status: "error", errorKind: "relay-unreachable", endedReason: null };
      }
      return { status: "disconnected", errorKind: null, endedReason: null };
  }
}

/**
 * Best-effort reason classification from a close-frame reason string.
 *
 * LOCK-STEP: the relay ends idle / max-duration sessions with code 1000 and a
 * reason built by terminal/relay/src/pairing.js → idleCloseReason / maxCloseReason
 * (shared by the Cloudflare DO and the Node stand-in). Those strings always contain
 * the substring "idle" / "max" respectively, which is exactly what this matches.
 * Keep the builders and this classifier in step — connection.test.ts pins the
 * default strings.
 */
function parseEndedReason(reason: string | undefined): EndedReason {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("idle")) return "idle";
  if (r.includes("max")) return "max-duration";
  return "remote";
}

/**
 * The connection state machine. Pure: `(state, event) => state`. Drives the dock's
 * six visible states; the component owns the side effects (fetch, socket, timers)
 * and feeds their outcomes back in as events.
 */
export function terminalReducer(
  state: TerminalConnectionState,
  event: TerminalEvent,
): TerminalConnectionState {
  switch (event.type) {
    case "connect":
      // Fresh attempt — clear any prior error/ended metadata.
      return { status: "connecting", sessionId: null, errorKind: null, endedReason: null, closeCode: null };

    case "session-created":
      // Only meaningful while we're opening a session; ignore stray late arrivals.
      if (state.status !== "connecting") return state;
      return { ...state, sessionId: event.sessionId };

    case "session-mint-failed":
      return { ...state, status: "error", errorKind: "session-mint-failed", closeCode: null };

    case "relay-open":
      // Relay reached; the bridge may not have attached yet → waiting-to-pair.
      if (state.status !== "connecting") return state;
      return { ...state, status: "waiting-to-pair", errorKind: null, endedReason: null };

    case "data":
      // First (or any) bytes from the bridge prove it's attached and streaming.
      if (state.status === "connected") return state;
      if (state.status === "waiting-to-pair" || state.status === "disconnected" || state.status === "connecting") {
        return { ...state, status: "connected", errorKind: null, endedReason: null, closeCode: null };
      }
      return state;

    case "user-end":
      return { ...state, status: "session-ended", endedReason: "user", errorKind: null };

    case "connect-timeout":
      // Only the connect clock — irrelevant once a stream is live.
      if (!isHandshaking(state.status)) return state;
      return { ...state, status: "error", errorKind: "connect-timeout", closeCode: null };

    case "reconnect-exhausted":
      // The grace window / token validity elapsed while disconnected and no reattach
      // landed → an HONEST end (not an error). The saved work on the machine is safe;
      // the overlay offers a clean fresh launch. A user-end already terminal → keep it.
      if (state.status === "session-ended") return state;
      return { ...state, status: "session-ended", endedReason: "reconnect-failed", errorKind: null };

    case "link-silent":
      // The heartbeat watchdog declared the link DEAD: nothing inbound (PTY bytes
      // or hb-acks) for the whole silence threshold while the socket still LOOKS
      // open — silent link death (wifi off / network switch; macOS never RSTs).
      // Same recoverable outcome as a visible drop → disconnected, so the existing
      // grace-window reattach machinery takes over. Only meaningful from a live
      // stream; every other state already has an honest story (the watchdog only
      // runs while connected anyway — this guard is defence-in-depth).
      if (state.status !== "connected") return state;
      return { ...state, status: "disconnected", errorKind: null, endedReason: null };

    case "closed": {
      // A user-initiated end already produced the terminal state; the socket's own
      // close event must not clobber it back to a generic disconnect.
      if (state.status === "session-ended") return { ...state, closeCode: event.code };
      const mapped = mapCloseCode(event.code, event.reason, state.status);
      return { ...state, ...mapped, closeCode: event.code };
    }

    case "reset":
      return { ...initialConnectionState };

    default:
      return state;
  }
}

/** Whether keystroke input should be sent (connected + not read-only). */
export function isInputEnabled(state: TerminalConnectionState, readOnly: boolean): boolean {
  return state.status === "connected" && !readOnly;
}

/**
 * Build the relay `browser`-leg attach URL. Mirrors the bridge's URL shape
 * (`/?session=<sid>&role=<leg>&token=<jwt>`) — see terminal/bridge/src/index.js.
 */
export function buildRelayUrl(baseUrl: string, sessionId: string, browserToken: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return (
    `${base}/?session=${encodeURIComponent(sessionId)}` +
    `&role=browser&token=${encodeURIComponent(browserToken)}`
  );
}

/**
 * Encode a resize control frame. Sent as a TEXT WebSocket frame; the bridge
 * distinguishes TEXT (control) from BINARY (data) and applies pty.resize. Must
 * match terminal/bridge/src/framing.js → encodeResize / parseControlMessage.
 * Returns null for non-sane dimensions (so the caller skips the send).
 */
export function encodeResizeMessage(cols: number, rows: number): string | null {
  if (!isValidDim(cols) || !isValidDim(rows)) return null;
  return JSON.stringify({ type: "resize", cols, rows });
}

function isValidDim(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n <= 1000;
}

/**
 * The outcome of a resize attempt (fix/terminal-dock-launch-defects,
 * fix/terminal-dock-cold-launch-resize):
 *
 *   - "send"  — dims changed AND the frame can actually REACH the PTY → send now,
 *     advance the dedupe key.
 *   - "defer" — dims changed but the frame can't reach the PTY yet → the dedupe key
 *     must NOT advance. Advancing it here was the original bug: a launch-time
 *     resize computed the real dims, stamped the key, and the frame was lost — the
 *     PTY was then stuck at the relay's 80×24 default forever, because a later
 *     same-size send() from the SAME key would be (wrongly) treated as a no-op
 *     dedupe.
 *   - "skip"  — unchanged since the last SUCCESSFUL send → no-op. This preserves the
 *     existing live-socket dedupe (ResizeObserver churn while the socket is open and
 *     dims haven't actually changed must stay a no-op).
 *
 * "Reachable" is NOT the same as "socket OPEN": the relay drops browser→bridge
 * frames (with no buffering) whenever no bridge/peer is attached yet
 * (terminal/relay/src/index.js). On a cold autolaunch the browser's wss handshake
 * (~100-300ms) beats the helper→bridge attach (can take seconds), so the socket is
 * OPEN well before the bridge is attached — a resize sent in that window is
 * silently dropped by the relay even though `ws.readyState === OPEN`. The caller
 * must gate on the runtime "peer attached and forwarding" signal (connection status
 * === "connected", which flips on the first inbound PTY byte) rather than socket
 * OPEN alone.
 */
export type ResizeDecision =
  | { action: "send"; nextLastKey: string }
  | { action: "defer" }
  | { action: "skip" };

/**
 * Decide what to do with a computed resize `key` (`"${cols}x${rows}"`) given the
 * last key a resize was SUCCESSFULLY sent for and whether the frame can currently
 * REACH the PTY (socket OPEN *and* the bridge/peer is attached — see the
 * `ResizeDecision` doc comment above for why OPEN alone isn't enough). Pure so the
 * dedupe/defer policy is unit-tested without a socket.
 */
export function decideResize(key: string, lastKey: string, isReachable: boolean): ResizeDecision {
  if (key === lastKey) return { action: "skip" };
  if (!isReachable) return { action: "defer" };
  return { action: "send", nextLastKey: key };
}

/** Feature flag — OFF unless NEXT_PUBLIC_TERMINAL_ENABLED is exactly "true". */
export function isTerminalEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TERMINAL_ENABLED === "true";
}

/** Relay base URL (public env), defaulting to the local dev relay. */
export function relayBaseUrl(): string {
  return process.env.NEXT_PUBLIC_TERMINAL_RELAY_URL || DEFAULT_RELAY_URL;
}

// ── grace-window control frames (browser leg) ─────────────────────────────────
//
// The relay sends the SURVIVING leg TEXT control frames while it HOLDS a session
// open for the reconnect grace window. These detectors mirror the shared
// definitions in terminal/shared/control-frames.mjs (encodePeerDegradedFrame /
// encodePeerReattachedFrame). Duplicated (not imported) for the same reason
// RELAY_CLOSE is: that module is plain .mjs outside the app's TS build graph — the
// drift is pinned by connection.test.ts, which imports the real encoders and checks
// these detectors agree byte-for-byte.

function isControlFrame(text: string, tag: string): boolean {
  if (text.length === 0 || text.length > 64) return false;
  try {
    const msg = JSON.parse(text) as unknown;
    return !!msg && typeof msg === "object" && (msg as { t?: unknown }).t === tag;
  } catch {
    return false;
  }
}

/** The relay is HOLDING this session: our peer dropped and may re-attach — keep the stream. */
export function isPeerDegradedFrame(text: string): boolean {
  return isControlFrame(text, "peer-degraded");
}

/** The pair is whole again inside the window — resume. */
export function isPeerReattachedFrame(text: string): boolean {
  return isControlFrame(text, "peer-reattached");
}

// ── app-level heartbeat + silent-link watchdog (fix/terminal-dock-heartbeat) ──
//
// macOS never RSTs a socket when the network silently dies (wifi off / network
// switch), and the dock only left "connected" on SOCKET events — so a silent link
// death froze the pill on "Connected" forever. The protocol-level pings the bridge
// relies on are invisible to browser JS, so the dock probes at the APP level:
// while connected it sends `{"t":"hb"}` every HEARTBEAT_INTERVAL_MS and the relay
// echoes `{"t":"hb-ack"}` to the probing leg only (hibernation-safe auto-response;
// never forwarded, never extends the relay's idle clock). The watchdog declares
// the link dead when NOTHING inbound — PTY bytes or acks — has arrived for
// LINK_SILENT_AFTER_MS, but ONLY once ARMED by the socket's first ack: an OLD
// relay never acks, so the watchdog stays disarmed there and pre-watchdog
// behaviour is unchanged (version-skew gate).
//
// The frame is duplicated (not imported) from terminal/shared/control-frames.mjs
// for the same reason RELAY_CLOSE is — that module is plain .mjs outside the app's
// TS build graph. connection.test.ts pins both directions byte-for-byte against
// the real .mjs encoders, so any drift fails there.

/** Cadence of the dock's `{"t":"hb"}` probe while connected. */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Silence threshold: nothing inbound for LONGER than this (strictly) → the link is
 * declared dead. Three heartbeat intervals — one lost ack is never a false alarm.
 */
export const LINK_SILENT_AFTER_MS = 45_000;

/**
 * Watchdog poll cadence. Each check computes WALL-CLOCK elapsed, so a hidden tab's
 * timer clamping can only DELAY detection, never fake recency; the dock also
 * re-checks immediately on visibilitychange→visible and online/offline.
 */
export const LINK_SILENT_CHECK_MS = 5_000;

/** The exact TEXT frame the dock sends as its liveness probe (mirrors encodeHeartbeatFrame in the .mjs). */
export function encodeHeartbeatFrame(): string {
  return JSON.stringify({ t: "hb" });
}

/** The relay's heartbeat echo — proof the link is alive. NEVER content: not written to the xterm, not logged. */
export function isHeartbeatAckFrame(text: string): boolean {
  return isControlFrame(text, "hb-ack");
}

/**
 * The watchdog verdict, pure so the boundary is unit-tested: dead only when ARMED
 * (this socket has acked at least once) AND the silence STRICTLY exceeds the
 * threshold. Unarmed → never (old-relay skew gate).
 */
export function shouldDeclareLinkSilent(lastInboundAt: number, now: number, armed: boolean): boolean {
  return armed && now - lastInboundAt > LINK_SILENT_AFTER_MS;
}
