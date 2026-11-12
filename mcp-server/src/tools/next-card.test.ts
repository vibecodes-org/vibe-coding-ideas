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
import { skipStep, approveStep, claimNextStep, completeStep } from "./workflows";
import { mintClaimToken } from "../claim-token";
import { pickNextCard } from "./next-card";

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
    for (const m of ["select", "eq", "in", "order", "range", "update", "neq", "limit", "or", "insert", "not", "is", "gt", "lt", "gte", "lte", "match", "filter"]) {
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
    expect(r.instruction).toContain('offer_next_card with finished_task_id "T1"');
    expect(r.instruction).toContain('Click "Start in a new tab" below');
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
  it("complete_step on the last step (A1)", async () => {
    const tok = mintClaimToken();
    const ctx = fakeCtx({
      task_workflow_steps: {
        ...stepRow,
        status: "in_progress",
        claim_token_hash: tok.hash,
        idea_id: "I1",
        human_check_required: false,
      },
      board_columns: cols,
      board_tasks: [
        { id: "T1", title: "Finished one", idea_id: "I1", column_id: "c-todo", position: 1 },
        { id: "T2", title: "Next one", idea_id: "I1", column_id: "c-todo", position: 2 },
      ],
    });
    const r = (await completeStep(ctx, {
      claim_token: tok.token,
      step_id: stepId,
      output: "done",
    })) as Record<string, unknown>;
    expect(r.run_complete).toBe(true);
    expect(r.workflow_finished).toBe(true);
    expect(r.finished_card).toEqual({ id: "T1", title: "Finished one" });
    expect(r.next_card).toEqual({ id: "T2", title: "Next one", column: "To DO" });
    expect(r.instruction).toContain('"Finished one" is finished. Next up on the board: "Next one".');
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

/**
 * A fake that honours the filters pickNextCard sends (eq, neq, in, or, order,
 * range), so a cap or a filter that hides cards shows up as a failing test.
 */
function filteringCtx(tables: Record<string, Record<string, unknown>[]>, calls: string[] = []) {
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (col: string, val: unknown) => {
      if (table === "board_tasks" && col === "column_id") calls.push(String(val));
      rows = rows.filter((r) => r[col] === val);
      return chain;
    };
    chain.neq = (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] !== val);
      return chain;
    };
    chain.in = (col: string, vals: unknown[]) => {
      rows = rows.filter((r) => vals.includes(r[col]));
      return chain;
    };
    chain.or = (expr: string) => {
      const parts = expr.split(",").map((p) => p.split("."));
      rows = rows.filter((r) =>
        parts.some(([col, op, val]) =>
          op === "is" ? r[col] == null : String(r[col]) === val
        )
      );
      return chain;
    };
    chain.order = (col: string, o: { ascending: boolean }) => {
      rows.sort((a, b) => {
        const x = a[col] as number | string;
        const y = b[col] as number | string;
        const c = x < y ? -1 : x > y ? 1 : 0;
        return o.ascending ? c : -c;
      });
      return chain;
    };
    chain.range = (from: number, to: number) => {
      rows = rows.slice(from, to + 1);
      return chain;
    };
    chain.then = (res: (v: unknown) => void) => Promise.resolve({ data: rows, error: null }).then(res);
    return chain;
  };
  return { supabase: { from }, userId: "u" } as unknown as McpContext;
}

describe("pickNextCard with the 50-card cap", () => {
  const colsI = cols.map((c) => ({ ...c, idea_id: "I1" }));
  const task = (id: string, column_id: string, position: number, extra = {}) => ({
    id,
    title: id,
    idea_id: "I1",
    column_id,
    position,
    archived: false,
    workflow_step_in_progress: 0,
    workflow_step_awaiting_approval: 0,
    ...extra,
  });

  it("still chooses the only To Do card when Backlog has 60 lower-position cards", async () => {
    const backlog = Array.from({ length: 60 }, (_, i) => task(`B${i}`, "c-back", i));
    const calls: string[] = [];
    const ctx = filteringCtx(
      { board_columns: colsI, board_tasks: [...backlog, task("TODO1", "c-todo", 5000)] },
      calls
    );
    const next = await pickNextCard(ctx, "I1", "FINISHED");
    expect(next).toEqual({ id: "TODO1", title: "TODO1", column: "To DO" });
    expect(calls).toEqual(["c-todo"]); // Backlog never queried
  });

  it("busy and archived cards do not use up the cap", async () => {
    const busy = Array.from({ length: 60 }, (_, i) =>
      task(`X${i}`, "c-todo", i, i % 2 ? { workflow_step_in_progress: 1 } : { archived: true })
    );
    const ctx = filteringCtx({
      board_columns: colsI,
      board_tasks: [...busy, task("OK", "c-todo", 9000, { workflow_step_in_progress: null })],
    });
    expect((await pickNextCard(ctx, "I1", "FINISHED"))?.id).toBe("OK");
  });

  it("goes to Backlog, after To Do, only when To Do has no eligible card", async () => {
    const calls: string[] = [];
    const ctx = filteringCtx(
      {
        board_columns: colsI,
        board_tasks: [task("FIN", "c-todo", 1), task("B1", "c-back", 1)],
      },
      calls
    );
    const next = await pickNextCard(ctx, "I1", "FIN");
    expect(next?.id).toBe("B1");
    expect(calls).toEqual(["c-todo", "c-back"]);
  });
});
