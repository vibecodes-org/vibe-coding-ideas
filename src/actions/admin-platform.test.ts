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

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Import after mocks are set up
import {
  getPlatformModelDefaultsAction,
  getPlatformModelDefaultsForAdmin,
  updatePlatformModelDefaults,
} from "./admin-platform";
import { SEED_PLATFORM_MODEL_DEFAULTS } from "@/lib/platform-model-defaults";

const SUPER_ADMIN_ID = "00000000-0000-0000-0000-0000000000aa";
const REGULAR_USER_ID = "00000000-0000-0000-0000-0000000000bb";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPlatformModelDefaultsAction", () => {
  it("returns the seed constants when no row is saved yet", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }));

    const result = await getPlatformModelDefaultsAction();
    expect(result).toEqual(SEED_PLATFORM_MODEL_DEFAULTS);
  });

  it("returns the live saved value — any authenticated user can read (no admin check)", async () => {
    const live = { defaults: { frontier: "fable", standard: "sonnet", cheap: "haiku" }, fallback: {} };
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { value: live }, error: null }) }) }),
    }));

    const result = await getPlatformModelDefaultsAction();
    expect(result).toEqual(live);
    // Not gated behind auth.getUser at all — the read path never checks it.
    expect(mockSupabase.auth.getUser).not.toHaveBeenCalled();
  });
});

describe("getPlatformModelDefaultsForAdmin", () => {
  it("reports isSeed=true and null audit fields when nothing has been saved", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }));

    const result = await getPlatformModelDefaultsForAdmin();
    expect(result.isSeed).toBe(true);
    expect(result.value).toEqual(SEED_PLATFORM_MODEL_DEFAULTS);
    expect(result.updatedBy).toBeNull();
    expect(result.updatedAt).toBeNull();
  });

  it("surfaces the audit line (updated_by/updated_at) for a saved row", async () => {
    const live = { defaults: { frontier: "fable", standard: "sonnet", cheap: "haiku" }, fallback: {} };
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                value: live,
                updated_at: "2026-07-20T00:00:00Z",
                updated_by: { id: SUPER_ADMIN_ID, full_name: "Nick Ball" },
              },
              error: null,
            }),
        }),
      }),
    }));

    const result = await getPlatformModelDefaultsForAdmin();
    expect(result.isSeed).toBe(false);
    expect(result.value).toEqual(live);
    expect(result.updatedBy).toEqual({ id: SUPER_ADMIN_ID, full_name: "Nick Ball" });
    expect(result.updatedAt).toBe("2026-07-20T00:00:00Z");
  });

  it("falls back to the seed value when the saved row is structurally invalid", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { value: { defaults: { frontier: "opus" } }, updated_at: "2026-07-20T00:00:00Z", updated_by: null },
              error: null,
            }),
        }),
      }),
    }));

    const result = await getPlatformModelDefaultsForAdmin();
    expect(result.value).toEqual(SEED_PLATFORM_MODEL_DEFAULTS);
  });
});

describe("updatePlatformModelDefaults — super-admin gate", () => {
  const validInput = {
    defaults: { frontier: "opus", standard: "sonnet", cheap: "haiku" },
    fallback: { fable: "opus", opus: "fable", sonnet: "opus", haiku: "sonnet" },
  };

  it("throws when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(updatePlatformModelDefaults(validInput)).rejects.toThrow("Not authenticated");
  });

  it("throws for an authenticated non-super-admin (denied)", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: REGULAR_USER_ID } }, error: null });
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { is_super_admin: false }, error: null }) }) }),
    }));

    await expect(updatePlatformModelDefaults(validInput)).rejects.toThrow("Super admin access required");
  });

  it("saves and returns the parsed value for a super-admin (allowed)", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: SUPER_ADMIN_ID } }, error: null });
    let upsertedWith: unknown;

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "users") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { is_super_admin: true }, error: null }) }) }) };
      }
      return {
        upsert: (row: unknown) => {
          upsertedWith = row;
          return Promise.resolve({ error: null });
        },
      };
    });

    const result = await updatePlatformModelDefaults(validInput);
    expect(result).toEqual(validInput);
    expect(upsertedWith).toMatchObject({
      key: "model_tier_defaults",
      value: validInput,
      updated_by: SUPER_ADMIN_ID,
    });
    expect((upsertedWith as { updated_at: string }).updated_at).toBeTruthy();
  });

  it("rejects a novel-family value that's too long, before ever touching the DB", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: SUPER_ADMIN_ID } }, error: null });

    await expect(
      updatePlatformModelDefaults({
        defaults: { frontier: "a".repeat(41), standard: "sonnet", cheap: "haiku" },
        fallback: {},
      })
    ).rejects.toThrow();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it("accepts a novel free-text model family (no schema change required)", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: SUPER_ADMIN_ID } }, error: null });
    let upsertedWith: unknown;

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "users") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { is_super_admin: true }, error: null }) }) }) };
      }
      return {
        upsert: (row: unknown) => {
          upsertedWith = row;
          return Promise.resolve({ error: null });
        },
      };
    });

    const novel = {
      defaults: { frontier: "opus-5.5", standard: "sonnet", cheap: "haiku" },
      fallback: { "opus-5.5": "opus" },
    };
    const result = await updatePlatformModelDefaults(novel);
    expect(result).toEqual(novel);
    expect((upsertedWith as { value: unknown }).value).toEqual(novel);
  });

  it("throws a safe message (never the raw DB error) when the upsert fails", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: SUPER_ADMIN_ID } }, error: null });

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "users") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { is_super_admin: true }, error: null }) }) }) };
      }
      return { upsert: () => Promise.resolve({ error: { message: "constraint violation on internal_column_xyz" } }) };
    });

    await expect(updatePlatformModelDefaults(validInput)).rejects.toThrow(
      "Failed to save platform model defaults — try again"
    );
  });
});
