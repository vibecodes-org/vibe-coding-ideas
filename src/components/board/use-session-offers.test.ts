import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const { toastError, state } = vi.hoisted(() => ({
  toastError: vi.fn(),
  state: { updateError: null as { message: string } | null, rows: [] as Record<string, unknown>[] },
}));

vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch, unsubscribe: async () => {} };
      return ch;
    },
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => ({ gte: async () => ({ data: state.rows, error: null }) }) }),
      }),
      update: () => ({
        eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: state.updateError }) }) }),
      }),
    }),
  }),
}));

import { useSessionOffers } from "./use-session-offers";

const row = { sid: "s1", user_id: "u1", idea_id: "i1", status: "offered", next_task_title: "Next" };

afterEach(() => {
  state.updateError = null;
  state.rows = [];
  toastError.mockClear();
});

describe("useSessionOffers", () => {
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
});
