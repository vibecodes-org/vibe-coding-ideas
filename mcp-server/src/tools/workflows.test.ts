import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import {
  claimNextStep,
  claimNextStepSchema,
  completeStep,
  completeStepSchema,
  approveStep,
  approveStepSchema,
} from "./workflows";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-a000-000000000001";
const TASK_ID = "00000000-0000-4000-a000-000000000010";
const STEP_ID = "00000000-0000-4000-a000-000000000020";
const RUN_ID = "00000000-0000-4000-a000-000000000030";
const IDEA_ID = "00000000-0000-4000-a000-000000000040";

/** Creates a chainable Supabase query mock that captures method calls. */
function createChain(resolveWith: unknown = null) {
  const captured = {
    eqs: [] as [string, unknown][],
    ins: [] as [string, unknown[]][],
    inserted: null as unknown,
    updated: null as unknown,
    selectedFields: null as string | null,
    ltCalls: [] as [string, unknown][],
  };

  const chain: Record<string, unknown> = {};

  for (const m of [
    "order",
    "limit",
    "range",
    "or",
    "filter",
    "delete",
  ]) {
    chain[m] = vi.fn(() => chain);
  }

  chain.select = vi.fn((fields?: string) => {
    if (fields) captured.selectedFields = fields;
    return chain;
  });

  chain.eq = vi.fn((col: string, val: unknown) => {
    captured.eqs.push([col, val]);
    return chain;
  });

  chain.in = vi.fn((col: string, vals: unknown[]) => {
    captured.ins.push([col, vals]);
    return chain;
  });

  chain.lt = vi.fn((col: string, val: unknown) => {
    captured.ltCalls.push([col, val]);
    return chain;
  });

  chain.insert = vi.fn((data: unknown) => {
    captured.inserted = data;
    return chain;
  });

  chain.update = vi.fn((data: unknown) => {
    captured.updated = data;
    return chain;
  });

  chain.single = vi.fn(() =>
    Promise.resolve({ data: resolveWith, error: null })
  );
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: resolveWith, error: null })
  );

  // Make chain thenable for `await query`
  chain.then = (resolve: (val: unknown) => void) =>
    Promise.resolve({
      data: Array.isArray(resolveWith) ? resolveWith : [],
      error: null,
    }).then(resolve);

  return { chain, captured };
}

function makeContext(
  fromFn: McpContext["supabase"]["from"]
): McpContext {
  return {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: USER_ID,
  };
}

/** Helper to build a step row for claimNextStep mocking */
function makeStepRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STEP_ID,
    task_id: TASK_ID,
    idea_id: IDEA_ID,
    run_id: RUN_ID,
    title: "Test Step",
    description: "A test step",
    agent_role: "developer",
    bot_id: null,
    claimed_by: null,
    human_check_required: false,
    status: "pending",
    position: 1000,
    step_order: 2,
    output: null,
    expected_deliverables: [],
    comment_count: 0,
    started_at: null,
    completed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema validation tests
// ---------------------------------------------------------------------------

describe("workflow schemas", () => {
  describe("completeStepSchema", () => {
    it("accepts valid input with output", () => {
      const result = completeStepSchema.parse({
        step_id: STEP_ID,
        output: "Here is my deliverable",
      });
      expect(result.step_id).toBe(STEP_ID);
      expect(result.output).toBe("Here is my deliverable");
    });

    it("accepts valid input without output", () => {
      const result = completeStepSchema.parse({
        step_id: STEP_ID,
      });
      expect(result.step_id).toBe(STEP_ID);
      expect(result.output).toBeUndefined();
    });

    it("rejects invalid UUID", () => {
      expect(() =>
        completeStepSchema.parse({ step_id: "not-a-uuid" })
      ).toThrow();
    });
  });

  describe("claimNextStepSchema", () => {
    it("accepts valid task_id", () => {
      const result = claimNextStepSchema.parse({ task_id: TASK_ID });
      expect(result.task_id).toBe(TASK_ID);
    });
  });
});

