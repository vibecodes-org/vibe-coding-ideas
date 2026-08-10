import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  popoutChannelName,
  generatePopoutNonce,
  openPopoutWindow,
  parsePopoutChannelMessage,
  reduceDockHandshake,
  INITIAL_DOCK_HANDSHAKE_STATE,
  isPreemptedClose,
  hasPopoutHandoffTimedOut,
  POPOUT_HANDOFF_TIMEOUT_MS,
  POPOUT_READY_RETRY_MS,
  BRING_BACK_REPLY_TIMEOUT_MS,
  createDockPopoutMessageHandler,
  startPopoutClientHandshake,
  startBringBackRequest,
  type PopoutPayload,
  type PopoutChannelLike,
  type DockHandshakeState,
  type DockPopoutEntry,
} from "./popout-channel";
import { RELAY_CLOSE } from "./connection";
import type { TransferredBuffer } from "./scrollback-transfer";

const PAYLOAD: PopoutPayload = {
  sid: "sid-123",
  browserToken: "tok-abc",
  relayUrl: "wss://relay.example",
  ideaId: "idea-1",
  ideaTitle: "Recipe Saver",
  label: "Add pagination to the recipe list",
  identity: "Recipe Saver · session sid-123",
  readOnly: false,
};

const BUFFER: TransferredBuffer = { data: "some scrollback\r\n", truncated: false };

describe("popoutChannelName", () => {
  it("namespaces the nonce so it can't collide with anything else on the origin", () => {
    expect(popoutChannelName("abc123")).toBe("vibecodes:terminal-popout:abc123");
  });
});

describe("generatePopoutNonce", () => {
  it("returns a non-empty, URL-hash-safe string", () => {
    const nonce = generatePopoutNonce();
    expect(nonce.length).toBeGreaterThan(8);
    expect(nonce).toMatch(/^[a-z0-9]+$/i);
  });

  it("never repeats across calls", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePopoutNonce()));
    expect(seen.size).toBe(50);
  });
});

describe("openPopoutWindow", () => {
  it("never puts `noopener` in the feature string — regression pin for the field failure (board tasks cd0a9792 / 4f9cf03d): `window.open` returns null unconditionally whenever the feature string contains `noopener`, even on a successful open, which made the dock's `if (!win)` guard fire on EVERY click. If this assertion ever fails, someone added `noopener` back — don't", () => {
    const windowOpen = vi.fn().mockReturnValue({ opener: "something" } as unknown as Window);
    openPopoutWindow("nonce-abc", windowOpen);
    const features = windowOpen.mock.calls[0][2];
    expect(features).not.toMatch(/noopener/);
  });

  it("derives the URL and target from the nonce exactly as the client's resolveNonce() expects — hash primary, `vibecodes-terminal-` prefix for the window.name fallback", () => {
    const windowOpen = vi.fn().mockReturnValue({ opener: "something" } as unknown as Window);
    openPopoutWindow("abc123", windowOpen);
    expect(windowOpen).toHaveBeenCalledWith("/terminal/popout#abc123", "vibecodes-terminal-abc123", expect.any(String));
  });

  it("on a successful open, returns the handle and severs its opener", () => {
    const fakeWin = { opener: "should-be-nulled" } as unknown as Window;
    const windowOpen = vi.fn().mockReturnValue(fakeWin);
    const result = openPopoutWindow("nonce-abc", windowOpen);
    expect(result).toBe(fakeWin);
    expect(result?.opener).toBeNull();
  });

  it("still returns the handle when severing opener throws (cross-origin or already-detached)", () => {
    const fakeWin = {} as Window;
    Object.defineProperty(fakeWin, "opener", {
      set() {
        throw new Error("cannot set opener");
      },
    });
    const windowOpen = vi.fn().mockReturnValue(fakeWin);
    const result = openPopoutWindow("nonce-abc", windowOpen);
    expect(result).toBe(fakeWin);
  });

  it("passes a genuine popup-block (null return) straight through — caller shows the blocked toast", () => {
    const windowOpen = vi.fn().mockReturnValue(null);
    const result = openPopoutWindow("nonce-abc", windowOpen);
    expect(result).toBeNull();
  });
});

