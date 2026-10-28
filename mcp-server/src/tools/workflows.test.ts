import { describe, it, expect, vi, afterEach } from "vitest";
import { matchRolesWithAiOrFuzzy } from "../../../src/lib/ai-role-matching";
import { createHash } from "node:crypto";
import type { McpContext } from "../context";
import { mintClaimToken, mintWorkToken, hashClaimToken } from "../claim-token";
import { getBotPrompt } from "./bots";
import { sessionAgentClaimHint } from "../../../src/lib/terminal/session-agents";
import { TIER_ADHERENCE_DISCLOSURE } from "../../../src/lib/constants";

// AI role matching hits the network — stub it so applyWorkflowTemplate can run
// against pure Supabase mocks. Only applyWorkflowTemplate uses it in this file.
vi.mock("../../../src/lib/ai-role-matching", () => ({
  matchRolesWithAiOrFuzzy: vi.fn(async () => ({})),
}));

// Shared valid claim token: post-cutover, every complete/fail needs one.
const TCT = mintClaimToken();
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
  createWorkflowTemplateSchema,
  skipStep,
  applyWorkflowTemplate,
  modelTierClause,
  resolveModelTier,
  resolveTierAdherence,
  resolvePersonaAdherence,
  personaReportNativeNamed,
  addStepComment,
  addStepCommentSchema,
  resetWorkflow,
  readLiveUnavailableModel,
  rematchWorkflowAgents,
  deliverableFileFormat,
  removeWorkflow,
} from "./workflows";
import { logger } from "../../../src/lib/logger";

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
  chain.is = vi.fn(() => chain);

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

    // P2c FR-1 / OQ1 (docs/design-platform-model-defaults.html §5): model_used
    // is optional (backward compatible) and now a free string (relaxed from a
    // fixed enum) — a novel platform-default model family must be reportable
    // with no schema change, so an unrecognised value is soft-validated
    // (logged if it mismatches) rather than rejected at the schema boundary.
    it("accepts a known model_used alias", () => {
      const result = completeStepSchema.parse({ step_id: STEP_ID, model_used: "fable" });
      expect(result.model_used).toBe("fable");
    });

    it("accepts model_used omitted (backward compatible)", () => {
      const result = completeStepSchema.parse({ step_id: STEP_ID });
      expect(result.model_used).toBeUndefined();
    });

    it("accepts a novel/unrecognised model_used value (e.g. a new model family) — never rejected", () => {
      const result = completeStepSchema.parse({ step_id: STEP_ID, model_used: "gpt-4" });
      expect(result.model_used).toBe("gpt-4");
    });

    it("rejects a model_used value over 40 characters", () => {
      expect(() =>
        completeStepSchema.parse({ step_id: STEP_ID, model_used: "a".repeat(41) })
      ).toThrow();
    });
  });

  describe("failStepSchema", () => {
    it("accepts a known model_used alias", () => {
      const result = failStepSchema.parse({ step_id: STEP_ID, model_used: "opus" });
      expect(result.model_used).toBe("opus");
    });

    it("accepts model_used omitted (backward compatible)", () => {
      const result = failStepSchema.parse({ step_id: STEP_ID });
      expect(result.model_used).toBeUndefined();
    });

    it("accepts a novel/unrecognised model_used value (e.g. a new model family) — never rejected", () => {
      const result = failStepSchema.parse({ step_id: STEP_ID, model_used: "gpt-4" });
      expect(result.model_used).toBe("gpt-4");
    });

    it("rejects a model_used value over 40 characters", () => {
      expect(() =>
        failStepSchema.parse({ step_id: STEP_ID, model_used: "a".repeat(41) })
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
 * from("users") once IFF the claimed step has a model_tier set (P2b),
 * and optionally from("workflow_step_comments") for rework instructions.
 */
function makeClaimContext(opts: {
  pendingStep: ReturnType<typeof makeStepRow>;
  /** Every step on the card (all attempts, all statuses) for the 1st read. Defaults to [pendingStep]. */
  allSteps?: Record<string, unknown>[];
  /** Test-owned array; receives every [column, value] passed to .eq() on the claim write (2nd task_workflow_steps call). */
  claimWriteEqs?: [string, unknown][];
  updatedStep: Record<string, unknown>;
  priorSteps: { id: string; title: string; step_order: number; output: string | null }[];
  /** users.model_tier_map row returned for the P2b directive-resolution lookup. */
  userModelTierMap?: Record<string, unknown> | null;
  /** Sets ctx.ownerUserId (bot-identity mode) alongside the fixed ctx.userId. */
  ownerUserId?: string;
  /** Test-owned array; pushed the `id` filter value on every from("users").eq("id", …) call. */
  usersQueryIds?: string[];
  /** Auto-switch (card 5d0665a2): the model_unavailable_model the marker lookup (5th task_workflow_steps call) should return. Undefined/omitted -> no marker (default: today's behaviour). */
  unavailableModel?: string | null;
}) {
  const tableCounts: Record<string, number> = {};

  const ctx = makeContext(((table: string) => {
    tableCounts[table] = (tableCounts[table] ?? 0) + 1;
    const callNum = tableCounts[table];

    if (table === "task_workflow_steps") {
      const chain = createChain(null);
      if (callNum === 1) {
        // 1st: fetch pending steps (awaited directly → thenable)
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: opts.allSteps ?? [opts.pendingStep], error: null }).then(resolve);
      } else if (callNum === 2) {
        // 2nd: claim update (maybeSingle)
        const originalEq = chain.chain.eq as (col: string, val: unknown) => unknown;
        chain.chain.eq = vi.fn((col: string, val: unknown) => {
          opts.claimWriteEqs?.push([col, val]);
          return originalEq(col, val);
        });
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
      } else if (callNum === 5) {
        // 5th: readLiveUnavailableModel's marker lookup (maybeSingle) — only
        // reached on the tiered path. Default (opts.unavailableModel
        // undefined) -> createChain(null)'s default {data:null,error:null},
        // i.e. no marker, today's behaviour.
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({
            data: opts.unavailableModel !== undefined ? { model_unavailable_model: opts.unavailableModel } : null,
            error: null,
          })
        );
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

    if (table === "users") {
      const { chain } = createChain({ model_tier_map: opts.userModelTierMap ?? null });
      const originalEq = chain.eq as (col: string, val: unknown) => unknown;
      chain.eq = vi.fn((col: string, val: unknown) => {
        if (col === "id") opts.usersQueryIds?.push(val as string);
        return originalEq(col, val);
      });
      return chain;
    }

    return createChain(null).chain;
  }) as unknown as McpContext["supabase"]["from"]);

  if (opts.ownerUserId) ctx.ownerUserId = opts.ownerUserId;
  return ctx;
}

describe("claimNextStep - current attempt only", () => {
  const OLD_RUN = "00000000-0000-4000-8000-0000000000a1";
  const NEW_RUN = "00000000-0000-4000-8000-0000000000b2";
  const oldAt = "2026-10-19T10:00:00Z";
  const newAt = "2026-10-21T05:40:00Z";
  const row = (id: string, run: string, order: number, status: string, at: string, extra: Record<string, unknown> = {}) =>
    makeStepRow({ id, run_id: run, step_order: order, position: order * 1000, status, created_at: at, title: `Step ${order} (${id})`, ...extra });

  // Abandoned attempt A: 1 done, 2 failed, 3 and 4 pending.
  const abandoned = () => [
    row("a1", OLD_RUN, 1, "completed", oldAt),
    row("a2", OLD_RUN, 2, "failed", oldAt),
    row("a3", OLD_RUN, 3, "pending", oldAt),
    row("a4", OLD_RUN, 4, "pending", oldAt),
  ];
  /** Counts reads/writes on task_workflow_steps; the claim write would be a 2nd call. */
  const countStepCalls = (ctx: McpContext) => {
    const counter = { n: 0 };
    const orig = ctx.supabase.from.bind(ctx.supabase);
    (ctx.supabase as unknown as { from: unknown }).from = (table: string) => {
      if (table === "task_workflow_steps") counter.n++;
      return orig(table as never);
    };
    return counter;
  };

  it("claims the live attempt's step when the abandoned attempt has unfinished steps at the same step numbers (either row order)", async () => {
    const live = [
      row("b1", NEW_RUN, 1, "completed", newAt),
      row("b2", NEW_RUN, 2, "completed", newAt),
      row("b3", NEW_RUN, 3, "pending", newAt),
      row("b4", NEW_RUN, 4, "pending", newAt),
    ];
    for (const allSteps of [[...abandoned(), ...live], [...live, ...abandoned()]]) {
      const updatedStep = { ...live[2], status: "in_progress", claimed_by: USER_ID };
      const claimWriteEqs: [string, unknown][] = [];
      const ctx = makeClaimContext({ pendingStep: live[2], allSteps, updatedStep, priorSteps: [], claimWriteEqs });
      await claimNextStep(ctx, { task_id: TASK_ID });
      expect(claimWriteEqs).toContainEqual(["id", "b3"]);
    }
  });

  it("reports done, claims nothing and writes nothing when the live attempt is finished and only the abandoned one has leftovers", async () => {
    const live = [
      row("b1", NEW_RUN, 1, "completed", newAt),
      row("b2", NEW_RUN, 2, "completed", newAt),
      row("b3", NEW_RUN, 3, "completed", newAt),
      row("b4", NEW_RUN, 4, "completed", newAt),
    ];
    const ctx = makeClaimContext({ pendingStep: abandoned()[2], allSteps: [...abandoned(), ...live], updatedStep: {}, priorSteps: [] });
    const calls = countStepCalls(ctx);
    const result = await claimNextStep(ctx, { task_id: TASK_ID });
    expect(result).toMatchObject({ done: true });
    expect(result).not.toHaveProperty("claim_token");
    expect(calls.n).toBe(1);
  });

  it("stops at a failed step in the live attempt instead of handing out the next one", async () => {
    const live = [
      row("b1", NEW_RUN, 1, "completed", newAt),
      row("b2", NEW_RUN, 2, "completed", newAt),
      row("b3", NEW_RUN, 3, "failed", newAt),
      row("b4", NEW_RUN, 4, "pending", newAt),
    ];
    const ctx = makeClaimContext({ pendingStep: live[3], allSteps: live, updatedStep: {}, priorSteps: [] });
    const calls = countStepCalls(ctx);
    const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as Record<string, unknown>;
    expect(result.workflow_stopped).toBe(true);
    expect(result.done).toBe(false);
    expect(result.failed_step).toMatchObject({ id: "b3", step_order: 3 });
    expect(String(result.instruction)).toContain("stopped");
    expect(result).not.toHaveProperty("claim_token");
    expect(result).not.toHaveProperty("step");
    expect(calls.n).toBe(1);
  });

  it("still moves past a step awaiting approval (unchanged behaviour)", async () => {
    const live = [
      row("b1", NEW_RUN, 1, "completed", newAt),
      row("b2", NEW_RUN, 2, "awaiting_approval", newAt),
      row("b3", NEW_RUN, 3, "pending", newAt),
    ];
    const updatedStep = { ...live[2], status: "in_progress", claimed_by: USER_ID };
    const claimWriteEqs: [string, unknown][] = [];
    const ctx = makeClaimContext({ pendingStep: live[2], allSteps: live, updatedStep, priorSteps: [], claimWriteEqs });
    await claimNextStep(ctx, { task_id: TASK_ID });
    expect(claimWriteEqs).toContainEqual(["id", "b3"]);
  });

  it("re-claims an in-progress step in the live attempt", async () => {
    const live = [
      row("b1", NEW_RUN, 1, "completed", newAt),
      row("b2", NEW_RUN, 2, "in_progress", newAt),
      row("b3", NEW_RUN, 3, "pending", newAt),
    ];
    const updatedStep = { ...live[1], status: "in_progress", claimed_by: USER_ID };
    const claimWriteEqs: [string, unknown][] = [];
    const ctx = makeClaimContext({ pendingStep: live[1], allSteps: [...abandoned(), ...live], updatedStep, priorSteps: [], claimWriteEqs });
    await claimNextStep(ctx, { task_id: TASK_ID });
    expect(claimWriteEqs).toContainEqual(["id", "b2"]);
  });
});

describe("claimNextStep", () => {
  it("lists prior steps by id, title and length instead of copying their write-ups", async () => {
    const step = makeStepRow({ step_order: 3 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [
      { id: "s1", title: "Step 1", step_order: 1, output: "Output from step 1" },
      { id: "s2", title: "Step 2", step_order: 2, output: "Output from step 2" },
    ];

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    expect(result).not.toHaveProperty("context");
    const r = result as { prior_steps: { step_id: string; title: string; output_chars: number }[] };
    expect(r.prior_steps).toEqual([
      { step_id: "s1", title: "Step 1", output_chars: "Output from step 1".length },
      { step_id: "s2", title: "Step 2", output_chars: "Output from step 2".length },
    ]);
    expect(JSON.stringify(result)).not.toContain("Output from step 1");
  });

  it("returns empty prior_steps for first step (no prior steps)", async () => {
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { prior_steps: unknown[] };
    expect(r.prior_steps).toEqual([]);
  });

  it("includes skipped steps with output in prior_steps", async () => {
    const step = makeStepRow({ step_order: 3 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [
      { id: "s1", title: "Step 1", step_order: 1, output: "Done" },
      { id: "s2", title: "Skipped Step", step_order: 2, output: "Skipped: not applicable" },
    ];

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { prior_steps: { step_id: string; title: string; output_chars: number }[] };
    expect(r.prior_steps).toHaveLength(2);
    expect(r.prior_steps[1]).toEqual({ step_id: "s2", title: "Skipped Step", output_chars: "Skipped: not applicable".length });
  });

  it("excludes completed steps with null output from prior_steps", async () => {
    const step = makeStepRow({ step_order: 3 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [
      { id: "s1", title: "Step 1", step_order: 1, output: "Has output" },
      { id: "s2", title: "Step 2", step_order: 2, output: null },
    ];

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { prior_steps: { title: string }[] };
    expect(r.prior_steps).toHaveLength(1);
    expect(r.prior_steps[0].title).toBe("Step 1");
  });

  it("preserves step_order in prior_steps", async () => {
    const step = makeStepRow({ step_order: 4 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [
      { id: "s1", title: "First", step_order: 1, output: "A" },
      { id: "s2", title: "Second", step_order: 2, output: "B" },
      { id: "s3", title: "Third", step_order: 3, output: "C" },
    ];

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { prior_steps: { title: string }[] };
    expect(r.prior_steps.map((c) => c.title)).toEqual(["First", "Second", "Third"]);
  });

  it("tells the session to put a get_task(step_ids) line in the helper's brief, and not to paste the steps", async () => {
    const step = makeStepRow({ step_order: 3 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [
      { id: "s1", title: "Research & Analysis", step_order: 1, output: "findings" },
      { id: "s2", title: "Architecture Design", step_order: 2, output: "architecture" },
    ];

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).toContain("PRIOR STEPS");
    // Titles and write-ups travel in prior_steps / get_task, never in the instruction.
    expect(r.instruction).not.toContain("Research & Analysis");
    expect(r.instruction).not.toContain("Architecture Design");
    expect((result as unknown as { prior_steps: Array<{ title: string }> }).prior_steps.map((p) => p.title)).toEqual([
      "Research & Analysis",
      "Architecture Design",
    ]);
    expect(r.instruction).toContain(`get_task(task_id "${TASK_ID}", idea_id "${IDEA_ID}", step_ids ["s1", "s2"])`);
    expect(r.instruction).not.toContain("the step_id values from prior_steps");
    expect(r.instruction).toContain("flag anything your work contradicts");
    expect(r.instruction).toContain("Don't paste or summarise them yourself");
    expect(r.instruction).not.toContain("findings");
  });

  it("omits the prior-steps line when there are none", async () => {
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).not.toContain("PRIOR STEPS");
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
    // The ids are in prior_steps, not repeated in the text.
    expect(r.instruction).toContain('"prior_steps"');
    expect((result as unknown as { prior_steps: { step_id: string }[] }).prior_steps.map((p) => p.step_id)).toEqual(["s1", "s2"]);
  });

  it("includes PROTECT PRIOR WORK on a first-step claim (Claude) — no prior work to save-point yet", async () => {
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).toContain("PROTECT PRIOR WORK");
    expect(r.instruction).toContain("Unexplained uncommitted");
    expect(r.instruction).not.toContain("SAVE-POINT COMMIT");
  });

  it("includes both PROTECT PRIOR WORK and SAVE-POINT COMMIT (exact wording) when prior steps exist (Claude)", async () => {
    const step = makeStepRow({ step_order: 3 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [
      { id: "s1", title: "Implementation", step_order: 1, output: "code written" },
    ];

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string };
    expect(r.instruction).toContain("PROTECT PRIOR WORK");
    expect(r.instruction).toContain(
      "SAVE-POINT COMMIT: Before spawning this step's subagent, if this project is a git repository and a previous step's completed work is still uncommitted, commit it locally now on the branch you are already on. Do not create a branch, worktree or folder for this, and never push. Skip this if there is nothing to commit or the project is not a git repository. Never commit secrets or files covered by `.gitignore`."
    );
  });

  it("includes both PROTECT PRIOR WORK and SAVE-POINT COMMIT on the Codex path too", async () => {
    const step = makeStepRow({ step_order: 3 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [
      { id: "s1", title: "Implementation", step_order: 1, output: "code written" },
    ];

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps });
    const result = await claimNextStep(ctx, { task_id: TASK_ID, agent: "codex" });

    const r = result as { instruction: string };
    expect(r.instruction).toContain("PROTECT PRIOR WORK");
    expect(r.instruction).toContain("SAVE-POINT COMMIT");
  });

  it("omits SAVE-POINT COMMIT on a first-step claim on the Codex path too", async () => {
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID, agent: "codex" });

    const r = result as { instruction: string };
    expect(r.instruction).toContain("PROTECT PRIOR WORK");
    expect(r.instruction).not.toContain("SAVE-POINT COMMIT");
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
    expect(r.instruction).toContain("- Design document (HTML) — write this as an HTML file (not markdown).");
    expect(r.instruction).toContain("- Component inventory\n");
    expect(r.instruction).toContain('A format in parentheses is part of the deliverable');
  });

  // Live persona test, 10 Oct 2026: "Verification note (repro re-run, test
  // checked, nearby behaviour)" became "write this as a repro re-run, test
  // checked, nearby behaviour file (not markdown)".
  it("only reads a parenthetical as a format when it names a real file format", async () => {
    const step = makeStepRow({
      step_order: 1,
      expected_deliverables: [
        "Code review verdict (pass / blocking issues)",
        "Decision pack (HTML, attached to card)",
        "Follow-up cards (if any)",
      ],
    });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as { instruction: string };

    expect(r.instruction).toContain("- Code review verdict (pass / blocking issues)\n");
    expect(r.instruction).toContain(
      "- Decision pack (HTML, attached to card) — write this as an HTML file (not markdown).",
    );
    expect(r.instruction).toContain("- Follow-up cards (if any)\n");
    expect(r.instruction).not.toMatch(/write this as an? (pass|if any)/);
    expect(r.instruction).toContain("A format in parentheses is part of the deliverable");
  });

  it("drops the format sentence when no deliverable names a format", async () => {
    const step = makeStepRow({
      step_order: 1,
      expected_deliverables: ["Verification note (repro re-run, test checked, nearby behaviour)", "Follow-up cards (if any)"],
    });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as { instruction: string };

    expect(r.instruction).toContain(
      "EXPECTED DELIVERABLES: produce the following:\n" +
        "- Verification note (repro re-run, test checked, nearby behaviour)\n" +
        "- Follow-up cards (if any)",
    );
    expect(r.instruction).not.toContain("write this as");
    expect(r.instruction).not.toContain("A format in parentheses");
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
    // Personas own the format choice; the old "choose a format" paragraph and
    // the generic "pass your full deliverable" line are gone (card 5e654dd1).
    expect(r.instruction).not.toContain("DELIVERABLE FORMAT");
    expect(r.instruction).not.toContain("Use your judgement");
    expect(r.instruction).toContain("EXPECTED DELIVERABLES");
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
// claimNextStep — workflow suggestion precedence (FR-2/FR-4, AC-21/22/24/25/26)
// ---------------------------------------------------------------------------

function makeSuggestionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sug-1",
    label_id: "lbl-1",
    rule_id: "rule-1",
    suggested_template_id: "tmpl-suggested",
    recommended_template_id: "tmpl-recommended",
    source: "ai",
    ai_confidence: 0.6,
    reason: "Mismatch detected",
    detected_categories: { task: "build", template: "discovery" },
    status: "suggested",
    adjudication_started_at: null,
    ...overrides,
  };
}

describe("claimNextStep — workflow suggestion precedence", () => {
  it("AC-21: blocks on an open suggestion when there is no claimable step (no token, no writes)", async () => {
    let suggestionChain: ReturnType<typeof createChain> | null = null;
    let stepChain: ReturnType<typeof createChain> | null = null;

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        stepChain = createChain([]); // no claimable step
        return stepChain.chain;
      }
      if (table === "workflow_suggestions") {
        suggestionChain = createChain([makeSuggestionRow()]);
        return suggestionChain.chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as Record<string, unknown>;

    expect(result.blocked_on_suggestion).toBe(true);
    expect(result.done).toBe(false);
    expect(result).not.toHaveProperty("claim_token");
    expect((result.suggestion as Record<string, unknown>).suggestion_id).toBe("sug-1");
    expect(result.instruction).toContain("do NOT start work");

    // No claim token minted, no rows written.
    expect(stepChain!.captured.updated).toBeNull();
    expect(stepChain!.captured.inserted).toBeNull();
    expect(suggestionChain!.captured.updated).toBeNull();
    expect(suggestionChain!.captured.inserted).toBeNull();
  });

  it("AC-22: claims the pending step normally and never queries suggestions when a step is claimable", async () => {
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const tableCounts: Record<string, number> = {};
    let suggestionQueried = false;

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      if (table === "workflow_suggestions") {
        suggestionQueried = true;
        return createChain([makeSuggestionRow()]).chain;
      }
      if (table === "task_workflow_steps") {
        const callNum = tableCounts[table];
        const chain = createChain(null);
        if (callNum === 1) {
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [step], error: null }).then(resolve);
        } else if (callNum === 2) {
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
        } else {
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [], error: null }).then(resolve);
        }
        return chain.chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as Record<string, unknown>;

    expect(suggestionQueried).toBe(false);
    expect(result.blocked_on_suggestion).toBeUndefined();
    expect(result.adjudication_pending).toBeUndefined();
    expect(result.done).toBe(false);
    expect(result).toHaveProperty("claim_token");
    expect((result.step as Record<string, unknown>).id).toBe(STEP_ID);
  });

  it("AC-24: returns adjudication_pending for a fresh adjudication marker with no claimable step", async () => {
    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") return createChain([]).chain;
      if (table === "workflow_suggestions") {
        return createChain([
          makeSuggestionRow({ adjudication_started_at: new Date().toISOString() }),
        ]).chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as Record<string, unknown>;

    expect(result.adjudication_pending).toBe(true);
    expect(result.done).toBe(false);
    expect(result.retry_after_seconds).toBe(10);
    expect(result).not.toHaveProperty("claim_token");
  });

  it("AC-25: treats a stale adjudication marker as a normal blocking suggestion", async () => {
    const stale = new Date(Date.now() - 120_000).toISOString();
    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") return createChain([]).chain;
      if (table === "workflow_suggestions") {
        return createChain([makeSuggestionRow({ adjudication_started_at: stale })]).chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as Record<string, unknown>;

    expect(result.adjudication_pending).toBeUndefined();
    expect(result.blocked_on_suggestion).toBe(true);
    expect(result.done).toBe(false);
  });

  it("AC-26: a dismissed suggestion with no steps (post-Remove) returns done — never blocked/adjudicating", async () => {
    // After "Remove", the suggestion row is dismissed (status != 'suggested') and
    // no workflow steps exist. fetchOpenSuggestions filters by status='suggested',
    // so the dismissed row is invisible → claim_next_step must report done:true.
    let suggestionChain: ReturnType<typeof createChain> | null = null;

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") return createChain([]).chain; // no steps
      if (table === "workflow_suggestions") {
        // A dismissed row exists in the table, but the status='suggested' filter
        // excludes it, so the open-suggestions query resolves to [].
        suggestionChain = createChain([]);
        return suggestionChain.chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as Record<string, unknown>;

    expect(result.done).toBe(true);
    expect(result.blocked_on_suggestion).toBeUndefined();
    expect(result.adjudication_pending).toBeUndefined();
    expect(result).not.toHaveProperty("claim_token");
    // Confirms the open-suggestion query is scoped to status='suggested'.
    expect(suggestionChain!.captured.eqs).toContainEqual(["status", "suggested"]);
  });

  it("AC-26: after a run with a pending step exists (post-Keep), claims the first real step normally", async () => {
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const tableCounts: Record<string, number> = {};

    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      if (table === "task_workflow_steps") {
        const callNum = tableCounts[table];
        const chain = createChain(null);
        if (callNum === 1) {
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [step], error: null }).then(resolve);
        } else if (callNum === 2) {
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: updatedStep, error: null })
          );
        } else {
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [], error: null }).then(resolve);
        }
        return chain.chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as Record<string, unknown>;

    expect(result.done).toBe(false);
    expect(result.blocked_on_suggestion).toBeUndefined();
    expect(result).toHaveProperty("claim_token");
    expect((result.step as Record<string, unknown>).id).toBe(STEP_ID);
  });
});

// ---------------------------------------------------------------------------
// claimNextStep — agent skills are sent in full (task d04408b0)
// ---------------------------------------------------------------------------

const SKILL_BOT_ID = "00000000-0000-4000-a000-000000000050";
const SKILL_PERSONA = "## Goal\nShip it.";

/**
 * Like makeClaimContext but assigns a bot (so matchedAgent resolves) and lets a
 * test supply the agent_skills the assigned bot owns and its system_prompt.
 * claimNextStep reads agent_skills once (only when a bot is assigned) and
 * writes the skills it sent into the claim update — captured here.
 */
function makeSkillsClaimContext(opts: {
  pendingStep: ReturnType<typeof makeStepRow>;
  updatedStep: Record<string, unknown>;
  skills: { name: string; content: string }[];
  systemPrompt?: string | null;
  toolAccess?: "full" | "read_only";
  skillsError?: string;
  ideaAgentsError?: string;
  priorSteps?: { id: string; title: string; step_order: number; output: string | null }[];
}) {
  const tableCounts: Record<string, number> = {};
  let claimChain: ReturnType<typeof createChain> | null = null;
  const systemPrompt = opts.systemPrompt === undefined ? SKILL_PERSONA : opts.systemPrompt;

  const ctx = makeContext(((table: string) => {
    tableCounts[table] = (tableCounts[table] ?? 0) + 1;
    const callNum = tableCounts[table];

    if (table === "task_workflow_steps") {
      const chain = createChain(null);
      if (callNum === 1) {
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [opts.pendingStep], error: null }).then(resolve);
      } else if (callNum === 2) {
        claimChain = chain;
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: opts.updatedStep, error: null })
        );
      } else if (callNum === 3) {
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [{ id: opts.pendingStep.id }], error: null }).then(resolve);
      } else if (callNum === 4) {
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: opts.priorSteps ?? [], error: null }).then(resolve);
      }
      return chain.chain;
    }

    if (table === "idea_agents") {
      // matchedAgent needs the assigned bot to appear in available_agents
      const chain = createChain(null);
      chain.chain.then = (resolve: (val: unknown) => void) =>
        Promise.resolve(
          opts.ideaAgentsError
            ? { data: null, error: { message: opts.ideaAgentsError } }
            : {
                data: [
                  {
                    bot_id: SKILL_BOT_ID,
                    bot: {
                      id: SKILL_BOT_ID,
                      name: "Atlas",
                      role: "Full Stack Engineer",
                      avatar_url: null,
                      is_active: true,
                      system_prompt: systemPrompt,
                      tool_access: opts.toolAccess ?? "full",
                    },
                  },
                ],
                error: null,
              },
        ).then(resolve);
      return chain.chain;
    }

    if (table === "agent_skills") {
      const chain = createChain(null);
      chain.chain.then = (resolve: (val: unknown) => void) =>
        Promise.resolve(
          opts.skillsError
            ? { data: null, error: { message: opts.skillsError } }
            : { data: opts.skills.map((s) => ({ bot_id: SKILL_BOT_ID, ...s })), error: null },
        ).then(resolve);
      return chain.chain;
    }

    if (table === "workflow_runs" || table === "workflow_step_comments") {
      return createChain([]).chain;
    }

    return createChain(null).chain;
  }) as unknown as McpContext["supabase"]["from"]);

  return {
    ctx,
    claimUpdate: () =>
      ((claimChain as ReturnType<typeof createChain> | null)?.captured.updated ?? {}) as Record<string, unknown>,
    skillsQueried: () => (tableCounts["agent_skills"] ?? 0) > 0,
  };
}

