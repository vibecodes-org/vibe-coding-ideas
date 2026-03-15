import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { getTask, getTaskSchema } from "./board-read";

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
}): McpContext {
  const taskChain = createChain(opts.task ?? makeTask());
  const stepsChain = createChain(opts.steps ?? []);
  const commentsChain = createChain(opts.comments ?? []);
  const activityChain = createChain(opts.activity ?? []);
  const attachmentsChain = createChain(opts.attachments ?? []);

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
// Tests
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

  it("omits workflow_instruction when no workflow steps exist", async () => {
    const ctx = buildContext({ steps: [] });

    const result = await getTask(ctx, params);

    expect(result.workflow_instruction).toBeNull();
  });
});
