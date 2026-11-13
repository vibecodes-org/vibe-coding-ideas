import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpContext } from "../context";

const mockCheckAndApplyAutoRules = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../src/lib/workflow-helpers", () => ({
  checkAndApplyAutoRules: (...args: unknown[]) => mockCheckAndApplyAutoRules(...args),
  checkAutoRuleWorkflow: vi.fn().mockResolvedValue({ hasActiveWorkflow: false }),
  removeAutoRuleWorkflow: vi.fn().mockResolvedValue({ removed: false }),
}));
vi.mock("../../../src/lib/workflow-matching", () => ({
  dismissSuggestionsForLabel: vi.fn().mockResolvedValue(undefined),
}));
const mockAddTaskComment = vi.fn().mockResolvedValue({ success: true });
vi.mock("./comments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./comments")>()),
  addTaskComment: (...args: unknown[]) => mockAddTaskComment(...args),
}));

import { createTask, moveTask, moveTaskSchema } from "./board-write";
import { manageLabels, manageLabelsSchema } from "./labels";
import { getTask, getTaskSchema } from "./board-read";

const USER_ID = "00000000-0000-4000-a000-000000000001";
const IDEA_ID = "00000000-0000-4000-a000-000000000040";
const TASK_ID = "00000000-0000-4000-a000-000000000010";
const LABEL_ID = "00000000-0000-4000-a000-000000000099";
const COL_OLD = "00000000-0000-4000-a000-000000000060";
const COL_NEW = "00000000-0000-4000-a000-000000000061";

function chainOf(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["order", "limit", "range", "or", "filter", "delete", "select", "eq", "is", "in", "neq", "not", "insert", "update", "upsert", "ilike"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve({ data, error: null }));
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }));
  chain.then = (resolve: (v: unknown) => void) =>
    Promise.resolve({ data: Array.isArray(data) ? data : [], error: null }).then(resolve);
  return chain;
}

type Step = { id: string; run_id: string; title: string; status: string; step_order: number; position: number; human_check_required?: boolean };
const step = (n: number, status: string, title = `Step ${n}`): Step => ({
  id: `s${n}`, run_id: "run1", title, status, step_order: n, position: n,
});

function makeCtx(tables: Record<string, unknown>): { ctx: McpContext; chains: Record<string, ReturnType<typeof chainOf>> } {
  const chains: Record<string, ReturnType<typeof chainOf>> = {};
  const from = vi.fn((table: string) => {
    chains[table] ??= chainOf(table in tables ? tables[table] : null);
    return chains[table];
  });
  return { ctx: { supabase: { from } as unknown as McpContext["supabase"], userId: USER_ID }, chains };
}

function moveCtx(steps: Step[], column: { title: string; is_done_column: boolean }) {
  return makeCtx({
    board_tasks: { id: TASK_ID, column_id: COL_OLD },
    board_columns: column,
    task_workflow_steps: steps,
  });
}
const move = (ctx: McpContext, extra: Record<string, unknown> = {}) =>
  moveTask(ctx, moveTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID, column_id: COL_NEW, ...extra }));

beforeEach(() => mockAddTaskComment.mockClear());

