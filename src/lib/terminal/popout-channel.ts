// In-app terminal — pop-out window hand-off, pure logic (multi-session stage 4,
// docs/design-terminal-multi-session-popout.html §10, D1-D7).
//
// The dock and the popped-out window are TWO SEPARATE documents (a real browser
// window opened via window.open) — there is no shared JS heap, no React context,
// no window.opener reliance. Isolation is enforced EXPLICITLY: `openPopoutWindow`
// below opens WITHOUT `noopener` in the feature string and then sets
// `win.opener = null` itself once it has a handle — see that function's doc for
// why the feature string can never carry `noopener` again. The only channel
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
//      polling `window.closed` — unreliable across two separate windows either
//      way, and outright blocked back when the feature string still carried
//      `noopener` (see the REWORK addendum below).
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
//
// SCROLLBACK TRANSFER (card 35cffc10, docs/design-terminal-scrollback-
// transfer.html): the buffer that rides pop-out and bring-back is carried
// entirely inside this module's existing message shapes — a `buffer` field
// added to `payload` (pop-out direction), and two new messages for bring-back
// (`bring-back-request` / `buffer-reply`). Design §1's decision: a SEPARATE
// "buffer" message would reintroduce the exact failure class the handshake
// rework above just eliminated (two coupled messages where either half can
// be the one that's lost); embedding the buffer in `payload` inherits the
// idempotent ready/re-send hardening for free. The `buffer` field is always
// OPTIONAL and leniently parsed — a malformed buffer is dropped (warned) on
// its own, never sinking the surrounding message; scrollback is never
// allowed to sink a hand-off. The actual serialize/restore mechanics live in
// scrollback-transfer.ts (a separate, transport-agnostic module) — this file
// only carries the resulting `{ data, truncated }` shape across the channel.
//
// REWORK ADDENDUM (fix/terminal-popout-open-guard, board task 4f9cf03d): the
// retried-handshake hardening above was necessary but NOT sufficient — it
// shipped and the pop-out STILL failed 100% of the time in production,
// because the actual field failure was one level up the call stack and
// nothing above could ever reach it. `handlePopOut` (terminal-dock.tsx)
// opened with `"width=760,height=560,noopener"`, and per the HTML spec,
// `window.open()` returns `null` whenever the feature string contains
// `noopener` — EVEN WHEN THE POPUP OPENS SUCCESSFULLY. So its `if (!win)`
// guard fired on every single click, the popup-blocked-toast branch ran
// unconditionally, and the function returned before ever reaching the
// BroadcastChannel wiring above — the retried "ready"s the popped window
// was faithfully sending landed on a dock that had never started listening.
// Fixed here by dropping `noopener` from the feature string (see
// `openPopoutWindow` below) and severing `win.opener` explicitly instead —
// isolation is preserved, but no longer at the cost of a null return on
// success.

import { RELAY_CLOSE } from "@/lib/terminal/connection";
import type { TransferredBuffer } from "@/lib/terminal/scrollback-transfer";

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

/** The signature of `window.open` — injectable so the call is testable without a real browser. */
export type PopoutWindowOpener = (url: string, target: string, features: string) => Window | null;

/**
 * Opens the popped-out terminal window and severs its opener link — the
 * exact sequence `terminal-dock.tsx`'s `handlePopOut` runs on click, extracted
 * here (same rationale as `createDockPopoutMessageHandler` below) so it's
 * unit-tested without a real `window.open`.
 *
 * THE FEATURE STRING BELOW MUST NEVER INCLUDE `noopener` — this is not a
 * style preference, it's the root cause of two field failures (board tasks
 * cd0a9792 and 4f9cf03d). Per the HTML spec, `window.open()` returns `null`
 * whenever the feature string contains `noopener`, EVEN WHEN THE POPUP
 * OPENS SUCCESSFULLY (the browsing context is still created; only the
 * reference back to it is withheld). `handlePopOut`'s `if (!win)` guard is
 * only a correct "was this genuinely popup-blocked?" check as long as a
 * successful open yields a real handle — reintroduce `noopener` here and
 * that guard fires on EVERY call again, exactly as it did in production.
 * Isolation is enforced explicitly instead, below: once a real handle comes
 * back, its `opener` is nulled out directly, so the popped window still has
 * no way to script back into the tab that opened it.
 */
