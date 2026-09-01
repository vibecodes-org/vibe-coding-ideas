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
  chain.neq = vi.fn(() => chain);
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
    const siblingsChain = createChain([]);
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
          if (boardTasksCalls === 1) return siblingsChain;
          if (boardTasksCalls === 2) return readChain;
          return writeChain;
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
      position: "bottom",
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
    const siblingsChain = createChain([]);
    const readChain = createChain({ column_id: COLUMN_A_ID });
    const columnChain = createChain({ title: "In Progress", is_done_column: false });
    const writeChain = createChain({ id: TASK_ID });
    const activityChain = createChain(null);

    let boardTasksCalls = 0;
    const fromFn = vi.fn((table: string) => {
      switch (table) {
        case "board_tasks":
          boardTasksCalls += 1;
          if (boardTasksCalls === 1) return siblingsChain;
          if (boardTasksCalls === 2) return readChain;
          return writeChain;
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
      position: "bottom",
    });

    const result = await moveTask(makeContext(fromFn), params);

    expect(result.success).toBe(true);
    expect(result.column).toBe("In Progress");
    // Empty target column -> bottom insert lands at 0 (computeBottomInsertPosition([])).
    expect(result.position).toBe(0);
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
      position: "bottom",
    });

    await expect(moveTask(makeContext(fromFn), params)).rejects.toThrow(
      `Task not found: ${TASK_ID}`
    );
  });
});

