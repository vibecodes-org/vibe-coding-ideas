import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockGetTerminalAutoAccept = vi.fn();

vi.mock("@/actions/profile", () => ({
  getTerminalAutoAccept: () => mockGetTerminalAutoAccept(),
}));

// Each test needs a fresh module (the cache is module-level state), so reset
// the module registry between tests rather than sharing cachedAutoAccept.
afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("useViewerTerminalAutoAccept (task d3de150c)", () => {
  it("returns undefined immediately, before the fetch resolves", async () => {
    let resolveFetch!: (v: unknown) => void;
    mockGetTerminalAutoAccept.mockReturnValue(new Promise((r) => (resolveFetch = r)));

    const { useViewerTerminalAutoAccept } = await import("./use-viewer-terminal-auto-accept");
    const { result } = renderHook(() => useViewerTerminalAutoAccept());
    expect(result.current).toBeUndefined();

    act(() => resolveFetch(false));
  });

  it("updates to the live fetched preference once the action resolves", async () => {
    mockGetTerminalAutoAccept.mockResolvedValue(true);

    const { useViewerTerminalAutoAccept } = await import("./use-viewer-terminal-auto-accept");
    const { result } = renderHook(() => useViewerTerminalAutoAccept());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("resolves to false when the user has never opted in", async () => {
    mockGetTerminalAutoAccept.mockResolvedValue(false);

    const { useViewerTerminalAutoAccept } = await import("./use-viewer-terminal-auto-accept");
    const { result } = renderHook(() => useViewerTerminalAutoAccept());

    await waitFor(() => expect(result.current).toBe(false));
  });

  it("degrades to false (never surfaces an error) if the action rejects — fail-safe, never fail-open", async () => {
    mockGetTerminalAutoAccept.mockRejectedValue(new Error("network error"));

    const { useViewerTerminalAutoAccept } = await import("./use-viewer-terminal-auto-accept");
    const { result } = renderHook(() => useViewerTerminalAutoAccept());

    await waitFor(() => expect(result.current).toBe(false));
  });

  it("fetches only once across multiple mounted consumers (shared cache)", async () => {
    mockGetTerminalAutoAccept.mockResolvedValue(true);

    const { useViewerTerminalAutoAccept } = await import("./use-viewer-terminal-auto-accept");
    const a = renderHook(() => useViewerTerminalAutoAccept());
    const b = renderHook(() => useViewerTerminalAutoAccept());

    await waitFor(() => expect(a.result.current).toBe(true));
    await waitFor(() => expect(b.result.current).toBe(true));
    expect(mockGetTerminalAutoAccept).toHaveBeenCalledTimes(1);
  });

  it("setViewerTerminalAutoAcceptCache pushes an update to every mounted consumer", async () => {
    mockGetTerminalAutoAccept.mockResolvedValue(false);

    const { useViewerTerminalAutoAccept, setViewerTerminalAutoAcceptCache } = await import(
      "./use-viewer-terminal-auto-accept"
    );
    const { result } = renderHook(() => useViewerTerminalAutoAccept());

    await waitFor(() => expect(result.current).toBe(false));

    act(() => setViewerTerminalAutoAcceptCache(true));
    expect(result.current).toBe(true);
  });
});
