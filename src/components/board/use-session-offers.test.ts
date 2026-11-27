import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const { toastError, state } = vi.hoisted(() => ({
  toastError: vi.fn(),
  state: { handler: null as ((p: { eventType: string; new: unknown }) => void) | null, updateError: null as { message: string } | null, rows: [] as Record<string, unknown>[], statusCb: null as ((s: string) => void) | null, reads: 0, channels: 0, onUpdate: null as (() => void) | null },
}));

vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    channel: () => {
      const ch = { on: (_e: string, _f: unknown, h: (p: { eventType: string; new: unknown }) => void) => ((state.handler = h), ch), subscribe: (cb: (s: string) => void) => ((state.statusCb = cb), ch), unsubscribe: async () => {} };
      state.channels++;
      return ch;
    },
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => ({ gte: async () => (state.reads++, { data: state.rows, error: null }) }) }),
      }),
      update: () => ({
        eq: () => ({ select: () => ({ maybeSingle: async () => (state.onUpdate?.(), { data: null, error: state.updateError }) }) }),
      }),
    }),
  }),
}));

import { useSessionOffers } from "./use-session-offers";

const row = { sid: "s1", user_id: "u1", idea_id: "i1", status: "offered", next_task_title: "Next" };

afterEach(() => {
  state.updateError = null;
  state.rows = [];
  state.reads = 0;
  state.onUpdate = null;
  state.channels = 0;
  state.statusCb = null;
  vi.useRealTimers();
  toastError.mockClear();
});

describe("useSessionOffers", () => {
  it("clears the bar when a live update marks the offer dismissed (a withdrawn offer)", async () => {
    state.rows = [row];
    const { result } = renderHook(() => useSessionOffers());
    await waitFor(() => expect(result.current.offers.has("s1")).toBe(true));
    await waitFor(() => expect(state.handler).not.toBeNull());
    act(() => state.handler!({ eventType: "UPDATE", new: { ...row, status: "dismissed" } }));
    expect(result.current.offers.has("s1")).toBe(false);
  });

  it("loads this person's open offers by session", async () => {
    state.rows = [row];
    const { result } = renderHook(() => useSessionOffers());
    await waitFor(() => expect(result.current.offers.get("s1")?.next_task_title).toBe("Next"));
  });

  it("dismissing removes the offer at once", async () => {
    state.rows = [row];
    const { result } = renderHook(() => useSessionOffers());
    await waitFor(() => expect(result.current.offers.size).toBe(1));
    await act(async () => {
      await result.current.setStatus("s1", "dismissed");
    });
    expect(result.current.offers.size).toBe(0);
  });

  it("a failed save puts the offer back and shows an error", async () => {
    state.rows = [row];
    state.updateError = { message: "nope" };
    const { result } = renderHook(() => useSessionOffers());
    await waitFor(() => expect(result.current.offers.size).toBe(1));
    await act(async () => {
      await result.current.setStatus("s1", "dismissed");
    });
    expect(result.current.offers.get("s1")).toBeTruthy();
    expect(toastError).toHaveBeenCalled();
  });

  describe("a missed live event", () => {
    it("shows the bar after the tab becomes visible again", async () => {
      const { result } = renderHook(() => useSessionOffers());
      await waitFor(() => expect(state.reads).toBe(1));
      expect(result.current.offers.size).toBe(0);
      state.rows = [row]; // saved on the server; no live event arrives
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => expect(result.current.offers.has("s1")).toBe(true));
    });

    it("shows the bar on the next timer read", async () => {
      const { result } = renderHook(() => useSessionOffers());
      await waitFor(() => expect(state.reads).toBe(1));
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      // re-mount under fake timers so the interval is the fake one
      const second = renderHook(() => useSessionOffers());
      await vi.waitFor(() => expect(state.reads).toBe(2));
      state.rows = [row];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000);
      });
      vi.useRealTimers();
      await waitFor(() => expect(second.result.current.offers.has("s1")).toBe(true));
      expect(result.current).toBeTruthy();
    });

    it("reads again when the live feed (re)subscribes", async () => {
      const { result } = renderHook(() => useSessionOffers());
      await waitFor(() => expect(state.statusCb).not.toBeNull());
      state.rows = [row];
      act(() => state.statusCb!("SUBSCRIBED"));
      await waitFor(() => expect(result.current.offers.has("s1")).toBe(true));
    });

    it("re-subscribes when the feed closes, without looping on its own cleanup", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      renderHook(() => useSessionOffers());
      await vi.waitFor(() => expect(state.statusCb).not.toBeNull());
      expect(state.channels).toBe(1);
      act(() => state.statusCb!("CLOSED"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      await vi.waitFor(() => expect(state.channels).toBe(2));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20000);
      });
      expect(state.channels).toBe(2);
    });

    it("a re-read does not bring back an offer that is being dismissed", async () => {
      state.rows = [row];
      const { result } = renderHook(() => useSessionOffers());
      await waitFor(() => expect(result.current.offers.size).toBe(1));
      // The save lands after the re-read has already started: the re-read
      // still sees the old row, and must not put it back.
      state.onUpdate = () => {
        state.rows = [];
      };
      await act(async () => {
        const p = result.current.setStatus("s1", "dismissed");
        document.dispatchEvent(new Event("visibilitychange"));
        await p;
      });
      expect(result.current.offers.size).toBe(0);
    });
  });
});
