import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// Card c4c27987 (Option A) — the one-time Undo toast (spec §3) lives inside
// persistViewerTerminalAgent so every picker gets it for free. These tests
// exercise that logic directly (no React component), mocking the server
// actions and sonner's toast().

const mockGetTerminalAgent = vi.fn();
const mockUpdateTerminalAgent = vi.fn();
const mockGetTerminalAgentToastSeen = vi.fn();
const mockMarkTerminalAgentToastSeen = vi.fn();

vi.mock("@/actions/profile", () => ({
  getTerminalAgent: () => mockGetTerminalAgent(),
  updateTerminalAgent: (agent: string) => mockUpdateTerminalAgent(agent),
  getTerminalAgentToastSeen: () => mockGetTerminalAgentToastSeen(),
  markTerminalAgentToastSeen: () => mockMarkTerminalAgentToastSeen(),
}));

const mockToast = vi.fn();
vi.mock("sonner", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

// Each test needs a fresh module (the agent cache is module-level state), so
// reset the module registry between tests rather than sharing cachedAgent —
// same posture as use-viewer-terminal-model.test.ts.
afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

function defaults() {
  mockUpdateTerminalAgent.mockImplementation(async (agent: string) => agent);
  mockGetTerminalAgentToastSeen.mockResolvedValue(false);
  mockMarkTerminalAgentToastSeen.mockResolvedValue(undefined);
}

describe("persistViewerTerminalAgent — the one-time Undo toast", () => {
  it("picker write that changes the value, never seen before: shows the toast once and marks it seen", async () => {
    defaults();
    mockGetTerminalAgent.mockResolvedValue("claude");
    const mod = await import("./use-viewer-terminal-agent");
    const { result } = renderHook(() => mod.useViewerTerminalAgent());
    await waitFor(() => expect(result.current).toBe("claude"));

    await act(async () => {
      await mod.persistViewerTerminalAgent("codex", { source: "picker" });
    });

    expect(mockUpdateTerminalAgent).toHaveBeenCalledWith("codex");
    await waitFor(() => expect(mockMarkTerminalAgentToastSeen).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledTimes(1);
    const [message, opts] = mockToast.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe(
      "Your launch button now starts Codex. Change it any time from the button's menu."
    );
    expect(opts.action.label).toBe("Undo");
  });

  it("Undo reverts to the previous agent and shows no second toast", async () => {
    defaults();
    mockGetTerminalAgent.mockResolvedValue("claude");
    const mod = await import("./use-viewer-terminal-agent");
    const { result } = renderHook(() => mod.useViewerTerminalAgent());
    await waitFor(() => expect(result.current).toBe("claude"));

    await act(async () => {
      await mod.persistViewerTerminalAgent("codex", { source: "picker" });
    });
    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));

    const [, opts] = mockToast.mock.calls[0] as [string, { action: { onClick: () => void } }];
    await act(async () => {
      opts.action.onClick();
      await Promise.resolve();
    });

    await waitFor(() => expect(mockUpdateTerminalAgent).toHaveBeenLastCalledWith("claude"));
    expect(result.current).toBe("claude");
    // Undo itself is source: "undo" — never triggers a second toast.
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it("already seen: no toast, but the write still succeeds", async () => {
    defaults();
    mockGetTerminalAgentToastSeen.mockResolvedValue(true);
    mockGetTerminalAgent.mockResolvedValue("claude");
    const mod = await import("./use-viewer-terminal-agent");
    const { result } = renderHook(() => mod.useViewerTerminalAgent());
    await waitFor(() => expect(result.current).toBe("claude"));

    await act(async () => {
      await mod.persistViewerTerminalAgent("codex", { source: "picker" });
    });

    await waitFor(() => expect(result.current).toBe("codex"));
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockMarkTerminalAgentToastSeen).not.toHaveBeenCalled();
  });

  it("same-value write: no toast (nothing actually changed)", async () => {
    defaults();
    mockGetTerminalAgent.mockResolvedValue("claude");
    const mod = await import("./use-viewer-terminal-agent");
    const { result } = renderHook(() => mod.useViewerTerminalAgent());
    await waitFor(() => expect(result.current).toBe("claude"));

    await act(async () => {
      await mod.persistViewerTerminalAgent("claude", { source: "picker" });
    });

    expect(mockToast).not.toHaveBeenCalled();
    expect(mockGetTerminalAgentToastSeen).not.toHaveBeenCalled();
  });

  it("footer source: never toasts, even on a real change and an unseen flag", async () => {
    defaults();
    mockGetTerminalAgent.mockResolvedValue("claude");
    const mod = await import("./use-viewer-terminal-agent");
    const { result } = renderHook(() => mod.useViewerTerminalAgent());
    await waitFor(() => expect(result.current).toBe("claude"));

    await act(async () => {
      await mod.persistViewerTerminalAgent("codex", { source: "footer" });
    });

    expect(mockToast).not.toHaveBeenCalled();
    expect(mockGetTerminalAgentToastSeen).not.toHaveBeenCalled();
  });

  it("default source (no options passed) behaves as 'picker' — existing call sites keep working", async () => {
    defaults();
    mockGetTerminalAgent.mockResolvedValue("claude");
    const mod = await import("./use-viewer-terminal-agent");
    const { result } = renderHook(() => mod.useViewerTerminalAgent());
    await waitFor(() => expect(result.current).toBe("claude"));

    await act(async () => {
      await mod.persistViewerTerminalAgent("codex");
    });

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1));
  });

  it("a failed seen-flag check never blocks or throws out of the write", async () => {
    defaults();
    mockGetTerminalAgentToastSeen.mockRejectedValue(new Error("network"));
    mockGetTerminalAgent.mockResolvedValue("claude");
    const mod = await import("./use-viewer-terminal-agent");
    const { result } = renderHook(() => mod.useViewerTerminalAgent());
    await waitFor(() => expect(result.current).toBe("claude"));

    await expect(
      mod.persistViewerTerminalAgent("codex", { source: "picker" })
    ).resolves.toBe("codex");
    await waitFor(() => expect(result.current).toBe("codex"));
    expect(mockToast).not.toHaveBeenCalled();
  });
});
