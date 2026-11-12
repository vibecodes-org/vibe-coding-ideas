import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockAgentAwareAction = vi.fn();

vi.mock("@/actions/admin-platform", () => ({
  getPlatformModelDefaultsAction: vi.fn(),
  getAgentAwarePlatformModelDefaultsAction: () => mockAgentAwareAction(),
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("usePlatformAgentAwareModelDefaults loading flag", () => {
  it("stops reporting loading once the cache is pushed, even if the fetch is still pending", async () => {
    mockAgentAwareAction.mockReturnValue(new Promise(() => {})); // never resolves
    const { usePlatformAgentAwareModelDefaults, setPlatformAgentAwareModelDefaultsCache } =
      await import("./use-platform-model-defaults");
    const { SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS } = await import("@/lib/platform-model-defaults");

    const { result } = renderHook(() => usePlatformAgentAwareModelDefaults());
    expect(result.current.isLoading).toBe(true);

    act(() => setPlatformAgentAwareModelDefaultsCache(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("a later consumer is not loading once the first fetch has resolved", async () => {
    let resolveFetch!: (v: unknown) => void;
    mockAgentAwareAction.mockReturnValue(new Promise((r) => (resolveFetch = r)));
    const mod = await import("./use-platform-model-defaults");
    const { SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS: seed } = await import("@/lib/platform-model-defaults");

    const first = renderHook(() => mod.usePlatformAgentAwareModelDefaults());
    await act(async () => resolveFetch(seed));
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));

    const second = renderHook(() => mod.usePlatformAgentAwareModelDefaults());
    expect(second.result.current.isLoading).toBe(false);
  });
});
