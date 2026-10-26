import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { getBoard, getBoardSchema, getTask, getTaskSchema } from "./board-read";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-a000-000000000001";
const TASK_ID = "00000000-0000-4000-a000-000000000010";
const IDEA_ID = "00000000-0000-4000-a000-000000000040";

/** Creates a chainable Supabase query mock. */
function createChain(resolveWith: unknown = null) {
  const chain: Record<string, unknown> = {};

  for (const m of ["order", "limit", "range", "or", "filter", "delete"]) {
    chain[m] = vi.fn(() => chain);
  }

  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);

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

  return chain;
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    idea_id: IDEA_ID,
    title: "Test Task",
    description: "A test task",
    column_id: "col-1",
    position: 1000,
    archived: false,
    due_date: null,
    users: { id: USER_ID, full_name: "Test User", email: "test@test.com" },
    board_task_labels: [],
    workflow_step_total: 0,
    workflow_step_completed: 0,
    attachment_count: 0,
    ...overrides,
  };
}

function makeStep(overrides: Record<string, unknown> = {}) {
  return {
    id: "step-1",
    task_id: TASK_ID,
    title: "Step 1",
    status: "pending",
    human_check_required: false,
    position: 0,
    ...overrides,
  };
}

function makeSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: "sug-1",
    label_id: "lbl-1",
    rule_id: "rule-1",
    suggested_template_id: "tmpl-suggested",
    recommended_template_id: "tmpl-recommended",
    source: "ai",
    ai_confidence: 0.62,
    reason: "Task looks like build work but template is discovery.",
    detected_categories: { task: "build", template: "discovery" },
    status: "suggested",
    adjudication_started_at: null,
    ...overrides,
  };
}

/**
 * Build a mock context where `from(table)` returns different chains
 * based on the table name.
 */
function buildContext(opts: {
  task?: Record<string, unknown>;
  steps?: Record<string, unknown>[];
  comments?: unknown[];
  activity?: unknown[];
  attachments?: unknown[];
  suggestions?: unknown[];
  /** Rows returned by getTask's step-level workflow_step_comments query. */
  stepComments?: unknown[];
  /** When true, the step-level comments query resolves with an error (soft-fail path). */
  stepCommentsError?: boolean;
}): McpContext {
  const taskChain = createChain(opts.task ?? makeTask());
  const stepsChain = createChain(opts.steps ?? []);
  const commentsChain = createChain(opts.comments ?? []);
  const activityChain = createChain(opts.activity ?? []);
  const attachmentsChain = createChain(opts.attachments ?? []);
  const suggestionsChain = createChain(opts.suggestions ?? []);
  const stepCommentsChain = createChain(opts.stepComments ?? []);
  if (opts.stepCommentsError) {
    stepCommentsChain.then = (resolve: (val: unknown) => void) =>
      Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve);
  }

  const fromFn = vi.fn((table: string) => {
    switch (table) {
      case "board_tasks":
        return taskChain;
      case "task_workflow_steps":
        return stepsChain;
      case "board_task_comments":
        return commentsChain;
      case "board_task_activity":
        return activityChain;
      case "board_task_attachments":
        return attachmentsChain;
      case "workflow_suggestions":
        return suggestionsChain;
      case "workflow_step_comments":
        return stepCommentsChain;
      default:
        return createChain();
    }
  });

  return {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: USER_ID,
  };
}

// ---------------------------------------------------------------------------
// getBoard — compact response
// ---------------------------------------------------------------------------

