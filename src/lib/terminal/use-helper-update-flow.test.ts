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
  vi.useFakeTimers();
  location = stubLocationAssign();
  statusQueue = [];
  fetchMock = vi.fn((url: string) => {
    if (url === "/api/terminal/session/end") return jsonResponse({});
    if (url === "/api/terminal/helper/command") return jsonResponse({});
    if (url === "/api/terminal/helper/status") {
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
      body: JSON.stringify({ cmd: "quiesce" }),
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
      body: JSON.stringify({ all: true }),
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
