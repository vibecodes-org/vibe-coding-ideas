import { describe, it, expect, vi, beforeEach } from "vitest";
import { decrementStarterCredit } from "./ai-helpers";

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
  const mockSupabase = { rpc: mockRpc } as any;
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
