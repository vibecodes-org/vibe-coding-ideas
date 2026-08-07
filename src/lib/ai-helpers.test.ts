import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { decrementStarterCredit, chargeAiUsage, resolveAiProvider, AI_MODEL } from "./ai-helpers";

// Mock logger to suppress output
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock encryption module (imported by ai-helpers)
const mockDecrypt = vi.fn();
vi.mock("@/lib/encryption", () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

// Mock `@supabase/supabase-js`'s `createClient` — this is what
// resolveAiProvider() uses (aliased to `createSupabaseJsClient`) to build the
// service-role client that reads `encrypted_anthropic_key`. Keeping this
// separate from the caller's own (RLS-bound) `supabase` client mock is the
// point of the test: it proves the raw ciphertext is read through the
// service-role path, not the caller's session client.
const mockServiceRoleFrom = vi.fn();
const mockCreateSupabaseJsClient = vi.fn((..._args: unknown[]) => ({ from: mockServiceRoleFrom }));
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/supabase-js")>();
  return {
    ...actual,
    createClient: (...args: unknown[]) => mockCreateSupabaseJsClient(...args),
  };
});

describe("decrementStarterCredit", () => {
  const mockRpc = vi.fn();
  const mockSupabase = { rpc: mockRpc } as unknown as SupabaseClient<Database>;
  const userId = "test-user-id";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns remaining credits on success", async () => {
    mockRpc.mockResolvedValue({ data: 9, error: null });

    const result = await decrementStarterCredit(mockSupabase, userId);

    expect(result).toBe(9);
    expect(mockRpc).toHaveBeenCalledWith("decrement_starter_credit", {
      p_user_id: userId,
    });
  });

  it("returns 0 when data is null (credits exhausted)", async () => {
    mockRpc.mockResolvedValue({ data: 0, error: null });

    const result = await decrementStarterCredit(mockSupabase, userId);

    expect(result).toBe(0);
  });

  it("throws on RPC error instead of silently returning 0", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "function does not exist" },
    });

    await expect(
      decrementStarterCredit(mockSupabase, userId)
    ).rejects.toThrow("Failed to decrement starter credit: function does not exist");
  });

  it("throws on network/connection errors", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "connection refused" },
    });

    await expect(
      decrementStarterCredit(mockSupabase, userId)
    ).rejects.toThrow("Failed to decrement starter credit");
  });
});

describe("chargeAiUsage", () => {
  const mockInsert = vi.fn();
  const mockRpc = vi.fn();
  const mockSupabase = {
    from: vi.fn(() => ({ insert: mockInsert })),
    rpc: mockRpc,
  } as unknown as SupabaseClient<Database>;
  const userId = "test-user-id";

  const baseParams = {
    userId,
    actionType: "enhance_description" as const,
    inputTokens: 10,
    outputTokens: 5,
    model: AI_MODEL,
    ideaId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ data: 9, error: null });
  });

  it("decrements exactly once for a platform key (non-free)", async () => {
    await chargeAiUsage(mockSupabase, { ...baseParams, keyType: "platform" });

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockRpc).toHaveBeenCalledOnce();
    expect(mockRpc).toHaveBeenCalledWith("decrement_starter_credit", {
      p_user_id: userId,
    });
  });

  it("does NOT decrement for a BYOK key (but still logs)", async () => {
    await chargeAiUsage(mockSupabase, { ...baseParams, keyType: "byok" });

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("does NOT decrement when free:true even on a platform key (but still logs)", async () => {
    await chargeAiUsage(mockSupabase, { ...baseParams, keyType: "platform", free: true });

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("propagates a platform decrement failure so the missed charge surfaces", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "rpc down" } });

    await expect(
      chargeAiUsage(mockSupabase, { ...baseParams, keyType: "platform" })
    ).rejects.toThrow("Failed to decrement starter credit: rpc down");
    // Usage is still logged before the throw.
    expect(mockInsert).toHaveBeenCalledOnce();
  });
});