function buildBoardContext(opts: {
  columns?: Record<string, unknown>[];
  tasks?: Record<string, unknown>[];
  labels?: Record<string, unknown>[];
}): McpContext {
  const columnsChain = createChain(
    opts.columns ?? [
      { id: "col-1", idea_id: IDEA_ID, title: "To Do", position: 0, is_done_column: false, created_at: "2026-01-01", updated_at: "2026-01-01" },
      { id: "col-2", idea_id: IDEA_ID, title: "Done", position: 1000, is_done_column: true, created_at: "2026-01-01", updated_at: "2026-01-01" },
    ]
  );
  const tasksChain = createChain(
    opts.tasks ?? [
      {
        id: TASK_ID, title: "Test Task", column_id: "col-1", position: 1000,
        due_date: null, archived: false, attachment_count: 0,
        workflow_step_total: 4, workflow_step_completed: 2,
        workflow_step_in_progress: 1, workflow_step_failed: 0, workflow_step_awaiting_approval: 0,
        workflow_active_step_title: null, workflow_active_agent_name: null,
        users: { id: USER_ID, full_name: "Test User" },
        board_task_labels: [{ label_id: "lbl-1", board_labels: { id: "lbl-1", name: "Bug", color: "red" } }],
      },
    ]
  );
  const labelsChain = createChain(opts.labels ?? [{ id: "lbl-1", name: "Bug", color: "red" }]);

  const fromFn = vi.fn((table: string) => {
    switch (table) {
      case "board_columns": return columnsChain;
      case "board_tasks": return tasksChain;
      case "board_labels": return labelsChain;
      default: return createChain();
    }
  });

  return {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: USER_ID,
  };
}

describe("getBoard — compact response format", () => {
  const params = getBoardSchema.parse({ idea_id: IDEA_ID });

  it("returns compact task summaries without position, created_at, updated_at", async () => {
    const ctx = buildBoardContext({});
    const result = await getBoard(ctx, params);

    const col = result.columns[0];
    expect(col).not.toHaveProperty("created_at");
    expect(col).not.toHaveProperty("updated_at");
    expect(col).not.toHaveProperty("position");
    expect(col).toHaveProperty("id");
    expect(col).toHaveProperty("title");

    const task = col.tasks[0];
    expect(task).not.toHaveProperty("position");
    expect(task).not.toHaveProperty("archived");
    expect(task).toHaveProperty("id");
    expect(task).toHaveProperty("title");
  });

  it("uses assignee name string instead of object", async () => {
    const ctx = buildBoardContext({});
    const result = await getBoard(ctx, params);

    expect(result.columns[0].tasks[0].assignee).toBe("Test User");
  });

  it("uses label name strings instead of full objects", async () => {
    const ctx = buildBoardContext({});
    const result = await getBoard(ctx, params);

    expect(result.columns[0].tasks[0].labels).toEqual(["Bug"]);
  });

  it("returns label names array instead of full objects at top level", async () => {
    const ctx = buildBoardContext({});
    const result = await getBoard(ctx, params);

    expect(result.labels).toEqual(["Bug"]);
  });

  it("omits null/zero fields from task summaries", async () => {
    const ctx = buildBoardContext({
      tasks: [{
        id: TASK_ID, title: "Bare Task", column_id: "col-1", position: 1000,
        due_date: null, archived: false, attachment_count: 0,
        workflow_step_total: 0, workflow_step_completed: 0,
        workflow_step_in_progress: 0, workflow_step_failed: 0, workflow_step_awaiting_approval: 0,
        workflow_active_step_title: null, workflow_active_agent_name: null,
        users: null,
        board_task_labels: [],
      }],
    });
    const result = await getBoard(ctx, params);

    const task = result.columns[0].tasks[0];
    expect(task).not.toHaveProperty("assignee");
    expect(task).not.toHaveProperty("due_date");
    expect(task).not.toHaveProperty("labels");
    expect(task).not.toHaveProperty("workflow");
    expect(task).not.toHaveProperty("attachments");
  });

  it("includes compact workflow summary string", async () => {
    const ctx = buildBoardContext({});
    const result = await getBoard(ctx, params);

    expect(result.columns[0].tasks[0].workflow).toBe("2/4 done, 1 in progress");
  });

  it("orders tasks by position then id, so ties (e.g. two tasks both moved to position 0) resolve deterministically", async () => {
    const ctx = buildBoardContext({});
    await getBoard(ctx, params);

    const fromFn = ctx.supabase.from as unknown as (table: string) => Record<string, unknown>;
    const tasksChain = fromFn("board_tasks");
    const orderCalls = (tasksChain.order as ReturnType<typeof vi.fn>).mock.calls;
    expect(orderCalls).toContainEqual(["position"]);
    expect(orderCalls).toContainEqual(["id"]);
    // "id" must be the secondary key, applied after "position".
    const positionIdx = orderCalls.findIndex((c: unknown[]) => c[0] === "position");
    const idIdx = orderCalls.findIndex((c: unknown[]) => c[0] === "id");
    expect(idIdx).toBeGreaterThan(positionIdx);
  });
});

