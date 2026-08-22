import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockGetPlatformTerminalModelDefaultAction = vi.fn();

vi.mock("@/actions/admin-platform", () => ({
  getPlatformTerminalModelDefaultAction: () => mockGetPlatformTerminalModelDefaultAction(),
}));

// Each test needs a fresh module (the cache is module-level state), so reset
// the module registry between tests rather than sharing cachedDefault.
afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("usePlatformTerminalModelDefault (binding: no seed)", () => {
  it("returns undefined immediately, before the fetch resolves — no seed placeholder", async () => {
    let resolveFetch!: (v: unknown) => void;
    mockGetPlatformTerminalModelDefaultAction.mockReturnValue(new Promise((r) => (resolveFetch = r)));

    const { usePlatformTerminalModelDefault } = await import("./use-platform-terminal-model-default");
    const { result } = renderHook(() => usePlatformTerminalModelDefault());
    expect(result.current).toBeUndefined();

    act(() => resolveFetch(null));
  });

  it("updates to the live fetched value once the action resolves", async () => {
    mockGetPlatformTerminalModelDefaultAction.mockResolvedValue("opus");

    const { usePlatformTerminalModelDefault } = await import("./use-platform-terminal-model-default");
    const { result } = renderHook(() => usePlatformTerminalModelDefault());

    await waitFor(() => expect(result.current).toBe("opus"));
  });

  it("resolves to null when nothing has been saved yet — a real, distinct state from undefined", async () => {
    mockGetPlatformTerminalModelDefaultAction.mockResolvedValue(null);

    const { usePlatformTerminalModelDefault } = await import("./use-platform-terminal-model-default");
    const { result } = renderHook(() => usePlatformTerminalModelDefault());

    await waitFor(() => expect(result.current).toBeNull());
  });

  it("degrades to null (never surfaces an error) if the action rejects", async () => {
    mockGetPlatformTerminalModelDefaultAction.mockRejectedValue(new Error("network error"));

    const { usePlatformTerminalModelDefault } = await import("./use-platform-terminal-model-default");
    const { result } = renderHook(() => usePlatformTerminalModelDefault());

    await waitFor(() => expect(result.current).toBeNull());
  });

  it("fetches only once across multiple mounted consumers (shared cache)", async () => {
    mockGetPlatformTerminalModelDefaultAction.mockResolvedValue("opus");

    const { usePlatformTerminalModelDefault } = await import("./use-platform-terminal-model-default");
    const a = renderHook(() => usePlatformTerminalModelDefault());
    const b = renderHook(() => usePlatformTerminalModelDefault());

    await waitFor(() => expect(a.result.current).toBe("opus"));
    await waitFor(() => expect(b.result.current).toBe("opus"));
    expect(mockGetPlatformTerminalModelDefaultAction).toHaveBeenCalledTimes(1);
  });

  it("setPlatformTerminalModelDefaultCache pushes an update to every mounted consumer", async () => {
    mockGetPlatformTerminalModelDefaultAction.mockResolvedValue(null);

    const { usePlatformTerminalModelDefault, setPlatformTerminalModelDefaultCache } = await import(
      "./use-platform-terminal-model-default"
    );
    const { result } = renderHook(() => usePlatformTerminalModelDefault());

    await waitFor(() => expect(result.current).toBeNull());

    act(() => setPlatformTerminalModelDefaultCache("sonnet"));
    expect(result.current).toBe("sonnet");
  });
});