describe("parsePopoutChannelMessage", () => {
  it("parses a ready message", () => {
    expect(parsePopoutChannelMessage({ type: "ready" })).toEqual({ type: "ready" });
  });

  it("parses a closed message", () => {
    expect(parsePopoutChannelMessage({ type: "closed" })).toEqual({ type: "closed" });
  });

  it("parses a well-formed payload message", () => {
    expect(parsePopoutChannelMessage({ type: "payload", payload: PAYLOAD })).toEqual({
      type: "payload",
      payload: PAYLOAD,
    });
  });

  it("rejects a payload message missing a required field", () => {
    const { sid: _sid, ...rest } = PAYLOAD;
    expect(parsePopoutChannelMessage({ type: "payload", payload: rest })).toBeNull();
  });

  it("rejects a payload message with the wrong type for readOnly", () => {
    expect(
      parsePopoutChannelMessage({ type: "payload", payload: { ...PAYLOAD, readOnly: "false" } }),
    ).toBeNull();
  });

  it.each([undefined, null, 42, "hello", [], { type: "unknown" }, { no_type: true }])(
    "returns null for garbage input %#",
    (input) => {
      expect(parsePopoutChannelMessage(input)).toBeNull();
    },
  );

  // ── scrollback transfer (card 35cffc10) ───────────────────────────────────

  it("deploy-skew: parses a payload with no buffer field at all exactly as before (old sender)", () => {
    expect(parsePopoutChannelMessage({ type: "payload", payload: PAYLOAD })).toEqual({
      type: "payload",
      payload: PAYLOAD,
    });
  });

  it("parses a payload carrying a well-formed buffer", () => {
    const withBuffer = { ...PAYLOAD, buffer: BUFFER };
    expect(parsePopoutChannelMessage({ type: "payload", payload: withBuffer })).toEqual({
      type: "payload",
      payload: withBuffer,
    });
  });

  it("a malformed buffer is dropped WITHOUT rejecting the rest of the payload — scrollback never sinks a hand-off", () => {
    const malformed = { ...PAYLOAD, buffer: { data: "ok", truncated: "not-a-boolean" } };
    const result = parsePopoutChannelMessage({ type: "payload", payload: malformed });
    expect(result).toEqual({ type: "payload", payload: PAYLOAD }); // buffer simply absent, credentials intact
  });

  it.each([null, 42, "nope", [], { data: 5, truncated: false }, { data: "ok" }])(
    "drops every other shape of malformed buffer %#, credentials still parse",
    (badBuffer) => {
      const result = parsePopoutChannelMessage({ type: "payload", payload: { ...PAYLOAD, buffer: badBuffer } });
      expect(result).toEqual({ type: "payload", payload: PAYLOAD });
    },
  );

  it("parses a bring-back-request message", () => {
    expect(parsePopoutChannelMessage({ type: "bring-back-request" })).toEqual({ type: "bring-back-request" });
  });

  it("parses a well-formed buffer-reply message", () => {
    expect(parsePopoutChannelMessage({ type: "buffer-reply", buffer: BUFFER })).toEqual({
      type: "buffer-reply",
      buffer: BUFFER,
    });
  });

  it("rejects a buffer-reply with a malformed buffer — here the buffer IS the whole message", () => {
    expect(parsePopoutChannelMessage({ type: "buffer-reply", buffer: { data: "ok" } })).toBeNull();
    expect(parsePopoutChannelMessage({ type: "buffer-reply" })).toBeNull();
  });
});

describe("reduceDockHandshake", () => {
  it("sends the payload on the first ready message", () => {
    const result = reduceDockHandshake(INITIAL_DOCK_HANDSHAKE_STATE, { type: "ready" });
    expect(result).toEqual({ state: "payload-sent", action: "send-payload" });
  });

  it("re-sends the payload on EVERY ready message, not just the first — idempotent, harmless duplicate (hardening for the Brave field failure: if the dock's first payload send was itself the message that got lost, a retried ready must still get a fresh send)", () => {
    const result = reduceDockHandshake("payload-sent", { type: "ready" });
    expect(result).toEqual({ state: "payload-sent", action: "send-payload" });
  });

  it("always reattaches on a closed message, regardless of handshake phase", () => {
    expect(reduceDockHandshake("waiting-for-ready", { type: "closed" })).toEqual({
      state: "waiting-for-ready",
      action: "reattach",
    });
    expect(reduceDockHandshake("payload-sent", { type: "closed" })).toEqual({
      state: "payload-sent",
      action: "reattach",
    });
  });

  it("ignores a stray payload message on the dock's own channel", () => {
    const result = reduceDockHandshake(INITIAL_DOCK_HANDSHAKE_STATE, {
      type: "payload",
      payload: PAYLOAD,
    });
    expect(result).toEqual({ state: INITIAL_DOCK_HANDSHAKE_STATE, action: "none" });
  });
});

