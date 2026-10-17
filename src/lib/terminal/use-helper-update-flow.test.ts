// Regression coverage for the shared quiesce-then-download flow (extracted
// from terminal-my-sessions-panel.tsx so terminal-session-chooser.tsx's
// "Update now" can drive the exact same sequence — see that component's
// header comment). The pure phase transitions are already covered by
// helper-update-flow.test.ts; this file covers the actual network glue at
// each transition: ending live sessions, sending `quiesce`, polling status,
// and — the load-bearing edge case — proceeding to download even when the
// poll never settles before QUIESCE_TIMEOUT_MS.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHelperUpdateFlow } from "./use-helper-update-flow";
import { TERMINAL_HELPER_DOWNLOAD_URL } from "./platform";

/** jsdom's `window.location.assign` isn't spy-able directly (its property
 *  descriptor isn't configurable) — swap in a plain object carrying the real
 *  Location's properties plus a spy-able `assign`, same idiom as
 *  launch-claude-code-button.test.tsx. */
function stubLocationAssign() {
  const original = window.location;
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    value: Object.assign(Object.create(Object.getPrototypeOf(original) as object), original, { assign }),
    configurable: true,
    writable: true,
  });
  return {
    assign,
    restore: () => {
      Object.defineProperty(window, "location", { value: original, configurable: true, writable: true });
    },
  };
}

type StatusResponse = { connected: boolean };

let location: ReturnType<typeof stubLocationAssign>;
let fetchMock: ReturnType<typeof vi.fn>;
let statusQueue: StatusResponse[];

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: async () => body } as Response);
}

beforeEach(() => {
  // Card 6b2cb8ac: the flow targets THIS Mac by name; these tests run as a
  // browser that has launched a session on "mac-a".
  window.localStorage.setItem("vc:term:machines", JSON.stringify(["mac-a"]));
  vi.useFakeTimers();
  location = stubLocationAssign();
  statusQueue = [];
  fetchMock = vi.fn((url: string) => {
    if (url === "/api/terminal/session/end") return jsonResponse({});
    if (url === "/api/terminal/helper/command") return jsonResponse({});
    if (url === "/api/terminal/helper/status" || url.startsWith("/api/terminal/helper/status?")) {
      const next = statusQueue.shift() ?? { connected: true };
      return jsonResponse(next);
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  location.restore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useHelperUpdateFlow", () => {
  it("no live sessions: start() skips the confirm, quiesces (no end-all call), and downloads once settled", async () => {
    statusQueue = [{ connected: false }];
    const onSettled = vi.fn();
    const { result } = renderHook(() => useHelperUpdateFlow({ sessionCount: 0, onSettled }));

    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.phase).toBe("ready");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/terminal/session/end", expect.anything());
    expect(fetchMock).toHaveBeenCalledWith("/api/terminal/helper/command", expect.objectContaining({
      body: JSON.stringify({ cmd: "quiesce", machines: ["mac-a"] }),
    }));
    expect(location.assign).toHaveBeenCalledWith(TERMINAL_HELPER_DOWNLOAD_URL);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("live sessions: start() goes to confirming with the count carried, confirm() ends all sessions then quiesces", async () => {
    statusQueue = [{ connected: false }];
    const { result } = renderHook(() => useHelperUpdateFlow({ sessionCount: 3 }));

    act(() => result.current.start());
    expect(result.current.phase).toBe("confirming");
    expect(result.current.confirmSessionCount).toBe(3);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      result.current.confirm();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/terminal/session/end", expect.objectContaining({
      body: JSON.stringify({ all: true, machines: ["mac-a"] }),
    }));
    expect(result.current.phase).toBe("ready");
    expect(location.assign).toHaveBeenCalledWith(TERMINAL_HELPER_DOWNLOAD_URL);
  });

  it("cancel() from confirming returns to idle without touching the network", () => {
    const { result } = renderHook(() => useHelperUpdateFlow({ sessionCount: 2 }));
    act(() => result.current.start());
    expect(result.current.phase).toBe("confirming");

    act(() => result.current.cancel());
    expect(result.current.phase).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls onQuiesceStart exactly once, right as quiescing begins", async () => {
    statusQueue = [{ connected: false }];
    const onQuiesceStart = vi.fn();
    const { result } = renderHook(() => useHelperUpdateFlow({ sessionCount: 0, onQuiesceStart }));

    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onQuiesceStart).toHaveBeenCalledOnce();
  });

  it("quiesce-timeout: the poll never settles, but the flow still proceeds to 'quiesce-timeout' and downloads regardless", async () => {
    // Every status poll reports still-connected (the default in the mock above).
    const onSettled = vi.fn();
    const { result } = renderHook(() => useHelperUpdateFlow({ sessionCount: 0, onSettled }));

    act(() => result.current.start());
    // The poll rechecks every 500ms until Date.now() clears the deadline —
    // advance in the same increments rather than one large jump, so each
    // fetch-then-reschedule hop actually gets flushed (a single big
    // `advanceTimersByTimeAsync`/`runAllTimersAsync` call can race ahead of
    // the fetch mock's own microtask hop and stall mid-loop).
    for (let i = 0; i < 25 && result.current.phase === "quiescing"; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
    }

    expect(result.current.phase).toBe("quiesce-timeout");
    // The whole point of the design: drag-to-Applications must always
    // succeed, so the download fires even though quiescing never settled.
    expect(location.assign).toHaveBeenCalledWith(TERMINAL_HELPER_DOWNLOAD_URL);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("delivered:false from the command route -> 'helper-unreachable', no status poll, download still starts", async () => {
    // Nick, 6 Sep 2026 (card 3280f13c): prod log showed the quiesce command
    // answered `delivered:false` (the relay had no live helper connection),
    // the very next status poll said connected:false, and the flow declared
    // "the helper has closed" — while the helper was alive on the Mac and
    // Finder refused the drag as "in use". connected:false is the SAME
    // absent connection, not evidence of a quit, so the poll must not run.
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/terminal/session/end") return jsonResponse({});
      if (url === "/api/terminal/helper/command") return jsonResponse({ delivered: false });
      if (url === "/api/terminal/helper/status") return jsonResponse({ connected: false });
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    const onSettled = vi.fn();
    const { result } = renderHook(() => useHelperUpdateFlow({ sessionCount: 0, onSettled }));

    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.phase).toBe("helper-unreachable");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/terminal/helper/status");
    expect(location.assign).toHaveBeenCalledWith(TERMINAL_HELPER_DOWNLOAD_URL);
    expect(onSettled).toHaveBeenCalledOnce();

    act(() => result.current.resetIfSettled());
    expect(result.current.phase).toBe("idle");
  });

  it("delivered:true from the command route -> polls status and settles to 'ready' once disconnected", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/terminal/helper/command") return jsonResponse({ delivered: true });
      if (url === "/api/terminal/helper/status?machines=mac-a") return jsonResponse(statusQueue.shift() ?? { connected: true });
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    statusQueue = [{ connected: true }, { connected: false }];
    const { result } = renderHook(() => useHelperUpdateFlow({ sessionCount: 0 }));

    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.phase).toBe("quiescing");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.phase).toBe("ready");
    expect(location.assign).toHaveBeenCalledWith(TERMINAL_HELPER_DOWNLOAD_URL);
  });

  it("resetIfSettled clears a 'ready' phase back to idle", async () => {
    statusQueue = [{ connected: false }];
    const { result } = renderHook(() => useHelperUpdateFlow({ sessionCount: 0 }));

    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.phase).toBe("ready");

    act(() => result.current.resetIfSettled());
    expect(result.current.phase).toBe("idle");
  });

  it("resetIfSettled is a no-op from any non-settled phase", () => {
    const { result } = renderHook(() => useHelperUpdateFlow({ sessionCount: 2 }));
    act(() => result.current.start());
    expect(result.current.phase).toBe("confirming");

    act(() => result.current.resetIfSettled());
    expect(result.current.phase).toBe("confirming");
  });
});

