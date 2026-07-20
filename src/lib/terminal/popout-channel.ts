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
//
// REWORK (fix/terminal-popout-handshake, board task cd0a9792): a Brave field
// test showed the popped window timing out with "Lost the session hand-off"
// while the dock's tab kept showing "Connected" — the hand-off never
// completed. Root cause: the popped window posted "ready" EXACTLY ONCE
// (terminal-popout-client.tsx), and neither side had any resilience to that
// single BroadcastChannel message going missing — no retry, and every
// rejection path (`parsePopoutPayload`/`parsePopoutChannelMessage`) failed
// SILENTLY (`return null`, nothing logged), so a dropped or delayed message
// left no trace anywhere. A one-shot post on a cross-window channel is not a
// safe assumption in real browsers (strict privacy/storage-isolation modes —
// Brave chief among them — plus ordinary scheduling races between a
// `noopener` popup and its opener can all delay or drop the very first
// message); this module now assumes every message CAN be lost and makes the
// whole handshake self-healing instead: the client retries "ready" on an
// interval until the payload lands or it gives up (`startPopoutClientHandshake`),
// the dock treats "ready" as fully idempotent — N readies, N (harmless,
// duplicate) payload re-sends — instead of "first one wins"
// (`reduceDockHandshake`), and every rejection path now warns with its
// reason instead of dropping silently.

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
   * see use-terminal-session.ts's `attachExisting` option doc. Non-essential:
   * an empty string is accepted (see `parsePopoutPayload`) — it's unused by
   * the popped window either way, so treating it as required would only add
   * one more way for a legitimate hand-off to be silently rejected.
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

/**
 * Field-by-field validation so a rejection can say WHICH field was the
 * problem (never silent — a dropped hand-off used to leave zero trace
 * anywhere, which is exactly what made the Brave field failure so hard to
 * place). `relayUrl` is intentionally the one non-essential field — see its
 * doc on `PopoutPayload` — so an empty string there doesn't sink an
 * otherwise-valid hand-off.
 */
function parsePopoutPayload(value: unknown): PopoutPayload | null {
  if (!value || typeof value !== "object") {
    console.warn("[terminal-popout] rejected payload: not an object", value);
    return null;
  }
  const p = value as Record<string, unknown>;
  const problems: string[] = [];
  if (!isNonEmptyString(p.sid)) problems.push("sid");
  if (!isNonEmptyString(p.browserToken)) problems.push("browserToken");
  if (typeof p.relayUrl !== "string") problems.push("relayUrl");
  if (!isNonEmptyString(p.ideaId)) problems.push("ideaId");
  if (typeof p.ideaTitle !== "string") problems.push("ideaTitle");
  if (!isNonEmptyString(p.label)) problems.push("label");
  if (typeof p.identity !== "string") problems.push("identity");
  if (typeof p.readOnly !== "boolean") problems.push("readOnly");
  if (problems.length > 0) {
    console.warn("[terminal-popout] rejected payload: invalid/missing field(s)", problems);
    return null;
  }
  return {
    sid: p.sid as string,
    browserToken: p.browserToken as string,
    relayUrl: p.relayUrl as string,
    ideaId: p.ideaId as string,
    ideaTitle: p.ideaTitle as string,
    label: p.label as string,
    identity: p.identity as string,
    readOnly: p.readOnly as boolean,
  };
}

/**
 * Validate + narrow a raw `BroadcastChannel` message event's `data` into a
 * known message — never throws (a stray/foreign message on the channel just
 * parses to `null` and is ignored), so callers never need a try/catch around a
 * postMessage payload they don't fully control (structured-clone data is
 * `unknown`, not `any`, by the time it reaches app code).
 */
