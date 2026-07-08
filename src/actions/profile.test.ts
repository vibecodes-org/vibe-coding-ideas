import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Minimal Supabase client mock
// ---------------------------------------------------------------------------

const mockSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSupabase,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Import after mocks are set up
import { getModelTierMap, updateModelTierMap } from "./profile";

const FAKE_USER_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: FAKE_USER_ID } }, error: null });
});

describe("getModelTierMap", () => {
  it("returns the stored map for the authenticated user", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { model_tier_map: { frontier: "opus" } }, error: null }),
        }),
      }),
    }));

    const result = await getModelTierMap();
    expect(result).toEqual({ frontier: "opus" });
  });

  it("returns null when the column is null", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { model_tier_map: null }, error: null }),
        }),
      }),
    }));

    const result = await getModelTierMap();
    expect(result).toBeNull();
  });

  it("throws when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(getModelTierMap()).rejects.toThrow("Not authenticated");
  });

  it("propagates DB errors", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: { message: "connection lost" } }),
        }),
      }),
    }));
    await expect(getModelTierMap()).rejects.toThrow("connection lost");
  });
});

describe("updateModelTierMap", () => {
  it("accepts a valid partial map and stores it scoped to the current user", async () => {
    let updatedWith: unknown;
    let scopedTo: unknown;
    mockSupabase.from.mockImplementation(() => ({
      update: (data: unknown) => ({
        eq: (col: string, val: unknown) => {
          updatedWith = data;
          scopedTo = { [col]: val };
          return Promise.resolve({ error: null });
        },
      }),
    }));

    const result = await updateModelTierMap({ frontier: "opus", cheap: "haiku" });

    expect(result).toEqual({ frontier: "opus", cheap: "haiku" });
    expect(updatedWith).toEqual({ model_tier_map: { frontier: "opus", cheap: "haiku" } });
    expect(scopedTo).toEqual({ id: FAKE_USER_ID });
  });

  it("accepts every valid tier/model combination", async () => {
    mockSupabase.from.mockImplementation(() => ({
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }));

    await expect(
      updateModelTierMap({ frontier: "fable", standard: "sonnet", cheap: "haiku" })
    ).resolves.toEqual({ frontier: "fable", standard: "sonnet", cheap: "haiku" });
  });

  it("stores NULL for an empty map (all tiers reset to platform default)", async () => {
    let updatedWith: unknown;
    mockSupabase.from.mockImplementation(() => ({
      update: (data: unknown) => {
        updatedWith = data;
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }));

    const result = await updateModelTierMap({});

    expect(result).toBeNull();
    expect(updatedWith).toEqual({ model_tier_map: null });
  });

  it("rejects an unknown key", async () => {
    await expect(
      updateModelTierMap({ nonsense: "opus" } as never)
    ).rejects.toThrow("Invalid model tier map");
  });

  it("rejects an invalid model value", async () => {
    await expect(
      updateModelTierMap({ frontier: "gpt-4" } as never)
    ).rejects.toThrow("Invalid model tier map");
  });

  it("rejects a non-object payload", async () => {
    await expect(updateModelTierMap("opus" as never)).rejects.toThrow("Invalid model tier map");
    await expect(updateModelTierMap(null as never)).rejects.toThrow("Invalid model tier map");
    await expect(updateModelTierMap(["opus"] as never)).rejects.toThrow("Invalid model tier map");
  });

  it("throws when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(updateModelTierMap({ frontier: "opus" })).rejects.toThrow("Not authenticated");
  });

  it("propagates DB errors", async () => {
    mockSupabase.from.mockImplementation(() => ({
      update: () => ({ eq: () => Promise.resolve({ error: { message: "write failed" } }) }),
    }));
    await expect(updateModelTierMap({ frontier: "opus" })).rejects.toThrow("write failed");
  });
});
