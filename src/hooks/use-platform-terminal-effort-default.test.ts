import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockGetPlatformTerminalEffortDefaultAction = vi.fn();

vi.mock("@/actions/admin-platform", () => ({
  getPlatformTerminalEffortDefaultAction: () => mockGetPlatformTerminalEffortDefaultAction(),
}));

// Each test needs a fresh module (the cache is module-level state), so reset
// the module registry between tests rather than sharing cachedDefault.
afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("usePlatformTerminalEffortDefault (binding: no seed)", () => {
  it("returns undefined immediately, before the fetch resolves — no seed placeholder", async () => {
    let resolveFetch!: (v: unknown) => void;
    mockGetPlatformTerminalEffortDefaultAction.mockReturnValue(new Promise((r) => (resolveFetch = r)));

    const { usePlatformTerminalEffortDefault } = await import("./use-platform-terminal-effort-default");
    const { result } = renderHook(() => usePlatformTerminalEffortDefault());
    expect(result.current).toBeUndefined();

    act(() => resolveFetch(null));
  });

  it("updates to the live fetched value once the action resolves", async () => {
    mockGetPlatformTerminalEffortDefaultAction.mockResolvedValue("high");

    const { usePlatformTerminalEffortDefault } = await import("./use-platform-terminal-effort-default");
    const { result } = renderHook(() => usePlatformTerminalEffortDefault());

    await waitFor(() => expect(result.current).toBe("high"));
  });

  it("resolves to null when nothing has been saved yet — a real, distinct state from undefined", async () => {
    mockGetPlatformTerminalEffortDefaultAction.mockResolvedValue(null);

    const { usePlatformTerminalEffortDefault } = await import("./use-platform-terminal-effort-default");
    const { result } = renderHook(() => usePlatformTerminalEffortDefault());

    await waitFor(() => expect(result.current).toBeNull());
  });

  it("degrades to null (never surfaces an error) if the action rejects", async () => {
    mockGetPlatformTerminalEffortDefaultAction.mockRejectedValue(new Error("network error"));

    const { usePlatformTerminalEffortDefault } = await import("./use-platform-terminal-effort-default");
    const { result } = renderHook(() => usePlatformTerminalEffortDefault());

    await waitFor(() => expect(result.current).toBeNull());
  });

  it("fetches only once across multiple mounted consumers (shared cache)", async () => {
    mockGetPlatformTerminalEffortDefaultAction.mockResolvedValue("high");

    const { usePlatformTerminalEffortDefault } = await import("./use-platform-terminal-effort-default");
    const a = renderHook(() => usePlatformTerminalEffortDefault());
    const b = renderHook(() => usePlatformTerminalEffortDefault());

    await waitFor(() => expect(a.result.current).toBe("high"));
    await waitFor(() => expect(b.result.current).toBe("high"));
    expect(mockGetPlatformTerminalEffortDefaultAction).toHaveBeenCalledTimes(1);
  });

  it("setPlatformTerminalEffortDefaultCache pushes an update to every mounted consumer", async () => {
    mockGetPlatformTerminalEffortDefaultAction.mockResolvedValue(null);

    const { usePlatformTerminalEffortDefault, setPlatformTerminalEffortDefaultCache } = await import(
      "./use-platform-terminal-effort-default"
    );
    const { result } = renderHook(() => usePlatformTerminalEffortDefault());

    await waitFor(() => expect(result.current).toBeNull());

    act(() => setPlatformTerminalEffortDefaultCache("sonnet"));
    expect(result.current).toBe("sonnet");
  });
});
