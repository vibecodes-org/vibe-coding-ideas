import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockGetPlatformModelDefaultsAction = vi.fn();

vi.mock("@/actions/admin-platform", () => ({
  getPlatformModelDefaultsAction: () => mockGetPlatformModelDefaultsAction(),
}));

// Each test needs a fresh module (the cache is module-level state), so reset
// the module registry between tests rather than sharing cachedDefaults.
afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("usePlatformModelDefaults", () => {
  it("returns the seed constants immediately, before the fetch resolves", async () => {
    let resolveFetch!: (v: unknown) => void;
    mockGetPlatformModelDefaultsAction.mockReturnValue(new Promise((r) => (resolveFetch = r)));

    const { usePlatformModelDefaults } = await import("./use-platform-model-defaults");
    const { SEED_PLATFORM_MODEL_DEFAULTS } = await import("@/lib/platform-model-defaults");

    const { result } = renderHook(() => usePlatformModelDefaults());
    expect(result.current).toEqual(SEED_PLATFORM_MODEL_DEFAULTS);

    // Let the pending promise resolve to avoid an unhandled-rejection/act warning leak.
    act(() => resolveFetch(SEED_PLATFORM_MODEL_DEFAULTS));
  });

  it("updates to the live fetched value once the action resolves", async () => {
    const live = { defaults: { frontier: "fable", standard: "sonnet", cheap: "haiku" }, fallback: {} };
    mockGetPlatformModelDefaultsAction.mockResolvedValue(live);

    const { usePlatformModelDefaults } = await import("./use-platform-model-defaults");
    const { result } = renderHook(() => usePlatformModelDefaults());

    await waitFor(() => expect(result.current).toEqual(live));
  });

  it("falls back to the seed constants if the action rejects — never surfaces an error", async () => {
    mockGetPlatformModelDefaultsAction.mockRejectedValue(new Error("network error"));

    const { usePlatformModelDefaults } = await import("./use-platform-model-defaults");
    const { SEED_PLATFORM_MODEL_DEFAULTS } = await import("@/lib/platform-model-defaults");
    const { result } = renderHook(() => usePlatformModelDefaults());

    await waitFor(() => expect(result.current).toEqual(SEED_PLATFORM_MODEL_DEFAULTS));
  });

  it("fetches only once across multiple mounted consumers (shared cache)", async () => {
    const live = { defaults: { frontier: "opus", standard: "sonnet", cheap: "haiku" }, fallback: {} };
    mockGetPlatformModelDefaultsAction.mockResolvedValue(live);

    const { usePlatformModelDefaults } = await import("./use-platform-model-defaults");

    const a = renderHook(() => usePlatformModelDefaults());
    const b = renderHook(() => usePlatformModelDefaults());

    await waitFor(() => expect(a.result.current).toEqual(live));
    await waitFor(() => expect(b.result.current).toEqual(live));
    expect(mockGetPlatformModelDefaultsAction).toHaveBeenCalledTimes(1);
  });

  it("setPlatformModelDefaultsCache pushes an update to every mounted consumer", async () => {
    const initial = { defaults: { frontier: "opus", standard: "sonnet", cheap: "haiku" }, fallback: {} };
    mockGetPlatformModelDefaultsAction.mockResolvedValue(initial);

    const { usePlatformModelDefaults, setPlatformModelDefaultsCache } = await import("./use-platform-model-defaults");
    const { result } = renderHook(() => usePlatformModelDefaults());

    await waitFor(() => expect(result.current).toEqual(initial));

    const saved = { defaults: { frontier: "fable", standard: "sonnet", cheap: "haiku" }, fallback: {} };
    act(() => setPlatformModelDefaultsCache(saved));

    expect(result.current).toEqual(saved);
  });
});
