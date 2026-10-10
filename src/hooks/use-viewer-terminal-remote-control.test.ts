import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockGetTerminalRemoteControl = vi.fn();

vi.mock("@/actions/profile", () => ({
  getTerminalRemoteControl: () => mockGetTerminalRemoteControl(),
}));

// Each test needs a fresh module (the cache is module-level state), so reset
// the module registry between tests rather than sharing cachedRemoteControl.
afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("useViewerTerminalRemoteControl (task 5c8969cc)", () => {
  it("returns undefined immediately, before the fetch resolves", async () => {
    let resolveFetch!: (v: unknown) => void;
    mockGetTerminalRemoteControl.mockReturnValue(new Promise((r) => (resolveFetch = r)));

    const { useViewerTerminalRemoteControl } = await import("./use-viewer-terminal-remote-control");
    const { result } = renderHook(() => useViewerTerminalRemoteControl());
    expect(result.current).toBeUndefined();

    act(() => resolveFetch(false));
  });

  it("updates to the live fetched preference once the action resolves", async () => {
    mockGetTerminalRemoteControl.mockResolvedValue(true);

    const { useViewerTerminalRemoteControl } = await import("./use-viewer-terminal-remote-control");
    const { result } = renderHook(() => useViewerTerminalRemoteControl());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("resolves to false when the user has never opted in", async () => {
    mockGetTerminalRemoteControl.mockResolvedValue(false);

    const { useViewerTerminalRemoteControl } = await import("./use-viewer-terminal-remote-control");
    const { result } = renderHook(() => useViewerTerminalRemoteControl());

    await waitFor(() => expect(result.current).toBe(false));
  });

  it("degrades to false (never surfaces an error) if the action rejects — fail-safe, never fail-open", async () => {
    mockGetTerminalRemoteControl.mockRejectedValue(new Error("network error"));

    const { useViewerTerminalRemoteControl } = await import("./use-viewer-terminal-remote-control");
    const { result } = renderHook(() => useViewerTerminalRemoteControl());

    await waitFor(() => expect(result.current).toBe(false));
  });

  it("fetches only once across multiple mounted consumers (shared cache)", async () => {
    mockGetTerminalRemoteControl.mockResolvedValue(true);

    const { useViewerTerminalRemoteControl } = await import("./use-viewer-terminal-remote-control");
    const a = renderHook(() => useViewerTerminalRemoteControl());
    const b = renderHook(() => useViewerTerminalRemoteControl());

    await waitFor(() => expect(a.result.current).toBe(true));
    await waitFor(() => expect(b.result.current).toBe(true));
    expect(mockGetTerminalRemoteControl).toHaveBeenCalledTimes(1);
  });

  it("setViewerTerminalRemoteControlCache pushes an update to every mounted consumer", async () => {
    mockGetTerminalRemoteControl.mockResolvedValue(false);

    const { useViewerTerminalRemoteControl, setViewerTerminalRemoteControlCache } = await import(
      "./use-viewer-terminal-remote-control"
    );
    const { result } = renderHook(() => useViewerTerminalRemoteControl());

    await waitFor(() => expect(result.current).toBe(false));

    act(() => setViewerTerminalRemoteControlCache(true));
    expect(result.current).toBe(true);
  });
});