// ---------------------------------------------------------------------------
// getTask — workflow_instruction
// ---------------------------------------------------------------------------

describe("getTask — workflow_instruction", () => {
  const params = getTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID });

  it("includes workflow_instruction when task has pending workflow steps", async () => {
    const ctx = buildContext({
      steps: [
        makeStep({ status: "pending" }),
        makeStep({ id: "step-2", status: "pending" }),
        makeStep({ id: "step-3", status: "completed" }),
      ],
    });

    const result = await getTask(ctx, params);

    expect(result.workflow_instruction).not.toBeNull();
    expect(result.workflow_instruction).toContain("claim_next_step");
    expect(result.workflow_instruction).toContain("3 steps");
    expect(result.workflow_instruction).toContain("2 pending");
  });

  it("says the workflow has stopped when the next open step is failed (pending steps after it)", async () => {
    const ctx = buildContext({
      steps: [
        makeStep({ id: "s1", status: "completed", step_order: 1 }),
        makeStep({ id: "s2", status: "completed", step_order: 2 }),
        makeStep({ id: "s3", title: "Build", status: "failed", step_order: 3 }),
        makeStep({ id: "s4", status: "pending", step_order: 4 }),
      ],
    });

    const result = await getTask(ctx, params);

    expect(result.workflow_instruction).toContain("has stopped");
    expect(result.workflow_instruction).toContain("step 3");
    expect(result.workflow_instruction).not.toContain("Use claim_next_step");
  });

  it("says the workflow has stopped when the failed step is the last open one", async () => {
    const ctx = buildContext({
      steps: [
        makeStep({ id: "s1", status: "completed", step_order: 1 }),
        makeStep({ id: "s2", status: "failed", step_order: 2 }),
      ],
    });

    const result = await getTask(ctx, params);

    expect(result.workflow_instruction).toContain("has stopped");
  });

  it("omits workflow_instruction when all steps are completed", async () => {
    const ctx = buildContext({
      steps: [
        makeStep({ status: "completed" }),
        makeStep({ id: "step-2", status: "completed" }),
      ],
    });

    const result = await getTask(ctx, params);

    expect(result.workflow_instruction).toBeNull();
  });

  it("mentions human approval when approval gates exist", async () => {
    const ctx = buildContext({
      steps: [
        makeStep({ status: "pending", human_check_required: true }),
        makeStep({ id: "step-2", status: "pending" }),
      ],
    });

    const result = await getTask(ctx, params);

    expect(result.workflow_instruction).toContain("human approval");
  });

  it("does not mention human approval when all gated steps are completed/skipped", async () => {
    const ctx = buildContext({
      steps: [
        makeStep({ status: "completed", human_check_required: true }),
        makeStep({ id: "step-2", status: "pending", human_check_required: false }),
      ],
    });

    const result = await getTask(ctx, params);

    expect(result.workflow_instruction).not.toBeNull();
    expect(result.workflow_instruction).not.toContain("human approval");
  });

  it("includes self-assign instruction when no workflow steps exist", async () => {
    const ctx = buildContext({ steps: [] });

    const result = await getTask(ctx, params);

    expect(result.workflow_instruction).not.toBeNull();
    expect(result.workflow_instruction).toContain("update_task");
    expect(result.workflow_instruction).toContain("assignee_id");
  });
});

// ---------------------------------------------------------------------------
// getTask — workflow_suggestions (FR-1, AC-19/AC-20)
// ---------------------------------------------------------------------------

