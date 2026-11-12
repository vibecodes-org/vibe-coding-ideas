import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";

vi.mock("../../../src/lib/workflow-helpers", async (orig) => ({
  ...(await orig<typeof import("../../../src/lib/workflow-helpers")>()),
  checkAndCompleteRun: vi.fn(async () => true),
}));

import {
  chooseNextCard,
  oneLine,
  workflowFinishedText,
  workflowFinishedReply,
  type NextCardTask,
} from "./next-card";
import { skipStep, approveStep, claimNextStep } from "./workflows";

const cols = [
  { id: "c-back", title: "Backlog" },
  { id: "c-todo", title: "To DO" },
  { id: "c-prog", title: "In Progress" },
];
const t = (o: Partial<NextCardTask> & { id: string }): NextCardTask => ({
  title: o.id,
  column_id: "c-todo",
  position: 1000,
  archived: false,
  workflow_step_in_progress: 0,
  workflow_step_awaiting_approval: 0,
  ...o,
});

describe("chooseNextCard", () => {
  it("takes the top of To Do (title match ignores case), by position then id", () => {
    const r = chooseNextCard(
      cols,
      [t({ id: "b", position: 2 }), t({ id: "a", position: 2 }), t({ id: "z", position: 5 })],
      "x"
    );
    expect(r).toEqual({ id: "a", title: "a", column: "To DO" });
  });
  it("falls back to Backlog when To Do is empty (A4)", () => {
    const r = chooseNextCard(cols, [t({ id: "k", column_id: "c-back" })], "x");
    expect(r?.id).toBe("k");
  });
  it("returns null when both are empty, never looking at other columns (A4)", () => {
    expect(chooseNextCard(cols, [t({ id: "p", column_id: "c-prog" })], "x")).toBeNull();
  });
  it("skips the finished card, archived cards and cards with a step running or awaiting approval (A5)", () => {
    const r = chooseNextCard(
      cols,
      [
        t({ id: "self", position: 1 }),
        t({ id: "arch", position: 2, archived: true }),
        t({ id: "run", position: 3, workflow_step_in_progress: 1 }),
        t({ id: "wait", position: 4, workflow_step_awaiting_approval: 1 }),
        t({ id: "ok", position: 5 }),
      ],
      "self"
    );
    expect(r?.id).toBe("ok");
  });
  it("moves on to Backlog when every To Do card is ineligible", () => {
    const r = chooseNextCard(cols, [t({ id: "self" }), t({ id: "b", column_id: "c-back" })], "self");
    expect(r?.id).toBe("b");
  });
});

describe("workflowFinishedText", () => {
  it("names the next card and offers the fresh session (no 'in Verify')", () => {
    const s = workflowFinishedText("Done card", { id: "1", title: "Next one", column: "To Do" });
    expect(s).toContain('"Done card" is finished.');
    expect(s).not.toContain("Verify");
    expect(s).toContain('Next up on the board: "Next one".');
    expect(s).toContain('pick "Launch in browser terminal"');
    expect(s).toContain('say "keep going here"');
  });
  it("says nothing is waiting when there is no next card", () => {
    expect(workflowFinishedText("Done card", null)).toBe(
      `"Done card" is finished. Nothing is waiting in To Do or Backlog. Close this session when you're done with it.`
    );
  });
  it("keeps titles on one line and cuts long ones (A7)", () => {
    expect(oneLine('a "b"\n  c\r\nd')).toBe('a "b" c d');
    const long = oneLine("x".repeat(300));
    expect(long).toHaveLength(120);
    expect(long.endsWith("…")).toBe(true);
    expect(workflowFinishedText("a\nb", null)).not.toContain("\n");
  });
});

/** A tiny fake Supabase: every query chain resolves to the table's rows. */
function fakeCtx(tables: Record<string, unknown>, opts: { failTable?: string } = {}) {
  const from = (table: string) => {
    const result =
      table === opts.failTable
        ? { data: null, error: { message: "boom" } }
        : { data: tables[table] ?? null, error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "range", "update", "neq", "limit"]) {
      chain[m] = () => chain;
    }
    chain.maybeSingle = () =>
      Promise.resolve({
        data: Array.isArray(result.data) ? result.data[0] : result.data,
        error: result.error,
      });
    chain.single = chain.maybeSingle;
    chain.then = (res: (v: unknown) => void) => Promise.resolve(result).then(res);
    return chain;
  };
  return { supabase: { from }, userId: "u" } as unknown as McpContext;
}

