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
import { useTerminalSession, type TerminalSessionDescriptor } from "./use-terminal-session";
import { isSameOwnerPreemptedClose } from "@/lib/terminal/connection";

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
  });
});
