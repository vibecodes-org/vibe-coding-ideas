import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";

const mockCheckAndApplyAutoRules = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../src/lib/workflow-helpers", () => ({
  checkAndApplyAutoRules: (...args: unknown[]) => mockCheckAndApplyAutoRules(...args),
}));

import { createTask, createTaskSchema } from "./board-write";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-a000-000000000001";
const IDEA_ID = "00000000-0000-4000-a000-000000000040";
const COLUMN_ID = "00000000-0000-4000-a000-000000000050";
const TASK_ID = "00000000-0000-4000-a000-000000000010";
const LABEL_BUG_ID = "00000000-0000-4000-a000-000000000098";
const LABEL_FRONTEND_ID = "00000000-0000-4000-a000-000000000099";

/** Creates a chainable Supabase query mock resolving to `resolveWith`. */
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