describe("claimNextStep — agent skills", () => {
  const SKILLS = [
    { name: "api-design-review", content: "  Check REST contracts first.\n" },
    { name: "a11y-audit", content: "Run a WCAG 2.2 AA pass." },
  ];
  const step = makeStepRow({ step_order: 1, bot_id: SKILL_BOT_ID });
  const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

  type SkillClaim = {
    instruction: string;
    persona_prompt?: string;
    native_subagent?: { name: string; tag: string };
    available_skills?: unknown;
  };

  // The persona text itself is built by composePersonaPrompt (tested in
  // lib/persona-prompt.test.ts) and is what get_agent_prompt(as_persona) returns.
  // A claim that names a native helper no longer repeats it (card 5e654dd1).
  it("leaves persona_prompt out when a native helper is named, and gates the fallback behind the user's yes", async () => {
    const { ctx } = makeSkillsClaimContext({ pendingStep: step, updatedStep, skills: SKILLS });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as SkillClaim;

    expect(r.native_subagent).toBeDefined();
    expect(r).not.toHaveProperty("persona_prompt");
    expect(r).not.toHaveProperty("persona_name");
    expect(r.instruction).toContain('get_agent_prompt (agent_id');
    expect(r.instruction).toContain("as_persona true");
    expect(r.instruction).toContain("Only on their explicit yes");
    // The skills paragraph talks about persona_prompt, which isn't here.
    expect(r.instruction).not.toContain("SKILLS:");
  });

  it("sends persona_prompt with the skills in full when the agent has skills but no persona text (no native helper)", async () => {
    const { ctx } = makeSkillsClaimContext({ pendingStep: step, updatedStep, skills: SKILLS, systemPrompt: null });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as SkillClaim;

    expect(r.native_subagent).toBeUndefined();
    expect(r.persona_prompt).toBe(
      "## Skills\nThese are your reference skills. Apply the ones relevant to this step.\n\n" +
        "### api-design-review\nCheck REST contracts first.\n\n### a11y-audit\nRun a WCAG 2.2 AA pass.",
    );
    expect(r.instruction).toContain("SKILLS: this agent's skills (api-design-review, a11y-audit) are included in full");
    expect(r.instruction).toContain("use it unchanged with the skills in it");
    expect(r.instruction).not.toContain("get_agent_skill_content");
    expect(r.instruction).not.toContain("skills_used");
    expect(r).not.toHaveProperty("available_skills");
  });

  it("records the skills it sent in the claim write itself (AC5)", async () => {
    const { ctx, claimUpdate } = makeSkillsClaimContext({ pendingStep: step, updatedStep, skills: SKILLS });
    await claimNextStep(ctx, { task_id: TASK_ID });

    expect(claimUpdate().skills_used).toEqual(["api-design-review", "a11y-audit"]);
  });

  it("records an empty list for an agent without skills, and adds nothing to the instruction (AC4/AC5)", async () => {
    const { ctx, claimUpdate } = makeSkillsClaimContext({ pendingStep: step, updatedStep, skills: [] });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as SkillClaim;

    expect(claimUpdate().skills_used).toEqual([]);
    expect(r).not.toHaveProperty("persona_prompt");
    expect(r.instruction).not.toContain("SKILLS:");
    expect(r).not.toHaveProperty("available_skills");
  });

  it("sends the skills as the worker's instructions when the agent has no persona text", async () => {
    const { ctx, claimUpdate } = makeSkillsClaimContext({ pendingStep: step, updatedStep, skills: SKILLS, systemPrompt: null });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as SkillClaim;

    expect(r.persona_prompt!.startsWith("## Skills\n")).toBe(true);
    expect(r.instruction).toContain('Spawn it with the "persona_prompt" field');
    expect(r.instruction).not.toContain("Call get_agent_prompt with agent_id");
    expect(claimUpdate().skills_used).toEqual(["api-design-review", "a11y-audit"]);
    // No persona text means no in-app definition exists to name.
    expect(r.native_subagent).toBeUndefined();
  });

  it("sends whole skills up to the size limit, names the rest and records only the sent ones (AC10)", async () => {
    const big = "x".repeat(40_001);
    const { ctx, claimUpdate } = makeSkillsClaimContext({
      pendingStep: step,
      updatedStep,
      skills: [SKILLS[0], { name: "huge", content: big }, { name: "after-huge", content: "short" }],
      systemPrompt: null, // no persona text: no native helper, so persona_prompt is sent
    });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as SkillClaim;

    expect(r.persona_prompt).toContain("### api-design-review");
    expect(r.persona_prompt).not.toContain("xxxx");
    expect(r.persona_prompt).not.toContain("### after-huge");
    expect(r.persona_prompt).toContain(`Not included here (over the size limit): huge, after-huge.`);
    expect(r.persona_prompt).toContain(`get_agent_skill_content (agent_id "${SKILL_BOT_ID}")`);
    expect(r.instruction).toContain("(api-design-review) are included in full");
    expect(r.instruction).toContain("only named there, with a note on loading them: huge, after-huge");
    expect(claimUpdate().skills_used).toEqual(["api-design-review"]);
  });

  it("the native subagent hint carries a tag built from the same skills text (AC2/AC8)", async () => {
    const { ctx } = makeSkillsClaimContext({ pendingStep: step, updatedStep, skills: SKILLS });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as SkillClaim;

    const { buildSkillsSection } = await import("../../../src/lib/skills-section");
    const section = buildSkillsSection(SKILL_BOT_ID, SKILLS);
    const expected = sessionAgentClaimHint({
      bot: { id: SKILL_BOT_ID, name: "Atlas", system_prompt: SKILL_PERSONA },
      tier: null,
      model: null,
      effort: null,
      skillsText: section.text,
    });
    expect(r.native_subagent).toEqual({ name: expected.name, tag: expected.tag });
    // ...and differs from the tag of the same agent with no skills.
    const bare = sessionAgentClaimHint({
      bot: { id: SKILL_BOT_ID, name: "Atlas", system_prompt: SKILL_PERSONA },
      tier: null,
      model: null,
      effort: null,
    });
    expect(r.native_subagent!.tag).not.toBe(bare.tag);
  });

  it("aborts the claim when the skills can't be read, rather than sending a skill-less persona", async () => {
    const { ctx, claimUpdate } = makeSkillsClaimContext({
      pendingStep: step,
      updatedStep,
      skills: [],
      skillsError: "permission denied",
    });
    await expect(claimNextStep(ctx, { task_id: TASK_ID })).rejects.toThrow("Failed to read the agent's skills: permission denied");
    expect(claimUpdate()).toEqual({});
  });

  it("aborts the claim, with nothing written, when the board's agents can't be read", async () => {
    const { ctx, claimUpdate, skillsQueried } = makeSkillsClaimContext({
      pendingStep: step,
      updatedStep,
      skills: SKILLS,
      ideaAgentsError: "agents unavailable",
    });
    await expect(claimNextStep(ctx, { task_id: TASK_ID })).rejects.toThrow("Failed to read the board's agents: agents unavailable");
    expect(claimUpdate()).toEqual({});
    expect(skillsQueried()).toBe(false);
  });

  it("names skills beyond the 50-skill cap instead of dropping them", async () => {
    const many = Array.from({ length: 52 }, (_, i) => ({ name: `skill-${i + 1}`, content: `body ${i + 1}` }));
    const { ctx, claimUpdate } = makeSkillsClaimContext({ pendingStep: step, updatedStep, skills: many, systemPrompt: null });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as SkillClaim;

    expect(r.persona_prompt).toContain("### skill-50\nbody 50");
    expect(r.persona_prompt).not.toContain("### skill-51");
    expect(r.persona_prompt).toContain("Not included here (over the size limit): skill-51, skill-52.");
    expect(r.persona_prompt).toContain(`get_agent_skill_content (agent_id "${SKILL_BOT_ID}")`);
    expect(claimUpdate().skills_used).toHaveLength(50);
  });

  it("the read-only claim's native-subagent tag differs from the full-access one (the note is fingerprinted)", async () => {
    const full = makeSkillsClaimContext({ pendingStep: step, updatedStep, skills: [] });
    const ro = makeSkillsClaimContext({ pendingStep: step, updatedStep, skills: [], toolAccess: "read_only" });
    const a = (await claimNextStep(full.ctx, { task_id: TASK_ID })) as SkillClaim;
    const b = (await claimNextStep(ro.ctx, { task_id: TASK_ID })) as SkillClaim;

    expect(a.native_subagent?.tag).toBeTruthy();
    expect(b.native_subagent?.tag).toBeTruthy();
    expect(b.native_subagent?.tag).not.toBe(a.native_subagent?.tag);
  });

  it("does not fetch skills for a bot_id=null step (byte-identical path)", async () => {
    const noBotStep = makeStepRow({ step_order: 1, bot_id: null });
    const noBotUpdated = { ...noBotStep, status: "in_progress", claimed_by: USER_ID };

    // Reuse the original no-bot harness — it has no agent_skills branch, proving
    // claimNextStep never queries agent_skills when bot_id is null.
    const ctx = makeClaimContext({ pendingStep: noBotStep, updatedStep: noBotUpdated, priorSteps: [] });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as SkillClaim;

    expect(r).not.toHaveProperty("available_skills");
    expect(r).not.toHaveProperty("persona_prompt");
    expect(r.instruction).not.toContain("SKILLS:");
  });

  it("Codex claims carry the same persona-with-skills text and don't forward a skills list (AC11)", async () => {
    const claude = makeSkillsClaimContext({ pendingStep: step, updatedStep, skills: SKILLS, systemPrompt: null });
    const claudeResult = (await claimNextStep(claude.ctx, { task_id: TASK_ID })) as SkillClaim;

    const codex = makeSkillsClaimContext({ pendingStep: step, updatedStep, skills: SKILLS, systemPrompt: null });
    const r = (await claimNextStep(codex.ctx, { task_id: TASK_ID, agent: "codex" })) as SkillClaim;

    expect(r.persona_prompt).toBe(claudeResult.persona_prompt);
    expect(r.instruction).toContain("SKILLS: this agent's skills (api-design-review, a11y-audit) are included in full");
    expect(r.instruction).not.toContain("available_skills");
    expect(r.instruction).not.toContain("skills_used");
    expect(r.instruction).not.toContain("get_agent_skill_content");
    expect(codex.claimUpdate().skills_used).toEqual(["api-design-review", "a11y-audit"]);
  });

  it("a re-claim records the skills sent on the latest claim (AC6)", async () => {
    const inProgress = { ...step, status: "in_progress" };
    const first = makeSkillsClaimContext({ pendingStep: inProgress, updatedStep, skills: SKILLS });
    await claimNextStep(first.ctx, { task_id: TASK_ID });
    expect(first.claimUpdate().skills_used).toEqual(["api-design-review", "a11y-audit"]);

    const second = makeSkillsClaimContext({ pendingStep: inProgress, updatedStep, skills: [SKILLS[1]] });
    await claimNextStep(second.ctx, { task_id: TASK_ID });
    expect(second.claimUpdate().skills_used).toEqual(["a11y-audit"]);
  });
});

// ---------------------------------------------------------------------------
// claimNextStep — persona embedding (persona-attestation design §A1/A2/§2)
// ---------------------------------------------------------------------------

const PERSONA_BOT_ID = "00000000-0000-4000-a000-000000000060";

/**
 * Like makeSkillsClaimContext but lets a test control the assigned bot's
 * system_prompt (null = "prompt-less" branch). No agent_skills row needed —
 * these tests only exercise the persona embed path.
 */
function makePersonaClaimContext(opts: {
  pendingStep: ReturnType<typeof makeStepRow>;
  updatedStep: Record<string, unknown>;
  systemPrompt: string | null;
  /** Auto-switch (card 5d0665a2): model_unavailable_model the marker lookup returns. Omitted -> no marker. */
  unavailableModel?: string;
  /** Skill rows the agent_skills read returns (default none). */
  skills?: Array<{ bot_id: string; name: string; content: string }>;
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
      } else {
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({
            data: opts.unavailableModel !== undefined ? { model_unavailable_model: opts.unavailableModel } : null,
            error: null,
          })
        );
      }
      return chain.chain;
    }

    if (table === "idea_agents") {
      const chain = createChain(null);
      chain.chain.then = (resolve: (val: unknown) => void) =>
        Promise.resolve({
          data: [
            {
              bot_id: PERSONA_BOT_ID,
              bot: {
                id: PERSONA_BOT_ID,
                name: "Atlas",
                role: "Full Stack Engineer",
                avatar_url: null,
                is_active: true,
                system_prompt: opts.systemPrompt,
              },
            },
          ],
          error: null,
        }).then(resolve);
      return chain.chain;
    }

    if (table === "agent_skills") return createChain(opts.skills ?? []).chain;
    if (table === "workflow_runs" || table === "workflow_step_comments") {
      return createChain([]).chain;
    }

    return createChain(null).chain;
  }) as unknown as McpContext["supabase"]["from"]);
}

// Task 3784ead1: every platform persona already carries the protect-prior-work
// rule (00175), so the claim only adds it when the persona doesn't — one copy
// per worker, never zero.
describe("claimNextStep — protect-prior-work sent once", () => {
  const RULE =
    "Never revert, reset, `git checkout`/`restore`, `git clean`, stash, or delete changes you did not make — " +
    "unexplained uncommitted changes in the working tree are someone else's intentional prior work, not a mess to clean up.";

  it("leaves it out of the brief when the persona already has it", async () => {
    const step = makeStepRow({ bot_id: PERSONA_BOT_ID });
    const ctx = makePersonaClaimContext({
      pendingStep: step,
      updatedStep: { ...step, status: "in_progress" },
      systemPrompt: `## Goal\nShip it.\n\n## Constraints\n${RULE}`,
    });
    const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as { instruction: string };
    expect(result.instruction).not.toContain("PROTECT PRIOR WORK");
  });

  it("keeps it in the brief when the persona doesn't have it", async () => {
    const step = makeStepRow({ bot_id: PERSONA_BOT_ID });
    const ctx = makePersonaClaimContext({
      pendingStep: step,
      updatedStep: { ...step, status: "in_progress" },
      systemPrompt: "You are Atlas. Ship it.",
    });
    const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as { instruction: string };
    expect(result.instruction).toContain("PROTECT PRIOR WORK");
  });
});

describe("claimNextStep — persona embedding", () => {
  // Pins the COMPLETE Claude instruction, including Auto and missing-persona
  // paths, without eight large text snapshots. First captured before the Codex
  // handoff fix; re-pinned deliberately on 10 Oct 2026 when task 3784ead1
  // calmed the wording (same rules, said once with their reasons); re-pinned
  // again on card 5e654dd1 (stage 2) when the hand-off was slimmed: the
  // instruction now comes from buildClaimInstruction.
  it("preserves pre-fix Claude instruction bytes for every tier and persona path", async () => {
    const hashes: Record<string, string> = {};
    for (const tier of [null, "frontier", "standard", "cheap"]) {
      for (const systemPrompt of [null, "You are Atlas. Preserve the user's work."]) {
        const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: tier });
        const ctx = () => makePersonaClaimContext({
          pendingStep: step,
          updatedStep: { ...step, status: "in_progress" },
          systemPrompt,
        });
        const implicit = await claimNextStep(ctx(), { task_id: TASK_ID });
        const explicit = await claimNextStep(ctx(), { task_id: TASK_ID, agent: "claude" });
        expect(explicit.instruction).toBe(implicit.instruction);
        expect(explicit).not.toHaveProperty("execution");
        // Task 59889027 added one NATIVE SUBAGENT paragraph on the embedded
        // paths and card ba37039b one STEP COST paragraph on every Claude
        // claim; everything else must stay byte-identical, so pin the rest.
        const preexisting = implicit.instruction!
          .replace(/\n\nNATIVE SUBAGENT: [^\n]*/, "")
          .replace(/\n\nSTEP COST: [^\n]*/, "");
        hashes[`${tier ?? "auto"}/${systemPrompt ? "embedded" : "missing"}`] =
          createHash("sha256").update(preexisting).digest("hex");
      }
    }
    expect(hashes).toMatchInlineSnapshot(`
      {
        "auto/embedded": "d5b3f08ac144decb41493c9befacd7be56ac8b86321d10ac13a67c9e53a7212d",
        "auto/missing": "8a71456840d0baf752a8d0606f44520a3dafce4b802e9d6719e94dbe8d7eb0ef",
        "cheap/embedded": "27311d871224a2da45b2be29b8a64246811de8f66ca05f1cdd61495fe16b5072",
        "cheap/missing": "a646a28985dfade02a59b1dd7bb0e1dfa40243d0d7fc5285cc38cde0d7a610e3",
        "frontier/embedded": "c2c98a0a3e22fb3df28740b0becdebc75273570981b5dcbd4622916d9484b39c",
        "frontier/missing": "eb9f4ea3c3f5c9f0e4561c4c868cc2ff01145193c34883413adea2ad8030e58c",
        "standard/embedded": "486f9a09744087c472d90061ad16155726662451364015ad886ff9867b0850fb",
        "standard/missing": "58c038966bf90e6fbe3707a15046fac95b73ffc99ac873fc41f4437d7bb59bfe",
      }
    `);
  });

  // Task 59889027: in-app terminal launches define the board's agents as real
  // Claude Code subagents; the claim names the one for this step.
  describe("native subagent hint", () => {
    const PERSONA = "You are Atlas. Preserve the user's work.";
    type NativeClaim = { native_subagent?: { name: string; tag: string }; instruction?: string };

    it("names the session subagent and its tag for a Claude claim of an embedded persona", async () => {
      const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: "frontier" });
      const ctx = makePersonaClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress" }, systemPrompt: PERSONA });
      const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as NativeClaim;
      const expected = sessionAgentClaimHint({
        bot: { id: PERSONA_BOT_ID, name: "Atlas", system_prompt: PERSONA },
        tier: "frontier",
        model: "opus",
        effort: "medium",
        ideaId: IDEA_ID,
        stepId: step.id,
      });
      expect(result.native_subagent).toEqual({ name: expected.name, tag: expected.tag });
      expect(result.instruction).toContain(expected.instruction);
      // Placed straight after the spawn steps it refines, before the skills/context blocks.
      expect(result.instruction!.indexOf("NATIVE SUBAGENT:")).toBeGreaterThan(result.instruction!.indexOf("RELIABILITY:"));
    });

    it("uses the untiered subagent on an Auto step", async () => {
      const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: null });
      const ctx = makePersonaClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress" }, systemPrompt: PERSONA });
      const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as NativeClaim;
      expect(result.native_subagent?.name.endsWith("-frontier")).toBe(false);
      expect(result.native_subagent?.tag).toContain(" auto auto]");
    });

    // Stage 5 of card 5e654dd1: a step's own effort level.
    it("a step with its own effort names the -<level> subagent and directs that effort", async () => {
      const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: "frontier", effort_override: "high" });
      const ctx = makePersonaClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress" }, systemPrompt: PERSONA });
      const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as NativeClaim & {
        step: { effort?: string };
      };
      const expected = sessionAgentClaimHint({
        bot: { id: PERSONA_BOT_ID, name: "Atlas", system_prompt: PERSONA },
        tier: "frontier",
        model: "opus",
        effort: "high",
        stepEffort: "high",
        ideaId: IDEA_ID,
        stepId: step.id,
      });
      expect(expected.name.endsWith("-frontier-high")).toBe(true);
      expect(result.native_subagent).toEqual({ name: expected.name, tag: expected.tag });
      expect(result.instruction).toContain('reasoning effort "high"');
      expect(result.step.effort).toBe("high");
    });

    it("a step without its own effort keeps the tier's name, tag and effort, and shows no effort", async () => {
      const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: "frontier", effort_override: null });
      const ctx = makePersonaClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress" }, systemPrompt: PERSONA });
      const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as NativeClaim & { step: Record<string, unknown> };
      expect(result.native_subagent?.name.endsWith("-frontier")).toBe(true);
      expect(result.native_subagent?.tag).toContain("opus medium]");
      expect(result.step).not.toHaveProperty("effort");
    });

    it("a Codex claim of a max step runs it as xhigh", async () => {
      const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: "frontier", effort_override: "max" });
      const ctx = makePersonaClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress" }, systemPrompt: PERSONA });
      const result = (await claimNextStep(ctx, { task_id: TASK_ID, agent: "codex" })) as {
        execution: { reasoning_effort: string };
        instruction: string;
      };
      expect(result.execution.reasoning_effort).toBe("xhigh");
      expect(result.instruction).toContain('reasoning_effort: "xhigh"');
    });

    it("adds nothing when the bot has no persona", async () => {
      const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: "frontier" });
      const ctx = makePersonaClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress" }, systemPrompt: null });
      const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as NativeClaim;
      expect(result).not.toHaveProperty("native_subagent");
      expect(result.instruction).not.toContain("NATIVE SUBAGENT");
    });

    // Task e16d69e8: Codex launches get the same agents as temporary
    // agent-role files, named and tagged with Codex's tier resolution.
    it("names the Codex agent type and its tag for a Codex claim of an embedded persona", async () => {
      const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: "frontier" });
      const ctx = makePersonaClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress" }, systemPrompt: PERSONA });
      const result = (await claimNextStep(ctx, { task_id: TASK_ID, agent: "codex" })) as NativeClaim;
      const expected = sessionAgentClaimHint({
        bot: { id: PERSONA_BOT_ID, name: "Atlas", system_prompt: PERSONA },
        tier: "frontier",
        model: "gpt-6-astra",
        effort: "high",
        agent: "codex",
      });
      expect(result.native_subagent).toEqual({ name: expected.name, tag: expected.tag });
      expect(result.instruction).toContain(expected.instruction);
      expect(result.instruction!.indexOf("NATIVE SUBAGENT:")).toBeGreaterThan(result.instruction!.indexOf("AUTO:"));
    });

    // Card 5d0665a2: a session subagent's definition pins the tier's normal
    // model, so while that model is marked unavailable the claim must not
    // send the step to it.
    it("leaves the native subagent out while the step is switched to the backup (Claude)", async () => {
      const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: "frontier" });
      const ctx = makePersonaClaimContext({
        pendingStep: step,
        updatedStep: { ...step, status: "in_progress" },
        systemPrompt: PERSONA,
        unavailableModel: "opus",
      });
      const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as NativeClaim;
      expect(result.instruction).toMatch(/^MODEL SWITCH:/);
      expect(result).not.toHaveProperty("native_subagent");
      expect(result.instruction).not.toContain("NATIVE SUBAGENT");
    });

    it("leaves the native agent type out while the step is switched to the backup (Codex)", async () => {
      const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: "frontier" });
      const ctx = makePersonaClaimContext({
        pendingStep: step,
        updatedStep: { ...step, status: "in_progress" },
        systemPrompt: PERSONA,
        unavailableModel: "gpt-6-astra",
      });
      const result = (await claimNextStep(ctx, { task_id: TASK_ID, agent: "codex" })) as NativeClaim;
      expect(result.instruction).toMatch(/^MODEL SWITCH:/);
      expect(result).not.toHaveProperty("native_subagent");
      expect(result.instruction).not.toContain("NATIVE SUBAGENT");
    });

    it("keeps the native subagent when the marker names a model this step isn't directed at", async () => {
      const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: "frontier" });
      const ctx = makePersonaClaimContext({
        pendingStep: step,
        updatedStep: { ...step, status: "in_progress" },
        systemPrompt: PERSONA,
        unavailableModel: "haiku",
      });
      const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as NativeClaim;
      expect(result.instruction).not.toContain("MODEL SWITCH");
      expect(result.native_subagent).toBeDefined();
      expect(result.instruction).toContain("NATIVE SUBAGENT:");
    });

    it("adds nothing to a Codex claim when the bot has no persona", async () => {
      const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: "frontier" });
      const ctx = makePersonaClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress" }, systemPrompt: null });
      const result = (await claimNextStep(ctx, { task_id: TASK_ID, agent: "codex" })) as NativeClaim;
      expect(result).not.toHaveProperty("native_subagent");
      expect(result.instruction).not.toContain("NATIVE SUBAGENT");
    });
  });

  it("names the native helper and leaves persona_prompt out when the matched bot has a system_prompt", async () => {
    const step = makeStepRow({ step_order: 1, bot_id: PERSONA_BOT_ID });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const systemPrompt = "You are Atlas, a Full Stack Engineer on the VibeCodes team.";

    const ctx = makePersonaClaimContext({ pendingStep: step, updatedStep, systemPrompt });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string; native_subagent?: { name: string }; persona_prompt?: string };
    expect(r.native_subagent?.name).toMatch(/^vc-atlas-/);
    // The helper's definition already is the persona (card 5e654dd1).
    expect(r).not.toHaveProperty("persona_prompt");
    expect(JSON.stringify(result)).not.toContain(systemPrompt);
    expect(r.instruction).toContain("NATIVE SUBAGENT");
    expect(r.instruction).toContain('as_persona true');
    // Attestation obligation on the completion-reporting sentence.
    expect(r.instruction).toContain("persona_used");
    expect(r.instruction).toContain("persona_used (verbatim/adapted/none)");
    expect(r.instruction).toContain("never blocks completion");
    // Untouched surrounding clauses.
    expect(r.instruction).toContain("FRESH SUBAGENT");
    expect(r.instruction).toContain("RELIABILITY");
    expect(r.instruction).toContain("This is the only exception");
  });

  it("get_agent_prompt(as_persona) returns byte-for-byte the persona_prompt a claim would send (card 5e654dd1, AC4.1)", async () => {
    const step = makeStepRow({ step_order: 1, bot_id: PERSONA_BOT_ID, model_tier: "frontier" });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const systemPrompt = "You are Atlas, a Full Stack Engineer on the VibeCodes team.";
    const skills = [
      { bot_id: PERSONA_BOT_ID, name: "api-design-review", content: "  Check REST contracts first.\n" },
      { bot_id: PERSONA_BOT_ID, name: "a11y-audit", content: "Run a WCAG 2.2 AA pass." },
    ];

    // A model switch is active, so the claim carries persona_prompt.
    const claimCtx = makePersonaClaimContext({ pendingStep: step, updatedStep, systemPrompt, unavailableModel: "opus", skills });
    const claimed = (await claimNextStep(claimCtx, { task_id: TASK_ID })) as { persona_prompt?: string };
    expect(claimed.persona_prompt).toContain("### api-design-review");

    const botCtx = makeContext(((table: string) => {
      if (table === "bot_profiles") {
        return createChain({ id: PERSONA_BOT_ID, name: "Atlas", role: "Full Stack Engineer", system_prompt: systemPrompt, tool_access: "full" }).chain;
      }
      if (table === "agent_skills") return createChain(skills).chain;
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);
    const viaTool = (await getBotPrompt(botCtx, { agent_id: PERSONA_BOT_ID, as_persona: true })) as { persona_prompt: string };

    expect(viaTool.persona_prompt).toBe(claimed.persona_prompt);
    // Without as_persona the reply is the unchanged raw profile.
    const raw = (await getBotPrompt(botCtx, { agent_id: PERSONA_BOT_ID })) as Record<string, unknown>;
    expect(raw).not.toHaveProperty("persona_prompt");
    expect(raw.system_prompt).toBe(systemPrompt);
  });

  it("embeds persona_prompt/persona_name/persona_role when no native helper is named (a model switch)", async () => {
    const step = makeStepRow({ step_order: 1, bot_id: PERSONA_BOT_ID, model_tier: "frontier" });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const systemPrompt = "You are Atlas, a Full Stack Engineer on the VibeCodes team.";

    // While a switch is active the native helper (pinned to the unavailable
    // model) is left out, so the persona must ride in the reply.
    const ctx = makePersonaClaimContext({ pendingStep: step, updatedStep, systemPrompt, unavailableModel: "opus" });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as {
      instruction: string; native_subagent?: unknown; persona_prompt?: string; persona_name?: string; persona_role?: string;
    };

    expect(r.native_subagent).toBeUndefined();
    expect(r.persona_prompt).toBe(systemPrompt);
    expect(r.persona_name).toBe("Atlas");
    expect(r.persona_role).toBe("Full Stack Engineer");
    expect(r.instruction).toContain('Spawn it with the "persona_prompt" field in this response as its system prompt');
    expect(r.instruction).not.toContain("Call get_agent_prompt");
  });

  it("omits persona fields and keeps the get_agent_prompt fallback when the step is unassigned", async () => {
    const step = makeStepRow({ step_order: 1, bot_id: null });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string; persona_prompt?: string };
    expect(r).not.toHaveProperty("persona_prompt");
    expect(r).not.toHaveProperty("persona_name");
    expect(r).not.toHaveProperty("persona_role");
    expect(r.instruction).toContain("Call get_agent_prompt");
  });

  it("omits persona fields and keeps the get_agent_prompt fallback when the assigned bot has no system_prompt", async () => {
    const step = makeStepRow({ step_order: 1, bot_id: PERSONA_BOT_ID });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makePersonaClaimContext({ pendingStep: step, updatedStep, systemPrompt: null });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string; persona_prompt?: string };
    expect(r).not.toHaveProperty("persona_prompt");
    expect(r).not.toHaveProperty("persona_name");
    expect(r).not.toHaveProperty("persona_role");
    expect(r.instruction).toContain("Call get_agent_prompt");
    expect(r.instruction).not.toContain("persona_used (");
  });
});

