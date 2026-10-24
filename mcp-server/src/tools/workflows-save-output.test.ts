// Stage 3 of card 5e654dd1: the helper saves its own write-up
// (save_step_output), complete_step / fail_step use it, and rework feedback is
// sent once. The database is a small recording fake so each test can read the
// exact writes (and the guards on them).
import { describe, it, expect, vi } from "vitest";
import { createHash } from "crypto";
import type { McpContext } from "../context";
import { mintClaimToken, mintWorkToken, hashClaimToken } from "../claim-token";
import {
  saveStepOutput,
  saveStepOutputSchema,
  completeStep,
  failStep,
} from "./workflows";
import { buildReworkInstructions } from "../lib/rework";
import { logger } from "../../../src/lib/logger";

const STEP_ID = "00000000-0000-4000-a000-000000000020";
const TASK_ID = "00000000-0000-4000-a000-000000000010";
const RUN_ID = "00000000-0000-4000-a000-000000000030";
const IDEA_ID = "00000000-0000-4000-a000-000000000040";
const BOT_ID = "00000000-0000-4000-a000-0000000000b1";
const USER_ID = "00000000-0000-4000-a000-000000000001";

interface Op {
  table: string;
  kind: "select" | "update" | "insert";
  payload?: unknown;
  eqs: [string, unknown][];
  nots: [string, string, unknown][];
  selected?: string;
}

/** A recording fake. `answer` returns the row(s) for a finished query. */
function fakeDb(answer: (op: Op) => { data: unknown; error?: unknown }) {
  const ops: Op[] = [];
  const ctx = {
    supabase: {
      from(table: string) {
        const op: Op = { table, kind: "select", eqs: [], nots: [] };
        const finish = () => {
          if (!ops.includes(op)) ops.push(op);
          const r = answer(op);
          return Promise.resolve({ data: r.data, error: r.error ?? null });
        };
        const chain: Record<string, unknown> = {};
        for (const m of ["in", "order", "limit", "gte", "neq", "lt"]) chain[m] = () => chain;
        chain.select = (f?: string) => { op.selected = f; return chain; };
        chain.eq = (c: string, v: unknown) => { op.eqs.push([c, v]); return chain; };
        chain.not = (c: string, o: string, v: unknown) => { op.nots.push([c, o, v]); return chain; };
        chain.update = (d: unknown) => { op.kind = "update"; op.payload = d; return chain; };
        chain.insert = (d: unknown) => { op.kind = "insert"; op.payload = d; ops.push(op); return chain; };
        chain.single = finish;
        chain.maybeSingle = finish;
        chain.then = (res: (v: unknown) => void, rej: (e: unknown) => void) => finish().then(res, rej);
        return chain;
      },
    },
    userId: USER_ID,
  } as unknown as McpContext;
  return { ctx, ops };
}

const CT = mintClaimToken();
const WT = mintWorkToken();

function stepRow(over: Record<string, unknown> = {}) {
  return {
    id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, idea_id: IDEA_ID, title: "Build", status: "in_progress",
    bot_id: BOT_ID, agent_role: "Engineer", human_check_required: false, model_tier: null,
    claim_token_hash: CT.hash, work_token_hash: WT.hash, output: null, step_order: 2, ...over,
  };
}