describe("move_task workflow guard", () => {
  it("refuses Done with open steps and no reason; nothing is written", async () => {
    const { ctx, chains } = moveCtx([step(1, "completed"), step(2, "pending")], { title: "Done", is_done_column: true });
    const r = (await move(ctx)) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.blocked).toBe("workflow_open");
    expect(r.open_steps).toEqual([{ title: "Step 2", status: "pending" }]);
    expect(String(r.message)).toContain("claim_next_step");
    expect(String(r.message)).toContain("close_reason");
    expect(chains.board_tasks.update).not.toHaveBeenCalled();
    expect(mockAddTaskComment).not.toHaveBeenCalled();
  });

  it("treats in-progress, awaiting-approval and failed steps as open for Done", async () => {
    for (const status of ["in_progress", "awaiting_approval", "failed"]) {
      const { ctx } = moveCtx([step(1, status)], { title: "Done", is_done_column: true });
      expect(((await move(ctx)) as Record<string, unknown>).blocked).toBe("workflow_open");
    }
  });

  it("allows Done with a reason, posts a comment, logs it, and leaves steps alone", async () => {
    const { ctx, chains } = moveCtx([step(1, "pending", "Plan"), step(2, "pending", "Build")], { title: "Done", is_done_column: true });
    const r = (await move(ctx, { close_reason: "  duplicate of another card " })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(chains.board_tasks.update).toHaveBeenCalled();
    expect(chains.task_workflow_steps.update).not.toHaveBeenCalled();
    expect(mockAddTaskComment).toHaveBeenCalledTimes(1);
    const content = (mockAddTaskComment.mock.calls[0][1] as { content: string }).content;
    expect(content).toBe("Closed with 2 workflow step(s) not run: Plan, Build. Reason: duplicate of another card");
    const activity = chains.board_task_activity.insert as ReturnType<typeof vi.fn>;
    expect(JSON.stringify(activity.mock.calls)).toContain("close_reason");
  });

  it("reports a missing close-reason comment instead of hiding it", async () => {
    mockAddTaskComment.mockRejectedValueOnce(new Error("boom"));
    const { ctx } = moveCtx([step(1, "pending")], { title: "Done", is_done_column: true });
    const r = (await move(ctx, { close_reason: "stale" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(String(r.warning)).toContain("boom");
  });

  it("rejects a blank close_reason", () => {
    expect(() => moveTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID, column_id: COL_NEW, close_reason: "   " })).toThrow();
  });

  it("moves Done untouched when all steps are completed or skipped", async () => {
    const { ctx } = moveCtx([step(1, "completed"), step(2, "skipped")], { title: "Done", is_done_column: true });
    const r = (await move(ctx)) as Record<string, unknown>;
    expect(r).toEqual({ success: true, column: "Done", position: expect.any(Number) });
    expect(mockAddTaskComment).not.toHaveBeenCalled();
  });

  it("moves a card with no workflow untouched", async () => {
    const { ctx } = moveCtx([], { title: "Done", is_done_column: true });
    const r = (await move(ctx)) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.workflow_reminder).toBeUndefined();
  });

  it("refuses Verify when no step has ever started", async () => {
    const { ctx } = moveCtx([step(1, "pending"), step(2, "pending")], { title: " verify ", is_done_column: false });
    expect(((await move(ctx)) as Record<string, unknown>).blocked).toBe("workflow_open");
  });

  it("allows Verify never-started with a reason", async () => {
    const { ctx } = moveCtx([step(1, "pending")], { title: "Verify", is_done_column: false });
    const r = (await move(ctx, { close_reason: "user asked" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(mockAddTaskComment).toHaveBeenCalledTimes(1);
  });

  it("allows Verify part-way through with a reminder", async () => {
    const { ctx } = moveCtx([step(1, "completed"), step(2, "pending", "Sign-off")], { title: "Verify", is_done_column: false });
    const r = (await move(ctx)) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(String(r.workflow_reminder)).toContain("Sign-off");
    expect(String(r.workflow_reminder)).toContain("claim_next_step");
    expect(mockAddTaskComment).not.toHaveBeenCalled();
  });

  it("nudges when moving to In Progress with nothing claimed", async () => {
    const { ctx } = moveCtx([step(1, "pending")], { title: "In Progress", is_done_column: false });
    const r = (await move(ctx)) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(String(r.workflow_reminder)).toContain("claim_next_step");
  });

  it("never blocks other columns", async () => {
    const { ctx } = moveCtx([step(1, "pending")], { title: "Backlog", is_done_column: false });
    const r = (await move(ctx)) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.workflow_reminder).toBeUndefined();
  });

  it("never blocks a reorder within the same column", async () => {
    const { ctx } = moveCtx([step(1, "pending")], { title: "Done", is_done_column: true });
    const r = (await moveTask(ctx, moveTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID, column_id: COL_OLD }))) as Record<string, unknown>;
    expect(r.success).toBe(true);
  });
});

describe("create_task and add_to_task tell the agent about a workflow", () => {
  const taskRow = { id: TASK_ID, title: "T", column_id: COL_OLD, position: 1000 };

  it("create_task returns workflow and the same instruction get_task gives", async () => {
    const steps = [step(1, "pending"), step(2, "pending")];
    const { ctx } = makeCtx({
      board_tasks: taskRow,
      board_labels: [{ id: LABEL_ID, name: "feature" }],
      task_workflow_steps: steps,
    });
    const r = (await createTask(ctx, { idea_id: IDEA_ID, column_id: COL_OLD, title: "T", labels: ["feature"] })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.workflow).toEqual({ steps_total: 2, steps_pending: 2 });
    expect(String(r.workflow_instruction)).toContain("Use claim_next_step(task_id)");

    const { ctx: readCtx } = makeCtx({
      board_tasks: { ...taskRow, idea_id: IDEA_ID },
      task_workflow_steps: steps,
    });
    const got = (await getTask(readCtx, getTaskSchema.parse({ task_id: TASK_ID, idea_id: IDEA_ID }))) as Record<string, unknown>;
    expect(got.workflow_instruction).toBe(r.workflow_instruction);
  });

  it("create_task returns the suggestion instruction when a suggestion was created", async () => {
    const { ctx } = makeCtx({
      board_tasks: taskRow,
      workflow_suggestions: [{ id: "sg1", status: "suggested", source: "auto_rule" }],
    });
    const r = (await createTask(ctx, { idea_id: IDEA_ID, column_id: COL_OLD, title: "T" })) as Record<string, unknown>;
    expect(r.workflow).toBeNull();
    expect(String(r.workflow_instruction)).toContain("unresolved workflow suggestion");
  });

  it("create_task with no workflow returns the no-workflow instruction and keeps old fields", async () => {
    const { ctx } = makeCtx({ board_tasks: taskRow });
    const r = (await createTask(ctx, { idea_id: IDEA_ID, column_id: COL_OLD, title: "T" })) as Record<string, unknown>;
    expect(r.task).toEqual(taskRow);
    expect(r.labels).toEqual([]);
    expect(String(r.workflow_instruction)).toContain("This task has no workflow");
  });

  it("add_to_task returns workflow info", async () => {
    const { ctx } = makeCtx({ board_labels: { name: "feature" }, task_workflow_steps: [step(1, "pending")] });
    const r = (await manageLabels(
      ctx,
      manageLabelsSchema.parse({ action: "add_to_task", idea_id: IDEA_ID, task_id: TASK_ID, label_id: LABEL_ID })
    )) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.workflow).toEqual({ steps_total: 1, steps_pending: 1 });
    expect(String(r.workflow_instruction)).toContain("claim_next_step");
  });
});