export function openPopoutWindow(nonce: string, windowOpen: PopoutWindowOpener): Window | null {
  const win = windowOpen(
    `/terminal/popout#${nonce}`,
    `vibecodes-terminal-${nonce}`,
    "width=760,height=560",
  );
  if (!win) return null; // genuinely popup-blocked — caller shows the toast (D7)
  try {
    win.opener = null;
  } catch {
    /* cross-origin or already-detached — nothing to sever, and the window
     * itself is still perfectly usable, so this must never sink the open. */
  }
  return win;
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
  /**
   * The dock's serialized scrollback at the moment of send (design §1/§2,
   * Flow A) — OPTIONAL and captured FRESH on every send (including retries),
   * never memoized, so a slow handshake still hands over the newest output.
   * Absent when the sender predates this card (deploy skew, E7) or when
   * nothing was available to serialize yet (e.g. the dock's own xterm
   * instance hasn't mounted). A malformed value here is dropped by
   * `parsePopoutPayload` without rejecting the rest of the payload —
   * scrollback is never allowed to sink a hand-off.
   */
  buffer?: TransferredBuffer;
}

export type PopoutChannelMessage =
  | { type: "ready" }
  | { type: "payload"; payload: PopoutPayload }
  | { type: "closed" }
  /** Dock → popped (Flow B, design §3): "I'm about to reattach — send me your buffer first." No payload of its own. */
  | { type: "bring-back-request" }
  /**
   * Popped → dock: the popped window's full serialized scrollback, either as
   * the direct reply to `bring-back-request` (Flow B) or pushed unprompted
   * immediately before `closed` when the window is simply being closed
   * (Flow C, design §4) — BroadcastChannel's per-sender ordering guarantees
   * the reply always lands before that `closed`.
   */
  | { type: "buffer-reply"; buffer: TransferredBuffer };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Lenient `TransferredBuffer` parse — `null` (with a console warning giving
 * the reason) for anything malformed. Used both for `payload.buffer` (where
 * the caller must NOT let a bad buffer reject the rest of the payload — see
 * `parsePopoutPayload`) and for `buffer-reply` (where the buffer IS the
 * entire message, so a bad one drops the whole message, still without ever
 * throwing).
 */
