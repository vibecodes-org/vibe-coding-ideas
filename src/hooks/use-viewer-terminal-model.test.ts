import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockGetTerminalModel = vi.fn();

vi.mock("@/actions/profile", () => ({
  getTerminalModel: () => mockGetTerminalModel(),
}));

// Each test needs a fresh module (the cache is module-level state), so reset
// the module registry between tests rather than sharing cachedModel.
afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("useViewerTerminalModel", () => {
  it("returns undefined immediately, before the fetch resolves", async () => {
    let resolveFetch!: (v: unknown) => void;
    mockGetTerminalModel.mockReturnValue(new Promise((r) => (resolveFetch = r)));

    const { useViewerTerminalModel } = await import("./use-viewer-terminal-model");
    const { result } = renderHook(() => useViewerTerminalModel());
    expect(result.current).toBeUndefined();

    act(() => resolveFetch(null));
  });

  it("updates to the live fetched override once the action resolves", async () => {
    mockGetTerminalModel.mockResolvedValue("sonnet");

    const { useViewerTerminalModel } = await import("./use-viewer-terminal-model");
    const { result } = renderHook(() => useViewerTerminalModel());

    await waitFor(() => expect(result.current).toBe("sonnet"));
  });

  it("resolves to null when the user has no override", async () => {
    mockGetTerminalModel.mockResolvedValue(null);

    const { useViewerTerminalModel } = await import("./use-viewer-terminal-model");
    const { result } = renderHook(() => useViewerTerminalModel());

    await waitFor(() => expect(result.current).toBeNull());
  });

  it("degrades to null (never surfaces an error) if the action rejects", async () => {
    mockGetTerminalModel.mockRejectedValue(new Error("network error"));

    const { useViewerTerminalModel } = await import("./use-viewer-terminal-model");
    const { result } = renderHook(() => useViewerTerminalModel());

    await waitFor(() => expect(result.current).toBeNull());
  });

  it("fetches only once across multiple mounted consumers (shared cache)", async () => {
    mockGetTerminalModel.mockResolvedValue("sonnet");

    const { useViewerTerminalModel } = await import("./use-viewer-terminal-model");
    const a = renderHook(() => useViewerTerminalModel());
    const b = renderHook(() => useViewerTerminalModel());

    await waitFor(() => expect(a.result.current).toBe("sonnet"));
    await waitFor(() => expect(b.result.current).toBe("sonnet"));
    expect(mockGetTerminalModel).toHaveBeenCalledTimes(1);
  });

  it("setViewerTerminalModelCache pushes an update to every mounted consumer", async () => {
    mockGetTerminalModel.mockResolvedValue(null);

    const { useViewerTerminalModel, setViewerTerminalModelCache } = await import("./use-viewer-terminal-model");
    const { result } = renderHook(() => useViewerTerminalModel());

    await waitFor(() => expect(result.current).toBeNull());

    act(() => setViewerTerminalModelCache("opus"));
    expect(result.current).toBe("opus");
  });
});