describe("chargeAiUsage — `charged` column reflects the real debit, not `free`", () => {
  const mockInsert = vi.fn();
  const mockRpc = vi.fn();
  const mockSupabase = {
    from: vi.fn(() => ({ insert: mockInsert })),
    rpc: mockRpc,
  } as unknown as SupabaseClient<Database>;
  const userId = "test-user-id";

  const baseParams = {
    userId,
    actionType: "enhance_description" as const,
    inputTokens: 10,
    outputTokens: 5,
    model: AI_MODEL,
    ideaId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ data: 9, error: null });
  });

  it("marks charged=true for a direct platform charge (no `free`)", async () => {
    await chargeAiUsage(mockSupabase, { ...baseParams, keyType: "platform" });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ charged: true })
    );
  });

  it("marks charged=false for a genuinely-free onboarding call (free:true, no chargedUpfront)", async () => {
    await chargeAiUsage(mockSupabase, { ...baseParams, keyType: "platform", free: true });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ charged: false })
    );
    // Genuinely free: no decrement either.
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("marks charged=true for an upfront-charged streaming call (free:true + chargedUpfront:true)", async () => {
    await chargeAiUsage(mockSupabase, {
      ...baseParams,
      keyType: "platform",
      free: true,
      chargedUpfront: true,
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ charged: true })
    );
    // The credit was already decremented via chargeAiUpfront — chargeAiUsage
    // itself must NOT decrement again (no double charge).
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("marks charged=false for BYOK regardless of free/chargedUpfront", async () => {
    await chargeAiUsage(mockSupabase, {
      ...baseParams,
      keyType: "byok",
      chargedUpfront: true,
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ charged: false })
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("AI_MODEL resolution", () => {
  // AI_MODEL is a module-level const computed from process.env at import
  // time, so each case needs a fresh module instance (vi.resetModules() +
  // dynamic import) to pick up the env change — same pattern as
  // src/lib/logger.test.ts.
  const originalEnv = { ...process.env };

  async function loadAiModel() {
    const mod = await import("./ai-helpers");
    return mod.AI_MODEL;
  }

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllEnvs();
  });

  it("falls back to the default when ANTHROPIC_MODEL is unset", async () => {
    delete process.env.ANTHROPIC_MODEL;

    expect(await loadAiModel()).toBe("claude-sonnet-5");
  });

  it("falls back to the default when ANTHROPIC_MODEL is an empty string (the prod outage case)", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "");

    expect(await loadAiModel()).toBe("claude-sonnet-5");
  });

  it("falls back to the default when ANTHROPIC_MODEL is whitespace-only", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "   ");

    expect(await loadAiModel()).toBe("claude-sonnet-5");
  });

  it("respects a real ANTHROPIC_MODEL value", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "claude-sonnet-5");

    expect(await loadAiModel()).toBe("claude-sonnet-5");
  });
});

describe("resolveAiProvider", () => {
  const userId = "test-user-id";

  /** A chainable `.select().eq().single()` mock resolving to `result`. */
  function singleRowChain(result: { data: unknown }) {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      single: vi.fn().mockResolvedValue(result),
    };
    return chain;
  }

  /** Caller's own RLS-bound client: only ever reads `ai_starter_credits`
   *  (still granted to `authenticated`) and, for the platform-credit path,
   *  today's platform call count from `ai_usage_log`. */
  function makeCallerSupabase(opts: {
    profile: { ai_starter_credits: number } | null;
    usageCount?: number;
  }) {
    const usersChain = singleRowChain({ data: opts.profile });
    const usageLogChain = {
      select: vi.fn(() => usageLogChain),
      eq: vi.fn(() => usageLogChain),
      gte: vi.fn().mockResolvedValue({ count: opts.usageCount ?? 0 }),
    };
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "users") return usersChain;
        if (table === "ai_usage_log") return usageLogChain;
        throw new Error(`resolveAiProvider test: unexpected table "${table}"`);
      }),
    } as unknown as SupabaseClient<Database>;
    return { supabase, usersChain };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDecrypt.mockReturnValue("sk-ant-decrypted");
  });

  it("happy path: returns a BYOK provider, reading the raw key through the service-role client (not the caller's)", async () => {
    const { supabase, usersChain } = makeCallerSupabase({ profile: { ai_starter_credits: 0 } });
    mockServiceRoleFrom.mockReturnValue(
      singleRowChain({ data: { encrypted_anthropic_key: "enc-ciphertext" } })
    );

    const result = await resolveAiProvider(supabase, userId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.keyType).toBe("byok");
    }
    // The ciphertext lookup went through the service-role client...
    expect(mockCreateSupabaseJsClient).toHaveBeenCalledOnce();
    expect(mockServiceRoleFrom).toHaveBeenCalledWith("users");
    expect(mockDecrypt).toHaveBeenCalledWith("enc-ciphertext");
    // ...never through the caller's own (RLS-bound) client, which legitimately
    // queries "users" too but only ever for ai_starter_credits — never asked
    // to select the (now ungrantable) ciphertext column.
    expect(usersChain.select).toHaveBeenCalledWith("ai_starter_credits");
    expect(usersChain.select).not.toHaveBeenCalledWith(
      expect.stringContaining("encrypted_anthropic_key")
    );
  });

  it("happy path: falls back to the platform key when there's no BYOK key but starter credits remain", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-platform-key");
    const { supabase } = makeCallerSupabase({ profile: { ai_starter_credits: 3 }, usageCount: 0 });
    mockServiceRoleFrom.mockReturnValue(singleRowChain({ data: { encrypted_anthropic_key: null } }));

    const result = await resolveAiProvider(supabase, userId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.keyType).toBe("platform");
    }
    vi.unstubAllEnvs();
  });

  it("error path: no key and no starter credits left", async () => {
    const { supabase } = makeCallerSupabase({ profile: { ai_starter_credits: 0 } });
    mockServiceRoleFrom.mockReturnValue(singleRowChain({ data: { encrypted_anthropic_key: null } }));

    const result = await resolveAiProvider(supabase, userId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
    }
  });

  it("error path: user profile not found — never falls through to the service-role key lookup", async () => {
    const { supabase } = makeCallerSupabase({ profile: null });

    const result = await resolveAiProvider(supabase, userId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
    // Fails fast on the caller-client check — no reason to spend a
    // service-role round trip for a user that doesn't exist.
    expect(mockCreateSupabaseJsClient).not.toHaveBeenCalled();
  });
});
