import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import {
  claimNextStep,
  claimNextStepSchema,
  completeStep,
  completeStepSchema,
  approveStep,
  approveStepSchema,
  failStep,
  failStepSchema,
  updateStep,
  updateStepSchema,
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
    neqs: [] as [string, unknown][],
    gtes: [] as [string, unknown][],
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

  chain.neq = vi.fn((col: string, val: unknown) => {
    captured.neqs.push([col, val]);
    return chain;
  });

  chain.gte = vi.fn((col: string, val: unknown) => {
    captured.gtes.push([col, val]);
    return chain;
  });

  chain.lt = vi.fn((col: string, val: unknown) => {
    captured.ltCalls.push([col, val]);
    return chain;
  });

  chain.not = vi.fn(() => chain);

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
        // 3rd: Tier 2 run-scoped step ID query (fires when output=null, comment_count=0)
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [{ id: opts.pendingStep.id }], error: null }).then(resolve);
      } else if (callNum === 4) {
        // 4th: context query — prior completed/skipped steps (thenable)
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
    const r = result as { context: { step_id: string; step_title: string; output: string }[] };
    expect(r.context).toHaveLength(2);
    expect(r.context[0]).toEqual({ step_id: "s1", step_title: "Step 1", output: "Output from step 1" });
    expect(r.context[1]).toEqual({ step_id: "s2", step_title: "Step 2", output: "Output from step 2" });
  });

  it("returns empty context for first step (no prior steps)", async () => {
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { context: { step_id: string; step_title: string; output: string }[] };
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

    const r = result as { context: { step_id: string; step_title: string; output: string }[] };
    expect(r.context).toHaveLength(2);
    expect(r.context[1]).toEqual({ step_id: "s2", step_title: "Skipped Step", output: "Skipped: not applicable" });
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

    const r = result as { context: { step_id: string; step_title: string; output: string }[] };
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

    const r = result as { context: { step_id: string; step_title: string; output: string }[] };
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
    expect(r.instruction).not.toContain("CASCADE REJECTION");
  });

  it("includes cascade rejection guidance with prior step IDs", async () => {
    const step = makeStepRow({ step_order: 3 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [
      { id: "s1", title: "Implementation", step_order: 1, output: "code written" },
      { id: "s2", title: "Unit Tests", step_order: 2, output: "tests passing" },
    ];

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).toContain("CASCADE REJECTION");
    expect(r.instruction).toContain("fail_step");
    expect(r.instruction).toContain("reset_to_step_id");
    expect(r.instruction).toContain("step_id: s1");
    expect(r.instruction).toContain("step_id: s2");
    expect(r.instruction).toContain('"Implementation"');
    expect(r.instruction).toContain('"Unit Tests"');
  });

  it("includes explicit format constraint for parenthetical deliverables", async () => {
    const step = makeStepRow({
      step_order: 1,
      expected_deliverables: ["Design document (HTML)", "Component inventory"],
    });
    const updatedStep = {
      ...step,
      status: "in_progress",
      claimed_by: USER_ID,
    };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).toContain("EXPECTED DELIVERABLES");
    expect(r.instruction).toContain("write this as a HTML file");
    expect(r.instruction).toContain("not markdown");
    // Non-parenthetical deliverable should not get a format note
    expect(r.instruction).not.toContain("write this as a Component file");
  });

  it("omits format constraint for deliverables without parenthetical", async () => {
    const step = makeStepRow({
      step_order: 1,
      expected_deliverables: ["Requirements doc", "Test plan"],
    });
    const updatedStep = {
      ...step,
      status: "in_progress",
      claimed_by: USER_ID,
    };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).toContain("EXPECTED DELIVERABLES");
    expect(r.instruction).not.toContain("write this as a");
  });

  it("instructs agent to write file for HTML deliverable", async () => {
    const step = makeStepRow({
      step_order: 1,
      expected_deliverables: ["Design document (HTML)"],
    });
    const updatedStep = {
      ...step,
      status: "in_progress",
      claimed_by: USER_ID,
    };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).toContain("docs/");
    expect(r.instruction).toContain("Do NOT paste the full file content");
  });

  it("instructs agent to write file for JSON deliverable", async () => {
    const step = makeStepRow({
      step_order: 1,
      expected_deliverables: ["API schema (JSON)"],
    });
    const updatedStep = {
      ...step,
      status: "in_progress",
      claimed_by: USER_ID,
    };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).toContain("docs/");
    expect(r.instruction).toContain("Do NOT paste the full file content");
  });

  it("gives adaptive format guidance for deliverable without format hint", async () => {
    const step = makeStepRow({
      step_order: 1,
      expected_deliverables: ["Requirements doc"],
    });
    const updatedStep = {
      ...step,
      status: "in_progress",
      claimed_by: USER_ID,
    };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).toContain("DELIVERABLE FORMAT: Choose the appropriate format");
    expect(r.instruction).toContain("Use your judgement");
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
  it("does not create output comment on completion (output column is sufficient)", async () => {
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

    await completeStep(ctx, { step_id: STEP_ID, output: "My output" });

    // Output is stored on the step's output column only — no duplicate comment
    expect(commentInserted).toBe(false);
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
// claimNextStep — rework instructions in instruction string
// ---------------------------------------------------------------------------

describe("claimNextStep — rework instructions", () => {
  /** Extended makeClaimContext that returns rework comments from workflow_step_comments */
  function makeClaimContextWithRework(opts: {
    pendingStep: ReturnType<typeof makeStepRow>;
    updatedStep: Record<string, unknown>;
    priorSteps: { id: string; title: string; step_order: number; output: string | null }[];
    reworkComments: { content: string; author_id: string; created_at: string; type: string }[];
  }) {
    const tableCounts: Record<string, number> = {};

    return makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table];

      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        if (callNum === 1) {
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [opts.pendingStep], error: null }).then(resolve);
        } else if (callNum === 2) {
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: opts.updatedStep, error: null })
          );
        } else if (callNum === 3) {
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
        return createChain(opts.reworkComments).chain;
      }

      if (table === "idea_agents") {
        return createChain([]).chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);
  }

  it("includes rework warning and feedback in instruction when rework_instructions present", async () => {
    const step = makeStepRow({ output: "Previous attempt failed", comment_count: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContextWithRework({
      pendingStep: step,
      updatedStep,
      priorSteps: [],
      reworkComments: [
        { content: "Please fix the validation logic", author_id: USER_ID, created_at: "2026-01-01T00:00:00Z", type: "failure" },
        { content: "Also handle edge case for empty input", author_id: USER_ID, created_at: "2026-01-01T01:00:00Z", type: "changes_requested" },
      ],
    });

    const result = await claimNextStep(ctx, { task_id: TASK_ID });
    const r = result as { instruction: string };

    expect(r.instruction).toContain("REWORK REQUIRED");
    expect(r.instruction).toContain("Previous failure: Previous attempt failed");
    expect(r.instruction).toContain("Feedback: Please fix the validation logic");
    expect(r.instruction).toContain("Feedback: Also handle edge case for empty input");
  });

  it("does not include rework section when no rework_instructions", async () => {
    const step = makeStepRow();
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).not.toContain("REWORK REQUIRED");
  });

  it("includes run-level rework instructions for intermediate cascade-reset steps", async () => {
    // Step has no local output or comments (intermediate step reset by cascade)
    const step = makeStepRow({ output: null, comment_count: 0 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const tableCounts: Record<string, number> = {};

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table];

      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        if (callNum === 1) {
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [step], error: null }).then(resolve);
        } else if (callNum === 2) {
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
        } else if (callNum === 3) {
          // Tier 2: run-scoped step IDs
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [{ id: step.id }, { id: "sibling-step" }], error: null }).then(resolve);
        } else if (callNum === 4) {
          // Context query — no prior steps
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [], error: null }).then(resolve);
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
        // Tier 2 run-scoped comments query — return failure + changes_requested from sibling steps
        return createChain([
          { content: "Validation logic is wrong", author_id: USER_ID, created_at: "2026-01-01T00:00:00Z", type: "failure" },
          { content: "Fix the edge case handling", author_id: USER_ID, created_at: "2026-01-01T01:00:00Z", type: "changes_requested" },
        ]).chain;
      }

      if (table === "idea_agents") {
        return createChain([]).chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = await claimNextStep(ctx, { task_id: TASK_ID });
    const r = result as { instruction: string; rework_instructions: unknown };

    expect(r.rework_instructions).not.toBeNull();
    expect(r.instruction).toContain("REWORK REQUIRED");
    expect(r.instruction).toContain("Feedback: Fix the edge case handling");
  });

  it("no false positives when run has no cascade comments", async () => {
    // Step has no local output or comments, and run siblings have no failure/changes_requested
    const step = makeStepRow({ output: null, comment_count: 0 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const tableCounts: Record<string, number> = {};

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table];

      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        if (callNum === 1) {
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [step], error: null }).then(resolve);
        } else if (callNum === 2) {
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
        } else if (callNum === 3) {
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [], error: null }).then(resolve);
        } else if (callNum === 4) {
          // Tier 2: run-scoped step IDs
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [{ id: step.id }], error: null }).then(resolve);
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
        // No cascade comments in the run
        return createChain([]).chain;
      }

      if (table === "idea_agents") {
        return createChain([]).chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = await claimNextStep(ctx, { task_id: TASK_ID });
    const r = result as { instruction: string; rework_instructions: unknown };

    expect(r.rework_instructions).toBeNull();
    expect(r.instruction).not.toContain("REWORK REQUIRED");
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

// ---------------------------------------------------------------------------
// failStep tests
// ---------------------------------------------------------------------------

const RESET_TO_STEP_ID = "00000000-0000-4000-a000-000000000099";

describe("failStep", () => {
  it("resets the failed step itself when cascade is used", async () => {
    const stepFetched = { id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Design Review",
      agent_role: "reviewer",
      status: "failed",
      output: "Needs rework",
    };
    const targetStep = { step_order: 2, position: 2000 };

    const tableCounts: Record<string, number> = {};
    // Track the cascade reset chain specifically
    let cascadeResetChain: ReturnType<typeof createChain> | null = null;

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table]!;

      if (table === "task_workflow_steps") {
        if (callNum === 1) {
          // 1st: fetch step to get run_id/step_order
          return createChain(stepFetched).chain;
        }
        if (callNum === 2) {
          // 2nd: update step to failed
          const chain = createChain(null);
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
          return chain.chain;
        }
        if (callNum === 3) {
          // 3rd: fetch target step for cascade
          return createChain(targetStep).chain;
        }
        if (callNum === 4) {
          // 4th: snapshot steps with output
          return createChain([]).chain;
        }
        if (callNum === 5) {
          // 5th: cascade reset update
          cascadeResetChain = createChain([{ id: STEP_ID }, { id: RESET_TO_STEP_ID }]);
          return cascadeResetChain.chain;
        }
      }

      if (table === "workflow_step_comments") {
        return createChain(null).chain;
      }

      if (table === "workflow_runs") {
        return createChain(null).chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = await failStep(ctx, {
      step_id: STEP_ID,
      output: "Needs rework",
      reset_to_step_id: RESET_TO_STEP_ID,
    });

    // The cascade reset should NOT have a .neq("id", ...) filter
    expect(cascadeResetChain).not.toBeNull();
    expect(cascadeResetChain!.captured.neqs).toEqual([]);
    // Should have .gte for step_order
    expect(cascadeResetChain!.captured.gtes).toEqual([["step_order", 2]]);
    expect(result.steps_reset).toBe(2);
  });

  it("sets run to running when cascade is used", async () => {
    const stepFetched = { id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Design Review",
      agent_role: "reviewer",
      status: "failed",
      output: "Needs rework",
    };
    const targetStep = { step_order: 2, position: 2000 };

    const tableCounts: Record<string, number> = {};
    let runUpdateData: unknown = null;

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table]!;

      if (table === "task_workflow_steps") {
        if (callNum === 1) {
          return createChain(stepFetched).chain;
        }
        if (callNum === 2) {
          const chain = createChain(null);
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
          return chain.chain;
        }
        if (callNum === 3) {
          return createChain(targetStep).chain;
        }
        if (callNum === 4) {
          // snapshot steps with output
          return createChain([]).chain;
        }
        if (callNum === 5) {
          return createChain([{ id: STEP_ID }]).chain;
        }
      }

      if (table === "workflow_step_comments") {
        return createChain(null).chain;
      }

      if (table === "workflow_runs") {
        const chain = createChain(null);
        chain.chain.update = vi.fn((data: unknown) => {
          runUpdateData = data;
          return chain.chain;
        });
        return chain.chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await failStep(ctx, {
      step_id: STEP_ID,
      output: "Needs rework",
      reset_to_step_id: RESET_TO_STEP_ID,
    });

    expect(runUpdateData).toEqual({ status: "running" });
  });

  it("sets run to failed when no cascade", async () => {
    const stepFetched = { id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Design Review",
      agent_role: "reviewer",
      status: "failed",
      output: "Fatal error",
    };

    const tableCounts: Record<string, number> = {};
    let runUpdateData: unknown = null;

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table]!;

      if (table === "task_workflow_steps") {
        if (callNum === 1) {
          return createChain(stepFetched).chain;
        }
        if (callNum === 2) {
          const chain = createChain(null);
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
          return chain.chain;
        }
      }

      if (table === "workflow_runs") {
        const chain = createChain(null);
        chain.chain.update = vi.fn((data: unknown) => {
          runUpdateData = data;
          return chain.chain;
        });
        return chain.chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await failStep(ctx, {
      step_id: STEP_ID,
      output: "Fatal error",
    });

    expect(runUpdateData).toEqual({ status: "failed" });
  });

  it("auto-creates failure comment when output is provided", async () => {
    const stepFetched = { id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Design Review",
      agent_role: "reviewer",
      status: "failed",
      output: "Design does not meet requirements",
    };

    const tableCounts: Record<string, number> = {};
    let commentInserted: unknown = null;

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table]!;

      if (table === "task_workflow_steps") {
        if (callNum === 1) {
          return createChain(stepFetched).chain;
        }
        if (callNum === 2) {
          const chain = createChain(null);
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
          return chain.chain;
        }
      }

      if (table === "workflow_step_comments") {
        const chain = createChain(null);
        chain.chain.insert = vi.fn((data: unknown) => {
          commentInserted = data;
          return chain.chain;
        });
        return chain.chain;
      }

      if (table === "workflow_runs") {
        return createChain(null).chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await failStep(ctx, {
      step_id: STEP_ID,
      output: "Design does not meet requirements",
    });

    expect(commentInserted).toEqual({
      step_id: STEP_ID,
      idea_id: IDEA_ID,
      author_id: USER_ID,
      type: "failure",
      content: "Design does not meet requirements",
    });
  });

  it("does not create failure comment when no output", async () => {
    const stepFetched = { id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Design Review",
      agent_role: "reviewer",
      status: "failed",
      output: null,
    };

    const tableCounts: Record<string, number> = {};
    let commentTableAccessed = false;

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table]!;

      if (table === "task_workflow_steps") {
        if (callNum === 1) {
          return createChain(stepFetched).chain;
        }
        if (callNum === 2) {
          const chain = createChain(null);
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
          return chain.chain;
        }
      }

      if (table === "workflow_step_comments") {
        commentTableAccessed = true;
        return createChain(null).chain;
      }

      if (table === "workflow_runs") {
        return createChain(null).chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await failStep(ctx, {
      step_id: STEP_ID,
    });

    expect(commentTableAccessed).toBe(false);
  });

  it("clears claimed_by on cascade-reset steps", async () => {
    const stepFetched = { id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Design Review",
      agent_role: "reviewer",
      status: "failed",
      output: "Needs rework",
    };
    const targetStep = { step_order: 2, position: 2000 };

    const tableCounts: Record<string, number> = {};
    let cascadeUpdateData: unknown = null;

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table]!;

      if (table === "task_workflow_steps") {
        if (callNum === 1) {
          return createChain(stepFetched).chain;
        }
        if (callNum === 2) {
          const chain = createChain(null);
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
          return chain.chain;
        }
        if (callNum === 3) {
          // Fetch target step for cascade
          return createChain(targetStep).chain;
        }
        if (callNum === 4) {
          // Snapshot steps with output
          return createChain([]).chain;
        }
        if (callNum === 5) {
          // Cascade reset update
          const chain = createChain([{ id: STEP_ID }, { id: RESET_TO_STEP_ID }]);
          chain.chain.update = vi.fn((data: unknown) => {
            cascadeUpdateData = data;
            return chain.chain;
          });
          return chain.chain;
        }
      }

      if (table === "workflow_step_comments") {
        return createChain(null).chain;
      }

      if (table === "workflow_runs") {
        return createChain(null).chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await failStep(ctx, {
      step_id: STEP_ID,
      output: "Needs rework",
      reset_to_step_id: RESET_TO_STEP_ID,
    });

    expect(cascadeUpdateData).toEqual({
      status: "pending",
      output: null,
      started_at: null,
      completed_at: null,
      claimed_by: null,
    });
  });

  it("sets completed_at when failing a step", async () => {
    const stepFetched = { id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Design Review",
      agent_role: "reviewer",
      status: "failed",
      output: "Error occurred",
    };

    const tableCounts: Record<string, number> = {};
    let stepUpdateData: unknown = null;

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table]!;

      if (table === "task_workflow_steps") {
        if (callNum === 1) {
          return createChain(stepFetched).chain;
        }
        if (callNum === 2) {
          const chain = createChain(null);
          chain.chain.update = vi.fn((data: unknown) => {
            stepUpdateData = data;
            return chain.chain;
          });
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
          return chain.chain;
        }
      }

      if (table === "workflow_step_comments") {
        return createChain(null).chain;
      }

      if (table === "workflow_runs") {
        return createChain(null).chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await failStep(ctx, {
      step_id: STEP_ID,
      output: "Error occurred",
    });

    expect(stepUpdateData).toHaveProperty("completed_at");
    expect((stepUpdateData as Record<string, unknown>).status).toBe("failed");
  });

  it("failure comment uses idea_id not task_id", async () => {
    const stepFetched = { id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Design Review",
      agent_role: "reviewer",
      status: "failed",
      output: "Bad design",
    };

    const tableCounts: Record<string, number> = {};
    let commentInserted: unknown = null;

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table]!;

      if (table === "task_workflow_steps") {
        if (callNum === 1) {
          return createChain(stepFetched).chain;
        }
        if (callNum === 2) {
          const chain = createChain(null);
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
          return chain.chain;
        }
      }

      if (table === "workflow_step_comments") {
        const chain = createChain(null);
        chain.chain.insert = vi.fn((data: unknown) => {
          commentInserted = data;
          return chain.chain;
        });
        return chain.chain;
      }

      if (table === "workflow_runs") {
        return createChain(null).chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await failStep(ctx, {
      step_id: STEP_ID,
      output: "Bad design",
    });

    expect(commentInserted).toMatchObject({
      step_id: STEP_ID,
      idea_id: IDEA_ID,
      author_id: USER_ID,
      type: "failure",
      content: "Bad design",
    });
    // Must NOT have task_id
    expect(commentInserted).not.toHaveProperty("task_id");
  });

  it("cascade creates changes_requested comment on target step", async () => {
    const stepFetched = { id: STEP_ID, run_id: RUN_ID, step_order: 5, idea_id: IDEA_ID };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "QA Review",
      agent_role: "reviewer",
      status: "failed",
      output: "Validation logic is wrong",
    };
    const targetStep = { step_order: 3, position: 3000 };

    const tableCounts: Record<string, number> = {};
    const commentsInserted: unknown[] = [];

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table]!;

      if (table === "task_workflow_steps") {
        if (callNum === 1) {
          return createChain(stepFetched).chain;
        }
        if (callNum === 2) {
          const chain = createChain(null);
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
          return chain.chain;
        }
        if (callNum === 3) {
          return createChain(targetStep).chain;
        }
        if (callNum === 4) {
          // Snapshot steps with output
          return createChain([]).chain;
        }
        if (callNum === 5) {
          return createChain([{ id: "s3" }, { id: "s4" }, { id: STEP_ID }]).chain;
        }
      }

      if (table === "workflow_step_comments") {
        const chain = createChain(null);
        chain.chain.insert = vi.fn((data: unknown) => {
          commentsInserted.push(data);
          return chain.chain;
        });
        return chain.chain;
      }

      if (table === "workflow_runs") {
        return createChain(null).chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await failStep(ctx, {
      step_id: STEP_ID,
      output: "Validation logic is wrong",
      reset_to_step_id: RESET_TO_STEP_ID,
    });

    // Should have two comment inserts: failure on source step + changes_requested on target
    expect(commentsInserted).toHaveLength(2);

    // First: failure comment on the failed step
    expect(commentsInserted[0]).toMatchObject({
      step_id: STEP_ID,
      idea_id: IDEA_ID,
      type: "failure",
      content: "Validation logic is wrong",
    });

    // Second: changes_requested comment on the cascade target step
    expect(commentsInserted[1]).toMatchObject({
      step_id: RESET_TO_STEP_ID,
      idea_id: IDEA_ID,
      type: "changes_requested",
      content: "Validation logic is wrong",
    });
  });
});

