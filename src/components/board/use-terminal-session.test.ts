// Behavioural regression net for the pure refactor that extracted
// use-terminal-session.ts out of terminal-dock.tsx (multi-session stage 1). These
// tests exercise the hook's session mechanics — mint → open → data → connected,
// read-only gating, user-end, mint failure, and the grace-window reconnect — via a
// mocked fetch + WebSocket, standing in for terminal-dock.tsx's previous inline
// tests-by-manual-verification of the same paths. connection.ts's OWN pure logic
// (terminalReducer, mapCloseCode, decideResize, …) is unit-tested independently in
// connection.test.ts and is NOT re-tested here — this file is about the wiring.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTerminalSession, type TerminalSessionDescriptor } from "./use-terminal-session";

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    onData() {}
    open() {}
    loadAddon() {}
    write() {}
    clear() {}
    focus() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
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
    toastError.mockClear();
    toastSuccess.mockClear();
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("fetch", vi.fn(async () => mintResponse()));
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
});