const board = {
  board_tasks: [
    { id: "T1", title: "Finished one", idea_id: "I1", column_id: "c-todo", position: 1 },
  ],
  board_columns: cols,
};

describe("workflowFinishedReply", () => {
  it("returns the fields and the stop-and-say instruction", async () => {
    const ctx = fakeCtx({
      board_columns: cols,
      board_tasks: [
        { id: "T1", title: "Finished one", idea_id: "I1", column_id: "c-todo", position: 1 },
        { id: "T2", title: "Next one", idea_id: "I1", column_id: "c-todo", position: 2 },
      ],
    });
    const r = await workflowFinishedReply(ctx, "T1");
    expect(r.workflow_finished).toBe(true);
    expect(r.finished_card).toEqual({ id: "T1", title: "Finished one" });
    expect(r.next_card?.id).toBe("T2");
    expect(r.instruction).toContain("then STOP");
    expect(r.instruction).toContain('"Finished one" is finished. Next up on the board: "Next one".');
    expect(r.instruction).toContain("Do NOT claim, move or start");
  });
  it("still finishes, with next_card null, when the lookup throws (A6)", async () => {
    const r = await workflowFinishedReply(fakeCtx({ ...board }, { failTable: "board_columns" }), "T1");
    expect(r.workflow_finished).toBe(true);
    expect(r.next_card).toBeNull();
    expect(r.instruction).toContain("could not be looked up");
  });
});

describe("tool replies when the run finishes", () => {
  const stepRow = {
    id: "S1",
    task_id: "T1",
    run_id: "R1",
    title: "Last",
    agent_role: "dev",
    status: "skipped",
    output: "x",
    completed_at: "2026",
  };
  const stepId = "00000000-0000-4000-8000-000000000001";

  it("skip_step (A2)", async () => {
    const ctx = fakeCtx({ task_workflow_steps: { ...stepRow, status: "pending" }, ...board });
    const r = (await skipStep(ctx, { step_id: stepId })) as Record<string, unknown>;
    expect(r.run_complete).toBe(true);
    expect(r.workflow_finished).toBe(true);
    expect(r.finished_card).toEqual({ id: "T1", title: "Finished one" });
  });
  it("approve_step (A2)", async () => {
    const ctx = fakeCtx({
      task_workflow_steps: { ...stepRow, status: "awaiting_approval", idea_id: "I1", human_check_required: true },
      ...board,
    });
    const r = (await approveStep(ctx, { step_id: stepId } as Parameters<typeof approveStep>[1])) as Record<string, unknown>;
    expect(r.workflow_finished).toBe(true);
  });
  it("claim_next_step on a finished card (A3)", async () => {
    const steps = [
      { id: "S1", task_id: "T1", run_id: "R1", status: "completed", created_at: "1" },
      { id: "S2", task_id: "T1", run_id: "R1", status: "skipped", created_at: "1" },
    ];
    const r = (await claimNextStep(fakeCtx({ task_workflow_steps: steps, ...board }), {
      task_id: "T1",
    })) as Record<string, unknown>;
    expect(r.done).toBe(true);
    expect(r.workflow_finished).toBe(true);
  });
  it("claim_next_step with a step awaiting approval keeps the old reply (A3)", async () => {
    const steps = [
      { id: "S1", task_id: "T1", run_id: "R1", status: "completed", created_at: "1" },
      { id: "S2", task_id: "T1", run_id: "R1", status: "awaiting_approval", created_at: "1", step_order: 2 },
    ];
    const r = await claimNextStep(fakeCtx({ task_workflow_steps: steps, ...board }), { task_id: "T1" });
    expect(r).toEqual({ done: true, message: "All steps complete or no pending steps" });
  });
});