describe("isPreemptedClose", () => {
  it("is true only for the relay's DUP_BROWSER close code", () => {
    expect(isPreemptedClose(RELAY_CLOSE.DUP_BROWSER)).toBe(true);
    expect(RELAY_CLOSE.DUP_BROWSER).toBe(4001);
  });

  it("is false for every other close code, including the sibling DUP_BRIDGE", () => {
    expect(isPreemptedClose(RELAY_CLOSE.DUP_BRIDGE)).toBe(false);
    expect(isPreemptedClose(1000)).toBe(false);
    expect(isPreemptedClose(1006)).toBe(false);
    expect(isPreemptedClose(null)).toBe(false);
  });
});

describe("hasPopoutHandoffTimedOut", () => {
  it("is false before the timeout elapses", () => {
    expect(hasPopoutHandoffTimedOut(1000, 1000 + POPOUT_HANDOFF_TIMEOUT_MS - 1)).toBe(false);
  });

  it("is true once the timeout elapses (inclusive boundary)", () => {
    expect(hasPopoutHandoffTimedOut(1000, 1000 + POPOUT_HANDOFF_TIMEOUT_MS)).toBe(true);
  });

  it("is true well past the timeout", () => {
    expect(hasPopoutHandoffTimedOut(1000, 1000 + POPOUT_HANDOFF_TIMEOUT_MS * 3)).toBe(true);
  });

  it("supports a custom timeout", () => {
    expect(hasPopoutHandoffTimedOut(0, 500, 1000)).toBe(false);
    expect(hasPopoutHandoffTimedOut(0, 1000, 1000)).toBe(true);
  });
});

// ── dock-side handler, in isolation ─────────────────────────────────────────

function makeSpyChannel(): PopoutChannelLike & { posted: unknown[] } {
  const spy: PopoutChannelLike & { posted: unknown[] } = {
    posted: [],
    onmessage: null,
    postMessage(data: unknown) {
      spy.posted.push(data);
    },
    close() {},
  };
  return spy;
}

