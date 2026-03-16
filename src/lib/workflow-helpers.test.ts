import { describe, it, expect, vi } from "vitest";
import { checkAndCompleteRun, checkAndApplyAutoRules, TERMINAL_STATUSES } from "./workflow-helpers";

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

// --- checkAndApplyAutoRules ---

function createAutoRuleMockSupabase(options: {
  rule?: { id: string; template_id: string; auto_run: boolean } | null;
  activeRun?: { id: string } | null;
}) {
  const calls: { table: string; method: string }[] = [];

  const makeChain = (resolvedData: unknown) => {
    const chain: Record<string, unknown> = {};
    const resolver = () =>
      Promise.resolve({ data: resolvedData ?? null, error: null });

    for (const m of ["select", "eq", "not", "maybeSingle"]) {
      chain[m] = vi.fn((..._args: unknown[]) => {
        if (m === "maybeSingle") return resolver();
        return chain;
      });
    }
    return chain;
  };

  const autoRuleChain = makeChain(options.rule ?? null);
  const activeRunChain = makeChain(options.activeRun ?? null);

  return {
    from: vi.fn((table: string) => {
      calls.push({ table, method: "from" });
      if (table === "workflow_auto_rules") return autoRuleChain;
      if (table === "workflow_runs") return activeRunChain;
      return makeChain(null);
    }),
    _calls: calls,
  };
}

describe("checkAndApplyAutoRules", () => {
  it("calls applyFn when a matching auto-rule exists", async () => {
    const applyFn = vi.fn().mockResolvedValue({});
    const supabase = createAutoRuleMockSupabase({
      rule: { id: "rule-1", template_id: "tmpl-1", auto_run: true },
      activeRun: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await checkAndApplyAutoRules(supabase as any, "task-1", "label-1", "idea-1", applyFn);

    expect(applyFn).toHaveBeenCalledWith("task-1", "tmpl-1");
  });

  it("does not call applyFn when no matching rule exists", async () => {
    const applyFn = vi.fn();
    const supabase = createAutoRuleMockSupabase({ rule: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await checkAndApplyAutoRules(supabase as any, "task-1", "label-1", "idea-1", applyFn);

    expect(applyFn).not.toHaveBeenCalled();
  });

  it("does not call applyFn when task has active workflow run", async () => {
    const applyFn = vi.fn();
    const supabase = createAutoRuleMockSupabase({
      rule: { id: "rule-1", template_id: "tmpl-1", auto_run: true },
      activeRun: { id: "run-1" },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await checkAndApplyAutoRules(supabase as any, "task-1", "label-1", "idea-1", applyFn);

    expect(applyFn).not.toHaveBeenCalled();
  });

  it("does not throw when applyFn fails", async () => {
    const applyFn = vi.fn().mockRejectedValue(new Error("apply failed"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = createAutoRuleMockSupabase({
      rule: { id: "rule-1", template_id: "tmpl-1", auto_run: true },
      activeRun: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(
      checkAndApplyAutoRules(supabase as any, "task-1", "label-1", "idea-1", applyFn)
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("does not throw when supabase query fails", async () => {
    const applyFn = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = {
      from: vi.fn(() => {
        throw new Error("db error");
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(
      checkAndApplyAutoRules(supabase as any, "task-1", "label-1", "idea-1", applyFn)
    ).resolves.toBeUndefined();

    expect(applyFn).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