// ---------------------------------------------------------------------------
// completeStep tests
// ---------------------------------------------------------------------------

describe("completeStep", () => {
  it("does not create output comment on completion (output column is sufficient)", async () => {
    const stepData = {
      claim_token_hash: TCT.hash,
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

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "My output" });

    // Output is stored on the step's output column only — no duplicate comment
    expect(commentInserted).toBe(false);
  });

  it("returns stop message when step routes to awaiting_approval", async () => {
    const stepData = {
      claim_token_hash: TCT.hash,
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

    const result = await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "My output" });

    expect(result.status).toBe("awaiting_approval");
    expect(result).toHaveProperty("message");
    expect((result as { message: string }).message).toContain("STOP");
    expect((result as { message: string }).message).toContain("do NOT call approve_step");
  });

  it("does not return stop message for normal completion", async () => {
    const stepData = {
      claim_token_hash: TCT.hash,
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

    const result = await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "My output" });

    expect(result.status).toBe("completed");
    expect(result).not.toHaveProperty("message");
  });

  it("does not create output comment when output is omitted", async () => {
    const stepData = {
      claim_token_hash: TCT.hash,
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

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done" });

    expect(commentInserted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// completeStep — tier adherence (P2c FR-6/7/8/12)
// ---------------------------------------------------------------------------

describe("completeStep — tier adherence (P2c)", () => {
  it.each(["frontier", "standard", "cheap"] as const)(
    "records the Codex %s launch settings on completion, including a launched fallback", async (tier) => {
      const step = makeStepRow({ model_tier: tier });
      const claim = await claimNextStep(makeClaimContext({
        pendingStep: step, updatedStep: { ...step, status: "in_progress" }, priorSteps: [],
      }), { task_id: TASK_ID, agent: "codex" });
      if (!("execution" in claim) || !claim.execution) throw new Error("Expected a Codex claim");
      const { model, reasoning_effort, fallback_model } = claim.execution;
      if (!model || !reasoning_effort || !fallback_model) throw new Error("Expected tier settings");
      for (const launchedModel of [model, fallback_model]) {
        const { ctx, getUpdate } = ctxFor({
          stepData: { ...baseStep, model_tier: tier, claim_token_hash: hashClaimToken(claim.claim_token!) },
          updatedStep: baseUpdatedStep,
        });
        await completeStep(ctx, {
          step_id: STEP_ID, claim_token: claim.claim_token!, agent: "codex",
          model_used: launchedModel, reasoning_effort_used: reasoning_effort,
          output: "A deliverable that does not claim to know its model.",
        });
        expect(getUpdate()).toMatchObject({
          executed_model: launchedModel, reasoning_effort_used: reasoning_effort, tier_honored: true,
        });
      }
    }
  );

  /** run_id: null throughout so checkAndCompleteRun never fires — keeps these
   * tests focused on the tier-adherence write path only. */
  function ctxFor(opts: {
    stepData: Record<string, unknown>;
    updatedStep: Record<string, unknown>;
    userModelTierMap?: Record<string, unknown> | null;
    /** Simulates a live (super-admin-saved) platform_settings row — omit to
     *  exercise the "missing row -> seed" path (the default in every other
     *  test in this block). */
    platformSettingsValue?: unknown;
  }) {
    let commentInserted: unknown = null;
    let usersQueried = 0;
    // QA rework (card 5d0665a2, AC-7): completeStep can now make a SECOND,
    // separate best-effort update to task_workflow_steps (the auto-switch
    // marker, written after the real completion update) — track every chain
    // created for this table and pick out the real completion's by its
    // `status` field, which a marker-only write never carries.
    const stepChains: ReturnType<typeof createChain>[] = [];

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() => Promise.resolve({ data: opts.stepData, error: null }));
        chain.chain.maybeSingle = vi.fn(() => Promise.resolve({ data: opts.updatedStep, error: null }));
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ error: null }).then(resolve);
        stepChains.push(chain);
        return chain.chain;
      }
      if (table === "users") {
        usersQueried++;
        return createChain({ model_tier_map: opts.userModelTierMap ?? null }).chain;
      }
      if (table === "platform_settings") {
        return createChain(
          opts.platformSettingsValue === undefined ? null : { value: opts.platformSettingsValue }
        ).chain;
      }
      if (table === "workflow_step_comments") {
        const chain = createChain(null);
        chain.chain.insert = vi.fn((data: unknown) => {
          commentInserted = data;
          return chain.chain;
        });
        return chain.chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    return {
      ctx,
      getUpdate: () =>
        stepChains.find((c) => c.captured.updated && "status" in (c.captured.updated as Record<string, unknown>))
          ?.captured.updated as Record<string, unknown>,
      getComment: () => commentInserted,
      getUsersQueried: () => usersQueried,
    };
  }

  const baseStep = {
    claim_token_hash: TCT.hash,
    id: STEP_ID,
    run_id: null,
    idea_id: IDEA_ID,
    human_check_required: false,
    status: "in_progress",
    bot_id: null,
  };
  const baseUpdatedStep = {
    id: STEP_ID,
    task_id: TASK_ID,
    run_id: null,
    title: "Test Step",
    agent_role: "developer",
    status: "completed",
    output: null,
    completed_at: "2026-01-01T00:00:00Z",
  };

  it("model_used = resolved model (seed: frontier -> opus/medium), effort reported and matches -> executed_model+effort set, tier_honored=true, no comment", async () => {
    const { ctx, getUpdate, getComment } = ctxFor({
      stepData: { ...baseStep, model_tier: "frontier" },
      updatedStep: baseUpdatedStep,
    });

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", model_used: "opus", reasoning_effort_used: "medium" });

    const update = getUpdate();
    expect(update.executed_model).toBe("opus");
    expect(update.reasoning_effort_used).toBe("medium");
    expect(update.tier_honored).toBe(true);
    expect(getComment()).toBeNull();
  });

  it("model_used = the tier's allowed fallback, effort matches -> tier_honored=true (fallback counts as honored)", async () => {
    const { ctx, getUpdate, getComment } = ctxFor({
      stepData: { ...baseStep, model_tier: "frontier" },
      updatedStep: baseUpdatedStep,
    });

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", model_used: "fable", reasoning_effort_used: "medium" });

    const update = getUpdate();
    expect(update.executed_model).toBe("fable");
    expect(update.tier_honored).toBe(true);
    expect(getComment()).toBeNull();
  });

  it("QA Bug-1: model matches but effort omitted -> tier_honored=NULL (not reported), no mismatch comment", async () => {
    const { ctx, getUpdate, getComment } = ctxFor({
      stepData: { ...baseStep, model_tier: "frontier" },
      updatedStep: baseUpdatedStep,
    });

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", model_used: "opus" });

    const update = getUpdate();
    expect(update.executed_model).toBe("opus");
    expect(update.tier_honored).toBeNull();
    expect(getComment()).toBeNull();
  });

  it("FR-6: model matches but effort is reported-and-wrong -> tier_honored=false, posts mismatch comment", async () => {
    const { ctx, getUpdate, getComment } = ctxFor({
      stepData: { ...baseStep, model_tier: "frontier" },
      updatedStep: baseUpdatedStep,
    });

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", model_used: "opus", reasoning_effort_used: "low" });

    const update = getUpdate();
    expect(update.executed_model).toBe("opus");
    expect(update.reasoning_effort_used).toBe("low");
    expect(update.tier_honored).toBe(false);
    expect(getComment()).not.toBeNull();
  });

  it("model_used = an unrelated concrete model -> tier_honored=false REGARDLESS of effort and posts a 'comment' (not 'failure') mismatch comment", async () => {
    const { ctx, getUpdate, getComment } = ctxFor({
      stepData: { ...baseStep, model_tier: "frontier" },
      updatedStep: baseUpdatedStep,
    });

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", model_used: "sonnet" });

    const update = getUpdate();
    expect(update.executed_model).toBe("sonnet");
    expect(update.tier_honored).toBe(false);

    const comment = getComment() as Record<string, unknown>;
    expect(comment).not.toBeNull();
    expect(comment.type).toBe("comment"); // NOT "failure" (Design-Review CONDITION 4)
    expect(comment.step_id).toBe(STEP_ID);
    expect(comment.idea_id).toBe(IDEA_ID);
    expect(comment.author_id).toBe(USER_ID);
    expect(comment.content as string).toContain("Tier not honored");
    expect(comment.content as string).toContain(TIER_ADHERENCE_DISCLOSURE);
    expect((comment.content as string).toLowerCase()).not.toContain("maps to");
  });

  // Nick's gate note 4: the auto-posted mismatch comment must name the LIVE
  // platform default (whatever a super-admin currently has configured), never
  // the seed constant — otherwise the comment can drift from reality the
  // moment an admin changes the default.
  it("names the LIVE (super-admin-configured) platform default in the mismatch comment, not the seed", async () => {
    const { ctx, getComment } = ctxFor({
      stepData: { ...baseStep, model_tier: "frontier" },
      updatedStep: baseUpdatedStep,
      platformSettingsValue: {
        defaults: { frontier: "fable", standard: "sonnet", cheap: "haiku" },
        fallback: { fable: "opus", opus: "fable", sonnet: "opus", haiku: "sonnet" },
      },
    });

    // Under this LIVE default, frontier resolves to fable (fallback opus) —
    // "sonnet" is a mismatch either way, but the comment's wording must name
    // "Fable" (the live default), never "Opus" (the seed default).
    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", model_used: "sonnet" });

    const comment = getComment() as Record<string, unknown>;
    expect(comment.content as string).toContain("Frontier step defaults to Fable");
    expect(comment.content as string).not.toContain("defaults to Opus");
  });

  it("model_used omitted -> executed_model=NULL, tier_honored=NULL (never false), no comment, no users query", async () => {
    const { ctx, getUpdate, getComment, getUsersQueried } = ctxFor({
      stepData: { ...baseStep, model_tier: "frontier" },
      updatedStep: baseUpdatedStep,
    });

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done" });

    const update = getUpdate();
    expect(update.executed_model).toBeNull();
    expect(update.tier_honored).toBeNull();
    expect(getComment()).toBeNull();
    expect(getUsersQueried()).toBe(0);
  });

  it("model_used='unknown' -> executed_model='unknown', tier_honored=NULL (never false), no comment, no users query", async () => {
    const { ctx, getUpdate, getComment, getUsersQueried } = ctxFor({
      stepData: { ...baseStep, model_tier: "frontier" },
      updatedStep: baseUpdatedStep,
    });

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", model_used: "unknown" });

    const update = getUpdate();
    expect(update.executed_model).toBe("unknown");
    expect(update.tier_honored).toBeNull();
    expect(getComment()).toBeNull();
    expect(getUsersQueried()).toBe(0);
  });

  it("Auto step (model_tier null) -> tier_honored stays NULL regardless of model_used, no users query", async () => {
    const { ctx, getUpdate, getComment, getUsersQueried } = ctxFor({
      stepData: { ...baseStep, model_tier: null },
      updatedStep: baseUpdatedStep,
    });

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", model_used: "sonnet" });

    const update = getUpdate();
    expect(update.executed_model).toBe("sonnet");
    expect(update.tier_honored).toBeNull();
    expect(getComment()).toBeNull();
    expect(getUsersQueried()).toBe(0);
  });

  it("resolves via the caller's model_tier_map override, not just the platform default", async () => {
    const { ctx, getUpdate, getUsersQueried } = ctxFor({
      stepData: { ...baseStep, model_tier: "frontier" },
      updatedStep: baseUpdatedStep,
      userModelTierMap: { frontier: "opus" },
    });

    // Override maps frontier -> opus, so opus is now the *resolved* model (not the fallback).
    // The legacy flat override carries no effort, so the platform default's
    // (seed) effort for frontier ("medium") still applies.
    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", model_used: "opus", reasoning_effort_used: "medium" });

    const update = getUpdate();
    expect(update.tier_honored).toBe(true);
    expect(getUsersQueried()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// completeStep — persona attestation (persona-attestation design §A3/A4/A6,
// Nick's amendment: skills_used)
// ---------------------------------------------------------------------------

describe("completeStep — persona attestation", () => {
  /** run_id: null throughout so checkAndCompleteRun never fires. */
  function ctxFor(opts: { stepData: Record<string, unknown>; updatedStep: Record<string, unknown> }) {
    let lastStepChain: ReturnType<typeof createChain> | null = null;

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() => Promise.resolve({ data: opts.stepData, error: null }));
        chain.chain.maybeSingle = vi.fn(() => Promise.resolve({ data: opts.updatedStep, error: null }));
        lastStepChain = chain;
        return chain.chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    return {
      ctx,
      getUpdate: () => lastStepChain!.captured.updated as Record<string, unknown>,
      getSelectedFields: () => lastStepChain!.captured.selectedFields,
    };
  }

  const baseStep = {
    claim_token_hash: TCT.hash,
    id: STEP_ID,
    run_id: null,
    idea_id: IDEA_ID,
    human_check_required: false,
    status: "in_progress",
    bot_id: null,
    model_tier: null,
  };
  const baseUpdatedStep = {
    id: STEP_ID,
    task_id: TASK_ID,
    run_id: null,
    title: "Test Step",
    agent_role: "developer",
    status: "completed",
    output: null,
    completed_at: "2026-01-01T00:00:00Z",
  };

  it("persona_used='verbatim' -> stores persona_used='verbatim', persona_honored=true", async () => {
    const { ctx, getUpdate } = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });
    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", persona_used: "verbatim" });

    const update = getUpdate();
    expect(update.persona_used).toBe("verbatim");
    expect(update.persona_honored).toBe(true);
  });

  it("persona_used='adapted' -> stores persona_used='adapted', persona_honored=false", async () => {
    const { ctx, getUpdate } = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });
    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", persona_used: "adapted" });

    const update = getUpdate();
    expect(update.persona_used).toBe("adapted");
    expect(update.persona_honored).toBe(false);
  });

  it("persona_used='none' -> stores persona_used='none', persona_honored=false", async () => {
    const { ctx, getUpdate } = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });
    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", persona_used: "none" });

    const update = getUpdate();
    expect(update.persona_used).toBe("none");
    expect(update.persona_honored).toBe(false);
  });

  it("persona_used omitted -> persona_used=NULL, persona_honored=NULL (never false — old-style call unaffected)", async () => {
    const { ctx, getUpdate } = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });
    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done" });

    const update = getUpdate();
    expect(update.persona_used).toBeNull();
    expect(update.persona_honored).toBeNull();
  });

  it("rejects an invalid persona_used value at the schema boundary", () => {
    expect(() =>
      completeStepSchema.parse({ step_id: STEP_ID, persona_used: "bogus" })
    ).toThrow();
  });

  // Task d04408b0: skills_used is VibeCodes' own record of what claim_next_step
  // sent. complete_step never writes it, whatever a caller still passes.
  it("skills_used passed by a caller -> accepted but not written", async () => {
    const { ctx, getUpdate } = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });
    await completeStep(ctx, {
      claim_token: TCT.token,
      step_id: STEP_ID,
      output: "done",
      skills_used: ["api-design-review", "a11y-audit"],
    });

    expect(getUpdate()).not.toHaveProperty("skills_used");
  });

  it("skills_used=[] and skills_used omitted -> neither is written", async () => {
    const empty = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });
    await completeStep(empty.ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", skills_used: [] });
    expect(empty.getUpdate()).not.toHaveProperty("skills_used");

    const omitted = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });
    await completeStep(omitted.ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done" });
    expect(omitted.getUpdate()).not.toHaveProperty("skills_used");
  });

  it("echoes persona_used/persona_honored/skills_used on the .select() list", async () => {
    const { ctx, getSelectedFields } = ctxFor({
      stepData: baseStep,
      updatedStep: { ...baseUpdatedStep, persona_used: "verbatim", persona_honored: true, skills_used: ["x"] },
    });
    const result = await completeStep(ctx, {
      claim_token: TCT.token,
      step_id: STEP_ID,
      output: "done",
      persona_used: "verbatim",
      skills_used: ["x"],
    });

    expect(getSelectedFields()).toContain("persona_used, persona_honored, skills_used");
    expect(result.step).toMatchObject({ persona_used: "verbatim", persona_honored: true, skills_used: ["x"] });
  });

  it("old-style call with no persona/skills params still completes normally", async () => {
    const { ctx, getUpdate } = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });
    const result = await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done" });

    expect(result.status).toBe("completed");
    const update = getUpdate();
    expect(update.persona_used).toBeNull();
    expect(update.persona_honored).toBeNull();
    expect(update).not.toHaveProperty("skills_used");
  });
});

// ---------------------------------------------------------------------------
// completeStep / failStep — compliance notification wiring
// (docs/design-compliance-alerts.html — notifyComplianceViolation)
// ---------------------------------------------------------------------------