// ---------------------------------------------------------------- save_step_output
describe("saveStepOutput", () => {
  function setup(row: Record<string, unknown> = stepRow(), updateResult: unknown = { id: STEP_ID, task_id: TASK_ID }) {
    return fakeDb((op) => {
      if (op.table === "task_workflow_steps" && op.kind === "select") {
        // verify read vs saved-output read
        return { data: op.selected === "output" ? { output: row.output } : row };
      }
      if (op.table === "task_workflow_steps" && op.kind === "update") {
        return { data: op.payload && "output" in (op.payload as object) ? updateResult : { id: row.task_id } };
      }
      return { data: null };
    });
  }

  it("saves with the current work token on an in-progress step, guarded by id, status and token hash, and never echoes the text", async () => {
    const { ctx, ops } = setup();
    const r = await saveStepOutput(ctx, { step_id: STEP_ID, work_token: WT.token, output: "full write-up" });
    expect(r).toEqual({ saved: true, step_id: STEP_ID, output_chars: 13, replaced_previous: false });
    expect(JSON.stringify(r)).not.toContain("full write-up");
    const write = ops.find((o) => o.kind === "update" && o.payload && "output" in (o.payload as object))!;
    expect(write.payload).toEqual({ output: "full write-up" });
    expect(write.eqs).toEqual(expect.arrayContaining([
      ["id", STEP_ID], ["status", "in_progress"], ["work_token_hash", hashClaimToken(WT.token)],
    ]));
    // touches the task, posts no comment
    expect(ops.some((o) => o.kind === "insert")).toBe(false);
    expect(ops.some((o) => o.table === "board_tasks" && o.kind === "update")).toBe(true);
  });

  it("a second save replaces the first and says so", async () => {
    const { ctx } = setup(stepRow({ output: "first" }));
    const r = await saveStepOutput(ctx, { step_id: STEP_ID, work_token: WT.token, output: "second" });
    expect(r.replaced_previous).toBe(true);
  });

  it("rejects the claim token with a message that names the mix-up, and warns", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx } = setup();
    await expect(saveStepOutput(ctx, { step_id: STEP_ID, work_token: CT.token, output: "x" })).rejects.toThrow(/claim_token \(ct_/);
    expect(warn).toHaveBeenCalledWith("work token rejected", expect.objectContaining({ tool: "save_step_output" }));
    warn.mockRestore();
  });

  it("rejects a superseded or other-step token and writes nothing", async () => {
    const { ctx, ops } = setup();
    const other = mintWorkToken();
    await expect(saveStepOutput(ctx, { step_id: STEP_ID, work_token: other.token, output: "x" })).rejects.toThrow(/not the current one/);
    expect(ops.some((o) => o.kind === "update")).toBe(false);
  });

  it("rejects a step that is not in progress", async () => {
    const { ctx, ops } = setup(stepRow({ status: "completed" }));
    await expect(saveStepOutput(ctx, { step_id: STEP_ID, work_token: WT.token, output: "x" })).rejects.toThrow(/no longer in progress/);
    expect(ops.some((o) => o.kind === "update")).toBe(false);
  });

  it("rejects a missing step and a step with no agent", async () => {
    await expect(
      saveStepOutput(fakeDb(() => ({ data: null })).ctx, { step_id: STEP_ID, work_token: WT.token, output: "x" })
    ).rejects.toThrow(/No workflow step found/);
    await expect(
      saveStepOutput(setup(stepRow({ bot_id: null })).ctx, { step_id: STEP_ID, work_token: WT.token, output: "x" })
    ).rejects.toThrow(/no assigned agent/);
  });

  it("tells the helper to stop when the guarded write loses a race (re-claimed between check and write)", async () => {
    const { ctx } = setup(stepRow(), null);
    await expect(saveStepOutput(ctx, { step_id: STEP_ID, work_token: WT.token, output: "x" })).rejects.toThrow(/stop and report back/);
  });

  it("limits the size: 1 to 50,000 characters, not blank", () => {
    const base = { step_id: STEP_ID, work_token: WT.token };
    expect(saveStepOutputSchema.safeParse({ ...base, output: "x".repeat(50000) }).success).toBe(true);
    expect(saveStepOutputSchema.safeParse({ ...base, output: "x".repeat(50001) }).success).toBe(false);
    expect(saveStepOutputSchema.safeParse({ ...base, output: "" }).success).toBe(false);
    expect(saveStepOutputSchema.safeParse({ ...base, output: "   " }).success).toBe(false);
    expect(saveStepOutputSchema.safeParse({ step_id: STEP_ID, output: "x" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------- complete_step
describe("completeStep — saved write-up", () => {
  function setup(row: Record<string, unknown>) {
    return fakeDb((op) => {
      if (op.table === "task_workflow_steps" && op.kind === "select") {
        if (op.selected === "id, status") return { data: [{ id: STEP_ID, status: "in_progress" }] };
        return { data: row };
      }
      if (op.table === "task_workflow_steps" && op.kind === "update") {
        const p = op.payload as Record<string, unknown>;
        if ("status" in p) {
          return { data: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Build", agent_role: "Engineer", status: p.status, output: "output" in p ? p.output : row.output } };
        }
      }
      return { data: null };
    });
  }
  const stepUpdate = (ops: Op[]) => ops.find((o) => o.table === "task_workflow_steps" && o.kind === "update" && o.payload && "status" in (o.payload as object))!;

  it("omitted output + saved write-up: completes with the saved one, guarded by output is not null", async () => {
    const { ctx, ops } = setup(stepRow({ output: "the full saved write-up" }));
    const r = await completeStep(ctx, { step_id: STEP_ID, claim_token: CT.token });
    expect(r.output_source).toBe("saved");
    expect(r).not.toHaveProperty("passed_output_ignored");
    expect(r.step.output_chars).toBe("the full saved write-up".length);
    const u = stepUpdate(ops);
    expect(u.payload).not.toHaveProperty("output");
    expect(u.nots).toContainEqual(["output", "is", null]);
  });

  it("omitted output + nothing saved: refuses before any write and the tokens stay valid", async () => {
    for (const saved of [null, "", "   "]) {
      const { ctx, ops } = setup(stepRow({ output: saved }));
      await expect(completeStep(ctx, { step_id: STEP_ID, claim_token: CT.token })).rejects.toThrow(
        /Nothing is saved for this step yet\..*save_step_output.*Nothing was changed\./
      );
      expect(ops.some((o) => o.kind === "update" || o.kind === "insert")).toBe(false);
    }
  });

  it("passed output + saved write-up: the saved one wins and the reply says the passed text was ignored", async () => {
    const { ctx, ops } = setup(stepRow({ output: "FULL saved" }));
    const r = await completeStep(ctx, { step_id: STEP_ID, claim_token: CT.token, output: "short summary" });
    expect(r.output_source).toBe("saved");
    expect(r.passed_output_ignored).toBe(true);
    expect(stepUpdate(ops).payload).not.toHaveProperty("output");
  });

  it("passed output + nothing saved: stored as before (sessions in flight, inline runs)", async () => {
    const { ctx, ops } = setup(stepRow({ output: null }));
    const r = await completeStep(ctx, { step_id: STEP_ID, claim_token: CT.token, output: "pasted write-up" });
    expect(r.output_source).toBe("passed");
    expect(r).not.toHaveProperty("passed_output_ignored");
    expect((stepUpdate(ops).payload as Record<string, unknown>).output).toBe("pasted write-up");
    expect(stepUpdate(ops).nots).toEqual([]);
  });

  it("keeps the claim token check and the approval stop, with the new wording", async () => {
    const wrong = setup(stepRow({ output: "x" }));
    await expect(completeStep(wrong.ctx, { step_id: STEP_ID, claim_token: "ct_wrong" })).rejects.toThrow(/isn't claimed by you/);
    const { ctx, ops } = setup(stepRow({ output: "x", human_check_required: true }));
    const r = await completeStep(ctx, { step_id: STEP_ID, claim_token: CT.token });
    expect(r.status).toBe("awaiting_approval");
    expect(r.message).toContain("STOP here");
    expect(r.message).toContain("do NOT call approve_step yourself");
    expect(r.message).toContain("Show the user the helper's summary");
    const u = stepUpdate(ops).payload as Record<string, unknown>;
    expect(u.claim_token_hash).toBeNull();
    expect(u.work_token_hash).toBeNull();
  });
});

// ---------------------------------------------------------------- fail_step
describe("failStep — saved write-up", () => {
  function setup(row: Record<string, unknown>) {
    return fakeDb((op) => {
      if (op.table === "task_workflow_steps" && op.kind === "select") {
        if (op.selected === "step_order, position") return { data: { step_order: 1, position: 1000 } };
        return { data: row };
      }
      if (op.table === "task_workflow_steps" && op.kind === "update") {
        const p = op.payload as Record<string, unknown>;
        if (p.status === "pending") return { data: [{ id: STEP_ID }] }; // the cascade reset
        if ("status" in p) return { data: { id: STEP_ID, task_id: TASK_ID, run_id: RUN_ID, title: "Build", agent_role: "E", status: p.status, output: null } };
        return { data: [{ id: STEP_ID }] };
      }
      return { data: null };
    });
  }
  const comments = (ops: Op[]) => ops.filter((o) => o.table === "workflow_step_comments" && o.kind === "insert").map((o) => o.payload as Record<string, unknown>);
  const failed = (ops: Op[]) => ops.find((o) => o.table === "task_workflow_steps" && o.kind === "update" && o.payload && "status" in (o.payload as object))!;

  it("in progress, output omitted, write-up saved: the saved text is the failure comment and stays in the output column", async () => {
    const { ctx, ops } = setup(stepRow({ output: "saved findings" }));
    await failStep(ctx, { step_id: STEP_ID, claim_token: CT.token });
    expect(comments(ops).find((c) => c.type === "failure")!.content).toBe("saved findings");
    expect(failed(ops).payload).not.toHaveProperty("output");
  });

  it("with a reset, the changes_requested comment carries the saved text too", async () => {
    const target = "00000000-0000-4000-a000-0000000000c1";
    const { ctx, ops } = setup(stepRow({ output: "saved findings" }));
    await failStep(ctx, { step_id: STEP_ID, claim_token: CT.token, reset_to_step_id: target });
    expect(comments(ops).find((c) => c.type === "changes_requested")!.content).toBe("saved findings");
  });

  it("awaiting approval, output omitted: the saved deliverable is never rejection text", async () => {
    const { ctx, ops } = setup(stepRow({ status: "awaiting_approval", output: "the deliverable" }));
    await failStep(ctx, { step_id: STEP_ID });
    expect(comments(ops).filter((c) => c.type === "failure")).toEqual([]);
    expect(failed(ops).payload).not.toHaveProperty("output");
  });

  it("output passed over a different saved write-up: the saved one is kept as an output comment by the step's agent first", async () => {
    const { ctx, ops } = setup(stepRow({ output: "saved findings" }));
    await failStep(ctx, { step_id: STEP_ID, claim_token: CT.token, output: "tests fail" });
    const cs = comments(ops);
    expect(cs.find((c) => c.type === "output")).toMatchObject({ content: "saved findings", author_id: BOT_ID });
    expect(cs.find((c) => c.type === "failure")!.content).toBe("tests fail");
    expect((failed(ops).payload as Record<string, unknown>).output).toBe("tests fail");
  });

  it("output passed identical to the saved write-up: no duplicate output comment", async () => {
    const { ctx, ops } = setup(stepRow({ output: "same" }));
    await failStep(ctx, { step_id: STEP_ID, claim_token: CT.token, output: "same" });
    expect(comments(ops).some((c) => c.type === "output")).toBe(false);
  });
});

// ---------------------------------------------------------------- rework
describe("buildReworkInstructions", () => {
  const titles = new Map([["build", "Build"], ["review", "Code review"], ["test", "Test"]]);
  const c = (content: string, created_at: string, step_id: string) => ({ content, created_at, step_id });

  it("returns null with no feedback", () => {
    expect(buildReworkInstructions([], [], titles)).toBeNull();
  });

  it("review fails with a reset to build: Build gets one item for itself, Test gets one item as background", () => {
    // failure on Review, same text as changes_requested on Build
    const failure = c("Fix the null check", "2026-01-01T00:00:00Z", "review");
    const twin = c("Fix the null check", "2026-01-01T00:00:01Z", "build");
    const buildGets = buildReworkInstructions([twin], [], titles)!;
    expect(buildGets).toMatchObject({ scope: "this_step", earlier_rounds: 0, feedback: { from_step: "Build", content: "Fix the null check" } });
    const testGets = buildReworkInstructions([], [failure, twin], titles)!;
    expect(testGets).toMatchObject({ scope: "earlier_step", earlier_rounds: 0, feedback: { content: "Fix the null check" } });
    expect(JSON.stringify(testGets).split("Fix the null check")).toHaveLength(2); // once
  });

  it("a step rejected back to itself gets one item (failure + twin on the same step)", () => {
    const r = buildReworkInstructions(
      [c("Wrong output", "2026-01-01T00:00:01Z", "build"), c(" Wrong output ", "2026-01-01T00:00:00Z", "build")], [], titles
    )!;
    expect(r.earlier_rounds).toBe(0);
    expect(r.scope).toBe("this_step");
  });

  it("two rounds give the newest in full plus a count of one earlier round", () => {
    const r = buildReworkInstructions(
      [c("round two", "2026-01-02T00:00:00Z", "build"), c("round two", "2026-01-02T00:00:01Z", "build"), c("round one", "2026-01-01T00:00:00Z", "build")],
      [], titles
    )!;
    expect(r.feedback.content).toBe("round two");
    expect(r.earlier_rounds).toBe(1);
    expect(JSON.stringify(r)).not.toContain("round one");
  });

  it("the newest wins whatever order the rows arrive in", () => {
    const r = buildReworkInstructions([c("old", "2026-01-01T00:00:00Z", "build"), c("new", "2026-01-03T00:00:00Z", "build")], [], titles)!;
    expect(r.feedback.content).toBe("new");
  });
});

// Keep the hash helper honest: the guard compares the hash of the presented token.
describe("work token hashing", () => {
  it("hashClaimToken is sha256 hex", () => {
    expect(hashClaimToken("wt_abc")).toBe(createHash("sha256").update("wt_abc").digest("hex"));
  });
});
