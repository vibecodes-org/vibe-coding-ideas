import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";

const mockCheckAndApplyAutoRules = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../src/lib/workflow-helpers", () => ({
  checkAndApplyAutoRules: (...args: unknown[]) => mockCheckAndApplyAutoRules(...args),
}));

import {
  createTask,
  createTaskSchema,
  updateTask,
  updateTaskSchema,
  moveTask,
  moveTaskSchema,
} from "./board-write";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-a000-000000000001";
const IDEA_ID = "00000000-0000-4000-a000-000000000040";
const COLUMN_ID = "00000000-0000-4000-a000-000000000050";
const TASK_ID = "00000000-0000-4000-a000-000000000010";
const LABEL_BUG_ID = "00000000-0000-4000-a000-000000000098";
const LABEL_FRONTEND_ID = "00000000-0000-4000-a000-000000000099";
const OTHER_USER_ID = "00000000-0000-4000-a000-000000000002";
const COLUMN_A_ID = "00000000-0000-4000-a000-000000000060";
const COLUMN_B_ID = "00000000-0000-4000-a000-000000000061";

/** Creates a chainable Supabase query mock resolving to `resolveWith`. */
function createChain(resolveWith: unknown = null) {
  const chain: Record<string, unknown> = {};

  for (const m of ["order", "limit", "range", "or", "filter", "delete"]) {
    chain[m] = vi.fn(() => chain);
  }

  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.not = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.upsert = vi.fn(() => chain);

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

/** Narrows an untyped chain property mocked via vi.fn() so `.mock.calls` can be asserted. */
function asMock(fn: unknown): ReturnType<typeof vi.fn> {
  return fn as ReturnType<typeof vi.fn>;
}

function makeContext(fromFn: (table: string) => unknown): McpContext {
  return {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: USER_ID,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createTask — add-labels auto-rule adjudication", () => {
  // Regression guard: the MCP route has no after()/waitUntil to schedule
  // post-response work, so checkAndApplyAutoRules must be told to await the
  // AI adjudication (awaitAdjudication: true) for every attached label —
  // otherwise it fires as a bare detached promise that serverless kills once
  // the tool call returns.
  it("awaits AI adjudication (awaitAdjudication: true) for a single attached label", async () => {
    mockCheckAndApplyAutoRules.mockClear();

    const taskChain = createChain({
      id: TASK_ID,
      title: "New Task",
      column_id: COLUMN_ID,
      position: 1000,
    });
    const activityChain = createChain(null);
    const boardLabelsChain = createChain([{ id: LABEL_BUG_ID, name: "bug" }]);
    const taskLabelsChain = createChain(null);

    const fromFn = vi.fn((table: string) => {
      switch (table) {
        case "board_tasks":
          return taskChain;
        case "board_task_activity":
          return activityChain;
        case "board_labels":
          return boardLabelsChain;
        case "board_task_labels":
          return taskLabelsChain;
        default:
          return createChain(null);
      }
    });

    const params = createTaskSchema.parse({
      idea_id: IDEA_ID,
      column_id: COLUMN_ID,
      title: "New Task",
      labels: ["bug"],
    });

    const result = await createTask(makeContext(fromFn), params);

    expect(result.success).toBe(true);
    expect(result.labels).toEqual([{ id: LABEL_BUG_ID, name: "bug" }]);
    expect(mockCheckAndApplyAutoRules).toHaveBeenCalledTimes(1);
    const options = mockCheckAndApplyAutoRules.mock.calls[0][5];
    expect(options.awaitAdjudication).toBe(true);
  });

  it("awaits AI adjudication once per matched label, sequentially", async () => {
    mockCheckAndApplyAutoRules.mockClear();

    const taskChain = createChain({
      id: TASK_ID,
      title: "New Task",
      column_id: COLUMN_ID,
      position: 1000,
    });
    const activityChain = createChain(null);
    const boardLabelsChain = createChain([
      { id: LABEL_BUG_ID, name: "bug" },
      { id: LABEL_FRONTEND_ID, name: "frontend" },
    ]);
    const taskLabelsChain = createChain(null);

    const fromFn = vi.fn((table: string) => {
      switch (table) {
        case "board_tasks":
          return taskChain;
        case "board_task_activity":
          return activityChain;
        case "board_labels":
          return boardLabelsChain;
        case "board_task_labels":
          return taskLabelsChain;
        default:
          return createChain(null);
      }
    });

    const params = createTaskSchema.parse({
      idea_id: IDEA_ID,
      column_id: COLUMN_ID,
      title: "New Task",
      labels: ["bug", "frontend"],
    });

    const result = await createTask(makeContext(fromFn), params);

    expect(result.labels).toHaveLength(2);
    // One call per attached label — each told to await adjudication.
    expect(mockCheckAndApplyAutoRules).toHaveBeenCalledTimes(2);
    for (const call of mockCheckAndApplyAutoRules.mock.calls) {
      expect(call[5].awaitAdjudication).toBe(true);
    }
  });

  it("does not call checkAndApplyAutoRules when no labels are attached", async () => {
    mockCheckAndApplyAutoRules.mockClear();

    const taskChain = createChain({
      id: TASK_ID,
      title: "New Task",
      column_id: COLUMN_ID,
      position: 1000,
    });
    const activityChain = createChain(null);

    const fromFn = vi.fn((table: string) => {
      switch (table) {
        case "board_tasks":
          return taskChain;
        case "board_task_activity":
          return activityChain;
        default:
          return createChain(null);
      }
    });

    const params = createTaskSchema.parse({
      idea_id: IDEA_ID,
      column_id: COLUMN_ID,
      title: "New Task",
    });

    const result = await createTask(makeContext(fromFn), params);

    expect(result.success).toBe(true);
    expect(mockCheckAndApplyAutoRules).not.toHaveBeenCalled();
  });
});

describe("updateTask — assignment optimistic-concurrency guard", () => {
  // Regression guard for the self-assign race: two concurrent updateTask
  // calls both read the same pre-update assignee_id (null), so without a
  // guard both writes would succeed and the last one would silently win.
  it("blocks a stale assignment when the row's assignee_id no longer matches what was read", async () => {
    const readChain = createChain({
      title: "Task",
      description: null,
      assignee_id: null,
      due_date: null,
      archived: false,
    });
    // The guarded UPDATE (.eq/.is on assignee_id) matches no row, because a
    // "concurrent" caller already claimed the task in between.
    const writeChain = createChain(null);

    let boardTasksCalls = 0;
    const fromFn = vi.fn((table: string) => {
      if (table === "board_tasks") {
        boardTasksCalls += 1;
        return boardTasksCalls === 1 ? readChain : writeChain;
      }
      return createChain(null);
    });

    const params = updateTaskSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      assignee_id: USER_ID,
    });

    await expect(updateTask(makeContext(fromFn), params)).rejects.toThrow(
      "This task was already assigned by someone else — refresh and try again."
    );

    // The guard must actually be present on the write, not just a plain update.
    expect(
      asMock(writeChain.is).mock.calls.some(
        (call: unknown[]) => call[0] === "assignee_id" && call[1] === null
      )
    ).toBe(true);
  });

  it("throws a distinct, actionable error — not the generic 'Failed to update task' message", async () => {
    const readChain = createChain({
      title: "Task",
      description: null,
      assignee_id: OTHER_USER_ID,
      due_date: null,
      archived: false,
    });
    const writeChain = createChain(null);

    let boardTasksCalls = 0;
    const fromFn = vi.fn((table: string) => {
      if (table === "board_tasks") {
        boardTasksCalls += 1;
        return boardTasksCalls === 1 ? readChain : writeChain;
      }
      return createChain(null);
    });

    const params = updateTaskSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      assignee_id: USER_ID,
    });

    let caught: Error | null = null;
    try {
      await updateTask(makeContext(fromFn), params);
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught?.message).not.toMatch(/Failed to update task/);
    expect(caught?.message).toMatch(/already assigned by someone else/);
    // Guard used .eq (not .is) since the previously-read assignee_id was non-null.
    expect(
      asMock(writeChain.eq).mock.calls.some(
        (call: unknown[]) => call[0] === "assignee_id" && call[1] === OTHER_USER_ID
      )
    ).toBe(true);
  });

  it("succeeds for ordinary single-caller assignment (no race)", async () => {
    const readChain = createChain({
      title: "Task",
      description: null,
      assignee_id: null,
      due_date: null,
      archived: false,
    });
    const writeChain = createChain({ id: TASK_ID, title: "Task" });
    const activityChain = createChain(null);
    const ideaChain = createChain({ author_id: OTHER_USER_ID });
    const botProfilesChain = createChain(null); // assignee is not a bot -> no working_started_at branch

    let boardTasksCalls = 0;
    const fromFn = vi.fn((table: string) => {
      switch (table) {
        case "board_tasks":
          boardTasksCalls += 1;
          return boardTasksCalls === 1 ? readChain : writeChain;
        case "board_task_activity":
          return activityChain;
        case "ideas":
          return ideaChain;
        case "bot_profiles":
          return botProfilesChain;
        case "collaborators":
          return createChain(null);
        default:
          return createChain(null);
      }
    });

    const params = updateTaskSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      assignee_id: USER_ID,
    });

    const result = await updateTask(makeContext(fromFn), params);

    expect(result.success).toBe(true);
    expect(result.task).toEqual({ id: TASK_ID, title: "Task" });
  });

  it("does not gate the write on assignee_id for an update that doesn't touch assignment", async () => {
    const readChain = createChain({
      title: "Old Title",
      description: null,
      assignee_id: null,
      due_date: null,
      archived: false,
    });
    const writeChain = createChain({ id: TASK_ID, title: "New Title" });
    const activityChain = createChain(null);

    let boardTasksCalls = 0;
    const fromFn = vi.fn((table: string) => {
      switch (table) {
        case "board_tasks":
          boardTasksCalls += 1;
          return boardTasksCalls === 1 ? readChain : writeChain;
        case "board_task_activity":
          return activityChain;
        default:
          return createChain(null);
      }
    });

    const params = updateTaskSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      title: "New Title",
    });

    const result = await updateTask(makeContext(fromFn), params);

    expect(result.success).toBe(true);
    // No assignee_id precondition should be applied to an ordinary field edit.
    expect(asMock(writeChain.is)).not.toHaveBeenCalled();
    expect(
      asMock(writeChain.eq).mock.calls.some((call: unknown[]) => call[0] === "assignee_id")
    ).toBe(false);
  });
});