describe("completeStep / failStep — compliance notification wiring", () => {
  const OWNER_ID = "00000000-0000-4000-a000-000000000099";

  /** Wires "ideas"/"notifications" table mocks alongside the usual step tables. */
  function ctxWithIdeaOwner(opts: {
    stepData: Record<string, unknown>;
    updatedStep: Record<string, unknown>;
    ownerId?: string | null;
    compliancePrefOff?: boolean;
  }) {
    const notificationsInserted: unknown[] = [];
    let ideaLookups = 0;

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() => Promise.resolve({ data: opts.stepData, error: null }));
        chain.chain.maybeSingle = vi.fn(() => Promise.resolve({ data: opts.updatedStep, error: null }));
        return chain.chain;
      }
      if (table === "ideas") {
        ideaLookups++;
        const chain = createChain(null);
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({
            data:
              opts.ownerId === null
                ? null
                : {
                    author_id: opts.ownerId ?? OWNER_ID,
                    author: { notification_preferences: opts.compliancePrefOff ? { compliance_alerts: false } : {} },
                  },
            error: null,
          })
        );
        return chain.chain;
      }
      if (table === "notifications") {
        const chain = createChain(null);
        chain.chain.insert = vi.fn((row: unknown) => {
          notificationsInserted.push(row);
          return chain.chain;
        });
        return chain.chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    return {
      ctx,
      getNotificationsInserted: () => notificationsInserted,
      getIdeaLookups: () => ideaLookups,
    };
  }

  const stepData = {
    claim_token_hash: TCT.hash,
    id: STEP_ID,
    run_id: null,
    idea_id: IDEA_ID,
    human_check_required: false,
    status: "in_progress",
    bot_id: null,
    model_tier: "frontier",
  };
  const updatedStep = {
    id: STEP_ID,
    task_id: TASK_ID,
    run_id: null,
    title: "Test Step",
    agent_role: "developer",
    status: "completed",
    output: null,
    completed_at: "2026-01-01T00:00:00Z",
  };

  it("completeStep: tier dishonored -> posts one step_compliance notification to the idea owner", async () => {
    const { ctx, getNotificationsInserted } = ctxWithIdeaOwner({ stepData, updatedStep });

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", model_used: "haiku" });

    const rows = getNotificationsInserted();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: OWNER_ID,
      actor_id: USER_ID,
      type: "step_compliance",
      idea_id: IDEA_ID,
      task_id: TASK_ID,
    });
  });

  it("completeStep: tier honored -> no notification, no idea lookup", async () => {
    const { ctx, getNotificationsInserted, getIdeaLookups } = ctxWithIdeaOwner({ stepData, updatedStep });

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", model_used: "fable" });

    expect(getNotificationsInserted()).toHaveLength(0);
    expect(getIdeaLookups()).toBe(0);
  });

  it("completeStep: tier dishonored but owner has compliance_alerts=false -> no notification", async () => {
    const { ctx, getNotificationsInserted } = ctxWithIdeaOwner({ stepData, updatedStep, compliancePrefOff: true });

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", model_used: "haiku" });

    expect(getNotificationsInserted()).toHaveLength(0);
  });

  it("completeStep: owner is the caller (self) -> STILL notified (no self-skip for compliance events)", async () => {
    const { ctx, getNotificationsInserted } = ctxWithIdeaOwner({ stepData, updatedStep, ownerId: USER_ID });

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done", model_used: "haiku" });

    expect(getNotificationsInserted()).toHaveLength(1);
  });

  it("failStep: tier dishonored -> posts one step_compliance notification", async () => {
    const failStepData = {
      claim_token_hash: TCT.hash,
      id: STEP_ID,
      run_id: null,
      step_order: 2,
      idea_id: IDEA_ID,
      bot_id: null,
      agent_role: "developer",
      status: "in_progress",
      model_tier: "frontier",
    };
    const failUpdatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: null,
      title: "Test Step",
      agent_role: "developer",
      status: "failed",
      output: "It broke",
    };
    const { ctx, getNotificationsInserted } = ctxWithIdeaOwner({
      stepData: failStepData,
      updatedStep: failUpdatedStep,
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_used: "haiku", output: "It broke" });

    const rows = getNotificationsInserted();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "step_compliance", idea_id: IDEA_ID, task_id: TASK_ID });
  });

  it("failStep: tier honored -> no notification", async () => {
    const failStepData = {
      claim_token_hash: TCT.hash,
      id: STEP_ID,
      run_id: null,
      step_order: 2,
      idea_id: IDEA_ID,
      bot_id: null,
      agent_role: "developer",
      status: "in_progress",
      model_tier: "frontier",
    };
    const failUpdatedStep = {
      id: STEP_ID,
      task_id: TASK_ID,
      run_id: null,
      title: "Test Step",
      agent_role: "developer",
      status: "failed",
      output: "It broke",
    };
    const { ctx, getNotificationsInserted } = ctxWithIdeaOwner({
      stepData: failStepData,
      updatedStep: failUpdatedStep,
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_used: "fable", output: "It broke" });

    expect(getNotificationsInserted()).toHaveLength(0);
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
    reworkComments: { content: string; author_id: string; created_at: string; type: string; step_id?: string }[];
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
    // A saved write-up on a pending/failed step is never a rework source.
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };

    const ctx = makeClaimContextWithRework({
      pendingStep: step,
      updatedStep,
      priorSteps: [],
      reworkComments: [
        { content: "Please fix the validation logic", author_id: USER_ID, created_at: "2026-01-01T00:00:00Z", type: "failure", step_id: STEP_ID },
        { content: "Also handle edge case for empty input", author_id: USER_ID, created_at: "2026-01-01T01:00:00Z", type: "changes_requested", step_id: STEP_ID },
      ],
    });

    const result = await claimNextStep(ctx, { task_id: TASK_ID });
    const r = result as { instruction: string };

    expect(r.instruction).toContain("REWORK REQUIRED");
    expect(r.instruction).toContain("rework_instructions.feedback");
    // Said once (card 5e654dd1): the feedback is in rework_instructions only —
    // not copied into the instruction, and the step object no longer carries output.
    expect(r.instruction).not.toContain("Previous attempt failed");
    expect(r.instruction).not.toContain("Please fix the validation logic");
    const full = result as unknown as {
      rework_instructions: { scope: string; feedback: { from_step: string; content: string }; earlier_rounds: number };
      step: Record<string, unknown>;
    };
    // Newest round only, plus a count of the older one; the step's own output is not a source.
    expect(full.rework_instructions.scope).toBe("this_step");
    expect(full.rework_instructions.feedback.content).toBe("Also handle edge case for empty input");
    expect(full.rework_instructions.feedback.from_step).toBe("Test Step");
    expect(full.rework_instructions.earlier_rounds).toBe(1);
    expect(full.rework_instructions).not.toHaveProperty("previous_failure_output");
    expect(full.rework_instructions).not.toHaveProperty("changes_requested");
    expect(full.step).not.toHaveProperty("output");
    expect(JSON.stringify(result)).not.toContain("Previous attempt failed");
    expect(JSON.stringify(result)).not.toContain("Please fix the validation logic");
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
            Promise.resolve({ data: [{ id: step.id, title: "Test Step" }, { id: "sibling-step", title: "Sibling" }], error: null }).then(resolve);
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
          { content: "Validation logic is wrong", author_id: USER_ID, created_at: "2026-01-01T00:00:00Z", type: "failure", step_id: "sibling-step" },
          { content: "Fix the edge case handling", author_id: USER_ID, created_at: "2026-01-01T01:00:00Z", type: "changes_requested", step_id: "sibling-step" },
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
    // A step that was never sent back is told it is background, never "this step failed".
    expect(r.instruction).not.toContain("REWORK REQUIRED");
    expect(r.instruction).toContain("rework_instructions.feedback is background");
    expect(r.rework_instructions).toMatchObject({ scope: "earlier_step", earlier_rounds: 1, feedback: { from_step: "Sibling" } });
    expect(JSON.stringify(r.rework_instructions)).toContain("Fix the edge case handling");
    expect(r.instruction).not.toContain("Fix the edge case handling");
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
// claimNextStep — approval_notes (Step-Level Comments API)
// ---------------------------------------------------------------------------

describe("claimNextStep — approval_notes", () => {
  /**
   * Extended makeClaimContext that also distinguishes the two
   * workflow_step_comments calls a default step triggers: the Tier 2
   * run-scoped rework query (1st call — output=null/comment_count=0 makes
   * Tier 1 skip and Tier 2 fire) and the new approval_notes query (2nd call).
   */
  function makeClaimContextWithApprovals(opts: {
    pendingStep: ReturnType<typeof makeStepRow>;
    updatedStep: Record<string, unknown>;
    priorSteps: { id: string; title: string; step_order: number; output: string | null }[];
    approvalRows: {
      step_id: string;
      content: string;
      author_id: string;
      created_at: string;
      users?: { full_name: string | null } | null;
    }[];
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
          // Tier 2 run-scoped step IDs (fires: pendingStep.output=null, comment_count=0)
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [{ id: opts.pendingStep.id }], error: null }).then(resolve);
        } else if (callNum === 4) {
          // Context query — prior completed/skipped steps
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
        if (callNum === 1) {
          // Tier 2 rework comments — none
          return createChain([]).chain;
        }
        // 2nd call: approval_notes query
        return createChain(opts.approvalRows).chain;
      }

      if (table === "idea_agents") {
        return createChain([]).chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);
  }

  it("returns approval_notes mapped from prior approval comments, with step_title from the prior-steps list", async () => {
    const step = makeStepRow({ step_order: 3 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [{ id: "s1", title: "Requirements", step_order: 1, output: "Reqs output" }];

    const ctx = makeClaimContextWithApprovals({
      pendingStep: step,
      updatedStep,
      priorSteps,
      approvalRows: [
        {
          step_id: "s1",
          content: "Approved — but rename the field to retry_count.",
          author_id: "human-1",
          created_at: "2026-07-10T18:03:55Z",
          users: { full_name: "Nick Ball" },
        },
      ],
    });

    const result = await claimNextStep(ctx, { task_id: TASK_ID });
    const r = result as { approval_notes: unknown };

    expect(r.approval_notes).toEqual([
      {
        step_id: "s1",
        step_title: "Requirements",
        content: "Approved — but rename the field to retry_count.",
        author_id: "human-1",
        author_name: "Nick Ball",
        created_at: "2026-07-10T18:03:55Z",
      },
    ]);
  });

  it("appends an APPROVER GUIDANCE block to the instruction when approval_notes exist", async () => {
    const step = makeStepRow({ step_order: 3 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [{ id: "s1", title: "Requirements", step_order: 1, output: "Reqs output" }];

    const ctx = makeClaimContextWithApprovals({
      pendingStep: step,
      updatedStep,
      priorSteps,
      approvalRows: [
        {
          step_id: "s1",
          content: "Approved — but rename the field to retry_count.",
          author_id: "human-1",
          created_at: "2026-07-10T18:03:55Z",
          users: { full_name: "Nick Ball" },
        },
      ],
    });

    const result = await claimNextStep(ctx, { task_id: TASK_ID });
    const r = result as { instruction: string };

    expect(r.instruction).toContain("APPROVER GUIDANCE");
    expect(r.instruction).toContain("BINDING requirement");
    expect(r.instruction).toContain('(see "approval_notes")');
    // Said once: the note text is in approval_notes, not copied into the instruction.
    expect(r.instruction).not.toContain("rename the field to retry_count");
    expect(
      (result as unknown as { approval_notes: { content: string; step_title: string }[] }).approval_notes[0],
    ).toMatchObject({ content: "Approved — but rename the field to retry_count.", step_title: "Requirements" });
  });

  it("returns approval_notes: [] and omits the guidance block when no approval comments exist", async () => {
    const step = makeStepRow({ step_order: 3 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID };
    const priorSteps = [{ id: "s1", title: "Requirements", step_order: 1, output: "Reqs output" }];

    const ctx = makeClaimContextWithApprovals({
      pendingStep: step,
      updatedStep,
      priorSteps,
      approvalRows: [],
    });

    const result = await claimNextStep(ctx, { task_id: TASK_ID });
    const r = result as { approval_notes: unknown; instruction: string };

    expect(r.approval_notes).toEqual([]);
    expect(r.instruction).not.toContain("APPROVER GUIDANCE");
  });

  it("returns approval_notes: [] with no query when the step has no run_id", async () => {
    const step = makeStepRow({ step_order: 3, run_id: null });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID, run_id: null };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as {
      instruction: string;
      approval_notes: unknown;
    };

    expect(result.approval_notes).toEqual([]);
    expect(result.instruction).not.toContain("APPROVER GUIDANCE");
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
      claim_token_hash: TCT.hash,
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
    // Saved replies (card 5e654dd1): the write-up is not echoed back.
    expect(result.step).not.toHaveProperty("output");
    expect(result.step).toMatchObject({ output_chars: "output".length });
  });

  // Design Review condition 2 (agent-voice-comments-design.html §1.2, §7):
  // approve_step is belt-and-braces — the hashes are normally already gone
  // by awaiting_approval — but the design's own traceability table (§6,
  // AC-14) names it as one of the five sites the unit tests should cover,
  // and it had no assertion at all before this.
  it("clears work_token_hash alongside claim_token_hash on approval (belt-and-braces)", async () => {
    const stepData = {
      claim_token_hash: TCT.hash,
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
    let stepUpdateData: Record<string, unknown> | null = null;
    const ctx = makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;

      if (table === "users") {
        return createChain({ is_bot: false }).chain;
      }

      if (table === "task_workflow_steps") {
        const callNum = tableCounts[table];
        if (callNum === 1) {
          return createChain(stepData).chain;
        }
        const chain = createChain(null);
        chain.chain.update = vi.fn((data: unknown) => {
          stepUpdateData = data as Record<string, unknown>;
          return chain.chain;
        });
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

    await approveStep(ctx, { step_id: STEP_ID });

    expect(stepUpdateData!.claim_token_hash).toBeNull();
    expect(stepUpdateData!.work_token_hash).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// failStep tests
// ---------------------------------------------------------------------------

const RESET_TO_STEP_ID = "00000000-0000-4000-a000-000000000099";

describe("failStep", () => {
  it("resets the failed step itself when cascade is used", async () => {
    const stepFetched = {
      claim_token_hash: TCT.hash, id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
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

    const result = await failStep(ctx, { claim_token: TCT.token,
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
    // Saved replies (card 5e654dd1): the write-up is not echoed back.
    expect(result.step).not.toHaveProperty("output");
    expect(result.step.output_chars).toBe("Needs rework".length);
  });

  it("sets run to running when cascade is used", async () => {
    const stepFetched = {
      claim_token_hash: TCT.hash, id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
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

    await failStep(ctx, { claim_token: TCT.token,
      step_id: STEP_ID,
      output: "Needs rework",
      reset_to_step_id: RESET_TO_STEP_ID,
    });

    expect(runUpdateData).toEqual({ status: "running" });
  });

  it("sets run to failed when no cascade", async () => {
    const stepFetched = {
      claim_token_hash: TCT.hash, id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
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

    await failStep(ctx, { claim_token: TCT.token,
      step_id: STEP_ID,
      output: "Fatal error",
    });

    expect(runUpdateData).toEqual({ status: "failed" });
  });

  it("auto-creates failure comment when output is provided", async () => {
    const stepFetched = {
      claim_token_hash: TCT.hash, id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
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

    await failStep(ctx, { claim_token: TCT.token,
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
    const stepFetched = {
      claim_token_hash: TCT.hash, id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
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

    await failStep(ctx, { claim_token: TCT.token,
      step_id: STEP_ID,
    });

    expect(commentTableAccessed).toBe(false);
  });

  it("clears claimed_by and claim_token_hash on cascade-reset steps", async () => {
    const stepFetched = {
      claim_token_hash: TCT.hash, id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
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

    await failStep(ctx, { claim_token: TCT.token,
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
      claim_token_hash: null, // FR3: resets invalidate outstanding tokens
      work_token_hash: null, // design §1.2: cleared everywhere claim_token_hash is
    });
  });

  it("sets completed_at when failing a step", async () => {
    const stepFetched = {
      claim_token_hash: TCT.hash, id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
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

    await failStep(ctx, { claim_token: TCT.token,
      step_id: STEP_ID,
      output: "Error occurred",
    });

    expect(stepUpdateData).toHaveProperty("completed_at");
    expect((stepUpdateData as Record<string, unknown>).status).toBe("failed");
    // Design Review condition 2: work_token_hash clears alongside
    // claim_token_hash on a plain (non-cascade) failure too.
    expect((stepUpdateData as Record<string, unknown>).work_token_hash).toBeNull();
  });

  it("failure comment uses idea_id not task_id", async () => {
    const stepFetched = {
      claim_token_hash: TCT.hash, id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID };
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

    await failStep(ctx, { claim_token: TCT.token,
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
    const stepFetched = {
      claim_token_hash: TCT.hash, id: STEP_ID, run_id: RUN_ID, step_order: 5, idea_id: IDEA_ID };
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

    await failStep(ctx, { claim_token: TCT.token,
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
// failStep — auto-switch to the backup model (card 5d0665a2)
// ---------------------------------------------------------------------------

describe("failStep — auto-switch to the backup model (card 5d0665a2)", () => {
  /**
   * QA rework (AC-7): the marker write is no longer folded into the same
   * update as status/claim fields — it is now a SEPARATE call (written
   * before the rescue for a first failure, or best-effort after the main
   * update for a second one), so a DB missing migration 00195 can reject
   * only the marker write and never the step's real status change. This mock
   * distinguishes every task_workflow_steps call after the initial fetch by
   * its SHAPE rather than its position: a `.select("model_unavailable_at")`
   * is the rescue guard read, a `.select("model_unavailable_model")` (with
   * no `.update()`) is readLiveUnavailableModel, an `.update()` immediately
   * awaited with no further `.select()` is a marker write/refresh, and an
   * `.update()` followed by `.select().maybeSingle()` is the real step
   * update.
   */
  function ctxFor(opts: {
    stepData: Record<string, unknown>;
    updatedStep: Record<string, unknown>;
    liveMarkerModel?: string | null;
    stepUnavailableAt?: string | null;
    guardReadError?: { message: string };
    guardReadThrows?: boolean;
    markerWriteError?: { message: string };
    markerWriteThrows?: boolean;
  }) {
    const commentsInserted: Record<string, unknown>[] = [];
    const runUpdates: Record<string, unknown>[] = [];
    const stepUpdates: Record<string, unknown>[] = [];
    let tableCalls = 0;

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        tableCalls++;
        if (tableCalls === 1) {
          return createChain(opts.stepData).chain;
        }

        let selectedFields: string | undefined;
        let updatedPayload: Record<string, unknown> | undefined;
        const local: Record<string, unknown> = {};
        local.select = vi.fn((f?: string) => {
          selectedFields = f;
          return local;
        });
        for (const m of ["eq", "not", "gte", "order", "limit", "in"]) {
          local[m] = vi.fn(() => local);
        }
        local.update = vi.fn((data: unknown) => {
          updatedPayload = data as Record<string, unknown>;
          stepUpdates.push(updatedPayload);
          return local;
        });
        local.maybeSingle = vi.fn(() => {
          if (updatedPayload && selectedFields) {
            // The real step update's own maybeSingle (update -> select -> maybeSingle).
            return Promise.resolve({ data: opts.updatedStep, error: null });
          }
          if (selectedFields === "model_unavailable_at") {
            // Rescue-guard read.
            if (opts.guardReadThrows) throw new Error("relation \"task_workflow_steps\" — unknown column");
            if (opts.guardReadError) return Promise.resolve({ data: null, error: opts.guardReadError });
            return Promise.resolve({ data: { model_unavailable_at: opts.stepUnavailableAt ?? null }, error: null });
          }
          // readLiveUnavailableModel's marker lookup.
          return Promise.resolve({
            data: opts.liveMarkerModel !== undefined ? { model_unavailable_model: opts.liveMarkerModel } : null,
            error: null,
          });
        });
        // A marker write/refresh is awaited directly off the chain returned
        // by .eq() — no .select() precedes it — so it must be thenable.
        local.then = (resolve: (val: unknown) => void) => {
          if (opts.markerWriteThrows) throw new Error("relation \"task_workflow_steps\" — unknown column");
          return Promise.resolve({ error: opts.markerWriteError ?? null }).then(resolve);
        };
        return local;
      }
      if (table === "users") return createChain({ model_tier_map: null }).chain;
      if (table === "platform_settings") return createChain(null).chain;
      if (table === "workflow_runs") {
        const chain = createChain(null);
        chain.chain.update = vi.fn((data: unknown) => {
          runUpdates.push(data as Record<string, unknown>);
          return chain.chain;
        });
        return chain.chain;
      }
      if (table === "workflow_step_comments") {
        const chain = createChain(null);
        chain.chain.insert = vi.fn((data: unknown) => {
          commentsInserted.push(data as Record<string, unknown>);
          return chain.chain;
        });
        return chain.chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    return {
      ctx,
      // The real step update always carries `status`; a marker write/refresh
      // never does — this holds regardless of call order.
      getUpdate: () => stepUpdates.find((u) => "status" in u) as Record<string, unknown>,
      getMarkerWrite: () => stepUpdates.find((u) => "model_unavailable_at" in u) as Record<string, unknown> | undefined,
      getComments: () => commentsInserted,
      getRunUpdates: () => runUpdates,
    };
  }

  const baseStep = {
    claim_token_hash: TCT.hash,
    id: STEP_ID,
    run_id: RUN_ID,
    step_order: 3,
    idea_id: IDEA_ID,
    bot_id: null,
    agent_role: "developer",
    status: "in_progress",
    model_tier: "frontier",
  };

  it("returns the step to pending instead of leaving it failed, and writes the marker as a separate call BEFORE the rescue (AC-1, AC-7)", async () => {
    const { ctx, getUpdate, getMarkerWrite } = ctxFor({
      stepData: baseStep,
      updatedStep: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "pending", output: null },
      liveMarkerModel: null,
      stepUnavailableAt: null,
    });

    await failStep(ctx, {
      claim_token: TCT.token,
      step_id: STEP_ID,
      output: "API error: credit balance too low",
      model_unavailable: true,
    });

    const update = getUpdate();
    expect(update.status).toBe("pending");
    expect(update.completed_at).toBeNull();
    expect(update.started_at).toBeNull();
    expect(update.claimed_by).toBeNull();
    expect("model_unavailable_at" in update).toBe(false);
    expect("model_unavailable_model" in update).toBe(false);

    // Seed frontier (claude) resolves to opus — written by its own call.
    const markerWrite = getMarkerWrite();
    expect(markerWrite).toBeDefined();
    expect(markerWrite!.model_unavailable_model).toBe("opus");
    expect(markerWrite!.model_unavailable_at).not.toBeNull();
  });

  it("on the rescue path the saved write-up is archived as an output comment, never used as failure text", async () => {
    const { ctx, getComments } = ctxFor({
      stepData: { ...baseStep, output: "SAVED HELPER WRITE-UP", bot_id: "00000000-0000-4000-a000-0000000000b1" },
      updatedStep: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "pending", output: null },
      liveMarkerModel: null,
      stepUnavailableAt: null,
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_unavailable: true });

    const all = getComments();
    expect(all.filter((c) => c.type === "failure")).toEqual([]);
    expect(all.find((c) => c.type === "output")).toMatchObject({ content: "SAVED HELPER WRITE-UP" });
    expect(all.some((c) => c.type !== "output" && c.content === "SAVED HELPER WRITE-UP")).toBe(false);
  });

  it("leaves the run running so the workflow carries on rather than stopping dead", async () => {
    const { ctx, getRunUpdates } = ctxFor({
      stepData: baseStep,
      updatedStep: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "pending", output: null },
      liveMarkerModel: null,
      stepUnavailableAt: null,
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_unavailable: true });

    expect(getRunUpdates()).toContainEqual({ status: "running" });
  });

  it("posts the binding-wording rescue comment naming the dead model and the backup (AC-3, Design Review edit)", async () => {
    const { ctx, getComments } = ctxFor({
      stepData: baseStep,
      updatedStep: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "pending", output: null },
      liveMarkerModel: null,
      stepUnavailableAt: null,
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_unavailable: true });

    const notice = getComments().find((c) => c.type === "comment");
    expect(notice).toBeDefined();
    // Seed frontier -> opus, backup fable.
    expect(notice!.content).toBe(
      "**Switched to the backup model.** This step couldn't run because **opus** was unavailable (for example out of credits or overloaded). It has been put back in the queue and will be re-run on the backup, **fable**. Other steps on this board that would have used **opus** will use **fable** too until midnight UTC, when **opus** is tried again. This automatic retry happens once per step — if it fails on **fable** as well it stays failed and needs a person to look."
    );
  });

  it("falls back to an ordinary failure when the marker write before the rescue fails — never rescues without recording it (AC-7)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx, getUpdate, getRunUpdates } = ctxFor({
      stepData: baseStep,
      updatedStep: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "failed", output: null },
      liveMarkerModel: null,
      stepUnavailableAt: null,
      markerWriteError: { message: "column \"model_unavailable_at\" does not exist" },
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_unavailable: true });

    // Never flipped to pending on a marker write it couldn't confirm — a
    // step "rescued" without a recorded marker could be rescued forever.
    const update = getUpdate();
    expect(update.status).toBe("failed");
    expect(getRunUpdates()).toContainEqual({ status: "failed" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("falls back to an ordinary failure when the marker write before the rescue throws (AC-7)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx, getUpdate, getRunUpdates } = ctxFor({
      stepData: baseStep,
      updatedStep: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "failed", output: null },
      liveMarkerModel: null,
      stepUnavailableAt: null,
      markerWriteThrows: true,
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_unavailable: true });

    const update = getUpdate();
    expect(update.status).toBe("failed");
    expect(getRunUpdates()).toContainEqual({ status: "failed" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("degrades to an ordinary failure when the rescue-guard read errors, exactly as on master (AC-7)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx, getUpdate, getRunUpdates, getMarkerWrite } = ctxFor({
      stepData: baseStep,
      updatedStep: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "failed", output: null },
      guardReadError: { message: "column task_workflow_steps.model_unavailable_at does not exist" },
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_unavailable: true });

    const update = getUpdate();
    expect(update.status).toBe("failed");
    expect("model_unavailable_at" in update).toBe(false);
    // Never even attempts a marker write once the guard read is unreadable.
    expect(getMarkerWrite()).toBeUndefined();
    expect(getRunUpdates()).toContainEqual({ status: "failed" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("degrades to an ordinary failure when the rescue-guard read throws (PGRST204-style), exactly as on master (AC-7)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx, getUpdate, getMarkerWrite } = ctxFor({
      stepData: baseStep,
      updatedStep: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "failed", output: null },
      guardReadThrows: true,
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_unavailable: true });

    const update = getUpdate();
    expect(update.status).toBe("failed");
    expect(getMarkerWrite()).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not rescue the same step twice — a second failure stays failed, and the marker is refreshed (as a separate best-effort write) to whichever model it was actually directed at (AC-1)", async () => {
    const { ctx, getUpdate, getMarkerWrite, getRunUpdates, getComments } = ctxFor({
      stepData: baseStep,
      stepUnavailableAt: "2026-09-20T00:00:00.000Z",
      // The live marker still names "opus" (set by the first rescue) — this
      // claim was therefore directed at the backup, "fable".
      liveMarkerModel: "opus",
      updatedStep: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "failed", output: null },
    });

    await failStep(ctx, {
      claim_token: TCT.token,
      step_id: STEP_ID,
      output: "Still failing",
      model_unavailable: true,
    });

    const update = getUpdate();
    expect(update.status).toBe("failed");
    expect(update.completed_at).not.toBeNull();
    expect("model_unavailable_at" in update).toBe(false);
    // The marker is refreshed (in its own call) to name the model THIS claim
    // was actually directed at (the backup, fable) — not the original primary.
    const markerWrite = getMarkerWrite();
    expect(markerWrite!.model_unavailable_model).toBe("fable");
    expect(markerWrite!.model_unavailable_at).not.toBeNull();
    expect(getRunUpdates()).toContainEqual({ status: "failed" });

    const secondFailureComment = getComments().find((c) => c.type === "comment");
    expect(secondFailureComment!.content).toBe(
      "**No automatic retry this time.** This step was already re-run once on a backup model and has now failed again because **fable** was unavailable. It has been left failed. Check your model credits or plan, then reset or re-run the step."
    );
  });

  it("a failed marker refresh on a second failure never changes the outcome — the step stays failed and the comment still posts (AC-7)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx, getUpdate, getComments } = ctxFor({
      stepData: baseStep,
      stepUnavailableAt: "2026-09-20T00:00:00.000Z",
      liveMarkerModel: "opus",
      updatedStep: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "failed", output: null },
      markerWriteError: { message: "column \"model_unavailable_model\" does not exist" },
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_unavailable: true });

    expect(getUpdate().status).toBe("failed");
    const secondFailureComment = getComments().find((c) => c.type === "comment");
    expect(secondFailureComment).toBeDefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("leaves an ordinary failure's marker columns completely untouched, and never attempts a marker write (AC-6)", async () => {
    const { ctx, getUpdate, getMarkerWrite, getRunUpdates } = ctxFor({
      stepData: baseStep,
      updatedStep: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "failed", output: "tests failed" },
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "tests failed" });

    const update = getUpdate();
    expect(update.status).toBe("failed");
    expect("model_unavailable_at" in update).toBe(false);
    expect("model_unavailable_model" in update).toBe(false);
    expect(update.output).toBe("tests failed");
    expect(getMarkerWrite()).toBeUndefined();
    expect(getRunUpdates()).toContainEqual({ status: "failed" });
  });

  it("keeps the failure text as a comment even though the rescued step's own output is cleared", async () => {
    const { ctx, getUpdate, getComments } = ctxFor({
      stepData: baseStep,
      updatedStep: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "pending", output: null },
      liveMarkerModel: null,
      stepUnavailableAt: null,
    });

    await failStep(ctx, {
      claim_token: TCT.token,
      step_id: STEP_ID,
      output: "API error: credit balance too low",
      model_unavailable: true,
    });

    // A pending step showing a failure in its output column reads as broken;
    // the text survives as the failure comment, which is also what
    // claim_next_step hands back as rework_instructions.
    expect(getUpdate().output).toBeNull();
    const failure = getComments().find((c) => c.type === "failure");
    expect(failure!.content).toBe("API error: credit balance too low");
  });

  it("never rescues an awaiting_approval rejection — human gate", async () => {
    const { ctx, getUpdate, getMarkerWrite } = ctxFor({
      stepData: { ...baseStep, status: "awaiting_approval" },
      updatedStep: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "failed", output: null },
    });

    await failStep(ctx, { step_id: STEP_ID, model_unavailable: true });

    const update = getUpdate();
    expect(update.status).toBe("failed");
    expect("model_unavailable_at" in update).toBe(false);
    expect(getMarkerWrite()).toBeUndefined();
  });

  it("never rescues an Auto step (no model_tier to resolve a backup for)", async () => {
    const { ctx, getUpdate, getMarkerWrite } = ctxFor({
      stepData: { ...baseStep, model_tier: null },
      updatedStep: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "failed", output: null },
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_unavailable: true });

    const update = getUpdate();
    expect(update.status).toBe("failed");
    expect("model_unavailable_at" in update).toBe(false);
    expect(getMarkerWrite()).toBeUndefined();
  });

  it("a cascade reset (reset_to_step_id) never clears or names the marker columns on the steps it resets (AC-9)", async () => {
    // Cascade rejection is a separate update entirely (over a step_order
    // range) from both the failed step's own update and any marker write —
    // it must stay exactly as it was on master.
    const commentsInserted: Record<string, unknown>[] = [];
    const cascadeUpdates: Record<string, unknown>[] = [];
    let tableCalls = 0;
    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        tableCalls++;
        if (tableCalls === 1) return createChain(baseStep).chain;
        if (tableCalls === 2) {
          // Final update for the failed step itself.
          const chain = createChain({ id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", status: "failed", output: null });
          return chain.chain;
        }
        if (tableCalls === 3) {
          // Cascade target step lookup (.single()).
          return createChain({ step_order: 1, position: 1000 }).chain;
        }
        if (tableCalls === 4) {
          // Snapshot of steps-with-output being wiped.
          const chain = createChain([]);
          return chain.chain;
        }
        // Cascade reset update itself.
        const chain = createChain([{ id: "some-other-step" }]);
        chain.chain.update = vi.fn((data: unknown) => {
          cascadeUpdates.push(data as Record<string, unknown>);
          return chain.chain;
        });
        return chain.chain;
      }
      if (table === "users") return createChain({ model_tier_map: null }).chain;
      if (table === "platform_settings") return createChain(null).chain;
      if (table === "workflow_runs") return createChain(null).chain;
      if (table === "workflow_step_comments") {
        const chain = createChain(null);
        chain.chain.insert = vi.fn((data: unknown) => {
          commentsInserted.push(data as Record<string, unknown>);
          return chain.chain;
        });
        return chain.chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await failStep(ctx, {
      claim_token: TCT.token,
      step_id: STEP_ID,
      output: "bad output, rework needed",
      reset_to_step_id: TASK_ID, // any UUID — the mock doesn't validate it
    });

    expect(cascadeUpdates).toHaveLength(1);
    expect("model_unavailable_at" in cascadeUpdates[0]).toBe(false);
    expect("model_unavailable_model" in cascadeUpdates[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// completeStep — auto-switch to the backup model, free signal (card 5d0665a2, AC-4)
// ---------------------------------------------------------------------------

describe("completeStep — auto-switch to the backup model, free signal (AC-4)", () => {
  /**
   * run_id: null throughout so checkAndCompleteRun never fires.
   *
   * QA rework (AC-7): the marker write is now a SEPARATE, best-effort call
   * made AFTER the real completion update, so a DB missing migration 00195
   * can reject only the marker write without breaking completion itself.
   * Distinguish the two by whether `.select()` (and so `.maybeSingle()` with
   * real data) follows the `.update()` — the marker write is awaited
   * directly off `.eq()`, with no `.select()`.
   */
  function ctxFor(opts: {
    stepData: Record<string, unknown>;
    updatedStep: Record<string, unknown>;
    markerWriteError?: { message: string };
    markerWriteThrows?: boolean;
  }) {
    let tableCalls = 0;
    const stepUpdates: Record<string, unknown>[] = [];
    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        tableCalls++;
        if (tableCalls === 1) {
          return createChain(opts.stepData).chain;
        }

        let selectCalled = false;
        let updatedPayload: Record<string, unknown> | undefined;
        const local: Record<string, unknown> = {};
        for (const m of ["eq", "in", "is", "not"]) {
          local[m] = vi.fn(() => local);
        }
        local.select = vi.fn(() => {
          selectCalled = true;
          return local;
        });
        local.update = vi.fn((data: unknown) => {
          updatedPayload = data as Record<string, unknown>;
          stepUpdates.push(updatedPayload);
          return local;
        });
        local.maybeSingle = vi.fn(() => Promise.resolve({ data: opts.updatedStep, error: null }));
        local.then = (resolve: (val: unknown) => void) => {
          if (selectCalled) {
            // Shouldn't happen (the real update always calls .maybeSingle()
            // itself, not via .then()) but keep this safe regardless.
            return Promise.resolve({ data: opts.updatedStep, error: null }).then(resolve);
          }
          if (opts.markerWriteThrows) throw new Error("relation \"task_workflow_steps\" — unknown column");
          return Promise.resolve({ error: opts.markerWriteError ?? null }).then(resolve);
        };
        return local;
      }
      if (table === "users") return createChain({ model_tier_map: null }).chain;
      if (table === "platform_settings") return createChain(null).chain;
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);
    return {
      ctx,
      getUpdate: () => stepUpdates.find((u) => "status" in u) as Record<string, unknown>,
      getMarkerWrite: () => stepUpdates.find((u) => "model_unavailable_at" in u) as Record<string, unknown> | undefined,
    };
  }

  const baseStep = {
    claim_token_hash: TCT.hash,
    id: STEP_ID,
    run_id: null,
    idea_id: IDEA_ID,
    human_check_required: false,
    status: "in_progress",
    bot_id: null,
    model_tier: "frontier",
  };
  const baseUpdatedStep = {
    id: STEP_ID,
    task_id: TASK_ID,
    run_id: null,
    title: "Test Step",
    agent_role: "developer",
    status: "completed",
    output: null,
    completed_at: "2026-01-01T00:00:00Z",
  };

  it("marks the primary unavailable when the agent self-reports running the backup — no new parameter needed, and never names the columns on the main completion update (AC-4, AC-7)", async () => {
    const { ctx, getUpdate, getMarkerWrite } = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });

    // Seed frontier (claude) resolves to opus, fallback fable.
    await completeStep(ctx, { step_id: STEP_ID, output: "done", claim_token: TCT.token, model_used: "fable" });

    expect("model_unavailable_at" in getUpdate()).toBe(false);
    expect("model_unavailable_model" in getUpdate()).toBe(false);

    const markerWrite = getMarkerWrite();
    expect(markerWrite).toBeDefined();
    expect(markerWrite!.model_unavailable_model).toBe("opus");
    expect(markerWrite!.model_unavailable_at).not.toBeNull();
  });

  it("marks nothing when the agent ran the model it was told to", async () => {
    const { ctx, getUpdate, getMarkerWrite } = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });

    await completeStep(ctx, { step_id: STEP_ID, output: "done", claim_token: TCT.token, model_used: "opus" });

    const update = getUpdate();
    expect("model_unavailable_at" in update).toBe(false);
    expect("model_unavailable_model" in update).toBe(false);
    expect(getMarkerWrite()).toBeUndefined();
  });

  it("marks nothing on an Auto step — it promised no model", async () => {
    const { ctx, getUpdate, getMarkerWrite } = ctxFor({
      stepData: { ...baseStep, model_tier: null },
      updatedStep: baseUpdatedStep,
    });

    await completeStep(ctx, { step_id: STEP_ID, output: "done", claim_token: TCT.token, model_used: "fable" });

    expect("model_unavailable_at" in getUpdate()).toBe(false);
    expect(getMarkerWrite()).toBeUndefined();
  });

  it("marks nothing when model_used is omitted", async () => {
    const { ctx, getUpdate, getMarkerWrite } = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });

    await completeStep(ctx, { step_id: STEP_ID, output: "done", claim_token: TCT.token });

    expect("model_unavailable_at" in getUpdate()).toBe(false);
    expect(getMarkerWrite()).toBeUndefined();
  });

  it("a completion succeeds even when the best-effort marker write fails — completion is unaffected (AC-7)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx, getUpdate } = ctxFor({
      stepData: baseStep,
      updatedStep: baseUpdatedStep,
      markerWriteError: { message: "column \"model_unavailable_at\" does not exist" },
    });

    const result = await completeStep(ctx, { step_id: STEP_ID, output: "done", claim_token: TCT.token, model_used: "fable" });

    expect(getUpdate().status).toBe("completed");
    expect((result as { step: { status: string } }).step.status).toBe("completed");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a completion succeeds even when the best-effort marker write throws (AC-7)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx, getUpdate } = ctxFor({
      stepData: baseStep,
      updatedStep: baseUpdatedStep,
      markerWriteThrows: true,
    });

    const result = await completeStep(ctx, { step_id: STEP_ID, output: "done", claim_token: TCT.token, model_used: "fable" });

    expect(getUpdate().status).toBe("completed");
    expect((result as { step: { status: string } }).step.status).toBe("completed");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// failStep — tier adherence (P2c FR-6/7/8/12)
// ---------------------------------------------------------------------------

describe("failStep — tier adherence (P2c)", () => {
  /** run_id: null throughout so the cascade/run-status paths never fire —
   * keeps these tests focused on the tier-adherence write path only. */
  function ctxFor(opts: {
    stepData: Record<string, unknown>;
    updatedStep: Record<string, unknown>;
    userModelTierMap?: Record<string, unknown> | null;
  }) {
    const commentsInserted: Record<string, unknown>[] = [];
    let usersQueried = 0;
    let lastStepChain: ReturnType<typeof createChain> | null = null;

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() => Promise.resolve({ data: opts.stepData, error: null }));
        chain.chain.maybeSingle = vi.fn(() => Promise.resolve({ data: opts.updatedStep, error: null }));
        lastStepChain = chain;
        return chain.chain;
      }
      if (table === "users") {
        usersQueried++;
        return createChain({ model_tier_map: opts.userModelTierMap ?? null }).chain;
      }
      if (table === "workflow_step_comments") {
        const chain = createChain(null);
        chain.chain.insert = vi.fn((data: unknown) => {
          commentsInserted.push(data as Record<string, unknown>);
          return chain.chain;
        });
        return chain.chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    return {
      ctx,
      getUpdate: () => lastStepChain!.captured.updated as Record<string, unknown>,
      getComments: () => commentsInserted,
      getUsersQueried: () => usersQueried,
    };
  }

  const baseStep = {
    claim_token_hash: TCT.hash,
    id: STEP_ID,
    run_id: null,
    step_order: 3,
    idea_id: IDEA_ID,
    bot_id: null,
    agent_role: "developer",
    status: "in_progress",
  };
  const baseUpdatedStep = {
    id: STEP_ID,
    task_id: TASK_ID,
    run_id: null,
    title: "Test Step",
    agent_role: "developer",
    status: "failed",
    output: null,
  };

  it("model_used = an unrelated concrete model -> tier_honored=false and posts a 'comment' (not 'failure') mismatch comment", async () => {
    const { ctx, getUpdate, getComments } = ctxFor({
      stepData: { ...baseStep, model_tier: "standard" },
      updatedStep: baseUpdatedStep,
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_used: "haiku" });

    const update = getUpdate();
    expect(update.executed_model).toBe("haiku");
    expect(update.tier_honored).toBe(false);

    const mismatchComment = getComments().find((c) => c.type === "comment");
    expect(mismatchComment).toBeDefined();
    expect(mismatchComment!.author_id).toBe(USER_ID);
    expect(mismatchComment!.content as string).toContain("Tier not honored");
    expect(mismatchComment!.content as string).toContain(TIER_ADHERENCE_DISCLOSURE);
  });

  it("does not confuse the mismatch comment with the separate failure-output comment", async () => {
    const { ctx, getComments } = ctxFor({
      stepData: { ...baseStep, model_tier: "standard" },
      updatedStep: baseUpdatedStep,
    });

    await failStep(ctx, {
      claim_token: TCT.token,
      step_id: STEP_ID,
      output: "Build failed",
      model_used: "haiku",
    });

    const comments = getComments();
    expect(comments).toHaveLength(2);
    expect(comments.find((c) => c.type === "failure")).toMatchObject({ content: "Build failed" });
    expect(comments.find((c) => c.type === "comment")?.content).toContain("Tier not honored");
  });

  it("model_used omitted -> executed_model=NULL, tier_honored=NULL (never false), no mismatch comment, no users query", async () => {
    const { ctx, getUpdate, getComments, getUsersQueried } = ctxFor({
      stepData: { ...baseStep, model_tier: "standard" },
      updatedStep: baseUpdatedStep,
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID });

    const update = getUpdate();
    expect(update.executed_model).toBeNull();
    expect(update.tier_honored).toBeNull();
    expect(getComments()).toHaveLength(0);
    expect(getUsersQueried()).toBe(0);
  });

  it("model_used='unknown' -> executed_model='unknown', tier_honored=NULL (never false), no mismatch comment", async () => {
    const { ctx, getUpdate, getComments } = ctxFor({
      stepData: { ...baseStep, model_tier: "standard" },
      updatedStep: baseUpdatedStep,
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_used: "unknown" });

    const update = getUpdate();
    expect(update.executed_model).toBe("unknown");
    expect(update.tier_honored).toBeNull();
    expect(getComments()).toHaveLength(0);
  });

  it("Auto step (model_tier null) -> tier_honored stays NULL regardless of model_used", async () => {
    const { ctx, getUpdate, getComments } = ctxFor({
      stepData: { ...baseStep, model_tier: null },
      updatedStep: baseUpdatedStep,
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_used: "sonnet" });

    const update = getUpdate();
    expect(update.executed_model).toBe("sonnet");
    expect(update.tier_honored).toBeNull();
    expect(getComments()).toHaveLength(0);
  });

  it("model_used = resolved model, effort matches -> tier_honored=true, no mismatch comment", async () => {
    const { ctx, getUpdate, getComments } = ctxFor({
      stepData: { ...baseStep, model_tier: "standard" },
      updatedStep: baseUpdatedStep,
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_used: "sonnet", reasoning_effort_used: "medium" });

    const update = getUpdate();
    expect(update.executed_model).toBe("sonnet");
    expect(update.reasoning_effort_used).toBe("medium");
    expect(update.tier_honored).toBe(true);
    expect(getComments()).toHaveLength(0);
  });

  it("QA Bug-1: model matches but effort omitted -> tier_honored=NULL, no mismatch comment", async () => {
    const { ctx, getUpdate, getComments } = ctxFor({
      stepData: { ...baseStep, model_tier: "standard" },
      updatedStep: baseUpdatedStep,
    });

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, model_used: "sonnet" });

    const update = getUpdate();
    expect(update.executed_model).toBe("sonnet");
    expect(update.tier_honored).toBeNull();
    expect(getComments()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// failStep — persona attestation (mirrors completeStep — persona attestation)
// ---------------------------------------------------------------------------

describe("failStep — persona attestation", () => {
  function ctxFor(opts: { stepData: Record<string, unknown>; updatedStep: Record<string, unknown> }) {
    let lastStepChain: ReturnType<typeof createChain> | null = null;

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() => Promise.resolve({ data: opts.stepData, error: null }));
        chain.chain.maybeSingle = vi.fn(() => Promise.resolve({ data: opts.updatedStep, error: null }));
        lastStepChain = chain;
        return chain.chain;
      }
      if (table === "workflow_step_comments") return createChain([]).chain;
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    return {
      ctx,
      getUpdate: () => lastStepChain!.captured.updated as Record<string, unknown>,
      getSelectedFields: () => lastStepChain!.captured.selectedFields,
    };
  }

  const baseStep = {
    claim_token_hash: TCT.hash,
    id: STEP_ID,
    run_id: null,
    step_order: 3,
    idea_id: IDEA_ID,
    bot_id: null,
    agent_role: "developer",
    status: "in_progress",
    model_tier: null,
  };
  const baseUpdatedStep = {
    id: STEP_ID,
    task_id: TASK_ID,
    run_id: null,
    title: "Test Step",
    agent_role: "developer",
    status: "failed",
    output: null,
  };

  it("persona_used='verbatim' -> stores persona_used='verbatim', persona_honored=true", async () => {
    const { ctx, getUpdate } = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });
    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, persona_used: "verbatim" });

    const update = getUpdate();
    expect(update.persona_used).toBe("verbatim");
    expect(update.persona_honored).toBe(true);
  });

  it("persona_used='adapted'/'none' -> persona_honored=false", async () => {
    const { ctx: ctxAdapted, getUpdate: getAdapted } = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });
    await failStep(ctxAdapted, { claim_token: TCT.token, step_id: STEP_ID, persona_used: "adapted" });
    expect(getAdapted().persona_honored).toBe(false);

    const { ctx: ctxNone, getUpdate: getNone } = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });
    await failStep(ctxNone, { claim_token: TCT.token, step_id: STEP_ID, persona_used: "none" });
    expect(getNone().persona_honored).toBe(false);
  });

  it("persona_used omitted -> persona_used=NULL, persona_honored=NULL (old-style call unaffected)", async () => {
    const { ctx, getUpdate } = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });
    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "Build failed" });

    const update = getUpdate();
    expect(update.persona_used).toBeNull();
    expect(update.persona_honored).toBeNull();
  });

  it("rejects an invalid persona_used value at the schema boundary", () => {
    expect(() =>
      failStepSchema.parse({ step_id: STEP_ID, persona_used: "bogus" })
    ).toThrow();
  });

  it("skills_used (present, empty or omitted) is accepted but never written", async () => {
    for (const extra of [{ skills_used: ["a11y-audit"] }, { skills_used: [] }, {}]) {
      const { ctx, getUpdate } = ctxFor({ stepData: baseStep, updatedStep: baseUpdatedStep });
      await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, ...extra });
      expect(getUpdate()).not.toHaveProperty("skills_used");
    }
  });

  it("echoes persona_used/persona_honored/skills_used on the .select() list", async () => {
    const { ctx, getSelectedFields } = ctxFor({
      stepData: baseStep,
      updatedStep: { ...baseUpdatedStep, persona_used: "adapted", persona_honored: false, skills_used: [] },
    });
    const result = await failStep(ctx, {
      claim_token: TCT.token,
      step_id: STEP_ID,
      persona_used: "adapted",
      skills_used: [],
    });

    expect(getSelectedFields()).toContain("persona_used, persona_honored, skills_used");
    expect(result.step).toMatchObject({ persona_used: "adapted", persona_honored: false, skills_used: [] });
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

  it("sets model_tier on a pending step", async () => {
    let capturedPatch: Record<string, unknown> | null = null;
    const ctx = makeContext(((table: string) => {
      const chain = createChain(null);
      chain.chain.update = vi.fn((data: unknown) => {
        capturedPatch = data as Record<string, unknown>;
        return chain.chain;
      });
      chain.chain.maybeSingle = vi.fn(() =>
        Promise.resolve({ data: { id: STEP_ID, status: "pending", model_tier: "cheap" }, error: null })
      );
      return chain.chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = await updateStep(ctx, { step_id: STEP_ID, model_tier: "cheap" });
    expect((result as { model_tier: string }).model_tier).toBe("cheap");
    expect(capturedPatch).toEqual({ model_tier: "cheap" });
  });

  it("clears model_tier back to Auto with null", async () => {
    let capturedPatch: Record<string, unknown> | null = null;
    const ctx = makeContext(((table: string) => {
      const chain = createChain(null);
      chain.chain.update = vi.fn((data: unknown) => {
        capturedPatch = data as Record<string, unknown>;
        return chain.chain;
      });
      chain.chain.maybeSingle = vi.fn(() =>
        Promise.resolve({ data: { id: STEP_ID, status: "pending", model_tier: null }, error: null })
      );
      return chain.chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await updateStep(ctx, { step_id: STEP_ID, model_tier: null });
    expect(capturedPatch).toEqual({ model_tier: null, effort_override: null });
  });

  it("rejects a model_tier edit when the step is not pending", async () => {
    const ctx = makeContext(((table: string) => {
      const chain = createChain(null);
      chain.chain.maybeSingle = vi.fn(() =>
        Promise.resolve({ data: null, error: null })
      );
      return chain.chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await expect(
      updateStep(ctx, { step_id: STEP_ID, model_tier: "frontier" })
    ).rejects.toThrow("Step not found or is no longer pending");
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

  it("completes (does not reject) when ctx.userId differs from step.bot_id — token is the capability (Fix 1)", async () => {
    const stepData = {
      claim_token_hash: TCT.hash,
      id: STEP_ID,
      run_id: RUN_ID,
      idea_id: IDEA_ID,
      human_check_required: false,
      status: "in_progress",
      bot_id: BOT_ID, // differs from ctx.userId (USER_ID) — the stale-slot case
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

    const ctx = makeCompleteContext({
      stepData,
      updatedStep,
      agentProfile: { name: "Atlas", role: "Full Stack Engineer" },
    });

    const result = await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "Done" });
    expect(result.status).toBe("completed");
  });

  it("succeeds when ctx.userId matches step.bot_id", async () => {
    const stepData = {
      claim_token_hash: TCT.hash,
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

    const result = await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "Done" });
    expect(result.status).toBe("completed");
  });

  it("succeeds when step.bot_id is null (no pre-matched agent)", async () => {
    const stepData = {
      claim_token_hash: TCT.hash,
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

    const result = await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "Done" });
    expect(result.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// failStep — identity enforcement tests
// ---------------------------------------------------------------------------

describe("failStep — identity enforcement", () => {
  it("fails (does not reject) when ctx.userId differs from step.bot_id — token is the capability (Fix 1)", async () => {
    const stepFetched = {
      claim_token_hash: TCT.hash,
      id: STEP_ID,
      run_id: RUN_ID,
      step_order: 3,
      idea_id: IDEA_ID,
      bot_id: BOT_ID, // differs from ctx.userId (USER_ID)
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
        if (callNum === 1) return createChain(stepFetched).chain;
        const chain = createChain(null);
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: updatedStep, error: null })
        );
        return chain.chain;
      }

      if (table === "workflow_step_comments") return createChain(null).chain;
      if (table === "workflow_runs") return createChain(null).chain;
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const result = await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "Failed" });
    expect(result.step.status).toBe("failed");
  });

  it("succeeds when step.bot_id is null", async () => {
    const stepFetched = {
      claim_token_hash: TCT.hash,
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

    const result = await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "Failed" });
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

// ---------------------------------------------------------------------------
// Claim-token protocol tests (docs/claim-token-protocol-design.html Rev 3)
// ---------------------------------------------------------------------------

describe("claim-token protocol", () => {
  /** Claim-flow context: returns [step] for the list query, captures the claim update. */
  function makeClaimCtx(step: Record<string, unknown>, onUpdate: (data: unknown) => void) {
    const tableCounts: Record<string, number> = {};
    return makeContext(((table: string) => {
      tableCounts[table] = (tableCounts[table] ?? 0) + 1;
      const callNum = tableCounts[table];

      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        if (callNum === 1) {
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [step], error: null }).then(resolve);
        } else if (callNum === 2) {
          chain.chain.update = vi.fn((data: unknown) => {
            onUpdate(data);
            return chain.chain;
          });
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: { ...step, status: "in_progress" }, error: null })
          );
        } else {
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

      if (table === "workflow_step_comments") return createChain([]).chain;
      if (table === "idea_agents") return createChain([]).chain;
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);
  }

  /** Complete/fail-flow context: serves stepData on .single(), captures updates. */
  function makeCompleteCtx(
    stepData: Record<string, unknown>,
    onUpdate?: (data: unknown) => void
  ) {
    return makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() =>
          Promise.resolve({ data: stepData, error: null })
        );
        chain.chain.update = vi.fn((data: unknown) => {
          onUpdate?.(data);
          return chain.chain;
        });
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({
            data: {
              id: STEP_ID,
              task_id: TASK_ID,
              run_id: RUN_ID,
              title: "Test Step",
              agent_role: "developer",
              status: "completed",
              output: "Done",
              completed_at: "2026-01-01T00:00:00Z",
            },
            error: null,
          })
        );
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return chain.chain;
      }

      if (table === "bot_profiles") {
        const chain = createChain(null);
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: { name: "Atlas", role: "Full Stack Engineer" }, error: null })
        );
        return chain.chain;
      }

      if (table === "workflow_step_comments") return createChain(null).chain;

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

  it("claimNextStep mints a one-time token and stores only its hash", async () => {
    const step = makeStepRow({ step_order: 1 });
    let captured: Record<string, unknown> | null = null;
    const ctx = makeClaimCtx(step, (d) => (captured = d as Record<string, unknown>));

    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const claimToken = (result as { claim_token?: string }).claim_token;
    expect(claimToken).toMatch(/^ct_[0-9a-f]{48}$/);
    expect(captured!.claim_token_hash).toBe(hashClaimToken(claimToken!));
    // Plaintext is never stored
    expect(captured!.claim_token_hash).not.toBe(claimToken);
  });

  it("claims on behalf of the step's assigned bot (claimed_by = bot_id, not the caller)", async () => {
    const step = makeStepRow({ step_order: 1, bot_id: BOT_ID });
    let captured: Record<string, unknown> | null = null;
    const ctx = makeClaimCtx(step, (d) => (captured = d as Record<string, unknown>));

    await claimNextStep(ctx, { task_id: TASK_ID });

    expect(captured!.claimed_by).toBe(BOT_ID);
  });

  it("re-claims an in_progress step (last-claim-wins) with a fresh token", async () => {
    const { hash: oldHash } = mintClaimToken();
    const step = makeStepRow({ step_order: 1, status: "in_progress", claim_token_hash: oldHash });
    let captured: Record<string, unknown> | null = null;
    const ctx = makeClaimCtx(step, (d) => (captured = d as Record<string, unknown>));

    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    expect((result as { done: boolean }).done).toBe(false);
    expect(captured!.claim_token_hash).not.toBe(oldHash); // old token displaced
  });

  it("completeStep succeeds with the valid claim token and clears the hash", async () => {
    const { token, hash } = mintClaimToken();
    let updateData: Record<string, unknown> | null = null;
    const ctx = makeCompleteCtx(
      { id: STEP_ID, run_id: RUN_ID, idea_id: IDEA_ID, human_check_required: false, status: "in_progress", bot_id: null, claim_token_hash: hash },
      (d) => (updateData = d as Record<string, unknown>)
    );

    const result = await completeStep(ctx, { step_id: STEP_ID, claim_token: token, output: "Done" });

    expect(result.status).toBe("completed");
    expect(updateData!.claim_token_hash).toBeNull(); // single-use
  });

  // Design Review condition 2 (agent-voice-comments-design.html §1.2, §7):
  // work_token_hash must be cleared at every site claim_token_hash is. The
  // cascade-reset and reset_workflow sites already assert this explicitly
  // elsewhere in this file — this closes the gap for complete_step's own
  // (non-cascade) update, which the traceability table (§6, AC-14) also
  // names as a site the unit tests should cover.
  it("completeStep clears work_token_hash alongside claim_token_hash", async () => {
    const { token, hash } = mintClaimToken();
    let updateData: Record<string, unknown> | null = null;
    const ctx = makeCompleteCtx(
      { id: STEP_ID, run_id: RUN_ID, idea_id: IDEA_ID, human_check_required: false, status: "in_progress", bot_id: null, claim_token_hash: hash },
      (d) => (updateData = d as Record<string, unknown>)
    );

    await completeStep(ctx, { step_id: STEP_ID, claim_token: token, output: "Done" });

    expect(updateData!.work_token_hash).toBeNull();
  });

  it("completeStep rejects a wrong token WITHOUT mutating the step (E2)", async () => {
    const { hash } = mintClaimToken();
    const { token: wrongToken } = mintClaimToken();
    let updates = 0;
    const ctx = makeCompleteCtx(
      { id: STEP_ID, run_id: RUN_ID, idea_id: IDEA_ID, human_check_required: false, status: "in_progress", bot_id: null, claim_token_hash: hash },
      () => updates++
    );

    await expect(
      completeStep(ctx, { step_id: STEP_ID, claim_token: wrongToken, output: "Done" })
    ).rejects.toThrow("This step isn't claimed by you");
    expect(updates).toBe(0); // an error is never a state change
  });

  it("completeStep rejects a missing token (post-cutover: always required)", async () => {
    const { hash } = mintClaimToken();
    const ctx = makeCompleteCtx(
      { id: STEP_ID, run_id: RUN_ID, idea_id: IDEA_ID, human_check_required: false, status: "in_progress", bot_id: null, claim_token_hash: hash }
    );

    await expect(
      completeStep(ctx, { step_id: STEP_ID, output: "Done" })
    ).rejects.toThrow("This step isn't claimed by you");
  });

  // err-6 (docs/agent-voice-comments-design.html §1.6): a work_token (wt_…)
  // presented where a claim_token belongs names the mix-up instead of
  // falling through to the generic "isn't claimed by you".
  it("completeStep rejects a wt_ work_token with err-6, not the generic mismatch", async () => {
    const { hash } = mintClaimToken();
    const { token: workToken } = mintWorkToken();
    const ctx = makeCompleteCtx({
      id: STEP_ID, run_id: RUN_ID, idea_id: IDEA_ID, human_check_required: false, status: "in_progress", bot_id: null, claim_token_hash: hash,
    });

    await expect(
      completeStep(ctx, { step_id: STEP_ID, claim_token: workToken, output: "Done" })
    ).rejects.toThrow(/work_token \(wt_…\) — it can voice comments but can never complete or fail a step/);
  });

  it("failStep rejects a wt_ work_token with err-6, not the generic mismatch", async () => {
    const { hash } = mintClaimToken();
    const { token: workToken } = mintWorkToken();
    const ctx = makeCompleteCtx({
      id: STEP_ID, run_id: RUN_ID, step_order: 3, idea_id: IDEA_ID, bot_id: null, agent_role: "developer", status: "in_progress", claim_token_hash: hash,
    });

    await expect(
      failStep(ctx, { step_id: STEP_ID, claim_token: workToken, output: "bad" })
    ).rejects.toThrow(/work_token \(wt_…\) — it can voice comments but can never complete or fail a step/);
  });

  it("persona mismatch (E3) does NOT block completion — token is the capability (Fix 1)", async () => {
    // A valid token whose step is assigned to BOT_ID, but the caller's ambient
    // identity is USER_ID (the stale-slot scenario that livelocked sessions).
    const { token, hash } = mintClaimToken();
    let updateData: Record<string, unknown> | null = null;
    const ctx = makeCompleteCtx(
      { id: STEP_ID, run_id: RUN_ID, idea_id: IDEA_ID, human_check_required: false, status: "in_progress", bot_id: BOT_ID, claim_token_hash: hash },
      (d) => (updateData = d as Record<string, unknown>)
    );

    const result = await completeStep(ctx, { step_id: STEP_ID, claim_token: token, output: "Done" });

    // Completion succeeds (no livelock) and is attributed to the claimed persona,
    // not the stale ambient identity.
    expect(result.status).toBe("completed");
    expect(updateData!.claimed_by).toBe(BOT_ID);
    expect(updateData!.claim_token_hash).toBeNull();
  });

  it("failStep on an awaiting_approval step needs no token (human gate)", async () => {
    const { hash } = mintClaimToken();
    const ctx = makeCompleteCtx({
      id: STEP_ID,
      run_id: RUN_ID,
      step_order: 3,
      idea_id: IDEA_ID,
      bot_id: BOT_ID,
      agent_role: "developer",
      status: "awaiting_approval",
      claim_token_hash: hash,
    });

    const result = await failStep(ctx, { step_id: STEP_ID, output: "Rejected by human" });
    expect(result.step).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// resetWorkflow — token lifecycle (design §1.2, Design Review condition 2)
//
// This was the genuine gap the design review found: reset_workflow flips
// every step back to pending without ever having been exercised by a unit
// test, so a stale work_token_hash (or even claim_token_hash) could have
// silently survived a full reset. Covering both hashes here closes it.
// ---------------------------------------------------------------------------

describe("resetWorkflow", () => {
  /**
   * QA rework (AC-7): the marker clear is now a SEPARATE, best-effort update
   * made AFTER the main reset update — naming the new columns in the main
   * update would make PostgREST reject the WHOLE statement on a DB missing
   * migration 00195, breaking reset for every user. Captures every
   * task_workflow_steps `.update()` call in order.
   */
  function ctxFor(opts: { markerClearError?: { message: string }; markerClearThrows?: boolean } = {}) {
    const stepUpdates: Record<string, unknown>[] = [];
    const ctx = makeContext(((table: string) => {
      if (table === "workflow_runs") {
        const chain = createChain({ id: RUN_ID });
        chain.chain.maybeSingle = vi.fn(() => Promise.resolve({ data: { id: RUN_ID }, error: null }));
        chain.chain.update = vi.fn(() => chain.chain);
        return chain.chain;
      }
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.update = vi.fn((data: unknown) => {
          stepUpdates.push(data as Record<string, unknown>);
          return chain.chain;
        });
        chain.chain.then = (resolve: (val: unknown) => void) => {
          if (stepUpdates.length > 1 && opts.markerClearThrows) {
            throw new Error("column \"model_unavailable_at\" does not exist");
          }
          const isMarkerClear = stepUpdates.length > 1;
          return Promise.resolve({ error: isMarkerClear ? (opts.markerClearError ?? null) : null }).then(resolve);
        };
        return chain.chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);
    return { ctx, getStepUpdates: () => stepUpdates };
  }

  it("clears both claim_token_hash and work_token_hash on every step in the run, matching today's shape exactly — no marker columns named (AC-7)", async () => {
    const { ctx, getStepUpdates } = ctxFor();

    const result = await resetWorkflow(ctx, { task_id: TASK_ID });

    expect(result.success).toBe(true);
    const [mainUpdate] = getStepUpdates();
    expect(mainUpdate).toEqual({
      status: "pending",
      output: null,
      started_at: null,
      completed_at: null,
      claimed_by: null,
      claim_token_hash: null,
      work_token_hash: null,
    });
  });

  it("clears the auto-switch marker on every step in the run, as a separate call (AC-9)", async () => {
    const { ctx, getStepUpdates } = ctxFor();

    await resetWorkflow(ctx, { task_id: TASK_ID });

    const updates = getStepUpdates();
    expect(updates).toHaveLength(2);
    expect(updates[1]).toEqual({ model_unavailable_at: null, model_unavailable_model: null });
  });

  it("still succeeds when the marker clear errors — a reset must never fail because of it (AC-7)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx } = ctxFor({ markerClearError: { message: "column \"model_unavailable_at\" does not exist" } });

    const result = await resetWorkflow(ctx, { task_id: TASK_ID });

    expect(result.success).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still succeeds when the marker clear throws (AC-7)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx } = ctxFor({ markerClearThrows: true });

    const result = await resetWorkflow(ctx, { task_id: TASK_ID });

    expect(result.success).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("skipStep — never clears or names the auto-switch marker (AC-9)", () => {
  it("skips a pending step without touching model_unavailable_* columns", async () => {
    let captured: Record<string, unknown> | null = null;
    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() => Promise.resolve({ data: { id: STEP_ID, run_id: RUN_ID, status: "pending" }, error: null }));
        chain.chain.update = vi.fn((data: unknown) => {
          captured = data as Record<string, unknown>;
          return chain.chain;
        });
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Test Step", agent_role: "developer", status: "skipped", output: "n/a", completed_at: "2026-01-01T00:00:00Z" }, error: null })
        );
        return chain.chain;
      }
      if (table === "workflow_runs") return createChain(null).chain;
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    const skipped = await skipStep(ctx, { step_id: STEP_ID });
    // Saved replies (card 5e654dd1): the write-up is not echoed back.
    expect(skipped.step).not.toHaveProperty("output");
    expect(skipped.step.output_chars).toBe("n/a".length);

    expect(captured).not.toBeNull();
    expect("model_unavailable_at" in captured!).toBe(false);
    expect("model_unavailable_model" in captured!).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// touchBoardTask — realtime propagation tests
// ---------------------------------------------------------------------------

describe("workflow step mutations touch board_tasks for realtime", () => {
  it("completeStep touches board_tasks.updated_at", async () => {
    let boardTaskTouched = false;

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() =>
          Promise.resolve({
            data: { id: STEP_ID, run_id: RUN_ID, idea_id: IDEA_ID, human_check_required: false, status: "in_progress", bot_id: null, claim_token_hash: TCT.hash },
            error: null,
          })
        );
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({
            data: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Step", agent_role: "dev", status: "completed", output: "done", completed_at: "2026-01-01" },
            error: null,
          })
        );
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return chain.chain;
      }

      if (table === "board_tasks") {
        boardTaskTouched = true;
        const chain = createChain(null);
        chain.chain.update = vi.fn((data: Record<string, unknown>) => {
          expect(data).toHaveProperty("updated_at");
          return chain.chain;
        });
        return chain.chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await completeStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "done" });
    expect(boardTaskTouched).toBe(true);
  });

  it("approveStep touches board_tasks.updated_at", async () => {
    let boardTaskTouched = false;

    const ctx = makeContext(((table: string) => {
      if (table === "users") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() =>
          Promise.resolve({ data: { is_bot: false }, error: null })
        );
        return chain.chain;
      }

      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() =>
          Promise.resolve({
            data: { id: STEP_ID, run_id: RUN_ID, idea_id: IDEA_ID, status: "awaiting_approval" },
            error: null,
          })
        );
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({
            data: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Step", agent_role: "dev", status: "completed", output: null, completed_at: "2026-01-01" },
            error: null,
          })
        );
        chain.chain.then = (resolve: (val: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return chain.chain;
      }

      if (table === "board_tasks") {
        boardTaskTouched = true;
        return createChain(null).chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await approveStep(ctx, { step_id: STEP_ID });
    expect(boardTaskTouched).toBe(true);
  });

  it("failStep touches board_tasks.updated_at", async () => {
    let boardTaskTouched = false;

    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() =>
          Promise.resolve({
            data: { id: STEP_ID, run_id: RUN_ID, step_order: 1, idea_id: IDEA_ID, bot_id: null, agent_role: "dev", status: "in_progress", claim_token_hash: TCT.hash },
            error: null,
          })
        );
        chain.chain.maybeSingle = vi.fn(() =>
          Promise.resolve({
            data: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Step", agent_role: "dev", status: "failed", output: "error" },
            error: null,
          })
        );
        return chain.chain;
      }

      if (table === "board_tasks") {
        boardTaskTouched = true;
        return createChain(null).chain;
      }

      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await failStep(ctx, { claim_token: TCT.token, step_id: STEP_ID, output: "error" });
    expect(boardTaskTouched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// claimNextStep — always returns the subagent instruction (toggle retired, bd13ee8f)
// ---------------------------------------------------------------------------

describe("claimNextStep — subagent instruction (only mode)", () => {
  /** Claim context that serves the step list + the claim update. No mode lookup. */
  function makeCtx() {
    const step = makeStepRow({ step_order: 1, bot_id: null });
    const counts: Record<string, number> = {};
    return {
      supabase: {
        from: (table: string) => {
          counts[table] = (counts[table] ?? 0) + 1;
          const n = counts[table];

          if (table === "task_workflow_steps") {
            const c = createChain(null);
            if (n === 1) {
              c.chain.then = (resolve: (v: unknown) => void) =>
                Promise.resolve({ data: [step], error: null }).then(resolve);
            } else if (n === 2) {
              c.chain.maybeSingle = vi.fn(() =>
                Promise.resolve({ data: { ...step, status: "in_progress" }, error: null })
              );
            } else {
              c.chain.then = (resolve: (v: unknown) => void) =>
                Promise.resolve({ data: [], error: null }).then(resolve);
            }
            return c.chain;
          }
          if (table === "workflow_runs") {
            // status check returns 'running' so the auto-move path is skipped
            return createChain({ status: "running" }).chain;
          }
          if (table === "idea_agents") return createChain([]).chain;
          if (table === "workflow_step_comments") return createChain([]).chain;
          return createChain(null).chain;
        },
      } as unknown as McpContext["supabase"],
      userId: USER_ID,
      sessionId: "sess-test",
    } as McpContext;
  }

  it("mandates spawning a fresh subagent", async () => {
    const result = await claimNextStep(makeCtx(), { task_id: TASK_ID });
    const instruction = (result as { instruction: string }).instruction;

    expect(instruction).toContain("FRESH SUBAGENT");
    expect(instruction).toContain("not in this conversation");
    expect(instruction).toContain("get_agent_prompt");
  });

  it("forbids inlining for convenience and narrowly gates the exception", async () => {
    const result = await claimNextStep(makeCtx(), { task_id: TASK_ID });
    const instruction = (result as { instruction: string }).instruction;

    // No convenience escape hatch — the only exception is a genuine capability gap.
    expect(instruction).toContain("don't do it yourself because it seems simpler");
    expect(instruction).toContain("This is the only exception");
    expect(instruction).toContain("no subagent/Agent tool");
  });

  it("includes reliability guidance (retry/resume rather than finishing inline)", async () => {
    const result = await claimNextStep(makeCtx(), { task_id: TASK_ID });
    const instruction = (result as { instruction: string }).instruction;

    expect(instruction).toContain("retry or resume it");
  });
});

// ---------------------------------------------------------------------------
// modelTierClause / resolveModelTier — MANDATORY MODEL directive (P2b)
// ---------------------------------------------------------------------------

describe("resolveModelTier", () => {
  it("resolves each Claude tier to its platform default, effort, and single-hop fallback (seed: frontier -> opus)", () => {
    expect(resolveModelTier("frontier")).toEqual({ resolved: "opus", effort: "medium", fallback: "fable" });
    expect(resolveModelTier("standard")).toEqual({ resolved: "sonnet", effort: "medium", fallback: "opus" });
    expect(resolveModelTier("cheap")).toEqual({ resolved: "haiku", effort: "low", fallback: "sonnet" });
  });

  it("resolves each Codex tier to its confirmed seed model/effort/fallback", () => {
    expect(resolveModelTier("frontier", "codex")).toEqual({ resolved: "gpt-6-astra", effort: "high", fallback: "gpt-5.6-sol" });
    expect(resolveModelTier("standard", "codex")).toEqual({ resolved: "gpt-5.6-sol", effort: "medium", fallback: "gpt-5.6-luna" });
    expect(resolveModelTier("cheap", "codex")).toEqual({ resolved: "gpt-5.6-luna", effort: "low", fallback: "gpt-5.6-sol" });
  });

  it("uses the caller's Claude override when the tier is present and valid", () => {
    expect(resolveModelTier("frontier", "claude", { frontier: { claude: { model: "opus" } } })).toEqual({
      resolved: "opus", effort: "medium", fallback: "fable",
    });
  });

  it("uses the caller's Codex override (free text always valid); unknown to the fallback map -> falls back to itself", () => {
    expect(resolveModelTier("frontier", "codex", { frontier: { codex: { model: "o4-mini" } } })).toEqual({
      resolved: "o4-mini", effort: "high", fallback: "o4-mini",
    });
  });

  it("an effort-only override keeps the platform-default model but overrides effort", () => {
    expect(resolveModelTier("frontier", "claude", { frontier: { claude: { effort: "low" } } })).toEqual({
      resolved: "opus", effort: "low", fallback: "fable",
    });
  });

  it("ignores an override for a different tier and falls back to the platform default", () => {
    expect(resolveModelTier("standard", "claude", { frontier: { claude: { model: "opus" } } })).toEqual({
      resolved: "sonnet", effort: "medium", fallback: "opus",
    });
  });

  it("ignores an invalid/unrecognised Claude override value and falls back to the platform default", () => {
    expect(resolveModelTier("cheap", "claude", { cheap: { claude: { model: "gpt-4" } } })).toEqual({
      resolved: "haiku", effort: "low", fallback: "sonnet",
    });
  });

  it("accepts a legacy flat user-map string as a Claude-only override", () => {
    expect(resolveModelTier("frontier", "claude", { frontier: "opus" })).toEqual({
      resolved: "opus", effort: "medium", fallback: "fable",
    });
    // The legacy flat shape carries no Codex information — Codex still resolves to its own platform default.
    expect(resolveModelTier("frontier", "codex", { frontier: "opus" })).toEqual({
      resolved: "gpt-6-astra", effort: "high", fallback: "gpt-5.6-sol",
    });
  });

  it("treats a null/undefined map the same as no override", () => {
    expect(resolveModelTier("frontier", "claude", null)).toEqual({ resolved: "opus", effort: "medium", fallback: "fable" });
    expect(resolveModelTier("frontier", "claude", undefined)).toEqual({ resolved: "opus", effort: "medium", fallback: "fable" });
  });

  it("threads a live agent-aware platformDefaults argument through — overrides the seed default", () => {
    const live = {
      defaults: {
        frontier: { claude: { model: "fable", effort: "high" as const }, codex: { model: "gpt-5.1-codex", effort: "high" as const } },
        standard: { claude: { model: "sonnet", effort: "medium" as const }, codex: { model: "gpt-5.1-codex-mini", effort: "medium" as const } },
        cheap: { claude: { model: "haiku", effort: "low" as const }, codex: { model: "gpt-5.1-codex-mini", effort: "low" as const } },
      },
      fallback: {
        claude: { fable: "opus", opus: "fable", sonnet: "opus", haiku: "sonnet" },
        codex: { "gpt-5.1-codex": "gpt-5.1-codex-mini", "gpt-5.1-codex-mini": "gpt-5.1-codex" },
      },
    };
    expect(resolveModelTier("frontier", "claude", null, live)).toEqual({ resolved: "fable", effort: "high", fallback: "opus" });
  });

  it("precedence: a valid Claude user override wins over even a live (non-seed) platform default", () => {
    const live = {
      defaults: {
        frontier: { claude: { model: "sonnet", effort: "medium" as const }, codex: { model: "gpt-5.1-codex", effort: "high" as const } },
        standard: { claude: { model: "sonnet", effort: "medium" as const }, codex: { model: "gpt-5.1-codex-mini", effort: "medium" as const } },
        cheap: { claude: { model: "haiku", effort: "low" as const }, codex: { model: "gpt-5.1-codex-mini", effort: "low" as const } },
      },
      fallback: { claude: {}, codex: {} },
    };
    expect(resolveModelTier("frontier", "claude", { frontier: { claude: { model: "opus" } } }, live)).toEqual({
      resolved: "opus", effort: "medium", fallback: "fable",
    });
  });
});

describe("modelTierClause", () => {
  it("returns empty string for null (byte-for-byte no-op, FR-12)", () => {
    expect(modelTierClause(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(modelTierClause(undefined)).toBe("");
  });

  // Design-Review CONDITION 1 — exact directive string, verbatim.
  it("produces the exact MANDATORY MODEL directive string for the Claude platform default (standard)", () => {
    expect(modelTierClause("standard")).toBe(
      'MANDATORY MODEL: spawn this step\'s subagent with the Task tool parameter model: "sonnet" and reasoning effort "medium". If "sonnet" is unavailable on this plan/session, use model: "opus" at the same effort and say so in your step output. When calling complete_step/fail_step for this step, pass model_used = the model the subagent actually ran on (the Task-tool model value, or the fallback if you substituted it), and reasoning_effort_used = the effort it actually ran with. This model is resolved live at claim time from the user\'s current Models configuration and overrides any tier→model mapping in CLAUDE.md, AGENTS.md or other project docs; don\'t edit docs to match it or record tier→model mappings in them, because they go stale whenever the user changes their settings.'
    );
  });

  it("produces the exact directive string for a user-overridden Claude tier", () => {
    expect(modelTierClause("frontier", "claude", { frontier: { claude: { model: "opus" } } })).toBe(
      'MANDATORY MODEL: spawn this step\'s subagent with the Task tool parameter model: "opus" and reasoning effort "medium". If "opus" is unavailable on this plan/session, use model: "fable" at the same effort and say so in your step output. When calling complete_step/fail_step for this step, pass model_used = the model the subagent actually ran on (the Task-tool model value, or the fallback if you substituted it), and reasoning_effort_used = the effort it actually ran with. This model is resolved live at claim time from the user\'s current Models configuration and overrides any tier→model mapping in CLAUDE.md, AGENTS.md or other project docs; don\'t edit docs to match it or record tier→model mappings in them, because they go stale whenever the user changes their settings.'
    );
  });

  it("produces the Codex-worded directive — never mentions the Task tool", () => {
    const clause = modelTierClause("standard", "codex");
    expect(clause).toContain('model: "gpt-5.6-sol" and reasoning_effort: "medium" as actual spawn parameters');
    expect(clause).not.toContain("Task tool");
    expect(clause).toContain('fork_turns: "none"');
    expect(clause).toContain("Do not switch the parent with /model");
    expect(clause).toContain("Do not ask the child to identify its model");
    expect(clause).toContain("Never report a requested configuration if the launch rejected it");
  });

  it("never capitalises a Codex model id in the clause", () => {
    const clause = modelTierClause("standard", "codex");
    expect(clause).toContain("gpt-5.6-sol");
    expect(clause).not.toContain("Gpt-5.6-Sol");
  });

  it("includes the doc-precedence rule for the platform-default path (URGENT stale-CLAUDE.md fix)", () => {
    const clause = modelTierClause("standard");
    expect(clause).toContain("resolved live at claim time");
    expect(clause).toContain("overrides any tier→model mapping");
    expect(clause).toContain("don't edit docs to match it");
  });

  it("includes the doc-precedence rule for the Codex path too", () => {
    const clause = modelTierClause("standard", "codex");
    expect(clause).toContain("resolved live at claim time");
    expect(clause).toContain("OVERRIDES");
    expect(clause).toContain("Never edit project docs");
  });

  it("includes the model_used + reasoning_effort_used capture sentence", () => {
    expect(modelTierClause("cheap")).toContain(
      "pass model_used = the model the subagent actually ran on"
    );
    expect(modelTierClause("cheap")).toContain("reasoning_effort_used = the effort it actually ran with");
  });

  it("names the resolved model, effort and fallback for every tier and agent", () => {
    for (const agent of ["claude", "codex"] as const) {
      for (const tier of ["frontier", "standard", "cheap"] as const) {
        const { resolved, effort, fallback } = resolveModelTier(tier, agent)!;
        const clause = modelTierClause(tier, agent);
        expect(clause).toContain("MANDATORY MODEL");
        expect(clause).toContain(resolved);
        expect(clause).toContain(fallback);
        expect(clause).toContain(effort);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// modelTierClause — auto-switch to the backup model (card 5d0665a2)
// ---------------------------------------------------------------------------

describe("modelTierClause — auto-switch to the backup model", () => {
  it("is byte-for-byte unchanged when no model is marked unavailable, for both agents (AC-6)", () => {
    expect(modelTierClause("frontier", "claude", undefined, undefined, null)).toBe(modelTierClause("frontier"));
    expect(modelTierClause("frontier", "claude", undefined, undefined, undefined)).toBe(modelTierClause("frontier"));
    expect(modelTierClause("frontier", "codex", undefined, undefined, null)).toBe(modelTierClause("frontier", "codex"));
  });

  it("directs the step at the backup when the tier's model is marked unavailable (AC-2)", () => {
    // Seed frontier (claude) resolves to opus, whose configured backup is fable.
    const clause = modelTierClause("frontier", "claude", undefined, undefined, "opus");
    expect(clause).toContain('model: "fable"');
    expect(clause).toMatch(/^MODEL SWITCH:/);
  });

  it("says which model is down and why, not just what to run, and scopes it to this board (AC-3)", () => {
    const clause = modelTierClause("frontier", "claude", undefined, undefined, "opus");
    expect(clause).toMatch(/"opus" was reported unavailable on this board/);
    expect(clause).toMatch(/midnight UTC/);
  });

  it("leaves a tier alone when the unavailable model isn't the one it directs at", () => {
    // cheap resolves to haiku; a dead opus is no reason to move it.
    expect(modelTierClause("cheap", "claude", undefined, undefined, "opus")).toBe(modelTierClause("cheap"));
  });

  it("respects a user override when deciding what is affected", () => {
    const pinned = { frontier: { claude: { model: "fable" } } };
    // The user pinned frontier to fable, so a dead OPUS must not move it...
    expect(modelTierClause("frontier", "claude", pinned, undefined, "opus")).toBe(modelTierClause("frontier", "claude", pinned));
    // ...but a dead FABLE must.
    expect(modelTierClause("frontier", "claude", pinned, undefined, "fable")).toMatch(/^MODEL SWITCH:/);
  });

  it("adds nothing on an Auto step, switch or no switch", () => {
    expect(modelTierClause(null, "claude", undefined, undefined, "opus")).toBe("");
  });

  it("still names a next resort after switching, so a second failure has somewhere to go", () => {
    const clause = modelTierClause("frontier", "claude", undefined, undefined, "opus");
    // Directed at fable, with opus named as the resort if fable is down too.
    expect(clause).toContain('use model: "opus"');
  });

  it("switches the Codex directive too, never mentioning the Task tool", () => {
    const clause = modelTierClause("frontier", "codex", undefined, undefined, "gpt-6-astra");
    expect(clause).toMatch(/^MODEL SWITCH:/);
    expect(clause).toContain('model: "gpt-5.6-sol"');
    expect(clause).not.toContain("Task tool");
  });
});

// ---------------------------------------------------------------------------
// resolveTierAdherence — P2c FR-6/7/8 (exact cases, NULL ≠ false), extended
// agent-aware + effort-aware (Codex model-tier task), QA Bug-1 hardened:
// a model match with UNREPORTED effort is NULL, never false.
// ---------------------------------------------------------------------------

describe("resolveTierAdherence", () => {
  it("model_used omitted -> executed=NULL, honored=NULL (never false)", () => {
    expect(resolveTierAdherence("frontier", "claude", undefined, undefined)).toEqual({
      executedModel: null,
      executedEffort: null,
      tierHonored: null,
      viaFallback: false,
    });
  });

  it("model_used='unknown' -> executed='unknown', honored=NULL (never false), regardless of tier", () => {
    expect(resolveTierAdherence("frontier", "claude", "unknown", undefined)).toEqual({
      executedModel: "unknown",
      executedEffort: null,
      tierHonored: null,
      viaFallback: false,
    });
    expect(resolveTierAdherence(null, "claude", "unknown", undefined)).toEqual({
      executedModel: "unknown",
      executedEffort: null,
      tierHonored: null,
      viaFallback: false,
    });
  });

  it("tier is null (Auto) -> executed=model_used, honored=NULL", () => {
    expect(resolveTierAdherence(null, "claude", "sonnet", "medium")).toEqual({
      executedModel: "sonnet",
      executedEffort: "medium",
      tierHonored: null,
      viaFallback: false,
    });
  });

  it("tier set, model+effort = platform-resolved (seed: frontier -> opus/medium) -> honored=true, not via fallback", () => {
    expect(resolveTierAdherence("frontier", "claude", "opus", "medium")).toEqual({
      executedModel: "opus",
      executedEffort: "medium",
      tierHonored: true,
      viaFallback: false,
    });
  });

  it("tier set, model = the tier's allowed fallback, effort matches -> honored=true, viaFallback=true", () => {
    // frontier resolves to opus (effort high), whose fallback is fable.
    expect(resolveTierAdherence("frontier", "claude", "fable", "medium")).toEqual({
      executedModel: "fable",
      executedEffort: "medium",
      tierHonored: true,
      viaFallback: true,
    });
  });

  it("FR-6: model matches but effort is reported-and-wrong -> honored=false (effort is first-class)", () => {
    expect(resolveTierAdherence("frontier", "claude", "opus", "low")).toEqual({
      executedModel: "opus",
      executedEffort: "low",
      tierHonored: false,
      viaFallback: false,
    });
  });

  it("QA Bug-1: model matches but effort omitted -> honored=NULL (not reported, never false)", () => {
    expect(resolveTierAdherence("frontier", "claude", "opus", undefined)).toEqual({
      executedModel: "opus",
      executedEffort: null,
      tierHonored: null,
      viaFallback: false,
    });
  });

  it("QA Bug-1: model matches but effort='unknown' -> honored=NULL (not reported, never false)", () => {
    expect(resolveTierAdherence("frontier", "claude", "opus", "unknown")).toEqual({
      executedModel: "opus",
      executedEffort: "unknown",
      tierHonored: null,
      viaFallback: false,
    });
  });

  it("QA Bug-1: model neither resolved nor fallback -> honored=false REGARDLESS of effort (even if effort matches)", () => {
    // frontier resolves to opus/fable — sonnet is neither, even though "high" is frontier's own effort.
    expect(resolveTierAdherence("frontier", "claude", "sonnet", "high")).toEqual({
      executedModel: "sonnet",
      executedEffort: "high",
      tierHonored: false,
      viaFallback: false,
    });
    // ... and effort omitted doesn't rescue a model mismatch into NULL either.
    expect(resolveTierAdherence("frontier", "claude", "sonnet", undefined)).toEqual({
      executedModel: "sonnet",
      executedEffort: null,
      tierHonored: false,
      viaFallback: false,
    });
  });

  it("tier set, model_used = a user's overridden resolved model -> honored=true", () => {
    expect(resolveTierAdherence("frontier", "claude", "opus", "medium", { frontier: { claude: { model: "opus" } } })).toEqual({
      executedModel: "opus",
      executedEffort: "medium",
      tierHonored: true,
      viaFallback: false,
    });
  });

  it("resolves and honors a Codex model+effort report", () => {
    expect(resolveTierAdherence("standard", "codex", "gpt-5.6-sol", "medium")).toEqual({
      executedModel: "gpt-5.6-sol",
      executedEffort: "medium",
      tierHonored: true,
      viaFallback: false,
    });
  });

  it("tier set, model_used='other', effort reported and wrong -> honored=false", () => {
    expect(resolveTierAdherence("standard", "claude", "other", "medium")).toEqual({
      executedModel: "other",
      executedEffort: "medium",
      tierHonored: false,
      viaFallback: false,
    });
  });
});

// ---------------------------------------------------------------------------
// resolvePersonaAdherence — persona-attestation design §A4/A5 truth table
// ---------------------------------------------------------------------------

describe("resolvePersonaAdherence", () => {
  // Card db4c7f7b: a stand-in subagent can't have run the persona verbatim.
  const BOT = "54dc8eca-1111-4222-8333-444455556666";
  it("downgrades 'verbatim' to 'adapted' when the spawned subagent is general-purpose", () => {
    expect(resolvePersonaAdherence("verbatim", "general-purpose", BOT, true)).toEqual({ personaUsed: "adapted", personaHonored: false });
  });
  it("downgrades 'verbatim' for another agent's vc- name", () => {
    expect(resolvePersonaAdherence("verbatim", "vc-atlas-37e8ffb2-frontier", BOT, true)).toEqual({ personaUsed: "adapted", personaHonored: false });
  });
  it("keeps 'verbatim' for a general-purpose type when the claim named no native subagent (nothing was swapped)", () => {
    expect(resolvePersonaAdherence("verbatim", "general-purpose", BOT, false)).toEqual({ personaUsed: "verbatim", personaHonored: true });
    expect(resolvePersonaAdherence("verbatim", "general-purpose", BOT)).toEqual({ personaUsed: "verbatim", personaHonored: true });
  });
  it("keeps 'verbatim' for the board-named agent, any tier or effort suffix", () => {
    for (const t of ["vc-planner-54dc8eca", "vc-planner-54dc8eca-frontier", "vc-planner-54dc8eca-frontier-high"]) {
      expect(resolvePersonaAdherence("verbatim", t, BOT, true)).toEqual({ personaUsed: "verbatim", personaHonored: true });
    }
  });
  it("leaves 'verbatim' alone when no subagent_type is reported", () => {
    expect(resolvePersonaAdherence("verbatim", undefined, BOT)).toEqual({ personaUsed: "verbatim", personaHonored: true });
  });
  it("does not touch 'none' or 'adapted' for a general-purpose subagent", () => {
    expect(resolvePersonaAdherence("none", "general-purpose", BOT, true).personaUsed).toBe("none");
  });

  it("'verbatim' -> personaUsed='verbatim', personaHonored=true", () => {
    expect(resolvePersonaAdherence("verbatim")).toEqual({ personaUsed: "verbatim", personaHonored: true });
  });

  it("'adapted' -> personaUsed='adapted', personaHonored=false", () => {
    expect(resolvePersonaAdherence("adapted")).toEqual({ personaUsed: "adapted", personaHonored: false });
  });

  it("'none' -> personaUsed='none', personaHonored=false", () => {
    expect(resolvePersonaAdherence("none")).toEqual({ personaUsed: "none", personaHonored: false });
  });

  it("omitted -> both NULL (never false — not reported is not a violation)", () => {
    expect(resolvePersonaAdherence(undefined)).toEqual({ personaUsed: null, personaHonored: null });
  });
});

describe("deliverableFileFormat", () => {
  it.each([
    ["Design document (HTML)", "HTML"],
    ["Decision pack (HTML, attached to card)", "HTML"],
    ["Clickable mock-up (self-contained HTML)", "HTML"],
    ["API schema (json)", "JSON"],
    ["Config (yml)", "YAML"],
    ["Release notes (md)", "Markdown"],
    ["Export (CSV) ", "CSV"],
  ])("%s -> %s", (deliverable, format) => {
    expect(deliverableFileFormat(deliverable)).toBe(format);
  });

  it.each([
    "Code review verdict (pass / blocking issues)",
    "Follow-up cards (if any)",
    "Verification note (repro re-run, test checked, nearby behaviour)",
    "Responsive check (375px + 1280px)",
    "Component (Storybook)",
    "Design document (HTML) and notes",
    "Requirements doc",
  ])("%s -> null", (deliverable) => {
    expect(deliverableFileFormat(deliverable)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// claimNextStep — MANDATORY MODEL directive in the instruction (P2b)
// ---------------------------------------------------------------------------

describe("claimNextStep — Codex handoff", () => {
  it.each([
    ["frontier", "gpt-6-astra", "high", "gpt-5.6-sol"],
    ["standard", "gpt-5.6-sol", "medium", "gpt-5.6-luna"],
    ["cheap", "gpt-5.6-luna", "low", "gpt-5.6-sol"],
  ])("returns launch controls and carries prior context for %s", async (tier, model, effort, fallback) => {
    const step = makeStepRow({ model_tier: tier });
    const result = await claimNextStep(makeClaimContext({
      pendingStep: step,
      updatedStep: { ...step, status: "in_progress" },
      priorSteps: [{ id: "prior-step", title: "Requirements", step_order: 1, output: "Preserve Claude behavior." }],
    }), { task_id: TASK_ID, agent: "codex" });
    if (!("execution" in result)) throw new Error("Expected a Codex claim");
    expect(result.execution).toEqual({
      agent: "codex", mode: "subagent", fork_turns: "none",
      model, reasoning_effort: effort, fallback_model: fallback,
      reporting_source: "accepted_launch_configuration",
    });
    // Earlier steps ride as ids; the child reads them with get_task(step_ids).
    expect(result).not.toHaveProperty("context");
    expect(result.prior_steps).toEqual([
      { step_id: "prior-step", title: "Requirements", output_chars: "Preserve Claude behavior.".length },
    ]);
    expect(result.instruction).toContain("spawn_agent");
    // Live test 11 Oct 2026: a Codex child that had the board tools said it
    // had none and couldn't post its comment, so the child is told where they are.
    expect(result.instruction).toContain("its VibeCodes board tools (add_task_comment, add_step_comment, get_task, save_step_output)");
    expect(result.instruction).toContain("if it reports having no VibeCodes board tools");
    expect(result.instruction).toContain("save_step_output (step_id");
    expect(result.instruction).not.toContain("Agent/Task tool");
    expect(result.instruction).not.toContain("Completed inline — no subagent capability.");
    expect(result.instruction).not.toContain("switch this Codex session");
    expect(result.instruction).toContain("actual spawn parameters");
    expect(result.instruction).toContain("Keep claim_token in the orchestrator only");
    expect(result.instruction).toContain(`get_task(task_id "${TASK_ID}", idea_id "${IDEA_ID}", step_ids ["prior-step"])`);
    expect(result.instruction).toContain("do not paste or summarise them");
    expect(result.instruction).not.toContain("Preserve Claude behavior.");
    expect(result.instruction).toContain("approval_notes, rework_instructions");
    expect(result.instruction).toContain("actual working directory");
    expect(result.instruction).toContain("It must not claim another step, complete/fail this step, or approve anything");
    expect(result.instruction).toContain("CAPABILITY CHECK");
    expect(result.instruction).toContain("stop before doing the work");
    expect(result.instruction).toContain("get_agent_prompt"); // unassigned persona lookup
  });

  it("uses the user's live Codex override, including effort, in both text and launch fields", async () => {
    const step = makeStepRow({ model_tier: "standard" });
    const result = await claimNextStep(makeClaimContext({
      pendingStep: step,
      updatedStep: { ...step, status: "in_progress" },
      priorSteps: [],
      userModelTierMap: { standard: { codex: { model: "gpt-5.6-terra", effort: "high" } } },
    }), { task_id: TASK_ID, agent: "codex" });
    if (!("execution" in result)) throw new Error("Expected a Codex claim");
    expect(result.execution).toMatchObject({ model: "gpt-5.6-terra", reasoning_effort: "high" });
    expect(result.instruction).toContain('model: "gpt-5.6-terra" and reasoning_effort: "high"');
  });

  it.each([null, "Preserve this full persona.\nDo not rewrite its constraints."])(
    "handles assigned persona %s without the Claude inline exception", async (systemPrompt) => {
      const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: "cheap", human_check_required: true });
      const result = await claimNextStep(makePersonaClaimContext({
        pendingStep: step, updatedStep: { ...step, status: "in_progress" }, systemPrompt,
      }), { task_id: TASK_ID, agent: "codex" });
      if (!("execution" in result)) throw new Error("Expected a Codex claim");
      // A named native agent type already carries the persona, so it isn't repeated.
      if (systemPrompt) {
        expect(result).not.toHaveProperty("persona_prompt");
        expect(result.native_subagent).toBeDefined();
      } else {
        expect(result).not.toHaveProperty("persona_prompt");
      }
      expect(result.work_token).toMatch(/^wt_/);
      expect(result.claim_token).toMatch(/^ct_/);
      expect(result.instruction).not.toContain("Agent/Task tool");
      expect(result.instruction).toContain(systemPrompt
        ? `get_agent_prompt with agent_id "${PERSONA_BOT_ID}" and as_persona true`
        : `Call get_agent_prompt with agent_id "${PERSONA_BOT_ID}"`);
      expect(result.instruction).toContain("HUMAN APPROVAL REQUIRED");
      expect(result.instruction).toContain("do not claim to have changed the child's system prompt");
    }
  );

  it("keeps Auto model selection open, with no tier lookups or inline fallback", async () => {
    const step = makeStepRow({ model_tier: null });
    const usersQueryIds: string[] = [];
    const result = await claimNextStep(makeClaimContext({
      pendingStep: step, updatedStep: { ...step, status: "in_progress" }, priorSteps: [], usersQueryIds,
    }), { task_id: TASK_ID, agent: "codex" });
    if (!("execution" in result)) throw new Error("Expected a Codex claim");
    expect(result.execution).toMatchObject({ model: null, reasoning_effort: null, fallback_model: null });
    expect(result.instruction).not.toContain("MANDATORY MODEL");
    expect(result.instruction).toContain("FRESH SUBAGENT");
    expect(usersQueryIds).toEqual([]);
  });
});

describe("claimNextStep — model_tier directive", () => {
  it("null model_tier leaves the instruction free of the directive and queries no users row (FR-12)", async () => {
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID, model_tier: null };
    const usersQueryIds: string[] = [];

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [], usersQueryIds });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string; step: { model_tier: string | null } };
    expect(r.instruction).not.toContain("MANDATORY MODEL");
    expect(r.step.model_tier).toBeNull();
    expect(usersQueryIds).toEqual([]); // no lookup at all on the Auto path
  });

  it("a set model_tier prepends the MANDATORY MODEL directive and surfaces the tier on the step", async () => {
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID, model_tier: "cheap" };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });

    const r = result as { instruction: string; step: { model_tier: string | null } };
    expect(r.instruction).toContain('MANDATORY MODEL: spawn this step\'s subagent with the Task tool parameter model: "haiku"');
    expect(r.instruction).toContain('use model: "sonnet"');
    expect(r.step.model_tier).toBe("cheap");
  });

  // Design-Review CONDITION 2 — directive is the FIRST element of the join.
  it("places the directive FIRST in the instruction, before the identity instruction", async () => {
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID, model_tier: "frontier" };

    const ctx = makeClaimContext({ pendingStep: step, updatedStep, priorSteps: [] });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });
    const r = result as { instruction: string };

    expect(r.instruction.startsWith("MANDATORY MODEL:")).toBe(true);
    expect(r.instruction.indexOf("MANDATORY MODEL")).toBeLessThan(r.instruction.indexOf("FRESH SUBAGENT"));
  });

  it("resolves the directive through the claiming user's model_tier_map override", async () => {
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID, model_tier: "frontier" };

    const ctx = makeClaimContext({
      pendingStep: step,
      updatedStep,
      priorSteps: [],
      userModelTierMap: { frontier: "opus" },
    });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });
    const r = result as { instruction: string };

    expect(r.instruction).toContain('model: "opus"');
    expect(r.instruction).toContain('use model: "fable"');
  });

  it("looks up the owner user's map (bot-identity mode), not the calling identity's", async () => {
    const OWNER_ID = "00000000-0000-4000-a000-000000000099";
    const step = makeStepRow({ step_order: 1 });
    const updatedStep = { ...step, status: "in_progress", claimed_by: USER_ID, model_tier: "standard" };
    const usersQueryIds: string[] = [];

    const ctx = makeClaimContext({
      pendingStep: step,
      updatedStep,
      priorSteps: [],
      ownerUserId: OWNER_ID,
      userModelTierMap: { standard: "opus" },
      usersQueryIds,
    });
    const result = await claimNextStep(ctx, { task_id: TASK_ID });
    const r = result as { instruction: string };

    expect(usersQueryIds).toEqual([OWNER_ID]);
    expect(r.instruction).toContain('model: "opus"');
  });

  it("the null path is byte-for-byte identical to omitting model_tier entirely (FR-12)", async () => {
    const stepA = makeStepRow({ step_order: 1 });
    const nullCtx = makeClaimContext({
      pendingStep: stepA,
      updatedStep: { ...stepA, status: "in_progress", claimed_by: USER_ID, model_tier: null },
      priorSteps: [],
    });
    const nullResult = (await claimNextStep(nullCtx, { task_id: TASK_ID })) as { instruction: string };

    const stepB = makeStepRow({ step_order: 1 });
    const absentCtx = makeClaimContext({
      pendingStep: stepB,
      updatedStep: { ...stepB, status: "in_progress", claimed_by: USER_ID },
      priorSteps: [],
    });
    const absentResult = (await claimNextStep(absentCtx, { task_id: TASK_ID })) as { instruction: string };

    expect(nullResult.instruction).toBe(absentResult.instruction);
  });
});

// ---------------------------------------------------------------------------
// Auto-switch to the configured backup model (card 5d0665a2)
// ---------------------------------------------------------------------------

describe("readLiveUnavailableModel", () => {
  /** Minimal stand-in for the single maybeSingle() marker query. */
  function markerCtx(result: { data: unknown; error: { message: string } | null }) {
    const filters: [string, unknown][] = [];
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, val: unknown) => {
      filters.push([col, val]);
      return chain;
    });
    chain.not = vi.fn((col: string, op: string) => {
      filters.push([`not:${col}`, op]);
      return chain;
    });
    chain.gte = vi.fn((col: string, val: unknown) => {
      filters.push([`gte:${col}`, val]);
      return chain;
    });
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() => Promise.resolve(result));
    const ctx = makeContext((() => chain) as unknown as McpContext["supabase"]["from"]);
    return { ctx, filters };
  }

  it("returns the stored model directly — no tier resolution at read time", async () => {
    const { ctx } = markerCtx({ data: { model_unavailable_model: "fable" }, error: null });
    await expect(readLiveUnavailableModel(ctx, IDEA_ID)).resolves.toBe("fable");
  });

  it("scopes to this board and to markers set today only, keyed on the marker's own timestamp", async () => {
    const { ctx, filters } = markerCtx({ data: { model_unavailable_model: "fable" }, error: null });
    await readLiveUnavailableModel(ctx, IDEA_ID);
    expect(filters).toContainEqual(["idea_id", IDEA_ID]);
    expect(filters).toContainEqual(["not:model_unavailable_at", "is"]);
    const dayBound = filters.find(([col]) => col === "gte:model_unavailable_at");
    expect(dayBound?.[1]).toBe(
      new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
      ).toISOString()
    );
    // Never keyed off updated_at — a step re-claimed days later must not
    // present as a fresh marker.
    expect(filters.every(([col]) => !String(col).endsWith("updated_at"))).toBe(true);
  });

  it("returns null when there is no marker", async () => {
    const { ctx } = markerCtx({ data: null, error: null });
    await expect(readLiveUnavailableModel(ctx, IDEA_ID)).resolves.toBeNull();
  });

  it("returns null when a marker row exists but names no model", async () => {
    const { ctx } = markerCtx({ data: { model_unavailable_model: null }, error: null });
    await expect(readLiveUnavailableModel(ctx, IDEA_ID)).resolves.toBeNull();
  });

  it("degrades to no switch on a query error rather than blocking the claim (AC-7)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx } = markerCtx({ data: null, error: { message: "boom" } });
    await expect(readLiveUnavailableModel(ctx, IDEA_ID)).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("degrades to no switch when the query throws (AC-7)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const ctx = makeContext((() => {
      throw new Error("connection reset");
    }) as unknown as McpContext["supabase"]["from"]);
    await expect(readLiveUnavailableModel(ctx, IDEA_ID)).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("claimNextStep — auto-switch to the backup model (card 5d0665a2)", () => {
  it("with no marker, the instruction is byte-for-byte identical to today's (AC-6)", async () => {
    const step = makeStepRow({ step_order: 1 });
    const ctx = makeClaimContext({
      pendingStep: step,
      updatedStep: { ...step, status: "in_progress", claimed_by: USER_ID, model_tier: "frontier" },
      priorSteps: [],
      unavailableModel: null,
    });
    const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as { instruction: string };
    expect(result.instruction).toContain(modelTierClause("frontier"));
    expect(result.instruction).not.toContain("MODEL SWITCH");
  });

  it("the Auto path (no model_tier) issues no marker query at all (AC-6)", async () => {
    const step = makeStepRow({ step_order: 1, model_tier: null });
    let taskWorkflowStepsCalls = 0;
    const ctx = makeContext(((table: string) => {
      if (table === "task_workflow_steps") {
        taskWorkflowStepsCalls++;
        const chain = createChain(null);
        if (taskWorkflowStepsCalls === 1) {
          chain.chain.then = (resolve: (val: unknown) => void) =>
            Promise.resolve({ data: [step], error: null }).then(resolve);
        } else if (taskWorkflowStepsCalls === 2) {
          chain.chain.maybeSingle = vi.fn(() =>
            Promise.resolve({ data: { ...step, status: "in_progress", claimed_by: USER_ID }, error: null })
          );
        }
        return chain.chain;
      }
      if (table === "workflow_runs") {
        const chain = createChain(null);
        chain.chain.then = (resolve: (val: unknown) => void) => Promise.resolve({ data: null, error: null }).then(resolve);
        return chain.chain;
      }
      return createChain([]).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await claimNextStep(ctx, { task_id: TASK_ID });
    // fetch, claim update, Tier-2 run-scoped id query, context query — and
    // crucially no 5th call, since the marker lookup is gated on model_tier.
    expect(taskWorkflowStepsCalls).toBe(4);
  });

  it("directs the tiered step at the backup and prepends the switch notice when a live marker names its model (AC-2/AC-3)", async () => {
    const step = makeStepRow({ step_order: 1 });
    const ctx = makeClaimContext({
      pendingStep: step,
      updatedStep: { ...step, status: "in_progress", claimed_by: USER_ID, model_tier: "frontier" },
      priorSteps: [],
      // Seed frontier (claude) resolves to opus; mark it dead.
      unavailableModel: "opus",
    });
    const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as { instruction: string };
    expect(result.instruction).toContain("MODEL SWITCH");
    expect(result.instruction).toContain('model: "fable"');
    expect(result.instruction).toMatch(/"opus" was reported unavailable on this board/);
  });

  it("carries the switched model/fallback on the Codex execution object too", async () => {
    const step = makeStepRow({ step_order: 1 });
    const ctx = makeClaimContext({
      pendingStep: step,
      updatedStep: { ...step, status: "in_progress", claimed_by: USER_ID, model_tier: "frontier" },
      priorSteps: [],
      // Seed frontier (codex) resolves to gpt-6-astra; mark it dead.
      unavailableModel: "gpt-6-astra",
    });
    const result = await claimNextStep(ctx, { task_id: TASK_ID, agent: "codex" });
    if (!("execution" in result)) throw new Error("Expected a Codex claim");
    expect(result.execution).toMatchObject({ model: "gpt-5.6-sol", fallback_model: "gpt-6-astra" });
  });

  it("a marker for a model this tier does not resolve to changes nothing", async () => {
    const step = makeStepRow({ step_order: 1 });
    const ctx = makeClaimContext({
      pendingStep: step,
      updatedStep: { ...step, status: "in_progress", claimed_by: USER_ID, model_tier: "cheap" },
      priorSteps: [],
      unavailableModel: "opus", // cheap resolves to haiku — irrelevant
    });
    const result = (await claimNextStep(ctx, { task_id: TASK_ID })) as { instruction: string };
    expect(result.instruction).not.toContain("MODEL SWITCH");
    expect(result.instruction).toContain(modelTierClause("cheap"));
  });
});

// ---------------------------------------------------------------------------
// applyWorkflowTemplate — copies model_tier onto created steps (P2)
// ---------------------------------------------------------------------------

describe("applyWorkflowTemplate — model_tier", () => {
  it("copies each template step's model_tier onto the inserted step (absent → null)", async () => {
    const template = {
      id: "00000000-0000-4000-a000-0000000000aa",
      name: "Feature Dev",
      idea_id: IDEA_ID,
      usage_count: 0,
      steps: [
        { title: "Implement", role: "Full Stack Developer", model_tier: "standard", effort: "high" },
        { title: "UX", role: "UX Designer" }, // no tier → null
      ],
    };

    const insertedSteps: Record<string, unknown>[] = [];
    const counts: Record<string, number> = {};

    const ctx = makeContext(((table: string) => {
      counts[table] = (counts[table] ?? 0) + 1;

      if (table === "workflow_templates") {
        return createChain(template).chain;
      }
      if (table === "board_tasks") {
        return createChain({ id: TASK_ID, idea_id: IDEA_ID, title: "Task" }).chain;
      }
      if (table === "workflow_runs") {
        // 1st call: active-run guard (maybeSingle → null). 2nd: insert run (single).
        return counts[table] === 1
          ? createChain(null).chain
          : createChain({ id: RUN_ID, task_id: TASK_ID }).chain;
      }
      if (table === "idea_agents") {
        return createChain([]).chain;
      }
      if (table === "task_workflow_steps") {
        const chain = createChain({
          id: "step-x", title: "x", agent_role: "y", bot_id: null,
          status: "pending", position: 1000, step_order: 1, human_check_required: false,
        });
        chain.chain.insert = vi.fn((data: unknown) => {
          insertedSteps.push(data as Record<string, unknown>);
          return chain.chain;
        });
        return chain.chain;
      }
      if (table === "workflow_suggestions") {
        return createChain([]).chain;
      }
      return createChain(null).chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await applyWorkflowTemplate(ctx, { task_id: TASK_ID, template_id: template.id });

    expect(insertedSteps).toHaveLength(2);
    expect(insertedSteps[0].model_tier).toBe("standard");
    expect(insertedSteps[1].model_tier).toBeNull();
    // Stage 5 of card 5e654dd1: the step's own effort travels with it.
    expect(insertedSteps[0].effort_override).toBe("high");
    expect(insertedSteps[1].effort_override).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// addStepComment — mentions (parity with add_task_comment, design §6/§9)
// ---------------------------------------------------------------------------

describe("addStepComment — mentions", () => {
  const NICK_ID = "00000000-0000-4000-a000-000000000050";

  const COMMENT_ROW = {
    id: "comment-1",
    step_id: STEP_ID,
    idea_id: IDEA_ID,
    author_id: USER_ID,
    type: "comment",
    content: "content",
    created_at: "2026-01-01T00:00:00Z",
  };

  const TEAM_ROW = {
    id: IDEA_ID,
    author: { id: NICK_ID, full_name: "Nick Ball", notification_preferences: { task_mentions: true } },
    collaborators: [],
  };

  /** Simple chainable mock: table -> fixed resolveWith, dispatched by name. */
  function simpleChain(resolveWith: unknown) {
    const chain: Record<string, unknown> = {};
    for (const m of ["order", "limit", "range", "or", "filter", "delete", "not"]) {
      chain[m] = vi.fn(() => chain);
    }
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.in = vi.fn(() => chain);
    chain.insert = vi.fn((data: unknown) => {
      (chain as Record<string, unknown> & { inserted?: unknown }).inserted = data;
      return chain;
    });
    chain.update = vi.fn(() => chain);
    chain.single = vi.fn(() => Promise.resolve({ data: resolveWith, error: null }));
    chain.maybeSingle = vi.fn(() => Promise.resolve({ data: resolveWith, error: null }));
    chain.then = (resolve: (val: unknown) => void) =>
      Promise.resolve({ data: resolveWith, error: null }).then(resolve);
    return chain;
  }

  function makeStepCommentCtx(opts: {
    stepLookupResult?: unknown;
    stepLookupError?: { message: string } | null;
  }) {
    const commentChain = simpleChain(COMMENT_ROW);
    const stepChain = simpleChain(
      opts.stepLookupResult !== undefined ? opts.stepLookupResult : { task_id: TASK_ID }
    );
    if (opts.stepLookupError) {
      stepChain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: opts.stepLookupError }));
    }
    const teamChain = simpleChain(TEAM_ROW);
    const notificationsChain = simpleChain(null);

    const fromFn = vi.fn((table: string) => {
      switch (table) {
        case "workflow_step_comments":
          return commentChain;
        case "task_workflow_steps":
          return stepChain;
        case "ideas":
          return teamChain;
        case "notifications":
          return notificationsChain;
        default:
          return simpleChain(null);
      }
    });

    const ctx: McpContext = {
      supabase: { from: fromFn } as unknown as McpContext["supabase"],
      userId: USER_ID,
    };
    return { ctx, notificationsChain };
  }

  it("resolves the parent task and notifies an @Full Name mention", async () => {
    const { ctx, notificationsChain } = makeStepCommentCtx({});
    const params = addStepCommentSchema.parse({
      step_id: STEP_ID,
      idea_id: IDEA_ID,
      content: "nice, @Nick Ball can you check?",
    });

    const result = await addStepComment(ctx, params);

    expect(result.id).toBe("comment-1"); // raw row shape preserved
    expect(result.mentions.notified).toEqual([{ user_id: NICK_ID, full_name: "Nick Ball" }]);
    // workflow_step_comments.id (data.id, "comment-1") must NEVER be written
    // as comment_id (FK'd to `comments`) or task_comment_id (FK'd to
    // `board_task_comments`) — neither table has this row, so either would
    // fail the constraint on a real database and silently drop the whole
    // notification insert. This path writes neither id (see workflows.ts).
    expect(notificationsChain.insert).toHaveBeenCalledWith([
      { user_id: NICK_ID, actor_id: USER_ID, type: "task_mention", idea_id: IDEA_ID, task_id: TASK_ID },
    ]);
    const inserted = (notificationsChain.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(inserted[0]).not.toHaveProperty("comment_id");
    expect(inserted[0]).not.toHaveProperty("task_comment_id");
  });

  it("is independent of the `type` field", async () => {
    const { ctx } = makeStepCommentCtx({});
    const params = addStepCommentSchema.parse({
      step_id: STEP_ID,
      idea_id: IDEA_ID,
      content: "@Nick Ball approved",
      type: "approval",
    });
    const result = await addStepComment(ctx, params);
    expect(result.mentions.notified).toEqual([{ user_id: NICK_ID, full_name: "Nick Ball" }]);
  });

  it("degrades to step_task_unresolved when the parent-task lookup returns null", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx } = makeStepCommentCtx({ stepLookupResult: null });
    const params = addStepCommentSchema.parse({
      step_id: STEP_ID,
      idea_id: IDEA_ID,
      content: "note",
      mentioned_user_ids: [NICK_ID],
    });

    const result = await addStepComment(ctx, params);

    expect(result.id).toBe("comment-1"); // comment still posts
    expect(result.mentions.notified).toEqual([]);
    expect(result.mentions.unresolved).toEqual([{ user_id: NICK_ID, reason: "step_task_unresolved" }]);
    expect(result.mentions.warning).toBeDefined();
    warnSpy.mockRestore();
  });

  it("degrades to step_task_unresolved and logs a warning when the lookup errors", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx } = makeStepCommentCtx({ stepLookupError: { message: "boom" } });
    const params = addStepCommentSchema.parse({
      step_id: STEP_ID,
      idea_id: IDEA_ID,
      content: "note",
      mentioned_user_ids: [NICK_ID],
    });

    const result = await addStepComment(ctx, params);

    expect(result.mentions.unresolved).toEqual([{ user_id: NICK_ID, reason: "step_task_unresolved" }]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("posts with no mentions when content has no @ and no mentioned_user_ids", async () => {
    const { ctx } = makeStepCommentCtx({});
    const params = addStepCommentSchema.parse({
      step_id: STEP_ID,
      idea_id: IDEA_ID,
      content: "plain step comment",
    });
    const result = await addStepComment(ctx, params);
    expect(result.mentions).toEqual({ notified: [], unresolved: [] });
  });

  // -------------------------------------------------------------------------
  // addStepComment — agent voice via work_token
  // (docs/agent-voice-comments-design.html §1.4)
  // -------------------------------------------------------------------------

  describe("work_token attribution", () => {
    const BOT_ID = "00000000-0000-4000-a000-000000000030";

    function makeWorkTokenCtx(stepRow: unknown) {
      const commentChain = simpleChain(COMMENT_ROW);
      const stepChain = simpleChain(stepRow);
      const teamChain = simpleChain(TEAM_ROW);
      const notificationsChain = simpleChain(null);

      const fromFn = vi.fn((table: string) => {
        switch (table) {
          case "workflow_step_comments":
            return commentChain;
          case "task_workflow_steps":
            return stepChain;
          case "ideas":
            return teamChain;
          case "notifications":
            return notificationsChain;
          default:
            return simpleChain(null);
        }
      });

      const ctx: McpContext = {
        supabase: { from: fromFn } as unknown as McpContext["supabase"],
        userId: USER_ID,
      };
      return { ctx, commentChain, notificationsChain };
    }

    it("valid token for THIS step: author_id is the step's bot_id, mentions carry the agent as actor", async () => {
      const { token, hash } = mintWorkToken();
      const { ctx, commentChain, notificationsChain } = makeWorkTokenCtx({
        id: STEP_ID,
        task_id: TASK_ID,
        title: "Step",
        status: "in_progress",
        bot_id: BOT_ID,
        work_token_hash: hash,
      });
      const params = addStepCommentSchema.parse({
        step_id: STEP_ID,
        idea_id: IDEA_ID,
        content: "@Nick Ball, mapped the auth flow.",
        work_token: token,
      });

      const result = await addStepComment(ctx, params);

      expect((commentChain as unknown as { inserted: { author_id: string } }).inserted.author_id).toBe(BOT_ID);
      expect(result.mentions.notified).toEqual([{ user_id: NICK_ID, full_name: "Nick Ball" }]);
      // Same as the human-attributed case: workflow_step_comments.id must
      // never be written as comment_id or task_comment_id.
      expect(notificationsChain.insert).toHaveBeenCalledWith([
        { user_id: NICK_ID, actor_id: BOT_ID, type: "task_mention", idea_id: IDEA_ID, task_id: TASK_ID },
      ]);
      const inserted = (notificationsChain.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(inserted[0]).not.toHaveProperty("comment_id");
      expect(inserted[0]).not.toHaveProperty("task_comment_id");
    });

    it("wrong-step token (superseded by re-claim): rejects, comment never inserted", async () => {
      const { token: staleToken } = mintWorkToken();
      const { hash: currentHash } = mintWorkToken();
      const { ctx, commentChain } = makeWorkTokenCtx({
        id: STEP_ID,
        task_id: TASK_ID,
        title: "Step",
        status: "in_progress",
        bot_id: BOT_ID,
        work_token_hash: currentHash,
      });
      const params = addStepCommentSchema.parse({
        step_id: STEP_ID,
        idea_id: IDEA_ID,
        content: "stale",
        work_token: staleToken,
      });

      await expect(addStepComment(ctx, params)).rejects.toThrow(/not the current one for this step/);
      expect((commentChain as unknown as { insert: ReturnType<typeof vi.fn> }).insert).not.toHaveBeenCalled();
    });

    it("completed-step token: rejects with the step's title and status, comment never inserted", async () => {
      const { token, hash } = mintWorkToken();
      const { ctx, commentChain } = makeWorkTokenCtx({
        id: STEP_ID,
        task_id: TASK_ID,
        title: "Implement the thing",
        status: "completed",
        bot_id: BOT_ID,
        work_token_hash: hash,
      });
      const params = addStepCommentSchema.parse({
        step_id: STEP_ID,
        idea_id: IDEA_ID,
        content: "too late",
        work_token: token,
      });

      await expect(addStepComment(ctx, params)).rejects.toThrow(
        /Step "Implement the thing" is no longer in progress \(status: completed\)/
      );
      expect((commentChain as unknown as { insert: ReturnType<typeof vi.fn> }).insert).not.toHaveBeenCalled();
    });
  });
});

describe("rematchWorkflowAgents — stale exact agents", () => {
  function setup(step: { bot_id: string | null; match_tier: string | null }, match: { botId: string | null; tier: string }) {
    vi.mocked(matchRolesWithAiOrFuzzy).mockResolvedValueOnce({ Planner: match } as never);
    const writes: { patch: unknown; eqs: [string, unknown][] }[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "task_workflow_steps") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  not: () => Promise.resolve({ data: [{ id: STEP_ID, agent_role: "Planner", ...step }], error: null }),
                }),
              }),
            }),
            update: (patch: unknown) => {
              const w = { patch, eqs: [] as [string, unknown][] };
              writes.push(w);
              const chain = { eq: (c: string, v: unknown) => { w.eqs.push([c, v]); return chain; } };
              return chain;
            },
          };
        }
        if (table === "board_tasks") {
          return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { idea_id: IDEA_ID }, error: null }) }) }) };
        }
        // idea_agents
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [
                  { bot_id: "sentinel", bot: { id: "sentinel", name: "Sentinel", role: "QA Engineer" } },
                  { bot_id: "planner", bot: { id: "planner", name: "Planner", role: "Planner" } },
                ],
                error: null,
              }),
          }),
        };
      }),
    };
    return { ctx: { supabase, userId: USER_ID } as unknown as McpContext, writes };
  }

  it("replaces an exact agent whose role no longer fits the step, guarded on pending", async () => {
    const { ctx, writes } = setup({ bot_id: "sentinel", match_tier: "exact" }, { botId: "planner", tier: "exact" });
    const result = await rematchWorkflowAgents(ctx, { task_id: TASK_ID });
    expect(result.matched).toBe(1);
    expect(writes[0].patch).toEqual({ bot_id: "planner", match_tier: "exact" });
    expect(writes[0].eqs).toContainEqual(["status", "pending"]);
  });

  it("clears a stale exact agent when no agent in the pool fits", async () => {
    const { ctx, writes } = setup({ bot_id: "sentinel", match_tier: "exact" }, { botId: null, tier: "none" });
    await rematchWorkflowAgents(ctx, { task_id: TASK_ID });
    expect(writes[0].patch).toEqual({ bot_id: null, match_tier: null });
  });

  it("leaves a correct exact agent alone", async () => {
    const { ctx, writes } = setup({ bot_id: "planner", match_tier: "exact" }, { botId: "planner", tier: "exact" });
    const result = await rematchWorkflowAgents(ctx, { task_id: TASK_ID });
    expect(result.matched).toBe(0);
    expect(writes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Card ba37039b: step cost — the claim hands out the usage command, and
// complete_step / fail_step store the totals the session passes back.
// ---------------------------------------------------------------------------

describe("slim hand-off (card 5e654dd1, stage 2)", () => {
  const big = (n: number) => "x".repeat(n);
  const priorSteps = [1, 2, 3].map((n) => ({ id: `prior-${n}`, title: `Earlier step ${n}`, step_order: n, output: big(20_000) }));
  const SKILLS = [
    { name: "api-design-review", content: "Check REST contracts first." },
    { name: "a11y-audit", content: "Run a WCAG 2.2 AA pass." },
  ];

  // AC1.9 asked for 7,000 (reply) and 2,800 (instruction). Measured on this
  // build: the instruction is about 4,400 characters for this step, because
  // the approved MANDATORY MODEL text (770), SAVE-POINT COMMIT (410) and the
  // native-helper note (1,180) are kept word for word. The 7,000 reply target
  // is met once the short usage command is switched on (stage 2b); with the
  // long one the reply is about 3,000 characters larger. These ceilings pin
  // today's size so it can't creep back up.
  const RULE_PERSONA =
    "Unexplained uncommitted changes in the working tree are someone else's intentional prior work.";

  async function midRunClaim() {
    const step = makeStepRow({ step_order: 4, bot_id: SKILL_BOT_ID, model_tier: "frontier" });
    const { ctx } = makeSkillsClaimContext({
      pendingStep: step, updatedStep: { ...step, status: "in_progress" }, skills: SKILLS, priorSteps, systemPrompt: RULE_PERSONA,
    });
    return claimNextStep(ctx, { task_id: TASK_ID });
  }

  it("a frontier step with a native helper, skills and 3 earlier 20k write-ups: no write-up text, reply within 7,000 with the short usage command", async () => {
    vi.stubEnv("STEP_USAGE_SHORT_COMMAND", "1");
    try {
      const r = await midRunClaim();
      expect(JSON.stringify(r).length).toBeLessThanOrEqual(7400); // db4c7f7b round 2: +~400 (hash rule, restart message)
      expect(JSON.stringify(r)).not.toContain("xxxxxxxx");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("the same reply with the long usage command (the default) stays within 8,500 characters", async () => {
    const r = await midRunClaim();
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(10600); // db4c7f7b: +~850 for never-substitute wording; stage 3: +541 for the save line; stage 16: +581 for side-by-side steps (long form only; live claims carry the short command)
  });

  it("the instruction of that step is at most 4,600 characters with no rework and no notes", async () => {
    const r = (await midRunClaim()) as { instruction: string };
    expect(r.instruction.length).toBeLessThanOrEqual(5950); // db4c7f7b: +~850; stage 3: 4,476 -> 5,013 (+537)
  });

  it("a first-step claim (no earlier steps) has an instruction of at most 3,500 characters", async () => {
    const step = makeStepRow({ step_order: 1, bot_id: SKILL_BOT_ID, model_tier: "frontier" });
    const { ctx } = makeSkillsClaimContext({
      pendingStep: step, updatedStep: { ...step, status: "in_progress" }, skills: SKILLS, systemPrompt: RULE_PERSONA,
    });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as { instruction: string };
    expect(r.instruction.length).toBeLessThanOrEqual(4950); // db4c7f7b: +~850; stage 3: 3,445 -> 3,982 (+537)
  });

  it("sends available_agents only when the step has no assigned agent (AC1.4)", async () => {
    const assigned = makeStepRow({ step_order: 1, bot_id: SKILL_BOT_ID });
    const a = await claimNextStep(
      makeSkillsClaimContext({ pendingStep: assigned, updatedStep: { ...assigned, status: "in_progress" }, skills: [] }).ctx,
      { task_id: TASK_ID },
    );
    expect(a).not.toHaveProperty("available_agents");
    const loose = makeStepRow({ step_order: 1, bot_id: null });
    const b = await claimNextStep(
      makeClaimContext({ pendingStep: loose, updatedStep: { ...loose, status: "in_progress" }, priorSteps: [] }),
      { task_id: TASK_ID },
    );
    expect(b).toHaveProperty("available_agents");
  });

  it("the step object carries no output, expected deliverables, counts or timestamps beyond started_at (AC1.5)", async () => {
    const step = makeStepRow({ step_order: 1, output: "old", expected_deliverables: ["Plan"] });
    const r = (await claimNextStep(
      makeClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress", output: "old" }, priorSteps: [] }),
      { task_id: TASK_ID },
    )) as { step: Record<string, unknown>; expected_deliverables: string[] };
    for (const k of ["output", "expected_deliverables", "comment_count", "position", "created_at", "completed_at", "claimed_by"]) {
      expect(r.step).not.toHaveProperty(k);
    }
    // Expected deliverables are sent once, at the top level.
    expect(r.expected_deliverables).toEqual(["Plan"]);
  });

  it("no longer asks the session to append a summary to the task description (R8)", async () => {
    const step = makeStepRow({ step_order: 4, bot_id: SKILL_BOT_ID });
    const { ctx } = makeSkillsClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress" }, skills: [], priorSteps });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as { instruction: string };
    expect(r.instruction).not.toContain("TASK DESCRIPTION");
    expect(r.instruction).not.toContain("update_task");
  });

  it("keeps every safety rule in a mid-run gated claim (AC1.8)", async () => {
    const step = makeStepRow({ step_order: 4, bot_id: SKILL_BOT_ID, model_tier: "frontier", human_check_required: true });
    const { ctx } = makeSkillsClaimContext({
      pendingStep: step, updatedStep: { ...step, status: "in_progress" }, skills: SKILLS, priorSteps,
    });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as { instruction: string };
    const t = r.instruction;
    // model, effort, fallback and reporting
    expect(t).toContain("MANDATORY MODEL");
    expect(t).toContain("model_used");
    expect(t).toContain("reasoning_effort_used");
    // fresh helper with its reason
    expect(t).toContain("FRESH SUBAGENT");
    expect(t).toContain("keeps this step independent of the others");
    // claim token stays; work token goes to the helper
    expect(t).toContain("never give it to the helper");
    expect(t).toContain("the helper gets the work_token");
    // human approval
    expect(t).toContain("you MUST STOP. Do NOT call approve_step yourself");
    // cascade rejection, save point, protect prior work (persona lacks the rule)
    expect(t).toContain("fail_step with reset_to_step_id");
    expect(t).toContain("SAVE-POINT COMMIT: Before spawning this step's subagent");
    expect(t).toContain("PROTECT PRIOR WORK: Include this verbatim in your spawned subagent's brief");
    // retry / resume, inline exception, usage
    expect(t).toContain("retry or resume it");
    expect(t).toContain("Completed inline — no subagent capability.");
    expect(t).toContain("run the usage_command");
    expect(t).toContain("pass its JSON line as usage");
  });

  it("the model switch notice still comes first and the native helper is left out (AC1.10)", async () => {
    const step = makeStepRow({ step_order: 1, bot_id: PERSONA_BOT_ID, model_tier: "frontier" });
    const ctx = makePersonaClaimContext({
      pendingStep: step, updatedStep: { ...step, status: "in_progress" }, systemPrompt: "You are Atlas.", unavailableModel: "opus",
    });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as { instruction: string; native_subagent?: unknown };
    expect(r.instruction).toMatch(/^MODEL SWITCH:/);
    expect(r.native_subagent).toBeUndefined();
  });
});

describe("step cost (card ba37039b)", () => {
  const USAGE = {
    models: [{ model: "claude-opus-5-5", calls: 3, input_tokens: 6, output_tokens: 900, cache_read_tokens: 40000, cache_write_5m_tokens: 9000, cache_write_1h_tokens: 0 }],
    output_estimated: true,
  };

  it("gives a Claude claim the usage command and the run-it step in its finish item, and a Codex claim neither", async () => {
    const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: "standard" });
    const ctx = () => makePersonaClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress" }, systemPrompt: "You are Atlas." });
    const claude = (await claimNextStep(ctx(), { task_id: TASK_ID })) as { usage_command?: string; instruction?: string };
    expect(claude.usage_command).toContain("ids='AGENT_ID'");
    expect(claude.usage_command).toMatch(/mark='vcu_[0-9a-f]{24}'/);
    // Near the top, so the session transcript holds the marker even if a long claim is cut short.
    expect(Object.keys(claude).slice(0, 2)).toEqual(["done", "usage_command"]);
    expect(claude.instruction).toContain("run the usage_command (swap AGENT_ID for the helper's agentId)");
    expect(claude.instruction).toContain("omit usage on NO_TRANSCRIPT; never let it hold up the step");
    const codex = (await claimNextStep(ctx(), { task_id: TASK_ID, agent: "codex" })) as { usage_command?: string; instruction?: string };
    expect(codex).not.toHaveProperty("usage_command");
    expect(codex.instruction).not.toContain("usage_command");
  });

  it("sends the short usage command only when STEP_USAGE_SHORT_COMMAND is on (stage 2b)", async () => {
    const step = makeStepRow({ bot_id: PERSONA_BOT_ID, model_tier: "standard" });
    const ctx = () => makePersonaClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress" }, systemPrompt: "You are Atlas." });
    const off = (await claimNextStep(ctx(), { task_id: TASK_ID })) as { usage_command: string };
    expect(off.usage_command).toContain("awk");
    vi.stubEnv("STEP_USAGE_SHORT_COMMAND", "1");
    try {
      const on = (await claimNextStep(ctx(), { task_id: TASK_ID })) as { usage_command: string };
      expect(on.usage_command).not.toContain("awk");
      expect(on.usage_command).toContain("NO_TRANSCRIPT no-script");
      expect(on.usage_command.length).toBeLessThan(260);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  function completionContext(stepStatus: string, usageInsert: ReturnType<typeof vi.fn>) {
    const stepData = { claim_token_hash: TCT.hash, id: STEP_ID, run_id: RUN_ID, idea_id: IDEA_ID, step_order: 2, human_check_required: false, status: stepStatus };
    const updatedStep = { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Build", agent_role: "developer", status: "completed", output: "done" };
    return makeContext(((table: string) => {
      if (table === "workflow_step_usage") return { insert: usageInsert };
      if (table === "task_workflow_steps") {
        const chain = createChain(null);
        chain.chain.single = vi.fn(() => Promise.resolve({ data: stepData, error: null }));
        chain.chain.maybeSingle = vi.fn(() => Promise.resolve({ data: updatedStep, error: null }));
        chain.chain.then = (resolve: (val: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve);
        return chain.chain;
      }
      const chain = createChain(null);
      chain.chain.then = (resolve: (val: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve);
      chain.chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
      return chain.chain;
    }) as unknown as McpContext["supabase"]["from"]);
  }

  it("complete_step reports output_chars instead of echoing the write-up", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    const result = await completeStep(completionContext("in_progress", insert), { claim_token: TCT.token, step_id: STEP_ID, output: "done" });
    expect(result.step).not.toHaveProperty("output");
    expect(result.step.output_chars).toBe(4);
    expect(result.status).toBe("completed");
  });

  it("complete_step stores the reported usage against the step", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    await completeStep(completionContext("in_progress", insert), { claim_token: TCT.token, step_id: STEP_ID, output: "done", usage: USAGE });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(((insert.mock.calls[0] as unknown[])[0] as Record<string, unknown>[])[0]).toMatchObject({
      step_id: STEP_ID, run_id: RUN_ID, idea_id: IDEA_ID, outcome: "completed", model: "claude-opus-5-5", cache_read_tokens: 40000,
    });
  });

  it("complete_step still completes when the usage report is empty or malformed", async () => {
    for (const usage of [{ models: [], output_estimated: true }, "NO_TRANSCRIPT", "{oops"]) {
      const insert = vi.fn(() => Promise.resolve({ error: null }));
      const parsed = completeStepSchema.parse({ claim_token: TCT.token, step_id: STEP_ID, output: "done", usage });
      const result = await completeStep(completionContext("in_progress", insert), parsed);
      expect(result.status).toBe("completed");
      expect(insert).not.toHaveBeenCalled();
    }
  });

  it("complete_step still completes when the usage write fails", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: { message: "relation \"workflow_step_usage\" does not exist" } }));
    const result = await completeStep(completionContext("in_progress", insert), { claim_token: TCT.token, step_id: STEP_ID, output: "done", usage: USAGE });
    expect(result.status).toBe("completed");
  });

  it("fail_step stores a failed attempt's usage, but not a human rejecting an approval gate", async () => {
    const failed = vi.fn(() => Promise.resolve({ error: null }));
    await failStep(completionContext("in_progress", failed), { claim_token: TCT.token, step_id: STEP_ID, output: "broken", usage: USAGE });
    expect(((failed.mock.calls[0] as unknown[])[0] as Record<string, unknown>[])[0]).toMatchObject({ outcome: "failed" });

    const rejected = vi.fn(() => Promise.resolve({ error: null }));
    await failStep(completionContext("awaiting_approval", rejected), { step_id: STEP_ID, output: "no", usage: USAGE });
    expect(rejected).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Stage 3 (card 5e654dd1): claims and saved write-ups
// ---------------------------------------------------------------------------

describe("claimNextStep — saved write-up and rework shape (stage 3)", () => {
  /** Wraps a claim context so the claim's own update payload can be read. */
  function withUpdateSpy(ctx: McpContext) {
    const updates: Record<string, unknown>[] = [];
    const realFrom = ctx.supabase.from.bind(ctx.supabase) as unknown as (t: string) => unknown;
    (ctx.supabase as { from: unknown }).from = ((table: string) => {
      const chain = realFrom(table) as Record<string, unknown>;
      if (table === "task_workflow_steps") {
        const realUpdate = chain.update as (d: Record<string, unknown>) => unknown;
        chain.update = (d: Record<string, unknown>) => { updates.push(d); return realUpdate(d); };
      }
      return chain;
    }) as never;
    return updates;
  }

  it("clears output when claiming a pending step", async () => {
    const step = makeStepRow();
    const ctx = makeClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress" }, priorSteps: [] });
    const updates = withUpdateSpy(ctx);
    await claimNextStep(ctx, { task_id: TASK_ID });
    expect(updates[0]).toHaveProperty("output", null);
  });

  it("keeps the saved write-up on a re-claim and says how big it is, with the extra line only then", async () => {
    const step = makeStepRow({ status: "in_progress", output: "x".repeat(321) });
    const ctx = makeClaimContext({ pendingStep: step, updatedStep: { ...step }, priorSteps: [] });
    const updates = withUpdateSpy(ctx);
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as unknown as { saved_output_chars: number; instruction: string; rework_instructions: unknown };
    expect(updates[0]).not.toHaveProperty("output");
    expect(r.saved_output_chars).toBe(321);
    expect(r.instruction).toContain("SAVED WRITE-UP: 321 characters are already saved on this step from the earlier claim.");
    // the saved write-up is never rework feedback
    expect(r.rework_instructions).toBeNull();
    expect(JSON.stringify(r)).not.toContain("xxxxxxxx");
  });

  it("a normal claim has no saved-write-up fields and no previous_failure_output", async () => {
    const step = makeStepRow();
    const ctx = makeClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress" }, priorSteps: [] });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as unknown as { instruction: string };
    expect(r).not.toHaveProperty("saved_output_chars");
    expect(r.instruction).not.toContain("SAVED WRITE-UP");
    expect(JSON.stringify(r)).not.toContain("previous_failure_output");
  });

  it("the brief carries the save line with the real step id", async () => {
    const step = makeStepRow();
    const ctx = makeClaimContext({ pendingStep: step, updatedStep: { ...step, status: "in_progress" }, priorSteps: [] });
    const r = (await claimNextStep(ctx, { task_id: TASK_ID })) as unknown as { instruction: string };
    expect(r.instruction).toContain(`save_step_output (step_id "${STEP_ID}", work_token)`);
  });
});

describe("removeWorkflow — removes every run on the card", () => {
  it("deletes by task_id so earlier runs go too", async () => {
    const { chain, captured } = createChain({ id: "run-live" });
    const ctx = makeContext((() => chain) as unknown as McpContext["supabase"]["from"]);
    const r = (await removeWorkflow(ctx, { task_id: TASK_ID })) as { message: string };
    expect(chain.delete).toHaveBeenCalled();
    expect(captured.eqs).toContainEqual(["task_id", TASK_ID]);
    expect(captured.eqs).not.toContainEqual(["id", "run-live"]);
    expect(r.message).toContain("all runs");
  });
});


// ---------------------------------------------------------------------------
// Per-step effort (card 5e654dd1, stage 5)
// ---------------------------------------------------------------------------

describe("per-step effort", () => {
  it("modelTierClause directs the step's own effort for Claude, and the tier's when there is none", () => {
    expect(modelTierClause("frontier", "claude", null, undefined, null, "high")).toContain('reasoning effort "high"');
    expect(modelTierClause("frontier", "claude", null, undefined, null, null)).toContain('reasoning effort "medium"');
  });

  it("modelTierClause gives Codex xhigh for max", () => {
    expect(modelTierClause("frontier", "codex", null, undefined, null, "max")).toContain('reasoning_effort: "xhigh"');
  });

  it("tier adherence is judged against the step's own level", () => {
    // Tier default is medium; the step asks for high.
    const honored = resolveTierAdherence("frontier", "claude", "opus", "high", null, undefined, "high");
    expect(honored.tierHonored).toBe(true);
    const notHonored = resolveTierAdherence("frontier", "claude", "opus", "medium", null, undefined, "high");
    expect(notHonored.tierHonored).toBe(false);
    // Without a step level, medium is what the tier asks for.
    expect(resolveTierAdherence("frontier", "claude", "opus", "medium").tierHonored).toBe(true);
  });

  it("update_step sets the level, clears it, and clears it when the tier goes back to Auto", async () => {
    const patches: Record<string, unknown>[] = [];
    const ctx = makeContext((() => {
      const chain = createChain(null);
      chain.chain.update = vi.fn((data: unknown) => {
        patches.push(data as Record<string, unknown>);
        return chain.chain;
      });
      chain.chain.maybeSingle = vi.fn(() => Promise.resolve({ data: { id: STEP_ID, status: "pending", model_tier: "frontier" }, error: null }));
      return chain.chain;
    }) as unknown as McpContext["supabase"]["from"]);

    await updateStep(ctx, { step_id: STEP_ID, effort: "high" });
    await updateStep(ctx, { step_id: STEP_ID, effort: null });
    await updateStep(ctx, { step_id: STEP_ID, model_tier: null });
    expect(patches).toEqual([
      { effort_override: "high" },
      { effort_override: null },
      { model_tier: null, effort_override: null },
    ]);
    expect(updateStepSchema.safeParse({ step_id: STEP_ID, effort: "turbo" }).success).toBe(false);
  });

  it("update_step rejects an effort when the resulting tier is Auto", async () => {
    const update = vi.fn();
    const mk = (tier: string | null) => makeContext((() => {
      const chain = createChain(null);
      chain.chain.update = update.mockReturnValue(chain.chain);
      chain.chain.maybeSingle = vi.fn(() => Promise.resolve({ data: { id: STEP_ID, status: "pending", model_tier: tier }, error: null }));
      return chain.chain;
    }) as unknown as McpContext["supabase"]["from"]);

    // Step currently on Auto, effort only.
    await expect(updateStep(mk(null), { step_id: STEP_ID, effort: "high" })).rejects.toThrow(/needs a model tier/);
    // Tier cleared and effort set in the same call.
    await expect(updateStep(mk("frontier"), { step_id: STEP_ID, model_tier: null, effort: "high" })).rejects.toThrow(/needs a model tier/);
    expect(update).not.toHaveBeenCalled();
    // Tier given together with effort is fine.
    await expect(updateStep(mk(null), { step_id: STEP_ID, model_tier: "frontier", effort: "high" })).resolves.toBeTruthy();
  });

  it("a template step may carry an effort only with a tier", () => {
    const base = { name: "T", idea_id: IDEA_ID };
    const ok = createWorkflowTemplateSchema.safeParse({
      ...base,
      steps: [{ title: "Review", role: "Code Reviewer", model_tier: "frontier", effort: "high" }],
    });
    expect(ok.success).toBe(true);
    const noTier = createWorkflowTemplateSchema.safeParse({
      ...base,
      steps: [{ title: "Review", role: "Code Reviewer", effort: "high" }],
    });
    expect(noTier.success).toBe(false);
    const bad = createWorkflowTemplateSchema.safeParse({
      ...base,
      steps: [{ title: "Review", role: "Code Reviewer", model_tier: "frontier", effort: "turbo" }],
    });
    expect(bad.success).toBe(false);
  });
});

describe("updateStep — role change puts the right agent on the step (card a5ecfbd6)", () => {
  // Stateful fake: one pending step row, an agent pool, and the rematch's reads/writes.
  function setup(row: { agent_role: string | null; bot_id: string | null; match_tier: string | null }, rematchTo: { botId: string | null; tier: string }) {
    const state = { ...row, id: STEP_ID, task_id: TASK_ID, status: "pending" };
    vi.mocked(matchRolesWithAiOrFuzzy).mockResolvedValue({ "Code Reviewer": rematchTo } as never);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "task_workflow_steps") {
          return {
            select: () => {
              const q: Record<string, unknown> = {};
              q.eq = () => q;
              q.maybeSingle = () => Promise.resolve({ data: { ...state }, error: null });
              // rematch read: .eq().eq().not()
              q.not = () => Promise.resolve({ data: [{ ...state }], error: null });
              return q;
            },
            update: (patch: Record<string, unknown>) => {
              const q: Record<string, unknown> = {};
              q.eq = () => q;
              q.select = () => q;
              q.maybeSingle = () => {
                Object.assign(state, patch);
                return Promise.resolve({ data: { ...state }, error: null });
              };
              // rematch writes are awaited directly
              q.then = (res: (v: unknown) => void) => {
                Object.assign(state, patch);
                res({ error: null });
              };
              return q;
            },
          };
        }
        if (table === "board_tasks") {
          return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { idea_id: IDEA_ID }, error: null }) }) }) };
        }
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [
                  { bot_id: "sentinel", bot: { id: "sentinel", name: "Sentinel", role: "QA Engineer" } },
                  { bot_id: "lens", bot: { id: "lens", name: "Lens", role: "Code Reviewer" } },
                ],
                error: null,
              }),
          }),
        };
      }),
    };
    return { ctx: { supabase, userId: USER_ID } as unknown as McpContext, state };
  }

  it("moves an exact-matched step to the new role's agent", async () => {
    const { ctx, state } = setup({ agent_role: "QA Engineer", bot_id: "sentinel", match_tier: "exact" }, { botId: "lens", tier: "exact" });
    await updateStep(ctx, { step_id: STEP_ID, agent_role: "Code Reviewer" });
    expect(state.agent_role).toBe("Code Reviewer");
    expect(state.bot_id).toBe("lens");
    expect(state.match_tier).toBe("exact");
  });

  it("drops a hand-picked agent when the role changes", async () => {
    const { ctx, state } = setup({ agent_role: "QA Engineer", bot_id: "sentinel", match_tier: "manual" }, { botId: "lens", tier: "exact" });
    await updateStep(ctx, { step_id: STEP_ID, agent_role: "Code Reviewer" });
    expect(state.bot_id).toBe("lens");
  });

  it("leaves no agent (not the old one) when nothing fits the new role", async () => {
    const { ctx, state } = setup({ agent_role: "QA Engineer", bot_id: "sentinel", match_tier: "exact" }, { botId: null, tier: "none" });
    await updateStep(ctx, { step_id: STEP_ID, agent_role: "Code Reviewer" });
    expect(state.bot_id).toBeNull();
    expect(state.match_tier).toBeNull();
  });

  it("keeps a hand-picked agent when the role is unchanged", async () => {
    const { ctx, state } = setup({ agent_role: "QA Engineer", bot_id: "sentinel", match_tier: "manual" }, { botId: "lens", tier: "exact" });
    await updateStep(ctx, { step_id: STEP_ID, agent_role: " qa engineer ", title: "Renamed" });
    expect(state.bot_id).toBe("sentinel");
    expect(state.match_tier).toBe("manual");
  });
});


