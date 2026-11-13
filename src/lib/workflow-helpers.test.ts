import { describe, it, expect, vi } from "vitest";
import { checkAndCompleteRun, checkAndApplyAutoRules, checkAutoRuleWorkflow, removeAutoRuleWorkflow, propagateTemplateEdits, resolveSuggestionOnApply, TERMINAL_STATUSES, workflowDisplayName, workflowProgressPct, WORKFLOW_FALLBACK_NAME } from "./workflow-helpers";

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

describe("workflowProgressPct", () => {
  it("returns 0 for 0/0 without NaN (divide-by-zero guard)", () => {
    expect(workflowProgressPct(0, 0)).toBe(0);
    expect(Number.isNaN(workflowProgressPct(0, 0))).toBe(false);
  });

  it("returns 0 for 0 of 6", () => {
    expect(workflowProgressPct(0, 6)).toBe(0);
  });

  it("returns 50 for 3 of 6", () => {
    expect(workflowProgressPct(3, 6)).toBe(50);
  });

  it("returns 100 for 6 of 6", () => {
    expect(workflowProgressPct(6, 6)).toBe(100);
  });

  it("caps overflow at 100", () => {
    expect(workflowProgressPct(9, 6)).toBe(100);
  });

  it("rounds to the nearest integer", () => {
    // 1/6 = 16.66… → 17
    expect(workflowProgressPct(1, 6)).toBe(17);
  });

  it("treats negative totals as zero", () => {
    expect(workflowProgressPct(1, -3)).toBe(0);
  });
});

describe("workflowDisplayName", () => {
  it("falls back to 'Workflow' for null", () => {
    expect(workflowDisplayName(null)).toBe(WORKFLOW_FALLBACK_NAME);
    expect(WORKFLOW_FALLBACK_NAME).toBe("Workflow");
  });

  it("falls back to 'Workflow' for undefined", () => {
    expect(workflowDisplayName(undefined)).toBe("Workflow");
  });

  it("falls back to 'Workflow' for an empty or whitespace string", () => {
    expect(workflowDisplayName("")).toBe("Workflow");
    expect(workflowDisplayName("   ")).toBe("Workflow");
  });

  it("passes through and trims a real name", () => {
    expect(workflowDisplayName("Feature Development")).toBe("Feature Development");
    expect(workflowDisplayName("  Release Pipeline  ")).toBe("Release Pipeline");
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

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal supabase mock; faithful SupabaseClient generics are impractical here
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

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal supabase mock; faithful SupabaseClient generics are impractical here
      checkAndApplyAutoRules(supabase as any, "task-1", "label-1", "idea-1", applyFn)
    ).resolves.toBeUndefined();

    expect(applyFn).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// --- checkAndApplyAutoRules with options (mismatch suggestions) ---

// A richer mock covering the apply/suggest path: rule lookup, active-run guard,
// template + task + label fetch, and workflow_suggestions insert.
function createSuggestPathSupabase(opts: {
  rule: { id: string; template_id: string };
  template: { id: string; name: string; description: string; steps: unknown };
  task: { id: string; title: string; description: string };
  taskLabels: string[];
}) {
  const suggestionInserts: Record<string, unknown>[] = [];

  const resolve = (data: unknown) => Promise.resolve({ data, error: null });

  return {
    from: vi.fn((table: string) => {
      switch (table) {
        case "workflow_auto_rules":
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(() => resolve(opts.rule)),
          };
        case "workflow_runs":
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(() => resolve(null)), // no active run
          };
        case "workflow_templates":
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(() => resolve(opts.template)),
          };
        case "board_tasks":
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(() => resolve(opts.task)),
          };
        case "board_task_labels":
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn(() =>
              resolve(opts.taskLabels.map((name) => ({ board_labels: { name } })))
            ),
          };
        case "workflow_suggestions": {
          const updateChain: Record<string, unknown> = {
            update: vi.fn(() => updateChain),
            eq: vi.fn(() => updateChain),
            then: (r?: (v: unknown) => unknown) => {
              const v = { data: null, error: null };
              return typeof r === "function" ? r(v) : Promise.resolve(v);
            },
          };
          return {
            ...updateChain,
            insert: vi.fn((vals: Record<string, unknown>) => {
              suggestionInserts.push(vals);
              return {
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn(() => resolve({ id: "sug-1" })),
              };
            }),
          };
        }
        default:
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            single: vi.fn(() => resolve(null)),
            maybeSingle: vi.fn(() => resolve(null)),
          };
      }
    }),
    _suggestionInserts: suggestionInserts,
  };
}