describe("createDockPopoutMessageHandler", () => {
  it("sends the payload the moment a ready message arrives", () => {
    const channel = makeSpyChannel();
    let entry: { channel: PopoutChannelLike; handshake: DockHandshakeState } | undefined = {
      channel,
      handshake: INITIAL_DOCK_HANDSHAKE_STATE,
    };
    const onReattach = vi.fn();
    const handler = createDockPopoutMessageHandler({
      getEntry: () => entry,
      setEntry: (next) => {
        entry = next;
      },
      getPayload: () => PAYLOAD,
      onReattach,
    });
    handler({ data: { type: "ready" } } as MessageEvent);
    expect(channel.posted).toEqual([{ type: "payload", payload: PAYLOAD }]);
    expect(entry?.handshake).toBe("payload-sent");
    expect(onReattach).not.toHaveBeenCalled();
  });

  it("re-sends on a second (retried) ready — idempotent, not 'first one wins'", () => {
    const channel = makeSpyChannel();
    let entry: { channel: PopoutChannelLike; handshake: DockHandshakeState } | undefined = {
      channel,
      handshake: INITIAL_DOCK_HANDSHAKE_STATE,
    };
    const handler = createDockPopoutMessageHandler({
      getEntry: () => entry,
      setEntry: (next) => {
        entry = next;
      },
      getPayload: () => PAYLOAD,
      onReattach: vi.fn(),
    });
    handler({ data: { type: "ready" } } as MessageEvent);
    handler({ data: { type: "ready" } } as MessageEvent);
    handler({ data: { type: "ready" } } as MessageEvent);
    // Three readies, three (harmless, duplicate) payload sends — this is
    // exactly what lets a lost PAYLOAD (not just a lost ready) recover: the
    // client keeps announcing "ready" until ONE of the dock's resulting
    // payload sends actually lands.
    expect(channel.posted).toEqual([
      { type: "payload", payload: PAYLOAD },
      { type: "payload", payload: PAYLOAD },
      { type: "payload", payload: PAYLOAD },
    ]);
  });

  it("calls onReattach on closed, and does nothing further once torn down (getEntry returns undefined)", () => {
    const channel = makeSpyChannel();
    let entry: { channel: PopoutChannelLike; handshake: DockHandshakeState } | undefined = {
      channel,
      handshake: "payload-sent",
    };
    const onReattach = vi.fn();
    const handler = createDockPopoutMessageHandler({
      getEntry: () => entry,
      setEntry: (next) => {
        entry = next;
      },
      getPayload: () => PAYLOAD,
      onReattach,
    });
    handler({ data: { type: "closed" } } as MessageEvent);
    expect(onReattach).toHaveBeenCalledTimes(1);

    // Simulate a racing "bring back" tearing this tab's bookkeeping down —
    // a later message on the SAME (now-stale) channel object must be a
    // total no-op, never touching onReattach or postMessage again.
    entry = undefined;
    handler({ data: { type: "ready" } } as MessageEvent);
    handler({ data: { type: "closed" } } as MessageEvent);
    expect(onReattach).toHaveBeenCalledTimes(1);
    expect(channel.posted).toEqual([]);
  });

  it("ignores garbage / unparseable messages without throwing", () => {
    const channel = makeSpyChannel();
    const handler = createDockPopoutMessageHandler({
      getEntry: () => ({ channel, handshake: INITIAL_DOCK_HANDSHAKE_STATE }),
      setEntry: () => {},
      getPayload: () => PAYLOAD,
      onReattach: vi.fn(),
    });
    expect(() => handler({ data: "not a message" } as unknown as MessageEvent)).not.toThrow();
    expect(channel.posted).toEqual([]);
  });

  // ── Flow C: buffer-reply stashed, applied on the closed that follows ──────
  // (design §4 — the popped window pushes its buffer unprompted, immediately
  // before its own "closed", when the user just closes the window rather
  // than clicking "Bring back".)

  describe("Flow C — buffer-reply then closed", () => {
    it("stashes buffer-reply without reattaching, then applies it when closed arrives", () => {
      const channel = makeSpyChannel();
      let entry: DockPopoutEntry | undefined = { channel, handshake: "payload-sent" };
      const onReattach = vi.fn();
      const handler = createDockPopoutMessageHandler({
        getEntry: () => entry,
        setEntry: (next) => {
          entry = next;
        },
        getPayload: () => PAYLOAD,
        onReattach,
      });

      handler({ data: { type: "buffer-reply", buffer: BUFFER } } as MessageEvent);
      expect(onReattach).not.toHaveBeenCalled(); // stash only — not a reattach signal by itself
      expect(entry?.pendingBuffer).toEqual(BUFFER);

      handler({ data: { type: "closed" } } as MessageEvent);
      expect(onReattach).toHaveBeenCalledTimes(1);
      expect(onReattach).toHaveBeenCalledWith(BUFFER);
    });

    it("closed with no prior buffer-reply reattaches with null — today's path (old window, failed serialize, or hand-off timeout)", () => {
      const channel = makeSpyChannel();
      let entry: DockPopoutEntry | undefined = { channel, handshake: "payload-sent" };
      const onReattach = vi.fn();
      const handler = createDockPopoutMessageHandler({
        getEntry: () => entry,
        setEntry: (next) => {
          entry = next;
        },
        getPayload: () => PAYLOAD,
        onReattach,
      });

      handler({ data: { type: "closed" } } as MessageEvent);
      expect(onReattach).toHaveBeenCalledWith(null);
    });

    it("a malformed buffer-reply is dropped entirely — never stashed, closed still reattaches with null", () => {
      const channel = makeSpyChannel();
      let entry: DockPopoutEntry | undefined = { channel, handshake: "payload-sent" };
      const onReattach = vi.fn();
      const handler = createDockPopoutMessageHandler({
        getEntry: () => entry,
        setEntry: (next) => {
          entry = next;
        },
        getPayload: () => PAYLOAD,
        onReattach,
      });

      handler({ data: { type: "buffer-reply", buffer: { data: "ok" } } } as MessageEvent);
      expect(entry?.pendingBuffer).toBeUndefined();

      handler({ data: { type: "closed" } } as MessageEvent);
      expect(onReattach).toHaveBeenCalledWith(null);
    });
  });
});

// ── client-side handshake driver, in isolation (fake timers) ───────────────

