import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNow } from "./use-now";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  const base = new Date("2026-01-01T00:00:00.000Z").getTime();

  it("advances the value after intervalMs", () => {
    const { result } = renderHook(() => useNow(1000, true));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(base + 1000);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(base + 2000);
  });

  it("returns the stable seed and does not tick when disabled", () => {
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const { result } = renderHook(() => useNow(1000, false));
    const seed = result.current;

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current).toBe(seed);
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("shares ONE interval across two simultaneous subscribers", () => {
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    const h1 = renderHook(() => useNow(1000, true));
    const h2 = renderHook(() => useNow(1000, true));

    // Both subscribers use the same cadence — only one shared timer is created.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Both update together from the same shared tick.
    expect(h1.result.current).toBe(base + 1000);
    expect(h2.result.current).toBe(base + 1000);
  });

  it("clears the interval when the last subscriber unmounts", () => {
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");

    const { unmount } = renderHook(() => useNow(1000, true));
    const { unmount: unmount2 } = renderHook(() => useNow(1000, true));

    // First unmount still leaves one subscriber — timer must keep running.
    unmount();
    expect(clearIntervalSpy).not.toHaveBeenCalled();

    // Last subscriber leaves — the shared timer is torn down.
    unmount2();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