// Card 6b2cb8ac (regression test 16, page half): "Update now" / "Download the
// helper" closes only the helper on THIS Mac. It used to send an account-wide
// `/session/end {all:true}` (ending every Mac's sessions) and a `quiesce` the
// relay handed to whichever Mac's helper held the single control slot.
describe("useHelperUpdateFlow — only this Mac (card 6b2cb8ac)", () => {
  afterEach(() => {
    window.localStorage.removeItem("vc:term:machines");
    window.localStorage.removeItem("vc:term:machine");
  });

  it("with this Mac's names: ends only its sessions, quiesces only its helper, polls its status", async () => {
    window.localStorage.setItem("vc:term:machines", JSON.stringify(["Nicks-Mac-mini.local", "nicks-mac-mini.home"]));
    statusQueue = [{ connected: false }];
    const { result } = renderHook(() => useHelperUpdateFlow({ sessionCount: 1 }));
    act(() => result.current.start());
    await act(async () => {
      result.current.confirm();
      await vi.advanceTimersByTimeAsync(0);
    });
    const machines = ["Nicks-Mac-mini.local", "nicks-mac-mini.home"];
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/terminal/session/end",
      expect.objectContaining({ body: JSON.stringify({ all: true, machines }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/terminal/helper/command",
      expect.objectContaining({ body: JSON.stringify({ cmd: "quiesce", machines }) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/terminal/helper/status?machines=${encodeURIComponent(machines.join(","))}`,
    );
    expect(result.current.phase).toBe("ready");
  });

  it("a browser that knows no Mac name: no end call, no quiesce, straight to the download", async () => {
    window.localStorage.removeItem("vc:term:machines");
    const { result } = renderHook(() => useHelperUpdateFlow({ sessionCount: 2 }));
    await act(async () => {
      result.current.start();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(location.assign).toHaveBeenCalledWith(TERMINAL_HELPER_DOWNLOAD_URL);
    expect(result.current.phase).toBe("helper-unreachable");
  });
});