describe("checkAndApplyAutoRules with userId option", () => {
  const buildTemplate = {
    id: "tmpl-build",
    name: "Build feature",
    description: "engineering",
    steps: [
      { title: "Implement API", description: "build backend", role: "Engineer" },
      { title: "Fix bug and deploy", description: "refactor", role: "Backend" },
    ],
  };
  const discoveryTemplate = {
    id: "tmpl-discovery",
    name: "Market discovery",
    description: "validation",
    steps: [
      { title: "Competitor analysis", description: "market research", role: "Analyst" },
      { title: "Pricing and go/no-go", description: "validation", role: "PM" },
    ],
  };

  it("auto-applies a clearly-good fit and writes no suggestion", async () => {
    const applyFn = vi.fn().mockResolvedValue({});
    const supabase = createSuggestPathSupabase({
      rule: { id: "rule-1", template_id: "tmpl-build" },
      template: buildTemplate,
      task: { id: "task-1", title: "Implement checkout API", description: "build and deploy backend" },
      taskLabels: ["backend"],
    });

    await checkAndApplyAutoRules(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      "task-1",
      "label-1",
      "idea-1",
      applyFn,
      { userId: "user-1", isAutonomousAgent: false }
    );

    expect(applyFn).toHaveBeenCalledWith("task-1", "tmpl-build");
    expect(supabase._suggestionInserts).toHaveLength(0);
  });

  it("writes a suggestion (not applyFn) for a suspect mismatch", async () => {
    const applyFn = vi.fn().mockResolvedValue({});
    const supabase = createSuggestPathSupabase({
      rule: { id: "rule-1", template_id: "tmpl-discovery" },
      template: discoveryTemplate,
      task: { id: "task-1", title: "Implement checkout API", description: "build and deploy backend" },
      taskLabels: ["backend"],
    });

    await checkAndApplyAutoRules(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      "task-1",
      "label-1",
      "idea-1",
      applyFn,
      // Await adjudication for determinism; with no AI profile the resolver
      // returns heuristic, so the suggestion stays open and applyFn is skipped.
      { userId: "user-1", isAutonomousAgent: true, awaitAdjudication: true }
    );

    expect(applyFn).not.toHaveBeenCalled();
    expect(supabase._suggestionInserts).toHaveLength(1);
    expect(supabase._suggestionInserts[0]).toMatchObject({
      status: "suggested",
      suggested_template_id: "tmpl-discovery",
    });
  });
});

// --- propagateTemplateEdits ---

type MockRun = { id: string; task_id: string; board_tasks?: { title: string; archived: boolean } | null };
type MockStep = Record<string, unknown> & { id: string; status: string; step_order: number };

function pending(id: string, order: number, title: string, role = "Dev", extra: Record<string, unknown> = {}): MockStep {
  return {
    id,
    status: "pending",
    step_order: order,
    position: (order - 1) * 1000,
    title,
    description: null,
    agent_role: role,
    human_check_required: false,
    expected_deliverables: [],
    model_tier: null,
    effort_override: null,
    started_at: null,
    claimed_by: null,
    claim_token_hash: null,
    work_token_hash: null,
    output: null,
    comment_count: 0,
    ...extra,
  };
}

