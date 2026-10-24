import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockAction = vi.fn();

vi.mock("@/actions/admin-platform", () => ({
  getPlatformTerminalAutoCompactDefaultAction: (agent: string) => mockAction(agent),
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("usePlatformTerminalAutoCompactDefault", () => {
  it("is undefined while loading, then the live value", async () => {
    let resolveFetch!: (v: unknown) => void;
    mockAction.mockReturnValue(new Promise((r) => (resolveFetch = r)));
    const { usePlatformTerminalAutoCompactDefault } = await import("./use-platform-terminal-auto-compact-default");
    const { result } = renderHook(() => usePlatformTerminalAutoCompactDefault("claude"));
    expect(result.current).toBeUndefined();
    act(() => resolveFetch(300000));
    await waitFor(() => expect(result.current).toBe(300000));
  });

  it("resolves to null when nothing is saved, and when the action rejects", async () => {
    mockAction.mockResolvedValue(null);
    const mod = await import("./use-platform-terminal-auto-compact-default");
    const a = renderHook(() => mod.usePlatformTerminalAutoCompactDefault("codex"));
    await waitFor(() => expect(a.result.current).toBeNull());

    vi.resetModules();
    mockAction.mockRejectedValue(new Error("network"));
    const mod2 = await import("./use-platform-terminal-auto-compact-default");
    const b = renderHook(() => mod2.usePlatformTerminalAutoCompactDefault("claude"));
    await waitFor(() => expect(b.result.current).toBeNull());
  });

  it("keeps a separate cache and fetch per agent, once each", async () => {
    mockAction.mockImplementation((agent: string) => Promise.resolve(agent === "claude" ? 300000 : 150000));
    const mod = await import("./use-platform-terminal-auto-compact-default");
    const c1 = renderHook(() => mod.usePlatformTerminalAutoCompactDefault("claude"));
    const c2 = renderHook(() => mod.usePlatformTerminalAutoCompactDefault("claude"));
    const x = renderHook(() => mod.usePlatformTerminalAutoCompactDefault("codex"));
    await waitFor(() => expect(x.result.current).toBe(150000));
    await waitFor(() => expect(c1.result.current).toBe(300000));
    expect(c2.result.current).toBe(300000);
    expect(mockAction).toHaveBeenCalledTimes(2);
  });

  it("setPlatformTerminalAutoCompactDefaultCache updates mounted consumers of that agent only", async () => {
    mockAction.mockResolvedValue(300000);
    const mod = await import("./use-platform-terminal-auto-compact-default");
    const c = renderHook(() => mod.usePlatformTerminalAutoCompactDefault("claude"));
    await waitFor(() => expect(c.result.current).toBe(300000));
    act(() => mod.setPlatformTerminalAutoCompactDefaultCache("claude", null));
    expect(c.result.current).toBeNull();
    const x = renderHook(() => mod.usePlatformTerminalAutoCompactDefault("codex"));
    await waitFor(() => expect(x.result.current).toBe(300000));
  });
});