describe("startPopoutClientHandshake", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces ready immediately, then keeps retrying on the interval until a payload arrives", () => {
    const channel = makeSpyChannel();
    const onPayload = vi.fn();
    const onTimeout = vi.fn();
    startPopoutClientHandshake({ channel, onPayload, onTimeout });

    expect(channel.posted).toEqual([{ type: "ready" }]);

    vi.advanceTimersByTime(POPOUT_READY_RETRY_MS);
    expect(channel.posted).toEqual([{ type: "ready" }, { type: "ready" }]);

    vi.advanceTimersByTime(POPOUT_READY_RETRY_MS);
    expect(channel.posted.length).toBe(3);

    // The payload lands (dock replying on the shared channel) — retries stop.
    channel.onmessage?.({ data: { type: "payload", payload: PAYLOAD } } as MessageEvent);
    expect(onPayload).toHaveBeenCalledWith(PAYLOAD);

    const postedBeforeMoreTime = channel.posted.length;
    vi.advanceTimersByTime(POPOUT_READY_RETRY_MS * 5);
    expect(channel.posted.length).toBe(postedBeforeMoreTime); // no more readies posted
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("gives up after the timeout, posts closed (so a listening dock auto-reattaches instead of staying stuck), and stops retrying", () => {
    const channel = makeSpyChannel();
    const onPayload = vi.fn();
    const onTimeout = vi.fn();
    startPopoutClientHandshake({ channel, onPayload, onTimeout });

    vi.advanceTimersByTime(POPOUT_HANDOFF_TIMEOUT_MS + 250);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onPayload).not.toHaveBeenCalled();
    expect(channel.posted[channel.posted.length - 1]).toEqual({ type: "closed" });

    const postedAtTimeout = channel.posted.length;
    vi.advanceTimersByTime(POPOUT_READY_RETRY_MS * 5);
    expect(channel.posted.length).toBe(postedAtTimeout); // fully stopped, no zombie retries
  });

  it("stop() tears down both timers silently (StrictMode-safe — no closed/ready leak on an ordinary unmount)", () => {
    const channel = makeSpyChannel();
    const stop = startPopoutClientHandshake({ channel, onPayload: vi.fn(), onTimeout: vi.fn() });
    const postedAtStart = channel.posted.length;
    stop();
    vi.advanceTimersByTime(POPOUT_HANDOFF_TIMEOUT_MS + 1000);
    expect(channel.posted.length).toBe(postedAtStart); // nothing more posted, ever
  });
});

// ── dock-side bring-back driver, in isolation (fake timers) — Flow B ───────