function createPropagationMockSupabase(options: {
  activeRuns: MockRun[] | null;
  stepsByRun: Record<string, MockStep[]>;
  /** What the swap function (replace_unstarted_workflow_run) answers. */
  swapResult?: { data: unknown; error: unknown };
  /** What the reshape function answers. */
  reshapeResult?: { data: unknown; error: unknown };
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = vi.fn((name: string, _args?: any) => {
    if (name === "replace_unstarted_workflow_run") {
      return Promise.resolve(options.swapResult ?? { data: true, error: null });
    }
    return Promise.resolve(options.reshapeResult ?? { data: "applied", error: null });
  });
  const from = vi.fn((table: string) => {
    if (table === "workflow_runs") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({ data: options.activeRuns, error: null }),
          }),
        }),
      };
    }
    let runId = "";
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      eq: vi.fn((_col: string, val: string) => {
        runId = val;
        return chain;
      }),
      order: vi.fn(() => Promise.resolve({ data: options.stepsByRun[runId] ?? [], error: null })),
    };
    return chain;
  });
  return { from, rpc };
}

const card = (title = "Card one", archived = false) => ({ title, archived });
const sampleTemplateSteps = [
  { title: "Step A Updated", role: "Dev", description: "New desc", requires_approval: true, deliverables: ["doc.md"] },
  { title: "Step B Updated", role: "QA", description: "QA desc", requires_approval: false, deliverables: [] },
];

