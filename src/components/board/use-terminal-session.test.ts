// Behavioural regression net for the pure refactor that extracted
// use-terminal-session.ts out of terminal-dock.tsx (multi-session stage 1). These
// tests exercise the hook's session mechanics — mint → open → data → connected,
// read-only gating, user-end, mint failure, and the grace-window reconnect — via a
// mocked fetch + WebSocket, standing in for terminal-dock.tsx's previous inline
// tests-by-manual-verification of the same paths. connection.ts's OWN pure logic
// (terminalReducer, mapCloseCode, decideResize, …) is unit-tested independently in
// connection.test.ts and is NOT re-tested here — this file is about the wiring.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  useTerminalSession,
  type AttachExistingPair,
  type TerminalSessionDescriptor,
} from "./use-terminal-session";
import { isSameOwnerPreemptedClose, RECONNECT_GRACE_MS } from "@/lib/terminal/connection";

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
// Tracks every mock Terminal instance created — used by the scrollback
// transfer tests below to inspect reset()/write() calls, the same way
// `mockSockets` tracks WebSockets. `vi.hoisted` because the mock factory
// (itself hoisted above this file's other statements) needs a live
// reference to push into.
const mockTerminals = vi.hoisted(() => [] as { written: string[]; resetCount: number }[]);
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    written: string[] = [];
    resetCount = 0;
    buffer = { active: { length: 0 } };
    constructor() {
      mockTerminals.push(this);
    }
    onData() {}
    open() {}
    loadAddon(addon: { activate: (term: unknown) => void }) {
      addon.activate(this);
    }
    write(data: string) {
      this.written.push(data);
    }
    clear() {}
    reset() {
      this.resetCount += 1;
    }
    focus() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    activate() {}
    dispose() {}
    fit() {}
  },
}));
// scrollback-transfer.ts's own real serialize/restore logic is unit-tested
// in its own test file (mocking the addon there, since the addon reaches
// into a real xterm Terminal's internals). Here it's mocked with a tiny fake
// so the HOOK WIRING (attachExisting.initialBuffer, serializeNow/restoreBuffer)
// can be exercised against the plain mock Terminal above without either
// needing to satisfy the real addon's internals.
vi.mock("@xterm/addon-serialize", () => ({
  SerializeAddon: class {
    private term: { written: string[] } | null = null;
    activate(term: { written: string[] }) {
      this.term = term;
    }
    dispose() {}
    serialize() {
      return (this.term?.written ?? []).join("");
    }
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

// ── mock WebSocket ────────────────────────────────────────────────────────────
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  binaryType = "";
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: unknown[] = [];

  constructor(url: string) {
    this.url = url;
    mockSockets.push(this);
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  // test helpers — simulate the relay's side of the protocol
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }

  simulateBinaryMessage(bytes: Uint8Array = new Uint8Array([1, 2, 3])) {
    this.onmessage?.({ data: bytes.buffer });
  }

  simulateAbnormalDrop() {
    // A real drop never calls close() first — the socket just dies. Mirror that:
    // set CLOSED and fire onclose directly with an abnormal code, bypassing our
    // own close() (which the dock's own teardown uses and would look identical).
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1006, reason: "" });
  }
}

let mockSockets: MockWebSocket[] = [];
function latestSocket(): MockWebSocket {
  const s = mockSockets[mockSockets.length - 1];
  if (!s) throw new Error("no WebSocket was constructed");
  return s;
}

function latestTerminal(): { written: string[]; resetCount: number } {
  const t = mockTerminals[mockTerminals.length - 1];
  if (!t) throw new Error("no Terminal was constructed");
  return t;
}

const descriptor: TerminalSessionDescriptor = {
  ideaId: "idea-1",
  ideaTitle: "Recipe Saver",
  ideaGithubUrl: null,
};

function mintResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true,
    json: async () => ({
      sessionId: "sid-abc123",
      browserToken: "browser-token",
      bridgeToken: "bridge-token",
      expiresAt: Date.now() + 300_000,
      ...overrides,
    }),
  };
}