describe("moveTask — column optimistic-concurrency guard", () => {
  // Regression guard: moveTask previously had no pre-read of the task's
  // current column at all, so a stale move couldn't even be detected.
  it("blocks a stale move when the task's column no longer matches what was read", async () => {
    const readChain = createChain({ column_id: COLUMN_A_ID });
    const columnChain = createChain({ title: "In Progress", is_done_column: false });
    // The guarded UPDATE (.eq on column_id) matches no row: a "concurrent"
    // mover already relocated the task in between.
    const writeChain = createChain(null);

    let boardTasksCalls = 0;
    const fromFn = vi.fn((table: string) => {
      switch (table) {
        case "board_tasks":
          boardTasksCalls += 1;
          return boardTasksCalls === 1 ? readChain : writeChain;
        case "board_columns":
          return columnChain;
        default:
          return createChain(null);
      }
    });

    const params = moveTaskSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      column_id: COLUMN_B_ID,
      position: 500,
    });

    await expect(moveTask(makeContext(fromFn), params)).rejects.toThrow(
      "This task was already moved by someone else — refresh and try again."
    );

    expect(
      asMock(writeChain.eq).mock.calls.some(
        (call: unknown[]) => call[0] === "column_id" && call[1] === COLUMN_A_ID
      )
    ).toBe(true);
  });

  it("succeeds for an ordinary single-caller move (no race)", async () => {
    const readChain = createChain({ column_id: COLUMN_A_ID });
    const columnChain = createChain({ title: "In Progress", is_done_column: false });
    const writeChain = createChain({ id: TASK_ID });
    const activityChain = createChain(null);

    let boardTasksCalls = 0;
    const fromFn = vi.fn((table: string) => {
      switch (table) {
        case "board_tasks":
          boardTasksCalls += 1;
          return boardTasksCalls === 1 ? readChain : writeChain;
        case "board_columns":
          return columnChain;
        case "board_task_activity":
          return activityChain;
        default:
          return createChain(null);
      }
    });

    const params = moveTaskSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      column_id: COLUMN_B_ID,
      position: 500,
    });

    const result = await moveTask(makeContext(fromFn), params);

    expect(result.success).toBe(true);
    expect(result.column).toBe("In Progress");
    expect(result.position).toBe(500);
  });

  it("throws 'Task not found' — not the generic DB error — when the task no longer exists", async () => {
    const readChain = createChain(null);
    const fromFn = vi.fn((table: string) => {
      if (table === "board_tasks") return readChain;
      return createChain(null);
    });

    const params = moveTaskSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      column_id: COLUMN_B_ID,
      position: 500,
    });

    await expect(moveTask(makeContext(fromFn), params)).rejects.toThrow(
      `Task not found: ${TASK_ID}`
    );
  });
});
