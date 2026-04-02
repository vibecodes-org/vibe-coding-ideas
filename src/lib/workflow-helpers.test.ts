import { describe, it, expect, vi } from "vitest";
import { checkAndCompleteRun, checkAndApplyAutoRules, checkAutoRuleWorkflow, removeAutoRuleWorkflow, propagateTemplateEdits, TERMINAL_STATUSES } from "./workflow-helpers";

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
  rule?: { id: string; template_id: string } | null;
  activeRun?: { id: string; template_id?: string } | null;
  triggeringRule?: { id: string; label_id: string } | null;
  labelStillOnTask?: boolean;
}) {
  const calls: { table: string; method: string }[] = [];
  const deletedRunIds: string[] = [];
  let autoRuleCallCount = 0;

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

  const activeRunChain = makeChain(options.activeRun ?? null);
  const triggeringRuleChain = makeChain(options.triggeringRule ?? null);
  const labelOnTaskChain = makeChain(
    options.labelStillOnTask ? { id: "label-link-1" } : null
  );

  const deleteChain = {
    eq: vi.fn((_col: string, val: string) => {
      deletedRunIds.push(val);
      return Promise.resolve({ error: null });
    }),
  };

  return {
    from: vi.fn((table: string) => {
      calls.push({ table, method: "from" });
      if (table === "workflow_auto_rules") {
        autoRuleCallCount++;
        // First call is the rule lookup for the new label; second is the triggering rule lookup
        if (autoRuleCallCount === 1) return makeChain(options.rule ?? null);
        return triggeringRuleChain;
      }
      if (table === "workflow_runs") {
        return {
          ...activeRunChain,
          delete: vi.fn(() => deleteChain),
        };
      }
      if (table === "board_task_labels") return labelOnTaskChain;
      return makeChain(null);
    }),
    _calls: calls,
    _deletedRunIds: deletedRunIds,
  };
}