// ---------------------------------------------------------------------------
// claimNextStep — context chaining tests
// ---------------------------------------------------------------------------

/**
 * Helper to build a claimNextStep mock context.
 * claimNextStep calls from("task_workflow_steps") 3 times:
 *   1. Select pending steps (thenable → array)
 *   2. Update/claim step (maybeSingle → single row)
 *   3. Context query — prior completed steps (thenable → array)
 * Plus from("workflow_runs") once and from("idea_agents") once,
 * and optionally from("workflow_step_comments") for rework instructions.
 */
function makeClaimContext(opts: {
  pendingStep: ReturnType<typeof makeStepRow>;
  updatedStep: Record<string, unknown>;
  priorSteps: { id: string; title: string; step_order: number; output: string | null }[];
}) {
  const tableCounts: Record<string, number> = {};

  return makeContext(((table: string) => {
    tableCounts[table] = (tableCounts[table] ?? 0) + 1;
    const callNum = tableCounts[table];

    if (table === "task_workflow_steps") {
      const chain = createChain(null);
      if (callNum === 1) {
        // 1st: fetch pending steps (awaited directly → thenable)
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [opts.pendingStep], error: null }).then(resolve);
      } else if (callNum === 2) {
        // 2nd: claim update (maybeSingle)
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: opts.updatedStep, error: null })
        );
      } else if (callNum === 3) {
        // 3rd: context query — prior completed/skipped steps (thenable)
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: opts.priorSteps, error: null }).then(resolve);
      }
      return chain.chain;
    }

    if (table === "workflow_runs") {
      const chain = createChain(null);
      chain.chain.then = (resolve: (val: unknown) => void) =>
        Promise.resolve({ data: null, error: null }).then(resolve);
      return chain.chain;
    }

    if (table === "workflow_step_comments") {
      return createChain([]).chain;
    }

    if (table === "idea_agents") {
      return createChain([]).chain;
    }

    return createChain(null).chain;
  }) as unknown as McpContext["supabase"]["from"]);
}

