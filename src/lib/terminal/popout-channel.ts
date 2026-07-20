// In-app terminal — pop-out window hand-off, pure logic (multi-session stage 4,
// docs/design-terminal-multi-session-popout.html §10, D1-D7).
//
// The dock and the popped-out window are TWO SEPARATE documents (a real browser
// window opened via window.open) — there is no shared JS heap, no React context,
// no window.opener reliance (we open with a feature string that omits it isn't
// required either way, since nothing here reads `opener`). The only channel
// between them is a same-origin `BroadcastChannel` named from a one-time NONCE
// carried in the popped window's URL HASH (never sent to any server — hashes
// never leave the browser) or, as a fallback, `window.name`. The nonce carries no
// session meaning by itself (D4/AC16: "no tokens ever ride the URL") — it only
// names a rendezvous channel; the actual session credentials (sid + browser
// token) cross exclusively over that channel, as a "payload" message.
//
// Handshake (design §13 Flow 3):
//   1. The dock calls window.open() SYNCHRONOUSLY from the click handler (popup
//      policy — D7), then opens a BroadcastChannel(nonce) and waits.
//   2. The popped window opens the SAME channel and posts "ready" the moment it
//      mounts.
//   3. On "ready", the dock posts "payload" (sid, browserToken, relayUrl, idea
//      id/title, label, identity, readOnly).
//   4. The popped window attaches with that pair — attaching with the SAME OWNER
//      preempts whichever OTHER browser leg is currently attached at the relay
//      (the existing 4001 "preempted" close, D1/F2). Both sides recognise that
//      close by its CODE (not by messaging each other about it): the dock treats
//      an expected preemption as "popped out" (tracked locally, see
//      terminal-dock.tsx's `poppedOutKeys`); the popped window treats ITS OWN
//      4001 close as "brought back to the dock" (see `isPreemptedClose` below) —
//      the SAME mechanism serves the pop-out direction and the bring-back
//      direction, just observed from opposite ends.
//   5. When the popped window closes (`beforeunload`/`pagehide`), it posts
//      "closed" on the SAME channel so the dock can auto-reattach (D3) without
//      polling `window.closed` (which `noopener` would block anyway).
//
// This module holds every piece of that protocol that's expressible as pure data
// + pure functions — channel naming, the payload shape, message parsing, the
// dock's own tiny handshake reducer, and the 4001/"brought back" + hand-off
// timeout predicates — so it's unit-tested without a DOM, a socket, or a real
// BroadcastChannel.

import { RELAY_CLOSE } from "@/lib/terminal/connection";

/** Channel names are namespaced so nothing else on the origin could collide. */
const POPOUT_CHANNEL_PREFIX = "vibecodes:terminal-popout:";

/** The BroadcastChannel name for a given hand-off nonce. */
export function popoutChannelName(nonce: string): string {
  return `${POPOUT_CHANNEL_PREFIX}${nonce}`;
}

/**
 * A one-time, meaningless-by-itself token that names the hand-off channel and
 * rides the popped window's URL HASH (never the query string, never sent to any
 * server). Uses `crypto.randomUUID()` where available (every supported browser);
 * the fallback only matters for a non-secure-context edge case and still yields
 * a channel name unique enough that a same-tab collision is not a real concern
 * (this is a rendezvous id, not a security boundary — the actual secret is the
 * browser token carried IN the payload message, never in the nonce or the URL).
 */
export function generatePopoutNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

/** Everything the popped window needs to attach to the SAME relay session. */
export interface PopoutPayload {
  /** The session id (sid) — never in the URL, only ever carried here. */
  sid: string;
  /** The browser-leg token. An EXPIRED token is fine — the relay waives expiry
   * for a same-owner reattach to a live session (D1's binding note). */
  browserToken: string;
  /**
   * Carried for fidelity with the design's payload shape and potential future
   * use (e.g. surfacing relay skew in logs); the popped window's own
   * `useTerminalSession` currently resolves the relay URL itself from the SAME
   * `NEXT_PUBLIC_TERMINAL_RELAY_URL` build-time env both documents share, so
   * this field is not required to be threaded into the actual connection —
   * see use-terminal-session.ts's `attachExisting` option doc.
   */
  relayUrl: string;
  ideaId: string;
  ideaTitle: string;
  /** This tab's derived label (task title, or `<idea slug> · <sid-short>`) — becomes the popped window's title. */
  label: string;
  /** The identity line shown in both the dock header and the popped window's header. */
  identity: string;
  readOnly: boolean;
}