describe("checkAndApplyAutoRules", () => {
  it("calls applyFn when a matching auto-rule exists", async () => {
    const applyFn = vi.fn().mockResolvedValue({});
    const supabase = createAutoRuleMockSupabase({
      rule: { id: "rule-1", template_id: "tmpl-1" },
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

  it("does not call applyFn when task has active workflow run with same template", async () => {
    const applyFn = vi.fn();
    const supabase = createAutoRuleMockSupabase({
      rule: { id: "rule-1", template_id: "tmpl-1" },
      activeRun: { id: "run-1", template_id: "tmpl-1" },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await checkAndApplyAutoRules(supabase as any, "task-1", "label-1", "idea-1", applyFn);

    expect(applyFn).not.toHaveBeenCalled();
  });

  it("does not call applyFn when active run's label is still on task", async () => {
    const applyFn = vi.fn();
    const supabase = createAutoRuleMockSupabase({
      rule: { id: "rule-2", template_id: "tmpl-2" },
      activeRun: { id: "run-1", template_id: "tmpl-1" },
      triggeringRule: { id: "rule-1", label_id: "label-A" },
      labelStillOnTask: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await checkAndApplyAutoRules(supabase as any, "task-1", "label-B", "idea-1", applyFn);

    expect(applyFn).not.toHaveBeenCalled();
    expect(supabase._deletedRunIds).toHaveLength(0);
  });

  it("does not call applyFn when active run was manually applied (no triggering rule)", async () => {
    const applyFn = vi.fn();
    const supabase = createAutoRuleMockSupabase({
      rule: { id: "rule-2", template_id: "tmpl-2" },
      activeRun: { id: "run-1", template_id: "tmpl-manual" },
      triggeringRule: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await checkAndApplyAutoRules(supabase as any, "task-1", "label-B", "idea-1", applyFn);

    expect(applyFn).not.toHaveBeenCalled();
    expect(supabase._deletedRunIds).toHaveLength(0);
  });

  it("removes orphaned run and applies new workflow when label was swapped", async () => {
    const applyFn = vi.fn().mockResolvedValue({});
    const supabase = createAutoRuleMockSupabase({
      rule: { id: "rule-2", template_id: "tmpl-2" },
      activeRun: { id: "run-1", template_id: "tmpl-1" },
      triggeringRule: { id: "rule-1", label_id: "label-A" },
      labelStillOnTask: false, // label A was removed
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await checkAndApplyAutoRules(supabase as any, "task-1", "label-B", "idea-1", applyFn);

    // Should have deleted the orphaned run
    expect(supabase._deletedRunIds).toContain("run-1");
    // Should have applied the new workflow
    expect(applyFn).toHaveBeenCalledWith("task-1", "tmpl-2");
  });

  it("does not throw when applyFn fails", async () => {
    const applyFn = vi.fn().mockRejectedValue(new Error("apply failed"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = createAutoRuleMockSupabase({
      rule: { id: "rule-1", template_id: "tmpl-1" },
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

// --- propagateTemplateEdits ---

function createPropagationMockSupabase(options: {
  activeRuns: { id: string; task_id: string }[] | null;
  stepsByRun: Record<string, { id: string; status: string; step_order: number }[]>;
  updateCounts?: Record<string, number>; // stepId -> count returned by update
}) {
  const updateResults = options.updateCounts ?? {};

  return {
    from: vi.fn((table: string) => {
      if (table === "workflow_runs") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockResolvedValue({
                data: options.activeRuns,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "task_workflow_steps") {
        // Need to handle both select (for fetching steps) and update (for updating steps)
        const chain: Record<string, ReturnType<typeof vi.fn>> = {};

        chain.select = vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn((_, __) => {
              // Return steps for the run based on run_id
              // We track which run was requested via closure
              return {
                then: undefined, // not a promise yet
              };
            }),
          }),
        });

        // Build a smarter mock that tracks eq() calls
        let currentRunId: string | null = null;
        let currentStepId: string | null = null;
        let isUpdateChain = false;

        const eqFn = vi.fn((_col: string, val: string) => {
          if (_col === "run_id") currentRunId = val;
          if (_col === "id") currentStepId = val;
          if (_col === "status" && isUpdateChain) {
            // This is the concurrency guard — return count
            const count = currentStepId ? (updateResults[currentStepId] ?? 1) : 1;
            return Promise.resolve({ count, error: null });
          }
          return mockChain;
        });

        const orderFn = vi.fn(() => {
          const runId = currentRunId;
          const steps = runId ? (options.stepsByRun[runId] ?? []) : [];
          return Promise.resolve({ data: steps, error: null });
        });

        const updateFn = vi.fn(() => {
          isUpdateChain = true;
          return mockChain;
        });

        const selectFn = vi.fn(() => {
          isUpdateChain = false;
          return mockChain;
        });

        const mockChain = {
          select: selectFn,
          eq: eqFn,
          order: orderFn,
          update: updateFn,
        };

        return mockChain;
      }
      return {};
    }),
  };
}

const sampleTemplateSteps = [
  { title: "Step A Updated", role: "Dev", description: "New desc", requires_approval: true, deliverables: ["doc.md"] },
  { title: "Step B Updated", role: "QA", description: "QA desc", requires_approval: false, deliverables: [] },
];

describe("propagateTemplateEdits", () => {
  it("returns zero counts when no active runs exist", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [],
      stepsByRun: {},
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);

    expect(result).toEqual({ runsUpdated: 0, stepsUpdated: 0, skippedStructuralMismatch: 0, affectedTaskIds: [] });
  });

  it("returns zero counts when activeRuns is null", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: null,
      stepsByRun: {},
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);

    expect(result).toEqual({ runsUpdated: 0, stepsUpdated: 0, skippedStructuralMismatch: 0, affectedTaskIds: [] });
  });

  it("skips runs with step count mismatch", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1" }],
      stepsByRun: {
        "run-1": [
          { id: "s1", status: "pending", step_order: 1 },
          { id: "s2", status: "pending", step_order: 2 },
          { id: "s3", status: "pending", step_order: 3 }, // 3 steps vs 2 template steps
        ],
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);

    expect(result.skippedStructuralMismatch).toBe(1);
    expect(result.stepsUpdated).toBe(0);
    expect(result.runsUpdated).toBe(0);
  });

  it("updates all pending steps when counts match", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1" }],
      stepsByRun: {
        "run-1": [
          { id: "s1", status: "pending", step_order: 1 },
          { id: "s2", status: "pending", step_order: 2 },
        ],
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);

    expect(result.stepsUpdated).toBe(2);
    expect(result.runsUpdated).toBe(1);
    expect(result.skippedStructuralMismatch).toBe(0);
  });

  it("only updates pending steps, skips completed/in_progress", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1" }],
      stepsByRun: {
        "run-1": [
          { id: "s1", status: "completed", step_order: 1 },
          { id: "s2", status: "pending", step_order: 2 },
        ],
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);

    expect(result.stepsUpdated).toBe(1);
    expect(result.runsUpdated).toBe(1);
  });

  it("handles concurrency guard returning count 0", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1" }],
      stepsByRun: {
        "run-1": [
          { id: "s1", status: "pending", step_order: 1 },
          { id: "s2", status: "pending", step_order: 2 },
        ],
      },
      updateCounts: { s1: 0, s2: 0 }, // both claimed between select and update
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);

    expect(result.stepsUpdated).toBe(0);
    expect(result.runsUpdated).toBe(0);
  });
});

// --- checkAutoRuleWorkflow ---

function createCheckRemoveMockSupabase(options: {
  rule?: { id: string; template_id: string; workflow_templates: { name: string } | null } | null;
  activeRun?: { id: string } | null;
}) {
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
      if (table === "workflow_auto_rules") return autoRuleChain;
      if (table === "workflow_runs") return activeRunChain;
      return makeChain(null);
    }),
  };
}

describe("checkAutoRuleWorkflow", () => {
  it("returns hasActiveWorkflow: false when no auto-rule exists", async () => {
    const supabase = createCheckRemoveMockSupabase({ rule: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkAutoRuleWorkflow(supabase as any, "task-1", "label-1", "idea-1");

    expect(result).toEqual({ hasActiveWorkflow: false });
  });

  it("returns hasActiveWorkflow: false when rule exists but no active run", async () => {
    const supabase = createCheckRemoveMockSupabase({
      rule: { id: "rule-1", template_id: "tmpl-1", workflow_templates: { name: "My Workflow" } },
      activeRun: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkAutoRuleWorkflow(supabase as any, "task-1", "label-1", "idea-1");

    expect(result).toEqual({ hasActiveWorkflow: false });
  });

  it("returns hasActiveWorkflow: true with run details when active run exists", async () => {
    const supabase = createCheckRemoveMockSupabase({
      rule: { id: "rule-1", template_id: "tmpl-1", workflow_templates: { name: "Bug Triage" } },
      activeRun: { id: "run-1" },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkAutoRuleWorkflow(supabase as any, "task-1", "label-1", "idea-1");

    expect(result).toEqual({
      hasActiveWorkflow: true,
      runId: "run-1",
      templateName: "Bug Triage",
    });
  });

  it("returns templateName as undefined when workflow_templates is null", async () => {
    const supabase = createCheckRemoveMockSupabase({
      rule: { id: "rule-1", template_id: "tmpl-1", workflow_templates: null },
      activeRun: { id: "run-1" },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkAutoRuleWorkflow(supabase as any, "task-1", "label-1", "idea-1");

    expect(result).toEqual({
      hasActiveWorkflow: true,
      runId: "run-1",
      templateName: undefined,
    });
  });
});

// --- removeAutoRuleWorkflow ---

function createRemoveWorkflowMockSupabase(options: {
  rule?: { id: string; template_id: string; workflow_templates: { name: string } | null } | null;
  activeRun?: { id: string } | null;
  deleteError?: { message: string } | null;
}) {
  const deleteCalled: string[] = [];

  const makeSelectChain = (resolvedData: unknown) => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    const resolver = () =>
      Promise.resolve({ data: resolvedData ?? null, error: null });

    for (const m of ["select", "eq", "not", "maybeSingle"]) {
      chain[m] = vi.fn(() => {
        if (m === "maybeSingle") return resolver();
        return chain;
      });
    }
    return chain;
  };

  const autoRuleChain = makeSelectChain(options.rule ?? null);
  const activeRunSelectChain = makeSelectChain(options.activeRun ?? null);

  // For delete chain
  const deleteEqFn = vi.fn((_col: string, val: string) => {
    deleteCalled.push(val);
    return Promise.resolve({ error: options.deleteError ?? null });
  });

  return {
    from: vi.fn((table: string) => {
      if (table === "workflow_auto_rules") return autoRuleChain;
      if (table === "workflow_runs") {
        return {
          select: activeRunSelectChain.select,
          eq: activeRunSelectChain.eq,
          not: activeRunSelectChain.not,
          maybeSingle: activeRunSelectChain.maybeSingle,
          delete: vi.fn(() => ({ eq: deleteEqFn })),
        };
      }
      return makeSelectChain(null);
    }),
    _deleteCalled: deleteCalled,
  };
}

describe("removeAutoRuleWorkflow", () => {
  it("returns removed: false when no auto-rule exists", async () => {
    const supabase = createRemoveWorkflowMockSupabase({ rule: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await removeAutoRuleWorkflow(supabase as any, "task-1", "label-1", "idea-1");

    expect(result).toEqual({ removed: false });
  });

  it("returns removed: false when no active run exists", async () => {
    const supabase = createRemoveWorkflowMockSupabase({
      rule: { id: "rule-1", template_id: "tmpl-1", workflow_templates: { name: "Test" } },
      activeRun: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await removeAutoRuleWorkflow(supabase as any, "task-1", "label-1", "idea-1");

    expect(result).toEqual({ removed: false });
  });

  it("deletes the workflow run and returns removed: true", async () => {
    const supabase = createRemoveWorkflowMockSupabase({
      rule: { id: "rule-1", template_id: "tmpl-1", workflow_templates: { name: "Bug Triage" } },
      activeRun: { id: "run-1" },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await removeAutoRuleWorkflow(supabase as any, "task-1", "label-1", "idea-1");

    expect(result).toEqual({ removed: true, templateName: "Bug Triage" });
    expect(supabase._deleteCalled).toContain("run-1");
  });

  it("returns removed: false when delete fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = createRemoveWorkflowMockSupabase({
      rule: { id: "rule-1", template_id: "tmpl-1", workflow_templates: { name: "Test" } },
      activeRun: { id: "run-1" },
      deleteError: { message: "permission denied" },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await removeAutoRuleWorkflow(supabase as any, "task-1", "label-1", "idea-1");

    expect(result).toEqual({ removed: false });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
