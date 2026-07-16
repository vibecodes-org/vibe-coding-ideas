import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { decrementStarterCredit, chargeAiUsage, AI_MODEL } from "./ai-helpers";

// Mock logger to suppress output
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock encryption module (imported by ai-helpers)
vi.mock("@/lib/encryption", () => ({
  decrypt: vi.fn(),
}));

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