describe("propagateTemplateEdits", () => {
  it("returns an empty report when no active runs exist", async () => {
    const supabase = createPropagationMockSupabase({ activeRuns: [], stepsByRun: {} });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);
    expect(result).toEqual({
      runsUpdated: 0,
      stepsUpdated: 0,
      runsReplaced: 0,
      skippedStructuralMismatch: 0,
      affectedTaskIds: [],
      keptRemoved: [],
      changedWhileSaving: [],
      dryRun: false,
    });
  });

  it("returns an empty report when activeRuns is null", async () => {
    const supabase = createPropagationMockSupabase({ activeRuns: null, stepsByRun: {} });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);
    expect(result.runsUpdated).toBe(0);
    expect(result.affectedTaskIds).toEqual([]);
  });

  const threeStepRun = {
    "run-1": [pending("s1", 1, "Step A Updated"), pending("s2", 2, "Step B Updated", "QA"), pending("s3", 3, "Old third")],
  };

  it("swaps a never-started run with a different step count and reports its task", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1", board_tasks: card() }],
      stepsByRun: threeStepRun,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);

    expect(supabase.rpc).toHaveBeenCalledWith("replace_unstarted_workflow_run", {
      p_run_id: "run-1",
      p_steps: [
        { title: "Step A Updated", description: "New desc", agent_role: "Dev", human_check_required: true, expected_deliverables: ["doc.md"], model_tier: null, effort_override: null },
        { title: "Step B Updated", description: "QA desc", agent_role: "QA", human_check_required: false, expected_deliverables: [], model_tier: null, effort_override: null },
      ],
    });
    expect(result.runsReplaced).toBe(1);
    expect(result.affectedTaskIds).toEqual(["task-1"]);
  });

  it("falls back to the careful path when the swap refuses", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1", board_tasks: card() }],
      stepsByRun: threeStepRun,
      swapResult: { data: false, error: null },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);

    expect(supabase.rpc.mock.calls.map((c) => c[0])).toEqual(["replace_unstarted_workflow_run", "reshape_workflow_run"]);
    expect(result.runsReplaced).toBe(0);
    expect(result.runsUpdated).toBe(1);
  });

  it("reshapes a started card: removes an untouched step and adds a new one (acceptance 1)", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1", board_tasks: card() }],
      stepsByRun: {
        "run-1": [
          pending("a", 1, "A", "Dev", { status: "completed", output: "done" }),
          pending("b", 2, "B", "Dev", { status: "in_progress", started_at: "2026-11-01" }),
          pending("c", 3, "C", "Dev"),
          pending("d", 4, "D", "Dev"),
        ],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", [
      { title: "A", role: "Dev" },
      { title: "B", role: "Dev" },
      { title: "X", role: "Security" },
      { title: "D", role: "Dev" },
    ]);

    const call = supabase.rpc.mock.calls.find((c) => c[0] === "reshape_workflow_run")!;
    expect(call[1].p_deletes).toEqual(["c"]);
    expect(call[1].p_inserts).toHaveLength(1);
    expect(call[1].p_inserts[0].title).toBe("X");
    expect(call[1].p_expected).toHaveLength(4);
    expect(result.runsUpdated).toBe(1);
    expect(result.affectedTaskIds).toEqual(["task-1"]);
    expect(result.keptRemoved).toEqual([]);
  });

  it("keeps a removed step that has a comment and reports it by card (acceptance 2)", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1", board_tasks: card("Fix login") }],
      stepsByRun: {
        "run-1": [
          pending("a", 1, "A", "Dev", { status: "completed", output: "done" }),
          pending("c", 2, "C", "Dev", { comment_count: 2 }),
          pending("d", 3, "D", "Dev"),
        ],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", [
      { title: "A", role: "Dev" },
      { title: "X", role: "Security" },
      { title: "D", role: "Dev" },
    ]);

    const call = supabase.rpc.mock.calls.find((c) => c[0] === "reshape_workflow_run")!;
    expect(call[1].p_deletes).toEqual([]);
    expect(result.keptRemoved).toEqual([{ taskId: "task-1", title: "Fix login", stepTitle: "C" }]);
  });

  it("writes nothing when the template did not really change (acceptance 7)", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1", board_tasks: card() }],
      stepsByRun: {
        "run-1": [
          pending("a", 1, "Step A Updated", "Dev", { description: "New desc", human_check_required: true, expected_deliverables: ["doc.md"] }),
          pending("b", 2, "Step B Updated", "QA", { description: "QA desc" }),
        ],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(result.runsUpdated).toBe(0);
    expect(result.affectedTaskIds).toEqual([]);
  });

  it("skips archived cards without reading their steps (acceptance 8)", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1", board_tasks: card("Old", true) }],
      stepsByRun: { "run-1": [pending("s1", 1, "Something else")] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(result.runsUpdated).toBe(0);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("reports a card as changed while saving when the database says so (acceptance 9)", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1", board_tasks: card("Fix login") }],
      stepsByRun: { "run-1": [pending("s1", 1, "Old A"), pending("s2", 2, "Old B", "QA")] },
      reshapeResult: { data: "changed", error: null },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);

    expect(result.runsUpdated).toBe(0);
    expect(result.skippedStructuralMismatch).toBe(1);
    expect(result.changedWhileSaving).toEqual([{ taskId: "task-1", title: "Fix login" }]);
    expect(result.affectedTaskIds).toEqual([]);
  });

  it("treats a failed write as changed while saving, not a crash", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1", board_tasks: card() }],
      stepsByRun: { "run-1": [pending("s1", 1, "Old A"), pending("s2", 2, "Old B", "QA")] },
      reshapeResult: { data: null, error: { message: "boom" } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);

    expect(result.changedWhileSaving).toHaveLength(1);
    expect(result.runsUpdated).toBe(0);
  });

  it("dry run writes nothing and returns a per-card preview (acceptance 11)", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1", board_tasks: card("Fix login") }],
      stepsByRun: {
        "run-1": [
          pending("a", 1, "A", "Dev", { status: "completed", output: "done" }),
          pending("c", 2, "C", "Dev"),
          pending("d", 3, "D", "Dev"),
        ],
      },
    });
    const result = await propagateTemplateEdits(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      "tmpl-1",
      [
        { title: "A", role: "Dev" },
        { title: "X", role: "Security" },
        { title: "D", role: "Dev" },
      ],
      { dryRun: true }
    );

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.affectedTaskIds).toEqual([]);
    expect(result.preview).toEqual([
      { taskId: "task-1", title: "Fix login", adds: ["X"], removes: ["C"], keeps: [], renames: [], stepsRewritten: 0 },
    ]);
  });

  it("copies a template step's own effort and model tier onto the waiting step (in place)", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1", board_tasks: card() }],
      stepsByRun: { "run-1": [pending("s1", 1, "Review"), pending("s2", 2, "Test", "QA")] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await propagateTemplateEdits(supabase as any, "tmpl-1", [
      { title: "Review", role: "Dev", model_tier: "frontier", effort: "high" },
      { title: "Test", role: "QA", model_tier: "standard" },
    ]);

    const updates = supabase.rpc.mock.calls.find((c) => c[0] === "reshape_workflow_run")![1].p_updates;
    expect(updates.map((u: { effort_override: unknown }) => u.effort_override)).toEqual(["high", null]);
    expect(updates.map((u: { model_tier: unknown }) => u.model_tier)).toEqual(["frontier", "standard"]);
  });

  it("clears the agent only on a step whose role changed", async () => {
    const supabase = createPropagationMockSupabase({
      activeRuns: [{ id: "run-1", task_id: "task-1", board_tasks: card() }],
      stepsByRun: {
        "run-1": [
          pending("s1", 1, "Step A Updated", "Planner"), // template says Dev
          pending("s2", 2, "Step B Updated", "  qa "), // case/space only
        ],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await propagateTemplateEdits(supabase as any, "tmpl-1", sampleTemplateSteps);

    const updates = supabase.rpc.mock.calls.find((c) => c[0] === "reshape_workflow_run")![1].p_updates;
    expect(updates.find((u: { id: string }) => u.id === "s1").clear_agent).toBe(true);
    expect(updates.find((u: { id: string }) => u.id === "s2").clear_agent).toBe(false);
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

// ---------------------------------------------------------------------------
// resolveSuggestionOnApply — the apply-side fix for orphaned suggestions.
// ---------------------------------------------------------------------------

type OpenSuggestionRow = {
  id: string;
  suggested_template_id: string | null;
  recommended_template_id: string | null;
};

/**
 * Mock supabase for resolveSuggestionOnApply. Two distinct calls hit
 * `workflow_suggestions`:
 *   1. a LIST select (awaited directly → thenable resolves to the open set)
 *   2. a guarded UPDATE terminated by `.maybeSingle()` (returns the claimed row
 *      or null when the concurrency guard matched zero rows)
 * Each `from()` returns a fresh chain so the two operations don't bleed state.
 */
function makeSuggestionSupabase(opts: {
  openSuggestions: OpenSuggestionRow[];
  claimResult?: { id: string } | null;
  selectError?: { message: string } | null;
  updateError?: { message: string } | null;
}) {
  const captured = {
    updatePayload: null as Record<string, unknown> | null,
    updateEqs: [] as [string, unknown][],
    updateCalled: false,
  };

  function makeChain() {
    let isUpdate = false;
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.update = vi.fn((v: Record<string, unknown>) => {
      isUpdate = true;
      captured.updateCalled = true;
      captured.updatePayload = v;
      return chain;
    });
    chain.eq = vi.fn((col: string, val: unknown) => {
      if (isUpdate) captured.updateEqs.push([col, val]);
      return chain;
    });
    chain.maybeSingle = vi.fn(() =>
      Promise.resolve({
        data: "claimResult" in opts ? (opts.claimResult ?? null) : { id: "sug-1" },
        error: opts.updateError ?? null,
      })
    );
    // Thenable: the list select awaits the chain directly.
    chain.then = (resolve: (v: unknown) => void) =>
      Promise.resolve({
        data: opts.openSuggestions,
        error: opts.selectError ?? null,
      }).then(resolve);
    return chain;
  }

  const supabase = { from: vi.fn(() => makeChain()) };
  return { supabase, captured };
}

describe("resolveSuggestionOnApply", () => {
  it("marks the suggestion 'accepted' when the applied template matches suggested_template_id", async () => {
    const { supabase, captured } = makeSuggestionSupabase({
      openSuggestions: [
        { id: "sug-1", suggested_template_id: "tpl-1", recommended_template_id: "tpl-1" },
      ],
    });

    const result = await resolveSuggestionOnApply(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      { taskId: "task-1", templateId: "tpl-1", resolvedBy: "user-1" }
    );

    expect(result).toEqual({ resolved: true });
    expect(captured.updatePayload).toMatchObject({
      status: "accepted",
      resolved_by: "user-1",
      adjudication_started_at: null,
    });
    expect(captured.updatePayload?.resolved_at).toBeTruthy();
    // accepted path must NOT record a replacement template.
    expect(captured.updatePayload?.replacement_template_id).toBeUndefined();
    // Concurrency guard present.
    expect(captured.updateEqs).toContainEqual(["status", "suggested"]);
    expect(captured.updateEqs).toContainEqual(["id", "sug-1"]);
  });

  it("marks the suggestion 'replaced' when the applied template matches recommended but differs from suggested", async () => {
    const { supabase, captured } = makeSuggestionSupabase({
      openSuggestions: [
        { id: "sug-1", suggested_template_id: "tpl-1", recommended_template_id: "tpl-2" },
      ],
    });

    const result = await resolveSuggestionOnApply(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      { taskId: "task-1", templateId: "tpl-2", resolvedBy: "user-1" }
    );

    expect(result).toEqual({ resolved: true });
    expect(captured.updatePayload).toMatchObject({
      status: "replaced",
      replacement_template_id: "tpl-2",
      resolved_by: "user-1",
      adjudication_started_at: null,
    });
  });

  it("is a NO-OP when the applied template matches NEITHER id (the warning is still valid)", async () => {
    const { supabase, captured } = makeSuggestionSupabase({
      openSuggestions: [
        { id: "sug-1", suggested_template_id: "tpl-1", recommended_template_id: "tpl-2" },
      ],
    });

    const result = await resolveSuggestionOnApply(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      { taskId: "task-1", templateId: "tpl-DIFFERENT", resolvedBy: "user-1" }
    );

    expect(result).toEqual({ resolved: false });
    // CRITICAL regression guard: no update is issued, so the suggestion stays open.
    expect(captured.updateCalled).toBe(false);
  });

  it("is a NO-OP (no error) when the task has no open suggestion", async () => {
    const { supabase, captured } = makeSuggestionSupabase({ openSuggestions: [] });

    const result = await resolveSuggestionOnApply(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      { taskId: "task-1", templateId: "tpl-1", resolvedBy: "user-1" }
    );

    expect(result).toEqual({ resolved: false });
    expect(captured.updateCalled).toBe(false);
  });

  it("reports resolved:false when the concurrency guard matches zero rows (already resolved)", async () => {
    const { supabase } = makeSuggestionSupabase({
      openSuggestions: [
        { id: "sug-1", suggested_template_id: "tpl-1", recommended_template_id: null },
      ],
      claimResult: null,
    });

    const result = await resolveSuggestionOnApply(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      { taskId: "task-1", templateId: "tpl-1", resolvedBy: "user-1" }
    );

    expect(result).toEqual({ resolved: false });
  });

  it("is non-fatal: a lookup failure is swallowed and returns resolved:false", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase, captured } = makeSuggestionSupabase({
      openSuggestions: [],
      selectError: { message: "boom" },
    });

    const result = await resolveSuggestionOnApply(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      { taskId: "task-1", templateId: "tpl-1", resolvedBy: "user-1" }
    );

    expect(result).toEqual({ resolved: false });
    expect(captured.updateCalled).toBe(false);
    consoleSpy.mockRestore();
  });

  it("matches the correct suggestion among several open ones on the task (multi-label)", async () => {
    const { supabase, captured } = makeSuggestionSupabase({
      openSuggestions: [
        { id: "sug-A", suggested_template_id: "tpl-A", recommended_template_id: "tpl-A" },
        { id: "sug-B", suggested_template_id: "tpl-B", recommended_template_id: "tpl-B" },
      ],
    });

    const result = await resolveSuggestionOnApply(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      { taskId: "task-1", templateId: "tpl-B", resolvedBy: "user-1" }
    );

    expect(result).toEqual({ resolved: true });
    // Guarded the SECOND suggestion, not the first.
    expect(captured.updateEqs).toContainEqual(["id", "sug-B"]);
    expect(captured.updateEqs).not.toContainEqual(["id", "sug-A"]);
  });
});
