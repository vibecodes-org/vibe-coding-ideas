import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedSave } from "./use-debounced-save";

describe("useDebouncedSave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves after the debounce delay", async () => {
    const onSave = vi.fn(async () => {});
    const { rerender } = renderHook(
      ({ value }: { value: string }) =>
        useDebouncedSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: "a" } }
    );

    rerender({ value: "ab" });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("ab");
  });

  it("cancels the previous timer when value changes again", async () => {
    const onSave = vi.fn(async () => {});
    const { rerender } = renderHook(
      ({ value }: { value: string }) =>
        useDebouncedSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: "a" } }
    );

    rerender({ value: "ab" });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    rerender({ value: "abc" });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("abc");
  });

  it("flush() persists pending value immediately and cancels the timer", async () => {
    const onSave = vi.fn(async () => {});
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) =>
        useDebouncedSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: "a" } }
    );

    rerender({ value: "ab" });
    await act(async () => {
      await result.current.flush();
    });
    expect(onSave).toHaveBeenCalledWith("ab");

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("flush() is a no-op when no save is pending", async () => {
    const onSave = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useDebouncedSave({ value: "a", onSave, delayMs: 500 })
    );

    await act(async () => {
      await result.current.flush();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not save on mount when skipInitial is true (default)", async () => {
    const onSave = vi.fn(async () => {});
    renderHook(() => useDebouncedSave({ value: "initial", onSave, delayMs: 500 }));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("skip prevents scheduling", async () => {
    const onSave = vi.fn(async () => {});
    const { rerender } = renderHook(
      ({ value, skip }: { value: string; skip: boolean }) =>
        useDebouncedSave({ value, onSave, delayMs: 500, skip }),
      { initialProps: { value: "a", skip: true } }
    );

    rerender({ value: "ab", skip: true });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("fires pending save on unmount", async () => {
    const onSave = vi.fn(async () => {});
    const { rerender, unmount } = renderHook(
      ({ value }: { value: string }) =>
        useDebouncedSave({ value, onSave, delayMs: 500 }),
      { initialProps: { value: "a" } }
    );

    rerender({ value: "ab" });
    unmount();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("ab");
  });

  it("saves the latest value even when onSave identity changes between renders", async () => {
    let captured = "";
    const { rerender } = renderHook(
      ({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) =>
        useDebouncedSave({ value, onSave, delayMs: 500 }),
      {
        initialProps: {
          value: "a",
          onSave: async (v: string) => {
            captured = v;
          },
        },
      }
    );

    rerender({
      value: "ab",
      onSave: async (v: string) => {
        captured = `new:${v}`;
      },
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(captured).toBe("new:ab");
  });
});