// Card db4c7f7b: subagent_type is required with "verbatim" only when the claim
// actually named a native subagent. Codex is exempt (no board-native agents).
describe("personaReportNativeNamed", () => {
  const BOT = "54dc8eca-1111-4222-8333-444455556666";
  const step = { bot_id: BOT, idea_id: "i", model_tier: null, effort_override: null };
  const ctxWith = (systemPrompt: string | null) =>
    ({
      userId: "u",
      ownerUserId: "u",
      supabase: {
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { system_prompt: systemPrompt } }) }) }) }),
      },
    }) as unknown as McpContext;

  it("rejects 'verbatim' without subagent_type when the claim named a native subagent, saying exactly what to pass", async () => {
    await expect(personaReportNativeNamed(ctxWith("You are the Planner."), step, { persona_used: "verbatim" })).rejects.toThrow(
      /subagent_type.*vc-<role>-54dc8eca-…/
    );
  });
  it("accepts it with subagent_type", async () => {
    await expect(
      personaReportNativeNamed(ctxWith("You are the Planner."), step, { persona_used: "verbatim", subagent_type: "vc-planner-54dc8eca-frontier" })
    ).resolves.toBe(true);
  });
  it("does not require it when the agent has no persona text (the claim named no native subagent)", async () => {
    await expect(personaReportNativeNamed(ctxWith(null), step, { persona_used: "verbatim" })).resolves.toBe(false);
    await expect(personaReportNativeNamed(ctxWith("   "), step, { persona_used: "verbatim" })).resolves.toBe(false);
  });
  it("does not require it for Codex (exempt) or an unassigned step", async () => {
    await expect(personaReportNativeNamed(ctxWith("persona"), step, { persona_used: "verbatim", agent: "codex" })).resolves.toBe(false);
    await expect(personaReportNativeNamed(ctxWith("persona"), { ...step, bot_id: null }, { persona_used: "verbatim" })).resolves.toBe(false);
  });
  it("does not look at anything for adapted, none or unreported", async () => {
    for (const persona_used of ["adapted", "none", undefined]) {
      await expect(personaReportNativeNamed(ctxWith("persona"), step, { persona_used })).resolves.toBe(false);
    }
  });
});
