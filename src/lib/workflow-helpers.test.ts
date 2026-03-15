import { describe, it, expect, vi } from "vitest";
import { checkAndCompleteRun, TERMINAL_STATUSES } from "./workflow-helpers";

function createMockSupabase(steps: { id: string; status: string }[]) {
  const updateChain = {
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn(() => updateChain),
  };
  // resolve the chained query to return steps
  mockChain.eq.mockResolvedValue({ data: steps, error: null });

  const supabase = {
    from: vi.fn(() => mockChain),
    _chain: mockChain,
    _updateChain: updateChain,
  };
  return supabase;
}

describe("TERMINAL_STATUSES", () => {
  it("includes completed and skipped", () => {
    expect(TERMINAL_STATUSES).toContain("completed");
    expect(TERMINAL_STATUSES).toContain("skipped");
    expect(TERMINAL_STATUSES).toHaveLength(2);
  });
});

describe("checkAndCompleteRun", () => {
  it("completes run when all steps are completed", async () => {
    const supabase = createMockSupabase([
      { id: "s1", status: "completed" },
      { id: "s2", status: "completed" },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkAndCompleteRun(supabase as any, "run-1");

    expect(result).toBe(true);
    // Should have called update on workflow_runs
    expect(supabase.from).toHaveBeenCalledWith("workflow_runs");
    expect(supabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" })
    );
  });

  it("completes run when all steps are completed or skipped", async () => {
    const supabase = createMockSupabase([
      { id: "s1", status: "completed" },
      { id: "s2", status: "skipped" },
      { id: "s3", status: "completed" },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkAndCompleteRun(supabase as any, "run-1");

    expect(result).toBe(true);
  });

  it("does not complete run when some steps are pending", async () => {
    const supabase = createMockSupabase([
      { id: "s1", status: "completed" },
      { id: "s2", status: "pending" },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkAndCompleteRun(supabase as any, "run-1");

    expect(result).toBe(false);
    // Should NOT have called update
    expect(supabase._chain.update).not.toHaveBeenCalled();
  });

  it("does not complete run when failed steps are present", async () => {
    const supabase = createMockSupabase([
      { id: "s1", status: "completed" },
      { id: "s2", status: "failed" },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkAndCompleteRun(supabase as any, "run-1");

    expect(result).toBe(false);
  });

  it("does not complete run when in_progress steps exist", async () => {
    const supabase = createMockSupabase([
      { id: "s1", status: "completed" },
      { id: "s2", status: "in_progress" },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkAndCompleteRun(supabase as any, "run-1");

    expect(result).toBe(false);
  });

  it("completes run when no steps exist (edge case)", async () => {
    const supabase = createMockSupabase([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkAndCompleteRun(supabase as any, "run-1");

    expect(result).toBe(true);
  });

  it("completes run when steps are null (edge case)", async () => {
    const updateChain = {
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn(() => updateChain),
    };
    mockChain.eq.mockResolvedValue({ data: null, error: null });
    const supabase = { from: vi.fn(() => mockChain), _chain: mockChain };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkAndCompleteRun(supabase as any, "run-1");

    // null steps treated as empty array → completes
    expect(result).toBe(true);
  });

  it("does not complete run with awaiting_approval steps", async () => {
    const supabase = createMockSupabase([
      { id: "s1", status: "completed" },
      { id: "s2", status: "awaiting_approval" },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkAndCompleteRun(supabase as any, "run-1");

    expect(result).toBe(false);
  });
});