describe("getTask — workflow_suggestions", () => {
  const params = getTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID });

  it("AC-19: returns workflow_suggestions array with full fields when an open suggestion exists", async () => {
    const ctx = buildContext({ steps: [], suggestions: [makeSuggestion()] });

    const result = await getTask(ctx, params);

    expect(result.workflow_suggestions).toHaveLength(1);
    expect(result.workflow_suggestions[0]).toEqual({
      suggestion_id: "sug-1",
      label_id: "lbl-1",
      rule_id: "rule-1",
      suggested_template_id: "tmpl-suggested",
      recommended_template_id: "tmpl-recommended",
      source: "ai",
      ai_confidence: 0.62,
      reason: "Task looks like build work but template is discovery.",
      detected_categories: { task: "build", template: "discovery" },
      status: "suggested",
      adjudication_started_at: null,
    });
  });

  it("returns an empty workflow_suggestions array when none exist", async () => {
    const ctx = buildContext({ steps: [], suggestions: [] });

    const result = await getTask(ctx, params);

    expect(result.workflow_suggestions).toEqual([]);
  });

  it("AC-20: emits suggestion-aware instruction (not self-assign) when an open suggestion exists with no steps", async () => {
    const ctx = buildContext({ steps: [], suggestions: [makeSuggestion()] });

    const result = await getTask(ctx, params);

    expect(result.workflow_instruction).not.toBeNull();
    expect(result.workflow_instruction).toContain("unresolved workflow suggestion");
    expect(result.workflow_instruction).toContain("Do NOT begin work");
    expect(result.workflow_instruction).toContain("Keep / Replace / Remove");
    // Suppresses the self-assign directive
    expect(result.workflow_instruction).not.toContain("update_task");
    expect(result.workflow_instruction).not.toContain("assignee_id");
  });

  it("does not affect workflow_step_total — a suggestion is not a step", async () => {
    const ctx = buildContext({
      task: makeTask({ workflow_step_total: 0 }),
      steps: [],
      suggestions: [makeSuggestion()],
    });

    const result = await getTask(ctx, params);

    expect(result.workflow_step_total).toBe(0);
    expect(result.workflow_steps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getTask — step-level comments (Step-Level Comments API)
// ---------------------------------------------------------------------------

describe("getTask — step-level comments", () => {
  // The complete shape (every step with its comments) is what `full: true` returns.
  const params = getTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID, full: true });

  it("attaches comments: [] and comments_truncated: false to a step with no comments", async () => {
    const ctx = buildContext({ steps: [makeStep({ id: "step-1" })], stepComments: [] });

    const result = await getTask(ctx, params);

    const step = result.workflow_steps[0] as Record<string, unknown>;
    expect(step.comments).toEqual([]);
    expect(step.comments_truncated).toBe(false);
  });

  it("shapes and attaches step comment rows, flattening the users join", async () => {
    const ctx = buildContext({
      steps: [makeStep({ id: "step-1" })],
      stepComments: [
        {
          id: "c1",
          step_id: "step-1",
          type: "comment",
          content: "Heads-up: watch out for the reload edge case.",
          author_id: "author-1",
          created_at: "2026-07-10T16:42:11Z",
          users: { full_name: "Priya" },
        },
      ],
    });

    const result = await getTask(ctx, params);

    const step = result.workflow_steps[0] as Record<string, unknown>;
    expect(step.comments).toEqual([
      {
        id: "c1",
        type: "comment",
        content: "Heads-up: watch out for the reload edge case.",
        author_id: "author-1",
        author_name: "Priya",
        created_at: "2026-07-10T16:42:11Z",
      },
    ]);
  });

  it("soft-fails to comments: [] / comments_truncated: false when the query errors", async () => {
    const ctx = buildContext({
      steps: [makeStep({ id: "step-1" })],
      stepCommentsError: true,
    });

    const result = await getTask(ctx, params);

    const step = result.workflow_steps[0] as Record<string, unknown>;
    expect(step.comments).toEqual([]);
    expect(step.comments_truncated).toBe(false);
  });

  it("does not query workflow_step_comments when there are no steps", async () => {
    const ctx = buildContext({ steps: [] });

    await getTask(ctx, params);

    const calls = (ctx.supabase.from as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some((c) => c[0] === "workflow_step_comments")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getTask - lean default, step_ids and full (card 5e654dd1, R3)
// ---------------------------------------------------------------------------

describe("getTask - lean default", () => {
  const lean = getTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID });
  const RUN_A = "run-a";
  const RUN_B = "run-b";
  const sid = (n: number) => `00000000-0000-4000-a000-0000000001${String(n).padStart(2, "0")}`;

  const runSteps = () => [
    makeStep({ id: sid(1), run_id: RUN_A, status: "completed", position: 0, step_order: 0, output: "a".repeat(1000), claim_token_hash: "h1", work_token_hash: "h2", completed_at: "2026-10-01T00:00:00Z" }),
    makeStep({ id: sid(2), run_id: RUN_B, status: "completed", position: 1, step_order: 0, output: "b".repeat(500), completed_at: "2026-10-02T00:00:00Z" }),
    makeStep({ id: sid(3), run_id: RUN_B, status: "in_progress", position: 2, step_order: 1, description: "Build it", output: null, claim_token_hash: "h3" }),
    makeStep({ id: sid(4), run_id: RUN_B, status: "pending", position: 3, step_order: 2, description: "Later", output: null }),
  ];

  it("returns only the current run, with a short line per step and no write-ups or hashes", async () => {
    const ctx = buildContext({ steps: runSteps() });
    const result = (await getTask(ctx, lean)) as unknown as Record<string, unknown>;
    const steps = result.workflow_steps as Array<Record<string, unknown>>;

    expect(steps.map((s) => s.id)).toEqual([sid(2), sid(3), sid(4)]);
    expect(result.earlier_runs).toBe(1);
    expect(steps[0].output_chars).toBe(500);
    for (const s of steps) {
      expect(s).not.toHaveProperty("output");
      expect(s).not.toHaveProperty("claim_token_hash");
      expect(s).not.toHaveProperty("work_token_hash");
    }
    expect(JSON.stringify(result)).not.toContain("bbbbbbbb");
  });

  it("gives the running step its description and latest comments, but not the pending one", async () => {
    const ctx = buildContext({
      steps: runSteps(),
      stepComments: Array.from({ length: 7 }, (_, i) => ({
        id: `c${i}`, step_id: sid(3), type: "comment", content: `note ${i}`,
        author_id: "u", created_at: `2026-10-0${i + 1}T00:00:00Z`, users: { full_name: "N" },
      })),
    });
    const result = (await getTask(ctx, lean)) as unknown as Record<string, unknown>;
    const steps = result.workflow_steps as Array<Record<string, unknown>>;
    const running = steps.find((s) => s.id === sid(3))!;
    const pending = steps.find((s) => s.id === sid(4))!;

    expect(running.description).toBe("Build it");
    expect((running.comments as unknown[]).length).toBe(5);
    expect(running.comment_count).toBe(7);
    expect(running.comments_truncated).toBe(true);
    expect(pending).not.toHaveProperty("description");
    expect(pending).not.toHaveProperty("comments");
  });

  it("picks the most recently finished run when nothing is left to do", async () => {
    const steps = runSteps().map((s) => ({ ...s, status: "completed" }));
    const result = (await getTask(buildContext({ steps }), lean)) as unknown as Record<string, unknown>;
    expect((result.workflow_steps as unknown[]).length).toBe(3);
    expect(result.earlier_runs).toBe(1);
  });

  it("prefers the newer running run over an abandoned older run with failed and pending steps at the same step numbers", async () => {
    const old = (n: number, status: string, order: number) =>
      makeStep({ id: sid(n), run_id: RUN_A, status, position: order, step_order: order, created_at: "2026-09-01T00:00:00Z" });
    const live = (n: number, status: string, order: number) =>
      makeStep({ id: sid(n), run_id: RUN_B, status, position: order, step_order: order, created_at: "2026-10-01T00:00:00Z" });
    const steps = [
      old(1, "completed", 1),
      old(2, "failed", 2),
      old(3, "pending", 3),
      old(4, "pending", 4),
      live(5, "completed", 1),
      live(6, "in_progress", 2),
      live(7, "pending", 3),
      live(8, "pending", 4),
    ];
    // Same result whichever order the database hands the rows back in.
    for (const rows of [steps, [...steps].reverse()]) {
      const result = (await getTask(buildContext({ steps: rows }), lean)) as unknown as Record<string, unknown>;
      const ids = (result.workflow_steps as Array<Record<string, unknown>>).map((s) => s.id).sort();
      expect(ids).toEqual([sid(5), sid(6), sid(7), sid(8)]);
      expect(result.earlier_runs).toBe(1);
    }
  });

  it("always uses the newest run, even when an older run has unfinished leftovers", async () => {
    const steps = [
      makeStep({ id: sid(1), run_id: RUN_A, status: "failed", position: 0, step_order: 0, created_at: "2026-09-01T00:00:00Z" }),
      makeStep({ id: sid(2), run_id: RUN_B, status: "completed", position: 1, step_order: 0, created_at: "2026-10-01T00:00:00Z", completed_at: "2026-10-02T00:00:00Z" }),
    ];
    const result = (await getTask(buildContext({ steps }), lean)) as unknown as Record<string, unknown>;
    expect((result.workflow_steps as Array<Record<string, unknown>>).map((s) => s.id)).toEqual([sid(2)]);
    expect(result.earlier_runs).toBe(1);
  });

  it("shows the assignee name only, no email, and leaves out recent activity", async () => {
    const ctx = buildContext({ steps: [] });
    const result = (await getTask(ctx, lean)) as unknown as Record<string, unknown>;
    expect(result.assignee).toEqual({ id: USER_ID, full_name: "Test User" });
    expect(result).not.toHaveProperty("recent_activity");
    const calls = (ctx.supabase.from as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some((c) => c[0] === "board_task_activity")).toBe(false);
  });

  it("reports comments_total and limits card comments to 5", async () => {
    const ctx = buildContext({ steps: [] });
    const result = (await getTask(ctx, lean)) as unknown as Record<string, unknown>;
    expect(result.comments_total).toBe(0);
    const taskCommentsChain = (ctx.supabase.from as unknown as (t: string) => { limit: ReturnType<typeof vi.fn> })("board_task_comments");
    expect(taskCommentsChain.limit).toHaveBeenCalledWith(5);
  });

  it("step_ids returns those steps in full (earlier run included), with up to 20 comments", async () => {
    const ctx = buildContext({ steps: runSteps() });
    const result = (await getTask(
      ctx,
      getTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID, step_ids: [sid(1)] })
    )) as unknown as Record<string, unknown>;
    const steps = result.workflow_steps as Array<Record<string, unknown>>;
    const full = steps.find((s) => s.id === sid(1))!;
    expect(full.output).toBe("a".repeat(1000));
    expect(full).not.toHaveProperty("claim_token_hash");
    expect(steps.find((s) => s.id === sid(2))).not.toHaveProperty("output");
    expect(result).not.toHaveProperty("not_included_step_ids");
  });

  it("step_ids stops at 80,000 characters, keeps at least one, and lists the rest", async () => {
    const big = (n: number, pos: number) =>
      makeStep({ id: sid(n), run_id: RUN_A, status: "completed", position: pos, step_order: pos, output: "x".repeat(50_000) });
    const ctx = buildContext({ steps: [big(1, 0), big(2, 1), big(3, 2)] });
    const result = (await getTask(
      ctx,
      getTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID, step_ids: [sid(1), sid(2), sid(3)] })
    )) as unknown as Record<string, unknown>;
    const withOutput = (result.workflow_steps as Array<Record<string, unknown>>).filter((s) => "output" in s);
    expect(withOutput.map((s) => s.id)).toEqual([sid(1)]);
    expect(result.not_included_step_ids).toEqual([sid(2), sid(3)]);
    expect(String(result.step_ids_note)).toContain("step_ids");
  });

  it("always returns the first requested step even when it alone is over the limit", async () => {
    const ctx = buildContext({
      steps: [makeStep({ id: sid(1), run_id: RUN_A, status: "completed", output: "y".repeat(120_000) })],
    });
    const result = (await getTask(
      ctx,
      getTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID, step_ids: [sid(1)] })
    )) as unknown as Record<string, unknown>;
    expect((result.workflow_steps as Array<Record<string, unknown>>)[0].output).toHaveLength(120_000);
    expect(result).not.toHaveProperty("not_included_step_ids");
  });

  it("rejects a step id that is not on this card", async () => {
    const ctx = buildContext({ steps: runSteps() });
    await expect(
      getTask(ctx, getTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID, step_ids: [sid(99)] }))
    ).rejects.toThrow(/not on task/);
  });

  it("refuses more than 10 step ids", () => {
    const ids = Array.from({ length: 11 }, (_, i) => sid(i));
    expect(() => getTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID, step_ids: ids })).toThrow();
  });

  it("full: true returns every step with its write-up and recent activity, but never the hashes", async () => {
    const ctx = buildContext({ steps: runSteps(), activity: [{ id: "a1", users: { full_name: "X" } }] });
    const result = (await getTask(
      ctx,
      getTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID, full: true })
    )) as unknown as Record<string, unknown>;
    const steps = result.workflow_steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(4);
    expect(steps[0].output).toBe("a".repeat(1000));
    for (const s of steps) {
      expect(s).not.toHaveProperty("claim_token_hash");
      expect(s).not.toHaveProperty("work_token_hash");
    }
    expect((result.recent_activity as unknown[]).length).toBe(1);
  });
});