export type PopoutChannelMessage =
  | { type: "ready" }
  | { type: "payload"; payload: PopoutPayload }
  | { type: "closed" };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function parsePopoutPayload(value: unknown): PopoutPayload | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (
    isNonEmptyString(p.sid) &&
    isNonEmptyString(p.browserToken) &&
    isNonEmptyString(p.relayUrl) &&
    isNonEmptyString(p.ideaId) &&
    typeof p.ideaTitle === "string" &&
    isNonEmptyString(p.label) &&
    typeof p.identity === "string" &&
    typeof p.readOnly === "boolean"
  ) {
    return {
      sid: p.sid,
      browserToken: p.browserToken,
      relayUrl: p.relayUrl,
      ideaId: p.ideaId,
      ideaTitle: p.ideaTitle,
      label: p.label,
      identity: p.identity,
      readOnly: p.readOnly,
    };
  }
  return null;
}

/**
 * Validate + narrow a raw `BroadcastChannel` message event's `data` into a
 * known message — never throws (a stray/foreign message on the channel just
 * parses to `null` and is ignored), so callers never need a try/catch around a
 * postMessage payload they don't fully control (structured-clone data is
 * `unknown`, not `any`, by the time it reaches app code).
 */
export function parsePopoutChannelMessage(data: unknown): PopoutChannelMessage | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as { type?: unknown; payload?: unknown };
  if (msg.type === "ready") return { type: "ready" };
  if (msg.type === "closed") return { type: "closed" };
  if (msg.type === "payload") {
    const payload = parsePopoutPayload(msg.payload);
    return payload ? { type: "payload", payload } : null;
  }
  return null;
}

// ── the dock's handshake reducer ────────────────────────────────────────────

/** The dock's side of the hand-off: has the payload been sent yet? */
export type DockHandshakeState = "waiting-for-ready" | "payload-sent";

export const INITIAL_DOCK_HANDSHAKE_STATE: DockHandshakeState = "waiting-for-ready";

export type DockHandshakeAction = "none" | "send-payload" | "reattach";

export interface DockHandshakeResult {
  state: DockHandshakeState;
  action: DockHandshakeAction;
}

/**
 * Pure reducer over every message the dock's channel can receive. `"ready"`
 * only triggers `send-payload` the FIRST time (idempotent against a retried
 * "ready" — e.g. a slow-loading popped window firing more than one, or a
 * message replayed after a hot-reload): once `payload-sent`, a later "ready" is
 * a no-op rather than re-sending (and re-triggering) the pop-out. `"closed"` is
 * the auto-reattach signal (D3) and is always actionable, regardless of
 * handshake phase — a popped window can close before OR after it ever received
 * the payload (e.g. the user closed it during the ~5s hand-off window), and the
 * dock must reattach either way. A stray `"payload"` on the DOCK's own channel
 * (it should never receive one — only send them) is ignored.
 */
export function reduceDockHandshake(
  state: DockHandshakeState,
  message: PopoutChannelMessage,
): DockHandshakeResult {
  if (message.type === "closed") return { state, action: "reattach" };
  if (message.type === "ready" && state === "waiting-for-ready") {
    return { state: "payload-sent", action: "send-payload" };
  }
  return { state, action: "none" };
}

// ── popped-window-side decisions ────────────────────────────────────────────

/**
 * The popped window's own browser leg was preempted by close code 4001 (the
 * relay's DUP_BROWSER code — RELAY_CLOSE.DUP_BROWSER). Within this feature,
 * that code has exactly ONE cause: the dock (or a later popped window) reattached
 * with the same owner, i.e. a "Bring back to dock" — either explicit (the
 * placeholder's button) or automatic (this window's own close-signal racing a
 * manual bring-back). The popped window uses this to show a CALM "brought back"
 * state instead of the generic P1 "duplicate session" error copy (binding
 * note: "recognise its 4001 preempted close ... not an error").
 */
export function isPreemptedClose(closeCode: number | null): boolean {
  return closeCode === RELAY_CLOSE.DUP_BROWSER;
}

/** How long the popped window waits for the hand-off payload before giving up honestly (D2/D7 fallback, "~5s" per the design). */
export const POPOUT_HANDOFF_TIMEOUT_MS = 5_000;

/** Pure boundary check for the ~5s hand-off wait, so the timing policy is testable without a real timer. */
export function hasPopoutHandoffTimedOut(
  startedAtMs: number,
  nowMs: number,
  timeoutMs: number = POPOUT_HANDOFF_TIMEOUT_MS,
): boolean {
  return nowMs - startedAtMs >= timeoutMs;
}