// ---------------------------------------------------------------------------
// updateStep tests
// ---------------------------------------------------------------------------

describe("updateStep", () => {
  it("successfully updates a pending step's title", async () => {
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "New Title",
      description: null,
      agent_role: "developer",
      human_check_required: false,
      expected_deliverables: [],
      status: "pending",
    };

    const ctx = makeContext(((table: string) => {
      const chain = createChain(null);
      chain.chain.maybeSingle = vi.fn(() =>
        Promise.resolve({ data: updatedStep, error: null })
      );
      return chain.chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = await updateStep(ctx, { step_id: STEP_ID, title: "New Title" });
    expect(result.title).toBe("New Title");
  });

  it("successfully updates multiple fields at once", async () => {
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Updated Title",
      description: "Updated description",
      agent_role: "designer",
      human_check_required: true,
      expected_deliverables: ["Mockup", "Spec"],
      status: "pending",
    };

    let capturedPatch: unknown = null;
    const ctx = makeContext(((table: string) => {
      const chain = createChain(null);
      chain.chain.update = vi.fn((data: unknown) => {
        capturedPatch = data;
        return chain.chain;
      });
      chain.chain.maybeSingle = vi.fn(() =>
        Promise.resolve({ data: updatedStep, error: null })
      );
      return chain.chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = await updateStep(ctx, {
      step_id: STEP_ID,
      title: "Updated Title",
      description: "Updated description",
      agent_role: "designer",
      human_check_required: true,
      expected_deliverables: ["Mockup", "Spec"],
    });

    expect(result.title).toBe("Updated Title");
    expect(result.agent_role).toBe("designer");
    expect(capturedPatch).toMatchObject({
      title: "Updated Title",
      description: "Updated description",
      agent_role: "designer",
      human_check_required: true,
      expected_deliverables: ["Mockup", "Spec"],
    });
  });

  it("rejects update when step is not pending", async () => {
    const ctx = makeContext(((table: string) => {
      const chain = createChain(null);
      chain.chain.maybeSingle = vi.fn(() =>
        Promise.resolve({ data: null, error: null })
      );
      return chain.chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await expect(
      updateStep(ctx, { step_id: STEP_ID, title: "New Title" })
    ).rejects.toThrow("Step not found or is no longer pending");
  });

  it("rejects update with no fields provided", async () => {
    const ctx = makeContext((() => createChain(null).chain) as unknown as McpContext["supabase"]["from"]);

    await expect(
      updateStep(ctx, { step_id: STEP_ID })
    ).rejects.toThrow("No fields to update");
  });

  describe("updateStepSchema", () => {
    it("accepts valid input with title only", () => {
      const result = updateStepSchema.parse({ step_id: STEP_ID, title: "New Title" });
      expect(result.title).toBe("New Title");
    });

    it("rejects invalid UUID", () => {
      expect(() =>
        updateStepSchema.parse({ step_id: "not-a-uuid", title: "Test" })
      ).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// completeStep — identity enforcement tests
// ---------------------------------------------------------------------------

const BOT_ID = "00000000-0000-4000-a000-000000000099";

describe("completeStep — identity enforcement", () => {
  function makeCompleteContext(opts: {
    stepData: Record<string, unknown>;
    updatedStep: Record<string, unknown>;
    agentProfile?: { name: string; role: string } | null;
  }) {
    const tableCounts: Record<string, number> = {};

    return makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;

      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() =>
          Promise.resolve({ data: opts.stepData, error: null })
        );
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: opts.updatedStep, error: null })
        );
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return chain.chain;
      }

      if (table === "bot_profiles") {
        const chain = createChain(null);
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: opts.agentProfile ?? null, error: null })
        );
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
  }

  it("rejects when ctx.userId does not match step.bot_id", async () => {
    const stepData = {
      id: STEP_ID,
      run_id: RUN_ID,
      idea_id: IDEA_ID,
      human_check_required: false,
      status: "in_progress",
      bot_id: BOT_ID,
      agent_role: "Developer",
    };

    const ctx = makeCompleteContext({
      stepData,
      updatedStep: {},
      agentProfile: { name: "Atlas", role: "Full Stack Developer" },
    });

    await expect(
      completeStep(ctx, { step_id: STEP_ID, output: "Done" })
    ).rejects.toThrow("Identity mismatch");
  });

  it("includes agent name and bot_id in error message", async () => {
    const stepData = {
      id: STEP_ID,
      run_id: RUN_ID,
      idea_id: IDEA_ID,
      human_check_required: false,
      status: "in_progress",
      bot_id: BOT_ID,
      agent_role: "Developer",
    };

    const ctx = makeCompleteContext({
      stepData,
      updatedStep: {},
      agentProfile: { name: "Atlas", role: "Full Stack Developer" },
    });

    await expect(
      completeStep(ctx, { step_id: STEP_ID })
    ).rejects.toThrow(/Atlas.*Full Stack Developer.*set_agent_identity/);
  });

  it("succeeds when ctx.userId matches step.bot_id", async () => {
    const stepData = {
      id: STEP_ID,
      run_id: RUN_ID,
      idea_id: IDEA_ID,
      human_check_required: false,
      status: "in_progress",
      bot_id: USER_ID, // matches ctx.userId
      agent_role: "Developer",
    };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Test Step",
      agent_role: "Developer",
      status: "completed",
      output: "Done",
      completed_at: "2026-01-01T00:00:00Z",
    };

    const ctx = makeCompleteContext({ stepData, updatedStep });

    const result = await completeStep(ctx, { step_id: STEP_ID, output: "Done" });
    expect(result.status).toBe("completed");
  });

  it("succeeds when step.bot_id is null (no pre-matched agent)", async () => {
    const stepData = {
      id: STEP_ID,
      run_id: RUN_ID,
      idea_id: IDEA_ID,
      human_check_required: false,
      status: "in_progress",
      bot_id: null,
      agent_role: "Developer",
    };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Test Step",
      agent_role: "Developer",
      status: "completed",
      output: "Done",
      completed_at: "2026-01-01T00:00:00Z",
    };

    const ctx = makeCompleteContext({ stepData, updatedStep });

    const result = await completeStep(ctx, { step_id: STEP_ID, output: "Done" });
    expect(result.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// failStep — identity enforcement tests
// ---------------------------------------------------------------------------

describe("failStep — identity enforcement", () => {
  it("rejects when ctx.userId does not match step.bot_id", async () => {
    const stepFetched = {
      id: STEP_ID,
      run_id: RUN_ID,
      step_order: 3,
      idea_id: IDEA_ID,
      bot_id: BOT_ID,
      agent_role: "Developer",
    };

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        const chain = createChain(stepFetched);
        return chain.chain;
      }

      if (table === "bot_profiles") {
        const chain = createChain(null);
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: { name: "Atlas", role: "Developer" }, error: null })
        );
        return chain.chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await expect(
      failStep(ctx, { step_id: STEP_ID, output: "Failed" })
    ).rejects.toThrow("Identity mismatch");
  });

  it("succeeds when step.bot_id is null", async () => {
    const stepFetched = {
      id: STEP_ID,
      run_id: RUN_ID,
      step_order: 3,
      idea_id: IDEA_ID,
      bot_id: null,
      agent_role: "Developer",
    };
    const updatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      title: "Test Step",
      agent_role: "Developer",
      status: "failed",
      output: "Failed",
    };

    const tableCounts: Record<string, number> = {};

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table];

      if (table === "task_workflow_steps") {
        if (callNum === 1) {
          return createChain(stepFetched).chain;
        }
        if (callNum === 2) {
          const chain = createChain(null);
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
          return chain.chain;
        }
      }

      if (table === "workflow_step_comments") {
        return createChain(null).chain;
      }

      if (table === "workflow_runs") {
        return createChain(null).chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = await failStep(ctx, { step_id: STEP_ID, output: "Failed" });
    expect(result.step.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// claimNextStep — claimed_by tests
// ---------------------------------------------------------------------------

describe("claimNextStep — claimed_by", () => {
  it("sets claimed_by to ctx.userId when claiming a step", async () => {
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    let capturedUpdate: unknown = null;
    const tableCounts: Record<string, number> = {};

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table];

      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        if (callNum === 1) {
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [step], error: null }).then(resolve);
        } else if (callNum === 2) {
          chain.chain.update = vi.fn((data: unknown) => {
            capturedUpdate = data;
            return chain.chain;
          });
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
        } else if (callNum === 3) {
          // Tier 2 run-scoped step ID query
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [{ id: step.id }], error: null }).then(resolve);
        } else if (callNum === 4) {
          // context query
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [], error: null }).then(resolve);
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

    await claimNextStep(ctx, { task_id: TASK_ID });

    expect(capturedUpdate).toMatchObject({
      status: "in_progress",
      claimed_by: USER_ID,
    });
  });
});