describe("startBringBackRequest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts bring-back-request immediately", () => {
    const channel = makeSpyChannel();
    startBringBackRequest({ channel, onSettle: vi.fn() });
    expect(channel.posted).toEqual([{ type: "bring-back-request" }]);
  });

  it("settles with the buffer the moment a buffer-reply arrives, before the timeout", () => {
    const channel = makeSpyChannel();
    const onSettle = vi.fn();
    startBringBackRequest({ channel, onSettle });

    vi.advanceTimersByTime(BRING_BACK_REPLY_TIMEOUT_MS - 50);
    channel.onmessage?.({ data: { type: "buffer-reply", buffer: BUFFER } } as MessageEvent);

    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith(BUFFER);

    // The timeout firing afterwards must be a total no-op — settle already happened.
    vi.advanceTimersByTime(BRING_BACK_REPLY_TIMEOUT_MS * 2);
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it("settles with null after the timeout when no reply ever arrives (D3's deliberate fallback)", () => {
    const channel = makeSpyChannel();
    const onSettle = vi.fn();
    startBringBackRequest({ channel, onSettle });

    vi.advanceTimersByTime(BRING_BACK_REPLY_TIMEOUT_MS);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith(null);
  });

  it("ignores a reply that arrives AFTER the timeout already settled — a late reply can never clobber the fallback", () => {
    const channel = makeSpyChannel();
    const onSettle = vi.fn();
    startBringBackRequest({ channel, onSettle });

    vi.advanceTimersByTime(BRING_BACK_REPLY_TIMEOUT_MS);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith(null);

    // A stray late buffer-reply (e.g. the popped window was just slow, not
    // dead) must not fire onSettle a second time.
    channel.onmessage?.({ data: { type: "buffer-reply", buffer: BUFFER } } as MessageEvent);
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it("ignores every non-buffer-reply message while waiting", () => {
    const channel = makeSpyChannel();
    const onSettle = vi.fn();
    startBringBackRequest({ channel, onSettle });

    channel.onmessage?.({ data: { type: "ready" } } as MessageEvent);
    channel.onmessage?.({ data: { type: "closed" } } as MessageEvent);
    channel.onmessage?.({ data: "garbage" } as unknown as MessageEvent);
    expect(onSettle).not.toHaveBeenCalled();

    channel.onmessage?.({ data: { type: "buffer-reply", buffer: BUFFER } } as MessageEvent);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith(BUFFER);
  });

  it("cancel() stops the timer and settles nothing — for an ordinary unmount, not a failure", () => {
    const channel = makeSpyChannel();
    const onSettle = vi.fn();
    const cancel = startBringBackRequest({ channel, onSettle });
    cancel();
    vi.advanceTimersByTime(BRING_BACK_REPLY_TIMEOUT_MS * 2);
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("a postMessage failure (channel already gone) doesn't prevent the timeout fallback from still firing", () => {
    const channel = makeSpyChannel();
    channel.postMessage = () => {
      throw new Error("channel closed");
    };
    const onSettle = vi.fn();
    startBringBackRequest({ channel, onSettle });
    vi.advanceTimersByTime(BRING_BACK_REPLY_TIMEOUT_MS);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith(null);
  });
});

// ── end-to-end over a shared channel bus — reproduces the field failure ────
//
// A minimal same-origin `BroadcastChannel` model: `postMessage` delivers
// SYNCHRONOUSLY to whichever OTHER channels already exist on the bus at call
// time — a channel created AFTER a message was posted simply never sees it,
// exactly like the real API (messages are never queued for a not-yet-open
// channel). This is enough to model the general fragility class the field
// failure belongs to: "the very first message on a fresh channel can be
// lost" — regardless of whether the real-world cause was Brave's
// privacy/storage isolation for a `noopener` popup, an ordinary scheduling
// race, or something else entirely. That exact browser-level mechanism is
// NOT reproducible here (see the root-cause write-up) — what IS reproducible,
// and what this section pins, is that the shipped one-shot design had zero
// recovery from that loss, and the reworked retry-based design does.

function createMockBroadcastBus() {
  const channels = new Set<PopoutChannelLike>();
  function createChannel(): PopoutChannelLike {
    const self: PopoutChannelLike = {
      onmessage: null,
      postMessage(data: unknown) {
        for (const other of channels) {
          if (other === self) continue;
          other.onmessage?.({ data } as MessageEvent);
        }
      },
      close() {
        channels.delete(self);
      },
    };
    channels.add(self);
    return self;
  }
  return { createChannel };
}

describe("end-to-end hand-off over a shared channel bus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("completes normally when the dock is already listening before the client announces ready (the common case)", () => {
    const bus = createMockBroadcastBus();
    const dockChannel = bus.createChannel();
    let dockEntry: { channel: PopoutChannelLike; handshake: DockHandshakeState } | undefined = {
      channel: dockChannel,
      handshake: INITIAL_DOCK_HANDSHAKE_STATE,
    };
    dockChannel.onmessage = createDockPopoutMessageHandler({
      getEntry: () => dockEntry,
      setEntry: (next) => {
        dockEntry = next;
      },
      getPayload: () => PAYLOAD,
      onReattach: vi.fn(),
    });

    const clientChannel = bus.createChannel();
    const onPayload = vi.fn();
    startPopoutClientHandshake({ channel: clientChannel, onPayload, onTimeout: vi.fn() });

    expect(onPayload).toHaveBeenCalledWith(PAYLOAD);
  });

  it("REPRODUCES the shipped bug: a one-shot ready posted before the dock exists is lost forever, and the hand-off times out with no recovery", () => {
    const bus = createMockBroadcastBus();

    // The popped window wins the race and (as terminal-popout-client.tsx
    // shipped) posts its ONE-SHOT "ready" before the dock has created its
    // channel yet.
    const clientChannel = bus.createChannel();
    clientChannel.postMessage({ type: "ready" });

    // The dock catches up moments later and starts listening — exactly like
    // the old inline handler in terminal-dock.tsx's handlePopOut.
    const dockChannel = bus.createChannel();
    let dockEntry: { channel: PopoutChannelLike; handshake: DockHandshakeState } | undefined = {
      channel: dockChannel,
      handshake: INITIAL_DOCK_HANDSHAKE_STATE,
    };
    dockChannel.onmessage = createDockPopoutMessageHandler({
      getEntry: () => dockEntry,
      setEntry: (next) => {
        dockEntry = next;
      },
      getPayload: () => PAYLOAD,
      onReattach: vi.fn(),
    });

    // The one-shot ready is already gone (delivered to nobody, since the
    // dock's channel didn't exist yet) — under the OLD design nothing else
    // is EVER posted, so the dock never sends a payload...
    expect(dockEntry?.handshake).toBe("waiting-for-ready");

    // ...and the popped window's own 5s timer (modelled directly here,
    // matching the OLD terminal-popout-client.tsx's setInterval+
    // hasPopoutHandoffTimedOut poll) fires with nothing ever having arrived
    // — "Lost the session hand-off", exactly as seen in the field.
    const startedAt = Date.now();
    vi.advanceTimersByTime(POPOUT_HANDOFF_TIMEOUT_MS + 250);
    expect(hasPopoutHandoffTimedOut(startedAt, Date.now())).toBe(true);
    expect(dockEntry?.handshake).toBe("waiting-for-ready"); // still never heard from
  });

  it("FIX: the same lost-first-message race self-heals via the client's retry loop, once the dock is listening", () => {
    const bus = createMockBroadcastBus();

    // Same race as above: the client's channel exists and (this time via
    // startPopoutClientHandshake) posts its first "ready" immediately —
    // before the dock's channel exists, so that first one is still lost.
    const clientChannel = bus.createChannel();
    const onPayload = vi.fn();
    startPopoutClientHandshake({ channel: clientChannel, onPayload, onTimeout: vi.fn() });

    // Confirm it really was lost — nobody was listening for it.
    expect(onPayload).not.toHaveBeenCalled();

    // The dock now comes online (still well within the 5s window).
    const dockChannel = bus.createChannel();
    let dockEntry: { channel: PopoutChannelLike; handshake: DockHandshakeState } | undefined = {
      channel: dockChannel,
      handshake: INITIAL_DOCK_HANDSHAKE_STATE,
    };
    dockChannel.onmessage = createDockPopoutMessageHandler({
      getEntry: () => dockEntry,
      setEntry: (next) => {
        dockEntry = next;
      },
      getPayload: () => PAYLOAD,
      onReattach: vi.fn(),
    });

    // Advance past ONE retry interval — the client's next "ready" announcement
    // reaches the now-live dock, which replies with the payload immediately.
    vi.advanceTimersByTime(POPOUT_READY_RETRY_MS + 10);

    expect(onPayload).toHaveBeenCalledWith(PAYLOAD);
    expect(dockEntry?.handshake).toBe("payload-sent");
  });

  it("FIX: also self-heals when it's the PAYLOAD (not the ready) that gets lost — a retried ready still gets a fresh send", () => {
    const bus = createMockBroadcastBus();
    const dockChannel = bus.createChannel();
    let dockEntry: { channel: PopoutChannelLike; handshake: DockHandshakeState } | undefined = {
      channel: dockChannel,
      handshake: INITIAL_DOCK_HANDSHAKE_STATE,
    };
    const dockHandler = createDockPopoutMessageHandler({
      getEntry: () => dockEntry,
      setEntry: (next) => {
        dockEntry = next;
      },
      getPayload: () => PAYLOAD,
      onReattach: vi.fn(),
    });

    const clientChannel = bus.createChannel();
    const onPayload = vi.fn();
    startPopoutClientHandshake({ channel: clientChannel, onPayload, onTimeout: vi.fn() });
    // The client's immediate "ready" was delivered (dock channel existed
    // first here) — but pretend the dock's FIRST reply payload never made it
    // back (e.g. the client's listener wasn't wired up yet on its end, or
    // any other transient loss) by wiring the dock's onmessage only AFTER
    // that first exchange.
    dockChannel.onmessage = dockHandler;
    expect(onPayload).not.toHaveBeenCalled(); // that first round-trip is gone

    // The client's retry loop announces "ready" again — this time the dock
    // IS listening, and under the new idempotent reducer it happily resends.
    vi.advanceTimersByTime(POPOUT_READY_RETRY_MS + 10);
    expect(onPayload).toHaveBeenCalledWith(PAYLOAD);
  });
});