describe("claimNextStep", () => {
  it("populates context from prior completed steps' output column", async () => {
    const step = makeStepRow({ step_order: 3 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [
      { id: "s1", title: "Step 1", step_order: 1, output: "Output from step 1" },
      { id: "s2", title: "Step 2", step_order: 2, output: "Output from step 2" },
    ];

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    expect(result).toHaveProperty("context");
    const r = result as { context: { step_title: string; output: string }[] };
    expect(r.context).toHaveLength(2);
    expect(r.context[0]).toEqual({ step_title: "Step 1", output: "Output from step 1" });
    expect(r.context[1]).toEqual({ step_title: "Step 2", output: "Output from step 2" });
  });

  it("returns empty context for first step (no prior steps)", async () => {
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { context: { step_title: string; output: string }[] };
    expect(r.context).toEqual([]);
  });

  it("includes skipped steps with output in context", async () => {
    const step = makeStepRow({ step_order: 3 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [
      { id: "s1", title: "Step 1", step_order: 1, output: "Done" },
      { id: "s2", title: "Skipped Step", step_order: 2, output: "Skipped: not applicable" },
    ];

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { context: { step_title: string; output: string }[] };
    expect(r.context).toHaveLength(2);
    expect(r.context[1]).toEqual({ step_title: "Skipped Step", output: "Skipped: not applicable" });
  });

  it("excludes completed steps with null output from context", async () => {
    const step = makeStepRow({ step_order: 3 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [
      { id: "s1", title: "Step 1", step_order: 1, output: "Has output" },
      { id: "s2", title: "Step 2", step_order: 2, output: null },
    ];

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { context: { step_title: string; output: string }[] };
    expect(r.context).toHaveLength(1);
    expect(r.context[0].step_title).toBe("Step 1");
  });

  it("preserves step_order in context", async () => {
    const step = makeStepRow({ step_order: 4 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [
      { id: "s1", title: "First", step_order: 1, output: "A" },
      { id: "s2", title: "Second", step_order: 2, output: "B" },
      { id: "s3", title: "Third", step_order: 3, output: "C" },
    ];

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { context: { step_title: string; output: string }[] };
    expect(r.context).toHaveLength(3);
    expect(r.context.map((c) => c.step_title)).toEqual(["First", "Second", "Third"]);
  });

  it("includes prior step titles in context chaining instruction", async () => {
    const step = makeStepRow({ step_order: 3 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [
      { id: "s1", title: "Research & Analysis", step_order: 1, output: "findings" },
      { id: "s2", title: "Architecture Design", step_order: 2, output: "architecture" },
    ];

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).toContain("CONTEXT CHAINING");
    expect(r.instruction).toContain('"Research & Analysis"');
    expect(r.instruction).toContain('"Architecture Design"');
    expect(r.instruction).toContain("Cite prior steps by name");
  });

  it("omits context chaining instruction when no prior steps", async () => {
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).not.toContain("CONTEXT CHAINING");
  });

  it("returns done when no pending steps", async () => {
    const ctx = makeContext(((table: string) => {
      const chain = createChain([]);
      return chain.chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = await claimNextStep(ctx, { task_id: TASK_ID });
    expect(result).toEqual({ done: true, message: "All steps complete or no pending steps" });
  });
});

// ---------------------------------------------------------------------------
// completeStep tests
// ---------------------------------------------------------------------------

describe("completeStep", () => {
  it("creates output comment when output is provided", async () => {
    const stepData = {
      id: STEP_ID,
      run_id: RUN_ID,
      idea_id: IDEA_ID,
      human_check_required: false,
      status: "in_progress",
    };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Test Step",
      agent_role: "developer",
      status: "completed",
      output: "My output",
      completed_at: "2026-01-01T00:00:00Z",
    };

    let commentInserted = false;
    let insertedData: Record<string, unknown> | null = null;

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        // single() for the initial fetch
        chain.chain.single = vi.fn(() =>
          Promise.resolve({ data: stepData, error: null })
        );
        // maybeSingle() for the update
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: updatedStep, error: null })
        );
        // then for the run completion check
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return chain.chain;
      }

      if (table === "workflow_step_comments") {
        const chain = createChain(null);
        const origInsert = chain.chain.insert;
        chain.chain.insert = vi.fn((data: unknown) => {
          commentInserted = true;
          insertedData = data as Record<string, unknown>;
          return chain.chain;
        });
        return chain.chain;
      }

      // workflow_runs for checkAndCompleteRun
      if (table === "workflow_runs") {
        const chain = createChain(null);
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: null, error: null })
        );
        return chain.chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await completeStep(ctx, { step_id: STEP_ID, output: "My output" });

    expect(commentInserted).toBe(true);
    expect(insertedData).toMatchObject({
      step_id: STEP_ID,
      idea_id: IDEA_ID,
      author_id: USER_ID,
      type: "output",
      content: "My output",
    });
  });

  it("returns stop message when step routes to awaiting_approval", async () => {
    const stepData = {
      id: STEP_ID,
      run_id: RUN_ID,
      idea_id: IDEA_ID,
      human_check_required: true,
      status: "in_progress",
    };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Test Step",
      agent_role: "developer",
      status: "awaiting_approval",
      output: "My output",
      completed_at: null,
    };

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() =>
          Promise.resolve({ data: stepData, error: null })
        );
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: updatedStep, error: null })
        );
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return chain.chain;
      }

      if (table === "workflow_step_comments") {
        return createChain(null).chain;
      }

      if (table === "workflow_runs") {
        const chain = createChain(null);
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: null, error: null })
        );
        return chain.chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = await completeStep(ctx, { step_id: STEP_ID, output: "My output" });

    expect(result.status).toBe("awaiting_approval");
    expect(result).toHaveProperty("message");
    expect((result as { message: string }).message).toContain("STOP");
    expect((result as { message: string }).message).toContain("do NOT call approve_step");
  });

  it("does not return stop message for normal completion", async () => {
    const stepData = {
      id: STEP_ID,
      run_id: RUN_ID,
      idea_id: IDEA_ID,
      human_check_required: false,
      status: "in_progress",
    };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Test Step",
      agent_role: "developer",
      status: "completed",
      output: "My output",
      completed_at: "2026-01-01T00:00:00Z",
    };

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() =>
          Promise.resolve({ data: stepData, error: null })
        );
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: updatedStep, error: null })
        );
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return chain.chain;
      }

      if (table === "workflow_step_comments") {
        return createChain(null).chain;
      }

      if (table === "workflow_runs") {
        const chain = createChain(null);
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: null, error: null })
        );
        return chain.chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = await completeStep(ctx, { step_id: STEP_ID, output: "My output" });

    expect(result.status).toBe("completed");
    expect(result).not.toHaveProperty("message");
  });

  it("does not create output comment when output is omitted", async () => {
    const stepData = {
      id: STEP_ID,
      run_id: RUN_ID,
      idea_id: IDEA_ID,
      human_check_required: false,
      status: "in_progress",
    };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Test Step",
      agent_role: "developer",
      status: "completed",
      output: null,
      completed_at: "2026-01-01T00:00:00Z",
    };

    let commentInserted = false;

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() =>
          Promise.resolve({ data: stepData, error: null })
        );
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: updatedStep, error: null })
        );
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return chain.chain;
      }

      if (table === "workflow_step_comments") {
        const chain = createChain(null);
        chain.chain.insert = vi.fn(() => {
          commentInserted = true;
          return chain.chain;
        });
        return chain.chain;
      }

      if (table === "workflow_runs") {
        const chain = createChain(null);
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: null, error: null })
        );
        return chain.chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await completeStep(ctx, { step_id: STEP_ID });

    expect(commentInserted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// claimNextStep — human approval directive tests
// ---------------------------------------------------------------------------

describe("claimNextStep — human approval directive", () => {
  it("includes human approval directive when step has human_check_required", async () => {
    const step = makeStepRow({ human_check_required: true });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).toContain("HUMAN APPROVAL REQUIRED");
    expect(r.instruction).toContain("Do NOT call approve_step");
  });

  it("omits human approval directive when step does not require human check", async () => {
    const step = makeStepRow({ human_check_required: false });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).not.toContain("HUMAN APPROVAL REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// approveStep — bot rejection test
// ---------------------------------------------------------------------------

describe("approveStep", () => {
  it("rejects bot callers", async () => {
    const ctx = makeContext(((table: string) => {
      if (table === "users") {
        const chain = createChain({ is_bot: true });
        return chain.chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await expect(
      approveStep(ctx, { step_id: STEP_ID })
    ).rejects.toThrow("Only humans can approve");
  });

  it("allows human callers", async () => {
    const stepData = {
      id: STEP_ID,
      run_id: RUN_ID,
      idea_id: IDEA_ID,
      status: "awaiting_approval",
    };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Test Step",
      agent_role: "developer",
      status: "completed",
      output: "output",
      completed_at: "2026-01-01T00:00:00Z",
    };

    const tableCounts: Record<string, number> = {};
    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;

      if (table === "users") {
        return createChain({ is_bot: false }).chain;
      }

      if (table === "task_workflow_steps") {
        const callNum = tableCounts[table];
        if (callNum === 1) {
          // Fetch step
          return createChain(stepData).chain;
        }
        // Update step
        const chain = createChain(null);
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: updatedStep, error: null })
        );
        return chain.chain;
      }

      if (table === "workflow_runs") {
        const chain = createChain(null);
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: null, error: null })
        );
        return chain.chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = await approveStep(ctx, { step_id: STEP_ID });
    expect(result.step).toMatchObject({ status: "completed" });
  });
});