describe("moveTask — relative placement (top/bottom/before/after)", () => {
  // Regression coverage for the position-guessing bug: move_task used to take
  // a raw absolute position number the caller had no way to choose correctly.
  // These lock in that the new relative placements resolve to the correct
  // absolute value, and that get_board would list them in that order.

  it("'top' lands strictly below the current lowest position in the target column", async () => {
    const siblingsChain = createChain([{ position: 1000 }, { position: 2000 }]);
    const readChain = createChain({ column_id: COLUMN_A_ID });
    const columnChain = createChain({ title: "To Do", is_done_column: false });
    const writeChain = createChain({ id: TASK_ID });
    const activityChain = createChain(null);

    let boardTasksCalls = 0;
    const fromFn = vi.fn((table: string) => {
      switch (table) {
        case "board_tasks":
          boardTasksCalls += 1;
          if (boardTasksCalls === 1) return siblingsChain;
          if (boardTasksCalls === 2) return readChain;
          return writeChain;
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
      position: "top",
    });

    const result = await moveTask(makeContext(fromFn), params);

    expect(result.position).toBe(0); // 1000 - POSITION_GAP
    expect(
      asMock(writeChain.update).mock.calls.some(
        (call: unknown[]) => (call[0] as Record<string, unknown>).position === 0
      )
    ).toBe(true);
  });

  it("'bottom' lands strictly above the current highest position in the target column", async () => {
    const siblingsChain = createChain([{ position: 1000 }, { position: 2000 }]);
    const readChain = createChain({ column_id: COLUMN_A_ID });
    const columnChain = createChain({ title: "To Do", is_done_column: false });
    const writeChain = createChain({ id: TASK_ID });
    const activityChain = createChain(null);

    let boardTasksCalls = 0;
    const fromFn = vi.fn((table: string) => {
      switch (table) {
        case "board_tasks":
          boardTasksCalls += 1;
          if (boardTasksCalls === 1) return siblingsChain;
          if (boardTasksCalls === 2) return readChain;
          return writeChain;
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
      position: "bottom",
    });

    const result = await moveTask(makeContext(fromFn), params);

    expect(result.position).toBe(3000); // 2000 + POSITION_GAP
  });

  it("before_task_id splits the gap to the next-lower sibling", async () => {
    const SIBLING_ID = "00000000-0000-4000-a000-000000000070";
    // Sibling sits at 2000; another task sits at 1000 below it -> split to 1500.
    const siblingLookupChain = createChain({
      id: SIBLING_ID,
      column_id: COLUMN_B_ID,
      position: 2000,
    });
    const otherPositionsChain = createChain([{ position: 1000 }]);
    const readChain = createChain({ column_id: COLUMN_A_ID });
    const columnChain = createChain({ title: "To Do", is_done_column: false });
    const writeChain = createChain({ id: TASK_ID });
    const activityChain = createChain(null);

    let boardTasksCalls = 0;
    const fromFn = vi.fn((table: string) => {
      switch (table) {
        case "board_tasks":
          boardTasksCalls += 1;
          if (boardTasksCalls === 1) return siblingLookupChain;
          if (boardTasksCalls === 2) return otherPositionsChain;
          if (boardTasksCalls === 3) return readChain;
          return writeChain;
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
      before_task_id: SIBLING_ID,
    });

    const result = await moveTask(makeContext(fromFn), params);

    expect(result.position).toBe(1500);
  });

  it("after_task_id splits the gap to the next-higher sibling, and steps a full gap past a last sibling", async () => {
    const SIBLING_ID = "00000000-0000-4000-a000-000000000071";
    const siblingLookupChain = createChain({
      id: SIBLING_ID,
      column_id: COLUMN_B_ID,
      position: 3000,
    });
    // Sibling is last in the column -> no higher neighbor to split against.
    const otherPositionsChain = createChain([{ position: 1000 }, { position: 2000 }]);
    const readChain = createChain({ column_id: COLUMN_A_ID });
    const columnChain = createChain({ title: "To Do", is_done_column: false });
    const writeChain = createChain({ id: TASK_ID });
    const activityChain = createChain(null);

    let boardTasksCalls = 0;
    const fromFn = vi.fn((table: string) => {
      switch (table) {
        case "board_tasks":
          boardTasksCalls += 1;
          if (boardTasksCalls === 1) return siblingLookupChain;
          if (boardTasksCalls === 2) return otherPositionsChain;
          if (boardTasksCalls === 3) return readChain;
          return writeChain;
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
      after_task_id: SIBLING_ID,
    });

    const result = await moveTask(makeContext(fromFn), params);

    expect(result.position).toBe(4000); // 3000 + POSITION_GAP
  });

  it("rejects before_task_id that isn't in the target column", async () => {
    const SIBLING_ID = "00000000-0000-4000-a000-000000000072";
    const siblingLookupChain = createChain({
      id: SIBLING_ID,
      column_id: COLUMN_A_ID, // not COLUMN_B_ID, the move target
      position: 2000,
    });
    const fromFn = vi.fn((table: string) => {
      if (table === "board_tasks") return siblingLookupChain;
      return createChain(null);
    });

    const params = moveTaskSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      column_id: COLUMN_B_ID,
      before_task_id: SIBLING_ID,
    });

    await expect(moveTask(makeContext(fromFn), params)).rejects.toThrow(
      "before_task_id must reference a task already in the target column"
    );
  });

  it("rejects more than one of position/before_task_id/after_task_id", async () => {
    const params = moveTaskSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      column_id: COLUMN_B_ID,
      position: "top",
      after_task_id: TASK_ID,
    });

    await expect(moveTask(makeContext(vi.fn(() => createChain(null))), params)).rejects.toThrow(
      "Provide at most one of position, before_task_id, after_task_id."
    );
  });

  it("rebalances the column and retries when repeated before_task_id splits exhaust the integer gap", async () => {
    // Regression coverage for the float-midpoint collision bug:
    // computeAdjacentInsertPosition used to divide (siblingPosition + neighbor) / 2
    // with no floor/rebalance, so enough same-spot "before" inserts eventually
    // produced a fractional position that Postgres would silently round on
    // write into a collision with an existing sibling. Here the sibling sits
    // at 1000 with a neighbor one integer below it (999) — no integer split
    // is possible, so resolveMovePosition must rebalance the column to clean
    // gap-spaced integers and retry, landing at a whole number with no collision.
    const SIBLING_ID = "00000000-0000-4000-a000-000000000073";
    const OTHER_ID = "00000000-0000-4000-a000-000000000074";

    const siblingLookupChain = createChain({
      id: SIBLING_ID,
      column_id: COLUMN_B_ID,
      position: 1000,
    });
    const otherPositionsChain = createChain([{ position: 999 }]);
    const rebalanceReadChain = createChain([
      { id: OTHER_ID, position: 999 },
      { id: SIBLING_ID, position: 1000 },
    ]);
    const updateOtherChain = createChain(null);
    const updateSiblingChain = createChain(null);
    const readChain = createChain({ column_id: COLUMN_A_ID });
    const columnChain = createChain({ title: "To Do", is_done_column: false });
    const writeChain = createChain({ id: TASK_ID });
    const activityChain = createChain(null);

    let boardTasksCalls = 0;
    const fromFn = vi.fn((table: string) => {
      switch (table) {
        case "board_tasks":
          boardTasksCalls += 1;
          if (boardTasksCalls === 1) return siblingLookupChain;
          if (boardTasksCalls === 2) return otherPositionsChain;
          if (boardTasksCalls === 3) return rebalanceReadChain;
          if (boardTasksCalls === 4) return updateOtherChain;
          if (boardTasksCalls === 5) return updateSiblingChain;
          if (boardTasksCalls === 6) return readChain;
          return writeChain;
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
      before_task_id: SIBLING_ID,
    });

    const result = await moveTask(makeContext(fromFn), params);

    // Rebalance assigns clean POSITION_GAP-spaced integers in current order:
    // OTHER_ID (was 999, sorts first) -> 1000, SIBLING_ID (was 1000) -> 2000.
    // Splitting before the rebalanced sibling (2000) against its new
    // neighbor (1000) lands at 1500 — a whole number, distinct from both.
    expect(result.position).toBe(1500);
    expect(Number.isInteger(result.position)).toBe(true);

    expect(
      asMock(updateOtherChain.update).mock.calls.some(
        (call: unknown[]) => (call[0] as Record<string, unknown>).position === 1000
      )
    ).toBe(true);
    expect(
      asMock(updateSiblingChain.update).mock.calls.some(
        (call: unknown[]) => (call[0] as Record<string, unknown>).position === 2000
      )
    ).toBe(true);

    // The final write for the moved task itself lands on yet another value —
    // no two tasks in the column share a position after this sequence.
    const finalPositions = new Set([1000, 2000, result.position]);
    expect(finalPositions.size).toBe(3);
  });
});