function parseTransferredBuffer(value: unknown): TransferredBuffer | null {
  if (!value || typeof value !== "object") {
    console.warn("[terminal-popout] rejected buffer: not an object", value);
    return null;
  }
  const b = value as Record<string, unknown>;
  if (typeof b.data !== "string" || typeof b.truncated !== "boolean") {
    console.warn("[terminal-popout] rejected buffer: invalid/missing field(s)", {
      hasData: typeof b.data === "string",
      hasTruncated: typeof b.truncated === "boolean",
    });
    return null;
  }
  return { data: b.data, truncated: b.truncated };
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
  const result: PopoutPayload = {
    sid: p.sid as string,
    browserToken: p.browserToken as string,
    relayUrl: p.relayUrl as string,
    ideaId: p.ideaId as string,
    ideaTitle: p.ideaTitle as string,
    label: p.label as string,
    identity: p.identity as string,
    readOnly: p.readOnly as boolean,
  };
  // Optional and leniently parsed (design §1's decision callout): a
  // malformed/absent buffer is dropped on its own — the credentials above
  // still go through either way. `p.buffer === undefined` is the ordinary
  // "sender predates this card, or had nothing to serialize yet" case and
  // warns nothing (that's expected, not an error).
  if (p.buffer !== undefined) {
    const buffer = parseTransferredBuffer(p.buffer);
    if (buffer) result.buffer = buffer;
  }
  return result;
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
  const msg = data as { type?: unknown; payload?: unknown; buffer?: unknown };
  if (msg.type === "ready") return { type: "ready" };
  if (msg.type === "closed") return { type: "closed" };
  if (msg.type === "bring-back-request") return { type: "bring-back-request" };
  if (msg.type === "payload") {
    // parsePopoutPayload already warns with the specific reason on rejection.
    const payload = parsePopoutPayload(msg.payload);
    return payload ? { type: "payload", payload } : null;
  }
  if (msg.type === "buffer-reply") {
    // Unlike payload.buffer, the buffer IS the whole message here — a
    // malformed one drops the whole message (parseTransferredBuffer already
    // warns with the specific reason).
    const buffer = parseTransferredBuffer(msg.buffer);
    return buffer ? { type: "buffer-reply", buffer } : null;
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
 * The dock's per-tab pop-out bookkeeping (terminal-dock.tsx's
 * `popoutChannelsRef` Map value shape) — exported so the caller and this
 * module agree on it. `pendingBuffer` is Flow C's stash (design §4): the
 * popped window's unprompted `buffer-reply`, held here until the `closed`
 * that always follows it (BroadcastChannel's per-sender ordering) actually
 * applies it. `undefined`/absent means "nothing stashed" — the ordinary case
 * for every message that isn't part of a Flow C close sequence.
 */
export interface DockPopoutEntry {
  channel: PopoutChannelLike;
  handshake: DockHandshakeState;
  pendingBuffer?: TransferredBuffer;
}

/**
 * Builds the DOCK side's `channel.onmessage` handler — the exact logic
 * terminal-dock.tsx's `handlePopOut` wires up, extracted so it can be driven
 * by a test double instead of a real `BroadcastChannel` + React state. The
 * per-tab bookkeeping (is this channel still the live one for this tab, or
 * did a "Bring back" already tear it down?) stays with the CALLER via
 * `getEntry`/`setEntry` — that's terminal-dock.tsx's `popoutChannelsRef` Map,
 * not something this module should own.
 *
 * `buffer-reply` (Flow C, design §4) is handled OUTSIDE the pure handshake
 * reducer below: it's not a handshake-phase transition, just a stash — the
 * popped window pushes it unprompted, immediately before its own `closed`,
 * when the user simply closes the window (no "Bring back" click, no
 * request/reply round trip like Flow B's `startBringBackRequest`). `onReattach`
 * receives whatever was stashed (or `null` if nothing was — an old popped
 * window, a failed serialize, or the hand-off-timeout `closed` that never
 * carried a payload at all) so the caller can restore it before reconnecting.
 */
export function createDockPopoutMessageHandler(options: {
  getEntry: () => DockPopoutEntry | undefined;
  setEntry: (next: DockPopoutEntry) => void;
  getPayload: () => PopoutPayload;
  onReattach: (stashedBuffer: TransferredBuffer | null) => void;
}): (ev: MessageEvent) => void {
  const { getEntry, setEntry, getPayload, onReattach } = options;
  return (ev) => {
    const message = parsePopoutChannelMessage(ev.data);
    if (!message) return; // already warned with a reason
    const current = getEntry();
    if (!current) return; // already torn down (e.g. a racing bring-back)
    if (message.type === "buffer-reply") {
      setEntry({ ...current, pendingBuffer: message.buffer });
      return;
    }
    const result = reduceDockHandshake(current.handshake, message);
    setEntry({ ...current, handshake: result.state });
    if (result.action === "send-payload") {
      current.channel.postMessage({ type: "payload", payload: getPayload() });
    } else if (result.action === "reattach") {
      onReattach(current.pendingBuffer ?? null);
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

// ── dock-side bring-back driver (Flow B, design §3) ─────────────────────────
//
// The two-phase "Bring back to dock" button click: request the popped
// window's buffer, wait a bounded amount of time for the reply, then let the
// caller proceed either way. Mirrors `startPopoutClientHandshake`'s shape —
// injectable timer/clock, no DOM — so it's unit-tested the same way.

/** D3: 500ms (the midpoint of the design's 400–600ms band) — see the design doc for the full rationale. */
export const BRING_BACK_REPLY_TIMEOUT_MS = 500;

export interface BringBackRequestOptions {
  channel: PopoutChannelLike;
  /**
   * Called exactly once, with the popped window's buffer on a timely reply,
   * or `null` on timeout (D3's deliberate fallback: the caller keeps its own
   * buffer and proceeds — complete history except the popped-out slice,
   * never a hang).
   */
  onSettle: (buffer: TransferredBuffer | null) => void;
  now?: () => number;
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
  timeoutMs?: number;
}

/**
 * The dock's half of Flow B: post `bring-back-request`, then settle exactly
 * once — either the moment a `buffer-reply` arrives, or after `timeoutMs`
 * with `null`. A reply that arrives AFTER settling (a late reply racing a
 * timeout that already fired, or a second call racing a first) is ignored —
 * `settled` latches permanently the first time either side wins, exactly
 * like `startPopoutClientHandshake`'s own single-settle guard.
 *
 * Deliberately takes over `channel.onmessage` for the duration of the wait
 * (restored to nothing on settle, same as this module's other drivers) —
 * the caller owns wiring it back to `createDockPopoutMessageHandler` if the
 * hand-off fails and the tab stays popped out; on success the whole entry
 * (channel included) gets torn down anyway (design's `endPopOut`).
 *
 * Returns a `cancel()` that settles nothing and just stops the timer — for
 * an unmount/nonce-change where nothing about the bring-back itself failed.
 */
export function startBringBackRequest(options: BringBackRequestOptions): () => void {
  const {
    channel,
    onSettle,
    setTimeoutFn = (cb, ms) => setTimeout(cb, ms),
    clearTimeoutFn = (id) => clearTimeout(id),
    timeoutMs = BRING_BACK_REPLY_TIMEOUT_MS,
  } = options;
  let settled = false;

  const finish = (buffer: TransferredBuffer | null) => {
    if (settled) return;
    settled = true;
    clearTimeoutFn(timer);
    channel.onmessage = null;
    onSettle(buffer);
  };

  channel.onmessage = (ev) => {
    if (settled) return;
    const message = parsePopoutChannelMessage(ev.data);
    if (message?.type !== "buffer-reply") return;
    finish(message.buffer);
  };

  const timer = setTimeoutFn(() => finish(null), timeoutMs);

  try {
    channel.postMessage({ type: "bring-back-request" });
  } catch {
    /* channel already gone — the timeout above still fires and falls back */
  }

  return () => {
    if (settled) return;
    settled = true;
    clearTimeoutFn(timer);
  };
}

// ── popped-window-side auto-close on bring-back (card 101bbb2d) ────────────
//
// The popped window was opened BY SCRIPT — `window.open()` in the dock (see
// `openPopoutWindow` above) — so `window.close()` from ITS OWN script is
// browser-permitted (the "scripts may only close windows they opened"
// restriction). By the time this window sees its own 4001 preempted close
// (`isPreemptedClose` above), the two-phase bring-back (design's Flow B,
// `startBringBackRequest`) has already crossed the scrollback buffer BEFORE
// the dock reattached — nothing further is needed from this window, so it
// closes itself instead of leaving Nick to close a "you can close this
// window" tab by hand. `BroughtBackOverlay` (terminal-popout-view.tsx) is
// kept exactly as-is as the FALLBACK: some browsers refuse a scripted close
// (e.g. the tab wasn't opened by script from that browser's point of view,
// or the user has multiple tabs in the window) — `closeWindow` swallows
// whatever it throws so a refusal never surfaces as an error, it just leaves
// the calm overlay + its Close button sitting there, which is also what's
// briefly visible during the delay below either way.

/** How long the popped window waits, once brought back, before closing itself — long enough that the "Brought back to the dock" state is visibly readable for a beat, short enough that it reads as automatic rather than stuck. */
export const BROUGHT_BACK_AUTO_CLOSE_MS = 600;

/**
 * Schedules `closeWindow()` after `delayMs` and returns a cancel function.
 * `closeWindow` is injected (rather than this module calling `window.close()`
 * directly) for the same reason every other driver in this file injects its
 * side effect — testable without a real `window`. Never throws: a browser
 * that refuses the scripted close (or any other failure inside `closeWindow`)
 * must leave the fallback "Moved to dock" screen intact, not crash the
 * popped window's render.
 */
export function startBroughtBackAutoClose(options: {
  closeWindow: () => void;
  delayMs?: number;
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
}): () => void {
  const {
    closeWindow,
    delayMs = BROUGHT_BACK_AUTO_CLOSE_MS,
    setTimeoutFn = (cb, ms) => setTimeout(cb, ms),
    clearTimeoutFn = (id) => clearTimeout(id),
  } = options;

  const timer = setTimeoutFn(() => {
    try {
      closeWindow();
    } catch {
      /* the browser refused the scripted close — the fallback screen (with
       * its own Close button) is already on screen; nothing else to do. */
    }
  }, delayMs);

  return () => clearTimeoutFn(timer);
}