export function parsePopoutChannelMessage(data: unknown): PopoutChannelMessage | null {
  if (!data || typeof data !== "object") {
    console.warn("[terminal-popout] ignoring channel message: not an object", data);
    return null;
  }
  const msg = data as { type?: unknown; payload?: unknown };
  if (msg.type === "ready") return { type: "ready" };
  if (msg.type === "closed") return { type: "closed" };
  if (msg.type === "payload") {
    // parsePopoutPayload already warns with the specific reason on rejection.
    const payload = parsePopoutPayload(msg.payload);
    return payload ? { type: "payload", payload } : null;
  }
  console.warn("[terminal-popout] ignoring channel message: unrecognised type", msg.type);
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
 * ALWAYS triggers `send-payload` — including every retry (see
 * `startPopoutClientHandshake`, which now re-announces "ready" on an
 * interval instead of posting it once). This is deliberately idempotent
 * rather than "first one wins": re-sending the SAME payload on a duplicate
 * "ready" is a harmless no-op for the popped window (it just overwrites its
 * own not-yet-set state with an identical value), whereas the old "only the
 * first ready counts" version meant that if the payload the dock sent in
 * response to that first ready was itself the one that got lost — not the
 * ready — every later retried "ready" was silently ignored and the hand-off
 * could never recover. `state` still tracks whether a payload has EVER been
 * sent (useful for tests/debugging), but no longer gates the action.
 * `"closed"` is the auto-reattach signal (D3) and is always actionable,
 * regardless of handshake phase — a popped window can close (or its own
 * hand-off can time out, which now ALSO posts "closed" — see
 * `startPopoutClientHandshake`) before OR after it ever received the
 * payload, and the dock must reattach either way. A stray `"payload"` on the
 * DOCK's own channel (it should never receive one — only send them) is
 * ignored.
 */
export function reduceDockHandshake(
  state: DockHandshakeState,
  message: PopoutChannelMessage,
): DockHandshakeResult {
  if (message.type === "closed") return { state, action: "reattach" };
  if (message.type === "ready") return { state: "payload-sent", action: "send-payload" };
  return { state, action: "none" };
}

// ── dock-side channel wiring (extracted so it's unit-testable without
//    mounting the whole terminal-dock.tsx component tree) ──────────────────

/**
 * The minimal shape terminal-dock.tsx's real `BroadcastChannel` and a test
 * double both satisfy. `onmessage`'s event type is the real DOM
 * `MessageEvent` (not a narrowed `{ data: unknown }`) deliberately — a
 * narrower property type here would make `BroadcastChannel` itself fail to
 * structurally satisfy this interface under `strictFunctionTypes`
 * (parameters are contravariant for property-declared function types).
 */
export interface PopoutChannelLike {
  postMessage(data: unknown): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  close(): void;
}

/**
 * Builds the DOCK side's `channel.onmessage` handler — the exact logic
 * terminal-dock.tsx's `handlePopOut` wires up, extracted so it can be driven
 * by a test double instead of a real `BroadcastChannel` + React state. The
 * per-tab bookkeeping (is this channel still the live one for this tab, or
 * did a "Bring back" already tear it down?) stays with the CALLER via
 * `getEntry`/`setEntry` — that's terminal-dock.tsx's `popoutChannelsRef` Map,
 * not something this module should own.
 */
export function createDockPopoutMessageHandler(options: {
  getEntry: () => { channel: PopoutChannelLike; handshake: DockHandshakeState } | undefined;
  setEntry: (next: { channel: PopoutChannelLike; handshake: DockHandshakeState }) => void;
  getPayload: () => PopoutPayload;
  onReattach: () => void;
}): (ev: MessageEvent) => void {
  const { getEntry, setEntry, getPayload, onReattach } = options;
  return (ev) => {
    const message = parsePopoutChannelMessage(ev.data);
    if (!message) return; // already warned with a reason
    const current = getEntry();
    if (!current) return; // already torn down (e.g. a racing bring-back)
    const result = reduceDockHandshake(current.handshake, message);
    setEntry({ channel: current.channel, handshake: result.state });
    if (result.action === "send-payload") {
      current.channel.postMessage({ type: "payload", payload: getPayload() });
    } else if (result.action === "reattach") {
      onReattach();
    }
  };
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

/**
 * How often the popped window re-announces "ready" while it waits (hardening
 * for the Brave field failure — see this module's header doc). One-shot was
 * fragile by construction: if that single message never landed on a live
 * dock listener, nothing would ever try again. ~300ms gives roughly 16
 * attempts inside the 5s hand-off window.
 */
export const POPOUT_READY_RETRY_MS = 300;

/** Pure boundary check for the ~5s hand-off wait, so the timing policy is testable without a real timer. */
export function hasPopoutHandoffTimedOut(
  startedAtMs: number,
  nowMs: number,
  timeoutMs: number = POPOUT_HANDOFF_TIMEOUT_MS,
): boolean {
  return nowMs - startedAtMs >= timeoutMs;
}

// ── popped-window-side channel wiring (extracted, same rationale as the
//    dock-side handler above) ───────────────────────────────────────────────

export interface PopoutClientHandshakeOptions {
  channel: PopoutChannelLike;
  /** Called with the payload the moment a valid one arrives — retries stop immediately after. */
  onPayload: (payload: PopoutPayload) => void;
  /** Called once, if no payload arrives before the timeout — the caller renders the "Lost the session hand-off" state. */
  onTimeout: () => void;
  now?: () => number;
  setIntervalFn?: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (id: ReturnType<typeof setInterval>) => void;
  retryIntervalMs?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * The popped window's side of the hand-off: announce "ready" immediately,
 * then keep re-announcing on `retryIntervalMs` until either a valid payload
 * arrives (`onPayload`, retries stop) or `timeoutMs` elapses (`onTimeout`,
 * retries stop AND a "closed" message goes out — see the module header doc:
 * a failed hand-off must not leave the dock stuck showing "Popped out"
 * forever with nothing on the other end, so a timeout is treated exactly
 * like the window closing for real). Returns a `stop()` cleanup that clears
 * both timers without sending anything (used on unmount/nonce-change, where
 * nothing failed — the effect is just tearing down).
 */
export function startPopoutClientHandshake(options: PopoutClientHandshakeOptions): () => void {
  const {
    channel,
    onPayload,
    onTimeout,
    now = Date.now,
    setIntervalFn = (cb, ms) => setInterval(cb, ms),
    clearIntervalFn = (id) => clearInterval(id),
    retryIntervalMs = POPOUT_READY_RETRY_MS,
    pollIntervalMs = 250,
    timeoutMs = POPOUT_HANDOFF_TIMEOUT_MS,
  } = options;
  const startedAt = now();
  let settled = false;

  const postReady = () => {
    try {
      channel.postMessage({ type: "ready" });
    } catch {
      /* channel already gone — nothing to announce to */
    }
  };

  channel.onmessage = (ev) => {
    if (settled) return;
    const message = parsePopoutChannelMessage(ev.data);
    if (message?.type !== "payload") return;
    settled = true;
    clearIntervalFn(readyTimer);
    clearIntervalFn(pollTimer);
    onPayload(message.payload);
  };

  // Both timers are created BEFORE the first `postReady()` call, even though
  // `postReady` doesn't fire on an interval tick until later — this is
  // deliberate, not incidental: `onmessage` (above) closes over `readyTimer`
  // / `pollTimer`, and on a delivery model where a message can be answered
  // SYNCHRONOUSLY (true of this repo's own test doubles; never true of a
  // real `BroadcastChannel`, whose dispatch is always a later task, but
  // correctness here shouldn't depend on that), calling `postReady()` before
  // both consts exist would let `onmessage` read them mid-initialization
  // (a TDZ `ReferenceError`) the instant that first "ready" gets answered.
  const readyTimer = setIntervalFn(postReady, retryIntervalMs);
  const pollTimer = setIntervalFn(() => {
    if (settled) return;
    if (!hasPopoutHandoffTimedOut(startedAt, now(), timeoutMs)) return;
    settled = true;
    clearIntervalFn(readyTimer);
    clearIntervalFn(pollTimer);
    try {
      channel.postMessage({ type: "closed" });
    } catch {
      /* channel already gone — nothing to signal */
    }
    onTimeout();
  }, pollIntervalMs);
  postReady();

  return () => {
    clearIntervalFn(readyTimer);
    clearIntervalFn(pollTimer);
  };
}
