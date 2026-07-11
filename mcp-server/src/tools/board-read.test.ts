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
  const params = getTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID });

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