describe("useTerminalSession", () => {
  beforeEach(() => {
    mockSockets = [];
    mockTerminals.length = 0;
    toastError.mockClear();
    toastSuccess.mockClear();
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("fetch", vi.fn(async () => mintResponse()));
    // jsdom doesn't implement ResizeObserver. Every OTHER test in this file
    // never actually attaches a DOM node to containerRef (renderHook doesn't
    // render the consumer's <div ref={containerRef}/> for it), so the hook's
    // resize-observer effect (gated on `containerRef.current`) never used to
    // fire — the scrollback transfer tests below are the first to attach a
    // real container, so they're also the first to reach this code path.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function setup(expanded = true) {
    const requestExpand = vi.fn();
    const utils = renderHook(() =>
      useTerminalSession(descriptor, { enabled: true, expanded, requestExpand }),
    );
    return { ...utils, requestExpand };
  }

  it("starts idle with no pair and read-write input", () => {
    const { result } = setup();
    expect(result.current.state.status).toBe("idle");
    expect(result.current.pair).toBeNull();
    expect(result.current.readOnly).toBe(false);
    expect(result.current.inputEnabled).toBe(false); // not connected yet
  });

  it("connect() mints a session, opens the browser leg, and reaches connected on first byte", async () => {
    const { result, requestExpand } = setup();

    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });

    expect(requestExpand).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/terminal/session",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ ideaId: "idea-1" }) }),
    );
    expect(result.current.pair).toEqual({
      sessionId: "sid-abc123",
      bridgeToken: "bridge-token",
      browserToken: "browser-token",
    });
    // buildRelayUrl shape: <base>/?session=<sid>&role=browser&token=<token>
    expect(latestSocket().url).toBe(
      "ws://127.0.0.1:8787/?session=sid-abc123&role=browser&token=browser-token",
    );

    act(() => latestSocket().simulateOpen());
    expect(result.current.state.status).toBe("waiting-to-pair");

    act(() => latestSocket().simulateBinaryMessage());
    expect(result.current.state.status).toBe("connected");
    expect(result.current.inputEnabled).toBe(true);
    // First successful byte marks this browser paired (install-first gate, #87).
    expect(window.localStorage.getItem("vibecodes:terminal:paired-v1")).toBe("1");
  });

  it("helperVersion starts null and picks up a bridge-version control frame (release-gate rework 2a)", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });
    expect(result.current.helperVersion).toBeNull();

    act(() => latestSocket().simulateOpen());
    act(() => {
      latestSocket().onmessage?.({ data: JSON.stringify({ t: "bridge-version", v: "0.2.0" }) });
    });
    expect(result.current.helperVersion).toBe("0.2.0");

    // A malformed `v` must never regress a known-good value back to unknown.
    act(() => {
      latestSocket().onmessage?.({ data: JSON.stringify({ t: "bridge-version", v: 123 }) });
    });
    expect(result.current.helperVersion).toBe("0.2.0");
  });

  it("helperVersion resets to null on a fresh connect() (a new mint may pair with a different bridge)", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });
    act(() => latestSocket().simulateOpen());
    act(() => {
      latestSocket().onmessage?.({ data: JSON.stringify({ t: "bridge-version", v: "0.2.0" }) });
    });
    expect(result.current.helperVersion).toBe("0.2.0");

    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });
    expect(result.current.helperVersion).toBeNull();
  });

  it("PATCHes the announced conv id onto the registry row, once per session (exact-conversation Resume, rework 5)", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });
    act(() => latestSocket().simulateOpen());
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    const conv = "99999999-8888-7777-6666-555555555555";
    act(() => {
      latestSocket().onmessage?.({ data: JSON.stringify({ t: "bridge-version", conv }) });
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/terminal/session/sid-abc123",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ claudeSessionId: conv }),
        }),
      );
    });

    // Re-announcing the SAME id on a later frame (e.g. a grace-window
    // reconnect) must not re-fire the PATCH — once-per-session, mirroring
    // the machine-identity guard.
    fetchMock.mockClear();
    act(() => {
      latestSocket().onmessage?.({ data: JSON.stringify({ t: "bridge-version", conv }) });
    });
    expect(fetchMock).not.toHaveBeenCalledWith("/api/terminal/session/sid-abc123", expect.anything());
  });

  it("does not PATCH a malformed conv id (non-UUID) — never forwarded to the registry", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });
    act(() => latestSocket().simulateOpen());
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    act(() => {
      latestSocket().onmessage?.({ data: JSON.stringify({ t: "bridge-version", conv: "not-a-uuid" }) });
    });
    expect(fetchMock).not.toHaveBeenCalledWith("/api/terminal/session/sid-abc123", expect.anything());
  });

  it("read-only gates inputEnabled while connected, independent of status", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });
    act(() => latestSocket().simulateOpen());
    act(() => latestSocket().simulateBinaryMessage());
    expect(result.current.inputEnabled).toBe(true);

    act(() => result.current.actions.setReadOnly(true));
    expect(result.current.readOnly).toBe(true);
    expect(result.current.inputEnabled).toBe(false);

    act(() => result.current.actions.setReadOnly(false));
    expect(result.current.inputEnabled).toBe(true);
  });

  it("end() closes the socket with a user-end reason and reaches session-ended", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });
    act(() => latestSocket().simulateOpen());
    act(() => latestSocket().simulateBinaryMessage());

    const ws = latestSocket();
    const closeSpy = vi.spyOn(ws, "close");
    act(() => result.current.actions.end());

    expect(closeSpy).toHaveBeenCalledWith(1000, "user-end");
    expect(result.current.state.status).toBe("session-ended");
    expect(result.current.state.endedReason).toBe("user");
  });

  it("a mint failure dispatches session-mint-failed and toasts, without opening a socket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) })),
    );
    const { result } = setup();

    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });

    expect(result.current.state.status).toBe("error");
    expect(result.current.state.errorKind).toBe("session-mint-failed");
    expect(result.current.pair).toBeNull();
    expect(toastError).toHaveBeenCalled();
    expect(mockSockets).toHaveLength(0);
  });

  it("forwards taskId/taskTitle on mint when provided (C1)", async () => {
    const fetchMock = vi.fn(async () => mintResponse());
    vi.stubGlobal("fetch", fetchMock);
    const requestExpand = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSession(descriptor, {
        enabled: true,
        expanded: true,
        requestExpand,
        taskId: "task-1",
        taskTitle: "Fix login",
      }),
    );
    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/terminal/session",
      expect.objectContaining({
        body: JSON.stringify({ ideaId: "idea-1", taskId: "task-1", taskTitle: "Fix login" }),
      }),
    );
  });

  it("a 409 cap refusal shows the server's copy, fires the onCapExceeded callback, and never opens a socket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({
          error: "You already have 5 terminals running — end one to start another.",
          code: "cap_exceeded",
          cap: 5,
          active: [],
        }),
      })),
    );
    const onCapExceeded = vi.fn();
    const requestExpand = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSession(descriptor, { enabled: true, expanded: true, requestExpand, onCapExceeded }),
    );

    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });

    expect(result.current.state.status).toBe("error");
    expect(mockSockets).toHaveLength(0);
    expect(toastError).toHaveBeenCalled();
    const [title, opts] = toastError.mock.calls[0];
    expect(title).toContain("You already have 5 terminals running");
    expect(opts?.action?.label).toBe("View my sessions");
    opts.action.onClick();
    expect(onCapExceeded).toHaveBeenCalled();
  });

  it("a 429 rate-limit refusal shows distinct copy with no action button and never mentions ending a session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 429,
        json: async () => ({
          error: "You're starting terminals too fast — wait a moment and try again.",
          code: "rate_limited",
        }),
      })),
    );
    const onCapExceeded = vi.fn();
    const requestExpand = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSession(descriptor, { enabled: true, expanded: true, requestExpand, onCapExceeded }),
    );

    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });

    expect(result.current.state.status).toBe("error");
    expect(toastError).toHaveBeenCalledWith("You're starting terminals too fast — wait a moment and try again.");
    expect(onCapExceeded).not.toHaveBeenCalled();
  });

  it("a 429 daily-relay-budget refusal (MITIGATION 3) shows distinct copy with no action button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 429,
        json: async () => ({
          error:
            "Terminal relay is near its free daily capacity — existing sessions keep running; new sessions available after midnight UTC.",
          code: "daily_relay_budget",
        }),
      })),
    );
    const onCapExceeded = vi.fn();
    const requestExpand = vi.fn();
    const { result } = renderHook(() =>
      useTerminalSession(descriptor, { enabled: true, expanded: true, requestExpand, onCapExceeded }),
    );

    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });

    expect(result.current.state.status).toBe("error");
    expect(mockSockets).toHaveLength(0);
    expect(toastError).toHaveBeenCalledWith(
      "Terminal relay is near its free daily capacity — existing sessions keep running; new sessions available after midnight UTC.",
    );
    expect(onCapExceeded).not.toHaveBeenCalled();
  });

  it("end() fire-and-forgets a POST to /api/terminal/session/end with the sid (C3 registry truth)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/terminal/session/end") return { ok: true, json: async () => ({ results: [] }) };
      return mintResponse();
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = setup();
    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });
    act(() => latestSocket().simulateOpen());
    act(() => latestSocket().simulateBinaryMessage());

    act(() => result.current.actions.end());

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/terminal/session/end",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sid: "sid-abc123" }),
      }),
    );
  });

  it("an abnormal drop after a live stream reattaches within the grace window (same sid, no re-mint)", async () => {
    vi.useFakeTimers();
    const { result } = setup();
    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });
    act(() => latestSocket().simulateOpen());
    act(() => latestSocket().simulateBinaryMessage());
    expect(result.current.state.status).toBe("connected");

    act(() => latestSocket().simulateAbnormalDrop());
    expect(result.current.state.status).toBe("disconnected");
    expect(mockSockets).toHaveLength(1); // no reattach socket yet — backoff pending

    // First backoff attempt fires at ~1000ms + up to 250ms jitter.
    await act(async () => {
      vi.advanceTimersByTime(1300);
    });
    expect(mockSockets).toHaveLength(2);
    expect(latestSocket().url).toContain("session=sid-abc123");
    expect(latestSocket().url).toContain("token=browser-token"); // retained token, no re-mint
    expect(global.fetch).toHaveBeenCalledTimes(1); // still just the original mint

    act(() => latestSocket().simulateBinaryMessage());
    expect(result.current.state.status).toBe("connected");
  });

  it("reconnect-exhausted (grace window spent) ends the session honestly, not as an error", async () => {
    vi.useFakeTimers();
    const { result } = setup();
    await act(async () => {
      await result.current.actions.connect({ autoLaunch: false });
    });
    act(() => latestSocket().simulateOpen());
    act(() => latestSocket().simulateBinaryMessage());
    act(() => latestSocket().simulateAbnormalDrop());

    // Exhaust the 90s grace window; the reconnect loop keeps reattaching (each new
    // socket immediately drops again) until the deadline passes. Backoff is capped
    // at 8s/attempt, so ~12 attempts comfortably clears the 90s window.
    await act(async () => {
      for (let i = 0; i < 16 && result.current.state.status !== "session-ended"; i++) {
        vi.advanceTimersByTime(12_000);
        const ws = mockSockets[mockSockets.length - 1];
        if (ws.readyState !== MockWebSocket.CLOSED) ws.simulateAbnormalDrop();
      }
    });

    expect(result.current.state.status).toBe("session-ended");
    expect(result.current.state.endedReason).toBe("reconnect-failed");
  });

  // Multi-session stage 2: `autoConnectWhenExpanded` stops a freshly-minted tab
  // (mounted with `expanded` already true, delivering its own explicit launch in
  // the same tick) from ALSO tripping the paired-auto-connect effect and minting
  // a second, orphaned session. Requires a "supported" platform + a pre-paired
  // browser, so these two stub navigator to a Mac UA.
  describe("autoConnectWhenExpanded", () => {
    const macUserAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

    beforeEach(() => {
      vi.stubGlobal("navigator", { userAgent: macUserAgent, maxTouchPoints: 0 });
      window.localStorage.setItem("vibecodes:terminal:paired-v1", "1");
    });

    it("auto-connects a paired, expanded, idle instance by default (unchanged P1 behaviour)", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, { enabled: true, expanded: true, requestExpand }),
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(global.fetch).toHaveBeenCalled();
      expect(result.current.state.status).not.toBe("idle");
    });

    it("does NOT auto-connect when autoConnectWhenExpanded is false (a freshly-minted tab)", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
        }),
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(global.fetch).not.toHaveBeenCalled();
      expect(result.current.state.status).toBe("idle");
    });
  });

  async function flushEffects() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  // Multi-session stage 4 (D1/D2, popout-channel.ts): the popped-out window's
  // whole entry point — attach to an ALREADY-MINTED session with no mint, no
  // deep link, no install-first gate.
  describe("attachExisting", () => {
    it("attaches directly to the transferred sid/browserToken — no mint, no deep link", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: { sessionId: "sid-popped", browserToken: "popped-browser-token" },
        }),
      );

      await flushEffects();

      // No mint round-trip at all — the whole point of attaching.
      expect(global.fetch).not.toHaveBeenCalled();
      expect(result.current.state.status).toBe("connecting");
      expect(result.current.pair).toEqual({
        sessionId: "sid-popped",
        browserToken: "popped-browser-token",
      });
      expect(latestSocket().url).toBe(
        "ws://127.0.0.1:8787/?session=sid-popped&role=browser&token=popped-browser-token",
      );

      act(() => latestSocket().simulateOpen());
      expect(result.current.state.status).toBe("waiting-to-pair");

      act(() => latestSocket().simulateBinaryMessage());
      expect(result.current.state.status).toBe("connected");
      expect(result.current.inputEnabled).toBe(true);
    });

    it("reports the relay's 4001 preempted close via closeCode, distinct from every other close", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: { sessionId: "sid-popped", browserToken: "popped-browser-token" },
        }),
      );
      await flushEffects();
      act(() => latestSocket().simulateOpen());
      act(() => latestSocket().simulateBinaryMessage());
      expect(result.current.state.status).toBe("connected");

      // The relay's DUP_BROWSER close — a "Bring back to dock" reattach
      // preempted THIS window's leg.
      act(() => latestSocket().close(4001, ""));
      expect(result.current.state.status).toBe("error");
      expect(result.current.state.errorKind).toBe("duplicate");
      expect(result.current.state.closeCode).toBe(4001);
    });

    // Card cbe60db5 rework 6: the SAME 4001 close, but with the relay's
    // same-owner PREEMPTION reason — the embedded dock's discriminator
    // (isSameOwnerPreemptedClose) needs this to render the calm "taken over"
    // state instead of the generic duplicate-session error (see
    // terminal-session-view.tsx / connection.ts for where it's consumed).
    it("carries the relay's preempted close REASON through onclose, not just the code", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: { sessionId: "sid-popped", browserToken: "popped-browser-token" },
        }),
      );
      await flushEffects();
      act(() => latestSocket().simulateOpen());
      act(() => latestSocket().simulateBinaryMessage());
      expect(result.current.state.status).toBe("connected");

      act(() => latestSocket().close(4001, "preempted"));
      expect(result.current.state.status).toBe("error");
      expect(result.current.state.closeCode).toBe(4001);
      expect(result.current.state.closeReason).toBe("preempted");
      expect(isSameOwnerPreemptedClose(result.current.state.closeCode, result.current.state.closeReason)).toBe(true);
    });

    it("only attaches once per distinct transferred sessionId — a stable object on a later render is a no-op", async () => {
      const requestExpand = vi.fn();
      const attachExisting = { sessionId: "sid-popped", browserToken: "popped-browser-token" };
      const { rerender } = renderHook(
        (props: { attachExisting: typeof attachExisting | null }) =>
          useTerminalSession(descriptor, {
            enabled: true,
            expanded: true,
            requestExpand,
            autoConnectWhenExpanded: false,
            attachExisting: props.attachExisting,
          }),
        { initialProps: { attachExisting } },
      );
      await flushEffects();
      expect(mockSockets).toHaveLength(1);

      rerender({ attachExisting: { ...attachExisting } }); // same sessionId, new object identity
      await flushEffects();
      expect(mockSockets).toHaveLength(1); // no second socket opened
    });

    // Card cbe60db5-followup / reconnect-relaunch fix: every OTHER test above
    // mounts the hook with `attachExisting` already populated in
    // `initialProps` — that's the popped-out window's shape (a fresh
    // component instance whose payload arrives async but before this
    // effect's first run), not the dock's own "My sessions"/chooser Reconnect
    // shape. There, the SAME already-mounted tab slot gets its `attach` field
    // set on a LATER render (terminal-dock.tsx's pristine-slot-reuse,
    // `performReattach` around lines 781-796) — `attachExisting` starts out
    // `null`/absent and flips to a real pair well after mount. This test
    // exercises THAT transition directly, confirming the effect still fires
    // (and the watchdog still arms) rather than assuming the dedupe test
    // above already covers it.
    it("attaches when attachExisting flips from null to populated on a LATER render (the real pristine-slot-reuse transition, not an already-populated mount)", async () => {
      vi.useFakeTimers();
      const requestExpand = vi.fn();
      const { result, rerender } = renderHook(
        (props: { attachExisting: AttachExistingPair | null }) =>
          useTerminalSession(descriptor, {
            enabled: true,
            expanded: true,
            requestExpand,
            autoConnectWhenExpanded: false,
            attachExisting: props.attachExisting,
          }),
        { initialProps: { attachExisting: null as AttachExistingPair | null } },
      );

      // Mounted with nothing to attach to yet — an idle pristine slot.
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.state.status).toBe("idle");
      expect(mockSockets).toHaveLength(0);

      // The dock reuses THIS SAME slot for a reattach — attachExisting flips
      // null → populated on a later render of the SAME hook instance.
      rerender({ attachExisting: { sessionId: "sid-late", browserToken: "late-browser-token" } });
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.state.status).toBe("connecting");
      expect(result.current.pair).toEqual({ sessionId: "sid-late", browserToken: "late-browser-token" });
      expect(mockSockets).toHaveLength(1);
      expect(latestSocket().url).toBe(
        "ws://127.0.0.1:8787/?session=sid-late&role=browser&token=late-browser-token",
      );

      act(() => latestSocket().simulateOpen());
      expect(result.current.state.status).toBe("waiting-to-pair");

      // The watchdog must still arm for this transition, exactly like the
      // already-mounted-populated case (see the "pairing watchdog" describe
      // below) — a bridge that never shows up still surfaces pairingTimedOut.
      await act(async () => {
        vi.advanceTimersByTime(RECONNECT_GRACE_MS + 1000);
      });
      expect(result.current.pairingTimedOut).toBe(true);
    });

    // Reconnect-relaunch fix (the bug this file's suite name references): a
    // reattach whose pair carries a bridgeToken (the reattach route now
    // mints one — /api/terminal/session/reattach) means a real Reconnect,
    // not a popped-out window's hand-off. attachToExisting must fire the
    // SAME vibecodes:// deep link connect({autoLaunch:true}) fires for a
    // fresh mint, or the local helper (which auto-quits when idle) never
    // gets told to come back and the session waits forever.
    it("fires the vibecodes:// deep link when the attach pair carries a bridgeToken (Reconnect actually relaunches the helper)", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: {
            sessionId: "sid-reconnect",
            browserToken: "reconnect-browser-token",
            bridgeToken: "reconnect-bridge-token",
            helperToken: "reconnect-helper-token",
          },
        }),
      );
      // Squashed-reattach fix (task 6ac2cd44): the deep link is now deferred
      // until xterm has actually mounted (see the "squashed-reattach fix"
      // describe block below for the fresh-mount-race coverage) — mount a
      // real container so the mocked xterm import resolves and the fire
      // actually happens, matching production (the container is ALWAYS
      // present; only xterm's async import is what's racing).
      mountContainer(result);
      await waitFor(() => expect(mockTerminals.length).toBeGreaterThan(0));
      await flushEffects();

      // openLaunchLinkAndArmTimeout only sets "opening" once a link actually
      // fired — this is the observable proof fireLaunchDeepLink ran.
      expect(result.current.launchPhase).toBe("opening");
      const iframes = document.querySelectorAll("iframe");
      expect(iframes).toHaveLength(1);
      const src = iframes[0].getAttribute("src") ?? "";
      expect(src.startsWith("vibecodes://launch?")).toBe(true);
      expect(src).toContain("session=sid-reconnect");
      expect(src).toContain(`token=${encodeURIComponent("reconnect-bridge-token")}`);
      expect(src).toContain(`helperToken=${encodeURIComponent("reconnect-helper-token")}`);
      // The browser leg still opens normally alongside the deep link.
      expect(mockSockets).toHaveLength(1);
    });

    // URGENT reattach fix (task 27d19c68, 2026-08-17 incident): Nick hit this
    // TWICE live — a hard refresh, then a cross-tab Reconnect, both reattached
    // successfully and then <1s later replaced the live conversation with an
    // empty boot screen. Root cause: fireLaunchDeepLink used to decide
    // resume-vs-fresh from promptPartsRef, which is null on BOTH triggers
    // (wiped by reload; never populated by a brand-new tab) — exactly the
    // state every test in this describe block is already in, since none of
    // them ever call launchFromBus/connect on this hook instance. The fix
    // forces the relaunch to be resume-shaped from the reattach payload's own
    // cwd/claudeSessionId instead, whenever those are present.
    it("forces an EXACT resume-shaped deep link on reattach when the pair carries cwd + claudeSessionId — even though promptPartsRef is null (regression, task 27d19c68)", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: {
            sessionId: "sid-reattach-live",
            browserToken: "reattach-browser-token",
            bridgeToken: "reattach-bridge-token",
            helperToken: "reattach-helper-token",
            cwd: "/Users/nick/projects/vibe-coding-ideas",
            claudeSessionId: "live-conv-id",
          },
        }),
      );
      // Squashed-reattach fix (task 6ac2cd44): see the comment on the first
      // test in this describe block — mount a real container so xterm
      // actually mounts and the now-deferred fire happens.
      mountContainer(result);
      await waitFor(() => expect(mockTerminals.length).toBeGreaterThan(0));
      await flushEffects();

      expect(result.current.launchPhase).toBe("opening");
      const iframes = document.querySelectorAll("iframe");
      expect(iframes).toHaveLength(1);
      const src = iframes[0].getAttribute("src") ?? "";
      expect(src.startsWith("vibecodes://launch?")).toBe(true);
      expect(src).toContain("session=sid-reattach-live");
      expect(src).toContain(`resume_id=${encodeURIComponent("live-conv-id")}`);
      expect(src).toContain(`cwd=${encodeURIComponent("/Users/nick/projects/vibe-coding-ideas")}`);
      // Never a fresh-boot prompt for a live reattach — that's the whole bug:
      // a duplicate process still gets spawned (unchanged, lower-risk
      // plumbing), but it must resume the SAME conversation, not boot empty.
      expect(src).not.toContain("prompt=");
      // Exact resume_id wins over the legacy resume=1 flag (buildLaunchDeepLink's
      // own precedence — drift-tested in deep-link.test.ts).
      expect(src).not.toContain("resume=1");
      // The browser leg still opens normally alongside the forced relaunch.
      expect(mockSockets).toHaveLength(1);
    });

    it("forces a legacy resume (--continue style) on reattach when the pair carries cwd but no claudeSessionId yet", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: {
            sessionId: "sid-reattach-no-conv-id",
            browserToken: "reattach-browser-token",
            bridgeToken: "reattach-bridge-token",
            helperToken: "reattach-helper-token",
            cwd: "/Users/nick/projects/vibe-coding-ideas",
            // claudeSessionId intentionally omitted — e.g. a pre-2a bridge
            // that never announced one, or a session still mid-first-turn.
            // The registry's own two columns are independent/uncoordinated,
            // so this combination is real, not hypothetical.
          },
        }),
      );
      // Squashed-reattach fix (task 6ac2cd44): see the comment on the first
      // test in this describe block — mount a real container so xterm
      // actually mounts and the now-deferred fire happens.
      mountContainer(result);
      await waitFor(() => expect(mockTerminals.length).toBeGreaterThan(0));
      await flushEffects();

      expect(result.current.launchPhase).toBe("opening");
      const iframes = document.querySelectorAll("iframe");
      expect(iframes).toHaveLength(1);
      const src = iframes[0].getAttribute("src") ?? "";
      expect(src).toContain(`cwd=${encodeURIComponent("/Users/nick/projects/vibe-coding-ideas")}`);
      expect(src).toContain("resume=1");
      expect(src).not.toContain("resume_id=");
      expect(src).not.toContain("prompt=");
    });

    it("falls back to the fresh-launch deep link when the reattach pair has no recorded cwd at all (edge case — never worse than the pre-fix behaviour)", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: {
            sessionId: "sid-reattach-no-cwd",
            browserToken: "reattach-browser-token",
            bridgeToken: "reattach-bridge-token",
            helperToken: "reattach-helper-token",
            // No cwd, no claudeSessionId — the registry row itself never
            // resolved a folder (e.g. a "new project" launch). Nothing to
            // resume into, so this intentionally falls through to the
            // pre-existing fresh-launch branch (logged as a warning in
            // fireLaunchDeepLink so the gap stays visible).
          },
        }),
      );
      // Squashed-reattach fix (task 6ac2cd44): see the comment on the first
      // test in this describe block — mount a real container so xterm
      // actually mounts and the now-deferred fire happens.
      mountContainer(result);
      await waitFor(() => expect(mockTerminals.length).toBeGreaterThan(0));
      await flushEffects();

      expect(result.current.launchPhase).toBe("opening");
      const iframes = document.querySelectorAll("iframe");
      expect(iframes).toHaveLength(1);
      const src = iframes[0].getAttribute("src") ?? "";
      expect(src).not.toContain("resume_id=");
      expect(src).not.toContain("resume=1");
      expect(src).toContain("prompt=");
    });

    // Squashed-reattach fix (task 6ac2cd44, 2026-08-17 follow-up to 27d19c68):
    // Nick's report — a reattach reconnects, flickers, and the terminal
    // renders squashed into part of the screen. QA traced this to
    // attachToExisting firing the reattach relaunch deep link SYNCHRONOUSLY,
    // in the same effect-flush pass as a fresh mount's still-in-flight async
    // xterm import — currentLaunchDims() (which reads termRef/fitRef) is
    // therefore GUARANTEED null then, so the remote PTY spawns at the
    // bridge's narrow 80x24 fallback instead of the real panel size. The fix
    // mirrors the existing pendingInitialBufferRef pattern: queue the fire
    // and flush it from the xterm-init effect once termRef/fitRef are
    // actually populated, instead of firing immediately with no dims.
    describe("squashed-reattach fix — deferred deep link until xterm is ready (task 6ac2cd44)", () => {
      it("defers the reattach relaunch deep link on a fresh mount where xterm hasn't loaded yet, then fires it with real dims once it has", async () => {
        const requestExpand = vi.fn();
        const { result } = renderHook(() =>
          useTerminalSession(descriptor, {
            enabled: true,
            expanded: true,
            requestExpand,
            autoConnectWhenExpanded: false,
            attachExisting: {
              sessionId: "sid-fresh-mount",
              browserToken: "fresh-browser-token",
              bridgeToken: "fresh-bridge-token",
              helperToken: "fresh-helper-token",
              cwd: "/Users/nick/projects/vibe-coding-ideas",
              claudeSessionId: "fresh-conv-id",
            },
          }),
        );
        // Mirrors the real fresh-mount race: the container is present (as it
        // always is in production — terminal-session-view.tsx keeps the
        // xterm host div permanently mounted regardless of status) but
        // xterm's own async import() hasn't resolved yet at this exact
        // synchronous point, since the attach-trigger effect (declared far
        // below the xterm-init effect) runs in the SAME synchronous
        // effect-flush pass as that still-in-flight import.
        mountContainer(result);

        // Not fired yet — this is the actual behaviour change. Before this
        // fix, this would already be "opening" here, having fired with null
        // dims (the squash's root cause).
        expect(result.current.launchPhase).toBe("idle");
        expect(document.querySelectorAll("iframe")).toHaveLength(0);

        // Let the mocked xterm dynamic import resolve and mount.
        await waitFor(() => expect(mockTerminals.length).toBeGreaterThan(0));
        await flushEffects();

        // Now it has fired — with REAL dims (never omitted), and the exact
        // same forceResumeCwd/forceResumeId this reattach carried, so the
        // deferral doesn't lose the resume-shaped behaviour PR #174 added.
        expect(result.current.launchPhase).toBe("opening");
        const iframes = document.querySelectorAll("iframe");
        expect(iframes).toHaveLength(1);
        const src = iframes[0].getAttribute("src") ?? "";
        expect(src).toContain("session=sid-fresh-mount");
        expect(src).toContain(`resume_id=${encodeURIComponent("fresh-conv-id")}`);
        expect(src).toContain(`cwd=${encodeURIComponent("/Users/nick/projects/vibe-coding-ideas")}`);
        // The pre-fix bug: cols/rows OMITTED entirely because
        // currentLaunchDims() returned null at fire time. The whole point of
        // this fix is that a reattach's deep link now always carries them.
        expect(src).toContain("cols=");
        expect(src).toContain("rows=");
      });

      it("fires the deep link immediately, unchanged, when xterm is ALREADY mounted (fast path — e.g. a same-tab Reconnect reusing an already-live pristine slot)", async () => {
        const requestExpand = vi.fn();
        const { result, rerender } = renderHook(
          (props: { attachExisting: AttachExistingPair | null }) =>
            useTerminalSession(descriptor, {
              enabled: true,
              expanded: true,
              requestExpand,
              autoConnectWhenExpanded: false,
              attachExisting: props.attachExisting,
            }),
          { initialProps: { attachExisting: null as AttachExistingPair | null } },
        );
        // xterm mounts on this idle pristine slot BEFORE any reattach is
        // requested — mirrors reusing a tab whose terminal was already
        // showing something (findPristineSlot in terminal-dock.tsx).
        mountContainer(result);
        await waitFor(() => expect(mockTerminals.length).toBeGreaterThan(0));
        expect(document.querySelectorAll("iframe")).toHaveLength(0);

        // The dock reuses this SAME slot for a reattach — attachExisting
        // flips null -> populated on a later render, exactly like the
        // pristine-slot-reuse test above, but this time xterm is already up.
        rerender({
          attachExisting: {
            sessionId: "sid-fast-path",
            browserToken: "fast-browser-token",
            bridgeToken: "fast-bridge-token",
            helperToken: "fast-helper-token",
            cwd: "/Users/nick/projects/vibe-coding-ideas",
            claudeSessionId: "fast-conv-id",
          },
        });

        // No extra wait/flush beyond rerender's own (synchronous) act() —
        // proving the fire happens in the SAME pass, unchanged from before
        // this fix, because termRef/fitRef were already populated.
        expect(result.current.launchPhase).toBe("opening");
        const iframes = document.querySelectorAll("iframe");
        expect(iframes).toHaveLength(1);
        const src = iframes[0].getAttribute("src") ?? "";
        expect(src).toContain("session=sid-fast-path");
        expect(src).toContain(`resume_id=${encodeURIComponent("fast-conv-id")}`);
      });

      it("drops a queued reattach deep link if a NEWER attachToExisting (a distinct sessionId) superseded it before xterm became ready (no duplicate fire)", async () => {
        // Deliberately does NOT drive the race through connect()'s own
        // await — the mocked xterm import resolves on its own microtask
        // schedule, so yielding via ANY await (including connect()'s mint
        // fetch) risks it resolving before or after the gen bump
        // nondeterministically. Two SYNCHRONOUS attachToExisting calls (via
        // rerender, which testing-library flushes synchronously) avoid that
        // race entirely: both queue attempts happen before xterm's import
        // has any chance to run, so mounting the container afterwards
        // deterministically exercises "two queued attempts, only the
        // latest should fire."
        const requestExpand = vi.fn();
        const { result, rerender } = renderHook(
          (props: { attachExisting: AttachExistingPair | null }) =>
            useTerminalSession(descriptor, {
              enabled: true,
              expanded: true,
              requestExpand,
              autoConnectWhenExpanded: false,
              attachExisting: props.attachExisting,
            }),
          {
            initialProps: {
              attachExisting: {
                sessionId: "sid-stale",
                browserToken: "stale-browser-token",
                bridgeToken: "stale-bridge-token",
                helperToken: "stale-helper-token",
                cwd: "/Users/nick/projects/vibe-coding-ideas",
                claudeSessionId: "stale-conv-id",
              } as AttachExistingPair | null,
            },
          },
        );
        // No mountContainer() yet — xterm never mounts, so the sid-stale
        // fire queues instead of firing (same setup as the fresh-mount test
        // above).
        expect(result.current.launchPhase).toBe("idle");
        expect(document.querySelectorAll("iframe")).toHaveLength(0);

        // A NEWER reattach for a DIFFERENT session (the dock reusing this
        // same pristine slot again before the first ever settled) claims a
        // later connect generation and overwrites the queued entry.
        rerender({
          attachExisting: {
            sessionId: "sid-fresh",
            browserToken: "fresh-browser-token",
            bridgeToken: "fresh-bridge-token",
            helperToken: "fresh-helper-token",
            cwd: "/Users/nick/projects/vibe-coding-ideas",
            claudeSessionId: "fresh-conv-id",
          },
        });
        expect(document.querySelectorAll("iframe")).toHaveLength(0); // still queued, not fired yet

        // NOW let xterm mount — only the LATEST (sid-fresh) fire must land;
        // the stale sid-stale queue entry must never be replayed alongside
        // (or instead of) it. If two iframes appear, or the stale session
        // id shows up, that's the duplicate-fire bug the task explicitly
        // warned against.
        mountContainer(result);
        await waitFor(() => expect(mockTerminals.length).toBeGreaterThan(0));
        await flushEffects();

        const iframes = document.querySelectorAll("iframe");
        expect(iframes).toHaveLength(1);
        const src = iframes[0].getAttribute("src") ?? "";
        expect(src).toContain("session=sid-fresh");
        expect(src).not.toContain("session=sid-stale");
      });
    });

    it("never fires a deep link when the attach pair carries no bridgeToken (popped-out hand-off — unchanged behaviour)", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: { sessionId: "sid-popped", browserToken: "popped-browser-token" },
        }),
      );
      await flushEffects();

      expect(result.current.launchPhase).toBe("idle");
      expect(document.querySelectorAll("iframe")).toHaveLength(0);
    });

    it("never trips the paired auto-connect effect, even on a browser that WOULD otherwise ambient-connect (would double-mint)", async () => {
      // Same paired/supported setup the "autoConnectWhenExpanded" describe
      // above uses to make the ambient auto-connect effect's guard pass —
      // proving `autoConnectWhenExpanded: false` (a real popped window's
      // actual wiring) is enough to stop it from ALSO firing connect()
      // alongside attachToExisting and minting a second, orphaned session.
      window.localStorage.setItem("vibecodes:terminal:paired-v1", "1");
      vi.stubGlobal("navigator", {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        maxTouchPoints: 0,
      });
      const requestExpand = vi.fn();
      renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: { sessionId: "sid-popped", browserToken: "popped-browser-token" },
        }),
      );
      await flushEffects();
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockSockets).toHaveLength(1); // exactly the attach's own socket, nothing extra
    });

    // ── scrollback transfer, Flow A (card 35cffc10) ─────────────────────────
    //
    // The xterm-init effect bails out early (`!containerRef.current`) unless
    // something has attached a real DOM node to `containerRef` — normally the
    // consumer's `<div ref={containerRef} />`, which `renderHook` never
    // renders since it exercises the hook in isolation. `mountContainer`
    // stands in for that JSX by assigning a detached element directly, the
    // same ref object the hook itself reads at effect-resume time.
    function mountContainer(result: { current: { containerRef: { current: HTMLDivElement | null } } }) {
      result.current.containerRef.current = document.createElement("div");
    }

    it("restores a handed-over initialBuffer into the terminal — reset then marker then data, BEFORE any socket data arrives", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: {
            sessionId: "sid-popped",
            browserToken: "popped-browser-token",
            initialBuffer: { data: "hello from the dock\r\n", truncated: true },
          },
        }),
      );
      mountContainer(result);
      await waitFor(() => expect(mockTerminals.length).toBeGreaterThan(0));

      const term = latestTerminal();
      await waitFor(() => expect(term.resetCount).toBe(1));
      expect(term.written[0]).toContain("older history trimmed during hand-off");
      expect(term.written[1]).toBe("hello from the dock\r\n");
    });

    it("falls back to a plain clear() (no reset/write) when no initialBuffer rides the attach — deploy skew / nothing to serialize", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: { sessionId: "sid-popped", browserToken: "popped-browser-token" },
        }),
      );
      mountContainer(result);
      await waitFor(() => expect(mockTerminals.length).toBeGreaterThan(0));
      await flushEffects();

      const term = latestTerminal();
      expect(term.resetCount).toBe(0);
      expect(term.written).toEqual([]);
    });

    it("restores the buffer even when the terminal mounts AFTER attachToExisting already ran (the pending-buffer race)", async () => {
      // Reproduces the ordering where the attach effect fires before the
      // async xterm-init effect has finished mounting the Terminal — the
      // buffer must not be silently dropped just because termRef was still
      // null at the moment attachToExisting ran.
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: {
            sessionId: "sid-popped",
            browserToken: "popped-browser-token",
            initialBuffer: { data: "queued before mount\r\n", truncated: false },
          },
        }),
      );
      mountContainer(result);
      // No flushEffects() at all yet — attachToExisting may or may not have
      // already run synchronously; either way the terminal mounts async.
      await waitFor(() => expect(mockTerminals.length).toBeGreaterThan(0));
      const term = latestTerminal();
      await waitFor(() => expect(term.written).toContain("queued before mount\r\n"));
      expect(term.resetCount).toBe(1);
    });
  });

  // ── scrollback transfer actions: serializeNow / restoreBuffer ────────────

  describe("scrollback transfer actions", () => {
    it("serializeNow() returns null before the xterm instance has mounted", () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, { enabled: true, expanded: false, requestExpand }),
      );
      // Synchronous — no flush, no container attached — the async xterm-init
      // effect hasn't (and here, can't yet have) resolved.
      expect(result.current.actions.serializeNow()).toBeNull();
    });

    it("serializeNow() returns a buffer once the terminal has mounted", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, { enabled: true, expanded: true, requestExpand }),
      );
      result.current.containerRef.current = document.createElement("div");
      await waitFor(() => expect(mockTerminals.length).toBeGreaterThan(0));

      const buffer = result.current.actions.serializeNow();
      expect(buffer).toEqual({ data: "", truncated: false }); // nothing written yet — honestly empty, not null
    });

    it("restoreBuffer() writes into the live terminal (reset, marker, data) and is a no-op before mount", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, { enabled: true, expanded: true, requestExpand }),
      );

      // Before mount: a no-op, never throws.
      expect(() =>
        result.current.actions.restoreBuffer({ data: "too early", truncated: false }),
      ).not.toThrow();

      result.current.containerRef.current = document.createElement("div");
      await waitFor(() => expect(mockTerminals.length).toBeGreaterThan(0));
      act(() => {
        result.current.actions.restoreBuffer({ data: "restored content", truncated: false });
      });
      const term = latestTerminal();
      expect(term.resetCount).toBeGreaterThanOrEqual(1);
      expect(term.written).toContain("restored content");
    });
  });

  // Card cbe60db5 rework 9 (Bug A — Nick's field test 2026-08-14): the
  // session-ended overlay's "Resume this conversation" action needs THIS
  // tab's own cwd/claudeSessionId to survive past the session actually
  // ending (unlike `promptPartsRef`, which the hook deliberately clears on
  // session-ended — see that effect). These pin the exposed `cwd`/
  // `claudeSessionId` result fields' full lifecycle: resolved at connect()
  // time, seeded from a carried resumeId, overwritten by the bridge's own
  // announcement, and retained (never reset) once the session ends.
  describe("cwd/claudeSessionId bookkeeping (Bug A)", () => {
    it("resolves no cwd/claudeSessionId for a plain (non-resume) launch with no recorded folder", async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.actions.connect({ autoLaunch: false });
      });
      // This idea has no GitHub repo, no saved localStorage path, and no
      // recorded DB path — resolveDefaultLaunchState falls to "new" mode,
      // whose cwd is the caller's effective target (undefined here), so no
      // cwd is ever resolved. Deterministic, not a false negative.
      expect(result.current.cwd).toBeNull();
      expect(result.current.claudeSessionId).toBeNull();
    });

    // Bug cbe60db5-followup-2 (QA, high severity): a fallback connect() —
    // paired auto-connect on panel open, or Retry — never had access to
    // recordedProjectPaths, so it always passed `undefined` into
    // resolveDefaultLaunchState even when the agent HAD recorded a real
    // folder for this idea+machine (idea_project_paths). That silently
    // dropped `cwd`, which meant a later session-ended overlay's Resume
    // button (requires a known cwd) never showed even though the folder was
    // fully known server-side. Fixed by threading recordedProjectPaths
    // through the descriptor into resolveLaunchPromptParts, mirroring the
    // launch button's own resolveEffectiveLaunchTarget resolution.
    it("resolves a recorded folder for a fallback (no-bus-payload) launch, when one is recorded for this idea", async () => {
      const { result } = renderHook(() =>
        useTerminalSession(
          { ...descriptor, recordedProjectPaths: [{ absolute_path: "/Users/nick/projects/recipe-saver", hostname: "nicks-mac" }] },
          { enabled: true, expanded: true, requestExpand: vi.fn() },
        ),
      );
      await act(async () => {
        await result.current.actions.connect({ autoLaunch: false });
      });
      expect(result.current.cwd).toBe("/Users/nick/projects/recipe-saver");
    });

    // The don't-break-it-for-the-common-case half of the same fix: >1
    // recorded machines is ambiguous (chooseLaunchCwd's own contract), so it
    // must still fall through to the "new project" flow exactly like having
    // none recorded at all — never guess a machine.
    it("still falls back to 'new project' (no cwd) when the recorded paths are ambiguous (more than one machine)", async () => {
      const { result } = renderHook(() =>
        useTerminalSession(
          {
            ...descriptor,
            recordedProjectPaths: [
              { absolute_path: "/Users/nick/projects/recipe-saver", hostname: "nicks-mac" },
              { absolute_path: "/home/nick/recipe-saver", hostname: "nicks-linux-box" },
            ],
          },
          { enabled: true, expanded: true, requestExpand: vi.fn() },
        ),
      );
      await act(async () => {
        await result.current.actions.connect({ autoLaunch: false });
      });
      expect(result.current.cwd).toBeNull();
    });

    it("seeds claudeSessionId from a carried resumeId and exposes the carried cwd immediately after mint", async () => {
      window.localStorage.setItem("vibecodes:terminal:paired-v1", "1");
      vi.stubGlobal("navigator", {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        maxTouchPoints: 0,
      });
      const { result } = setup();
      act(() => {
        result.current.actions.launchFromBus({
          resumeId: "claude-conv-carried",
          cwd: "/Users/nick/projects/vibe-coding-ideas",
        });
      });
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      await flushEffects();

      expect(result.current.cwd).toBe("/Users/nick/projects/vibe-coding-ideas");
      // Seeded from the carried resumeId even before the bridge announces
      // anything — a legacy bridge that never announces a `conv` still lets a
      // LATER resume-of-this-resume carry the right id.
      expect(result.current.claudeSessionId).toBe("claude-conv-carried");
    });

    it("overwrites the seeded claudeSessionId once the bridge announces its own conv id", async () => {
      window.localStorage.setItem("vibecodes:terminal:paired-v1", "1");
      vi.stubGlobal("navigator", {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        maxTouchPoints: 0,
      });
      const { result } = setup();
      act(() => {
        result.current.actions.launchFromBus({
          resumeId: "claude-conv-carried",
          cwd: "/Users/nick/projects/vibe-coding-ideas",
        });
      });
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      await flushEffects();
      act(() => latestSocket().simulateOpen());

      const announced = "99999999-8888-7777-6666-555555555555";
      act(() => {
        latestSocket().onmessage?.({ data: JSON.stringify({ t: "bridge-version", conv: announced }) });
      });
      expect(result.current.claudeSessionId).toBe(announced);
    });

    it("keeps cwd/claudeSessionId once the session ends (unlike promptPartsRef, never cleared on session-ended)", async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.actions.connect({ autoLaunch: false });
      });
      act(() => latestSocket().simulateOpen());
      const announced = "99999999-8888-7777-6666-555555555555";
      act(() => {
        latestSocket().onmessage?.({ data: JSON.stringify({ t: "bridge-version", conv: announced }) });
      });
      expect(result.current.claudeSessionId).toBe(announced);

      act(() => {
        result.current.actions.end();
      });
      expect(result.current.state.status).toBe("session-ended");
      // The Resume action reads exactly these two fields off the ended
      // session — they must still be here to read.
      expect(result.current.claudeSessionId).toBe(announced);
    });

    // Bug cbe60db5-followup (QA, 2026-08-16): a reload-reattach / instant-
    // continue / chooser-Reconnect never showed "Resume this conversation"
    // once the reattached session later ended for a non-user reason, even
    // though the server had the folder on record — attachToExisting() never
    // called setSessionCwd/setClaudeSessionId, unlike connect(). Fixed by
    // threading the reattach route's cwd/claudeSessionId through
    // AttachExistingPair into attachToExisting.
    it("attachToExisting seeds cwd/claudeSessionId from the attach pair, and they survive a non-user session end", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: {
            sessionId: "sid-reattached",
            browserToken: "reattached-browser-token",
            cwd: "/Users/nick/projects/vibe-coding-ideas",
            claudeSessionId: "claude-conv-from-registry",
          },
        }),
      );
      await flushEffects();

      // Seeded immediately, before the socket ever opens — mirrors connect()'s
      // seeding, not something that only shows up once a bridge announces.
      expect(result.current.cwd).toBe("/Users/nick/projects/vibe-coding-ideas");
      expect(result.current.claudeSessionId).toBe("claude-conv-from-registry");

      act(() => latestSocket().simulateOpen());
      act(() => latestSocket().simulateBinaryMessage());
      expect(result.current.state.status).toBe("connected");

      // Ends for a NON-user reason (the bridge's own idle/max-duration close,
      // or an exhausted reconnect) — exactly the case canResume in
      // terminal-session-view.tsx cares about.
      act(() => latestSocket().close(1000, "idle timeout"));
      expect(result.current.state.status).toBe("session-ended");
      expect(result.current.state.endedReason).toBe("idle");
      expect(result.current.cwd).toBe("/Users/nick/projects/vibe-coding-ideas");
      expect(result.current.claudeSessionId).toBe("claude-conv-from-registry");
    });

    it("attachToExisting falls back to null cwd/claudeSessionId when the attach pair omits them (pop-out hand-off, or a pre-fix reattach response)", async () => {
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: { sessionId: "sid-popped", browserToken: "popped-browser-token" },
        }),
      );
      await flushEffects();

      expect(result.current.cwd).toBeNull();
      expect(result.current.claudeSessionId).toBeNull();
    });
  });

  // Bug B (card cbe60db5, Nick's field test 2026-08-15): a promptless
  // (Resume) launch's PTY used to spawn at a hardcoded 80x24 because the
  // browser's own resize can't reach a not-yet-existent process in time.
  // Fixed by carrying the browser's real, already-fitted cols/rows on the
  // SAME launch deep link — see currentLaunchDims's doc comment above
  // sendResize(). These tests mount a real containerRef (mountContainer,
  // matching the scrollback-transfer tests' own rationale above) so the
  // mocked xterm Terminal actually exists, then mutate its cols/rows the way
  // a real fit-addon would have computed them from the panel's real size.
  describe("PTY spawn dims on the launch deep link (Bug B, card cbe60db5)", () => {
    function mountContainer(result: { current: { containerRef: { current: HTMLDivElement | null } } }) {
      result.current.containerRef.current = document.createElement("div");
    }

    it("carries the real fitted cols/rows on a resume launch once xterm has mounted", async () => {
      window.localStorage.setItem("vibecodes:terminal:paired-v1", "1");
      vi.stubGlobal("navigator", {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        maxTouchPoints: 0,
      });
      const { result } = setup();
      mountContainer(result);
      await waitFor(() => expect(mockTerminals.length).toBeGreaterThan(0));
      const term = mockTerminals[mockTerminals.length - 1] as unknown as { cols: number; rows: number };
      term.cols = 137;
      term.rows = 42;

      act(() => {
        result.current.actions.launchFromBus({
          resumeId: "claude-conv-carried",
          cwd: "/Users/nick/projects/vibe-coding-ideas",
        });
      });
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      await flushEffects();

      const iframes = document.querySelectorAll("iframe");
      expect(iframes).toHaveLength(1);
      const src = iframes[0].getAttribute("src") ?? "";
      expect(src).toContain("cols=137");
      expect(src).toContain("rows=42");
      // cols/rows ride AFTER resume_id (rides before prompt either way) per
      // the shared builder's param ordering (drift-tested in deep-link.test.ts).
      expect(src.indexOf("resume_id=")).toBeLessThan(src.indexOf("cols="));
    });

    it("omits cols/rows entirely when xterm hasn't mounted yet (fast-click race) — falls back to the bridge's own default, never worse than before this fix", async () => {
      window.localStorage.setItem("vibecodes:terminal:paired-v1", "1");
      vi.stubGlobal("navigator", {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        maxTouchPoints: 0,
      });
      const { result } = setup();
      // No mountContainer() — termRef/fitRef stay null, exactly the race a
      // brand-new tab (no pristine slot to reuse) can hit.
      act(() => {
        result.current.actions.launchFromBus({
          resumeId: "claude-conv-carried",
          cwd: "/Users/nick/projects/vibe-coding-ideas",
        });
      });
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      await flushEffects();

      const iframes = document.querySelectorAll("iframe");
      expect(iframes).toHaveLength(1);
      const src = iframes[0].getAttribute("src") ?? "";
      expect(src).not.toContain("cols=");
      expect(src).not.toContain("rows=");
    });

    it("carries the real fitted cols/rows on a normal (prompt-carrying) launch too", async () => {
      window.localStorage.setItem("vibecodes:terminal:paired-v1", "1");
      vi.stubGlobal("navigator", {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        maxTouchPoints: 0,
      });
      const { result } = setup();
      mountContainer(result);
      await waitFor(() => expect(mockTerminals.length).toBeGreaterThan(0));
      const term = mockTerminals[mockTerminals.length - 1] as unknown as { cols: number; rows: number };
      term.cols = 220;
      term.rows = 55;

      await act(async () => {
        await result.current.actions.connect({ autoLaunch: true });
      });

      const iframes = document.querySelectorAll("iframe");
      expect(iframes).toHaveLength(1);
      const src = iframes[0].getAttribute("src") ?? "";
      expect(src).toContain("cols=220");
      expect(src).toContain("rows=55");
      expect(src).toContain("prompt=");
      expect(src.indexOf("cols=")).toBeLessThan(src.indexOf("prompt="));
    });
  });

  // Card cbe60db5 rework 10 (stuck-pairing watchdog, 2026-08-14 incident): QA
  // root-caused a session stuck forever on "Waiting for your machine to
  // attach" — attachToExisting (reload-reattach/instant-continue, the
  // chooser's Reconnect) and reconnectNow's fresh-attach-reset (bring-back-
  // from-pop-out) both reach status "waiting-to-pair" with launchPhase
  // "idle" and NOTHING re-fires the vibecodes:// deep link, so the existing
  // 8s helperTimerRef (which only bounds a FRESH same-pageview
  // connect({autoLaunch:true}) launch) never engages. `pairingTimedOut`
  // reports the new watchdog's own outcome; the presentational swap to
  // TimeoutPanel is covered separately in terminal-session-view.test.tsx.
  describe("pairing watchdog (stuck 'waiting for your machine to attach')", () => {
    it("a manual connect({autoLaunch:false}) never times out — the one legitimate indefinite wait", async () => {
      vi.useFakeTimers();
      const { result } = setup();
      await act(async () => {
        await result.current.actions.connect({ autoLaunch: false });
      });
      act(() => latestSocket().simulateOpen());
      expect(result.current.state.status).toBe("waiting-to-pair");
      expect(result.current.launchPhase).toBe("idle");

      await act(async () => {
        vi.advanceTimersByTime(RECONNECT_GRACE_MS + 1000);
      });
      expect(result.current.pairingTimedOut).toBe(false);
    });

    it("attachToExisting arms the watchdog — pairingTimedOut fires after RECONNECT_GRACE_MS with no bridge attach", async () => {
      vi.useFakeTimers();
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: { sessionId: "sid-popped", browserToken: "popped-browser-token" },
        }),
      );
      await act(async () => {
        await Promise.resolve();
      });
      act(() => latestSocket().simulateOpen());
      expect(result.current.state.status).toBe("waiting-to-pair");
      expect(result.current.launchPhase).toBe("idle");
      expect(result.current.pairingTimedOut).toBe(false);

      // Just short of the deadline — still waiting, no false positive.
      await act(async () => {
        vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1000);
      });
      expect(result.current.pairingTimedOut).toBe(false);

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.pairingTimedOut).toBe(true);
    });

    it("cancels the watchdog the instant the bridge attaches before the deadline", async () => {
      vi.useFakeTimers();
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: { sessionId: "sid-popped", browserToken: "popped-browser-token" },
        }),
      );
      await act(async () => {
        await Promise.resolve();
      });
      act(() => latestSocket().simulateOpen());

      await act(async () => {
        vi.advanceTimersByTime(RECONNECT_GRACE_MS / 2);
      });
      act(() => latestSocket().simulateBinaryMessage());
      expect(result.current.state.status).toBe("connected");

      // Advance well past the original deadline — a cleared timer must never
      // fire late and flip a now-connected session into "timed out".
      await act(async () => {
        vi.advanceTimersByTime(RECONNECT_GRACE_MS);
      });
      expect(result.current.pairingTimedOut).toBe(false);
    });

    it("reconnectNow's fresh-attach-reset (bring-back-from-pop-out) arms the watchdog when the bridge never returns", async () => {
      vi.useFakeTimers();
      const requestExpand = vi.fn();
      const { result } = renderHook(() =>
        useTerminalSession(descriptor, {
          enabled: true,
          expanded: true,
          requestExpand,
          autoConnectWhenExpanded: false,
          attachExisting: { sessionId: "sid-popped", browserToken: "popped-browser-token" },
        }),
      );
      await act(async () => {
        await Promise.resolve();
      });
      act(() => latestSocket().simulateOpen());
      act(() => latestSocket().simulateBinaryMessage());
      expect(result.current.state.status).toBe("connected");

      // Bring-back-from-pop-out: this window's own leg was preempted (relay
      // 4001 "preempted") while the popped window took over — decideReconnectNow
      // routes this to "fresh-attach-reset".
      act(() => latestSocket().close(4001, "preempted"));
      expect(result.current.state.status).toBe("error");

      act(() => result.current.actions.reconnectNow());
      expect(result.current.state.status).toBe("connecting");
      act(() => latestSocket().simulateOpen());
      expect(result.current.state.status).toBe("waiting-to-pair");
      expect(result.current.launchPhase).toBe("idle");

      await act(async () => {
        vi.advanceTimersByTime(RECONNECT_GRACE_MS + 1000);
      });
      expect(result.current.pairingTimedOut).toBe(true);
    });
  });
});