describe("getBoard — up_next (short look at the queue)", () => {
  const cols = [
    { id: "col-b", idea_id: IDEA_ID, title: "Backlog", position: 0, is_done_column: false },
    { id: "col-t", idea_id: IDEA_ID, title: "To Do", position: 1000, is_done_column: false },
    { id: "col-p", idea_id: IDEA_ID, title: "In Progress", position: 2000, is_done_column: false },
  ];
  const mk = (col: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${col}-${i}`, title: `${col} task ${i}`, column_id: col, position: i * 1000,
      due_date: null, archived: false, attachment_count: 0,
      workflow_step_total: 0, workflow_step_completed: 0, workflow_step_in_progress: 0,
      workflow_step_failed: 0, workflow_step_awaiting_approval: 0,
      users: null, board_task_labels: [],
    }));
  const run = (tasks: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
    getBoard(
      buildBoardContext({ columns: cols, tasks }),
      getBoardSchema.parse({ idea_id: IDEA_ID, ...extra })
    );

  it("without up_next returns every card and no 'more' field", async () => {
    const r = await run([...mk("col-b", 4), ...mk("col-t", 12), ...mk("col-p", 3)]);
    expect(r.columns.map((c) => c.tasks.length)).toEqual([4, 12, 3]);
    for (const c of r.columns) expect(c).not.toHaveProperty("more");
  });

  it("a full To Do gives its top 5, says how many are hidden, and Backlog adds nothing", async () => {
    const r = await run([...mk("col-b", 4), ...mk("col-t", 12), ...mk("col-p", 3)], { up_next: 5 });
    const by = Object.fromEntries(r.columns.map((c) => [c.title, c]));
    expect(Object.keys(by).sort()).toEqual(["Backlog", "To Do"]);
    expect(by["To Do"].tasks.map((t) => t.id)).toEqual(["col-t-0", "col-t-1", "col-t-2", "col-t-3", "col-t-4"]);
    expect(by["To Do"].more).toBe(7);
    expect(by["Backlog"].tasks).toHaveLength(0);
    expect(by["Backlog"].more).toBe(4);
  });

  it("a short To Do is topped up from Backlog to reach 5, never from other columns", async () => {
    const r = await run([...mk("col-b", 4), ...mk("col-t", 3), ...mk("col-p", 3)], { up_next: 5 });
    const by = Object.fromEntries(r.columns.map((c) => [c.title, c]));
    expect(by["To Do"].tasks).toHaveLength(3);
    expect(by["To Do"]).not.toHaveProperty("more");
    expect(by["Backlog"].tasks.map((t) => t.id)).toEqual(["col-b-0", "col-b-1"]);
    expect(by["Backlog"].more).toBe(2);
    expect(r.columns.some((c) => c.title === "In Progress")).toBe(false);
  });
});
