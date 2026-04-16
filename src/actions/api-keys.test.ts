import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Import after mocks are set up
import { generateApiKey, listApiKeys, revokeApiKey } from "./api-keys";

const FAKE_USER_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: FAKE_USER_ID } }, error: null });
});

describe("generateApiKey", () => {
  it("returns a vbc_-prefixed key and stores the hash", async () => {
    let insertedHash: string | undefined;

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "user_api_keys") {
        return {
          insert: (row: { key_hash: string }) => {
            insertedHash = row.key_hash;
            return Promise.resolve({ error: null });
          },
        };
      }
    });

    const key = await generateApiKey("My Codex session");

    expect(key).toMatch(/^vbc_[0-9a-f]{64}$/);
    expect(insertedHash).toBe(createHash("sha256").update(key).digest("hex"));
  });

  it("throws when name is empty", async () => {
    await expect(generateApiKey("")).rejects.toThrow("Name is required");
  });

  it("throws when name exceeds 100 characters", async () => {
    await expect(generateApiKey("x".repeat(101))).rejects.toThrow("100 characters");
  });

  it("throws when not authenticated", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(generateApiKey("test")).rejects.toThrow("Not authenticated");
  });

  it("propagates DB errors", async () => {
    mockSupabase.from.mockImplementation(() => ({
      insert: () => Promise.resolve({ error: { message: "unique constraint" } }),
    }));
    await expect(generateApiKey("test")).rejects.toThrow("unique constraint");
  });
});

describe("listApiKeys", () => {
  it("returns keys without hashes", async () => {
    const rows = [
      { id: "k1", name: "Codex", created_at: "2026-01-01T00:00:00Z", last_used_at: null, expires_at: null },
    ];
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }),
    }));

    const result = await listApiKeys();
    expect(result).toEqual(rows);
    // Confirm no key_hash field
    expect(Object.keys(result[0])).not.toContain("key_hash");
  });

  it("returns empty array when no keys exist", async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: null, error: null }) }) }),
    }));
    const result = await listApiKeys();
    expect(result).toEqual([]);
  });
});

describe("revokeApiKey", () => {
  it("deletes by id scoped to current user", async () => {
    const deletedWith: unknown[] = [];
    mockSupabase.from.mockImplementation(() => ({
      delete: () => ({
        eq: (col: string, val: string) => ({
          eq: (col2: string, val2: string) => {
            deletedWith.push({ [col]: val, [col2]: val2 });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    }));

    await revokeApiKey("k1");
    expect(deletedWith).toContainEqual({ id: "k1", user_id: FAKE_USER_ID });
  });

  it("throws on DB error", async () => {
    mockSupabase.from.mockImplementation(() => ({
      delete: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ error: { message: "not found" } }),
        }),
      }),
    }));
    await expect(revokeApiKey("missing")).rejects.toThrow("not found");
  });
});
