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

export type EndedReason = "user" | "remote" | "idle" | "max-duration";

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

/** Best-effort reason classification from a close-frame reason string. */
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

/** Feature flag — OFF unless NEXT_PUBLIC_TERMINAL_ENABLED is exactly "true". */
export function isTerminalEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TERMINAL_ENABLED === "true";
}

/** Relay base URL (public env), defaulting to the local dev relay. */
export function relayBaseUrl(): string {
  return process.env.NEXT_PUBLIC_TERMINAL_RELAY_URL || DEFAULT_RELAY_URL;
}
