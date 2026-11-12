import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpContext } from "../context";
import { offerNextCard } from "./session-offers";
import { buildSessionEnvValue } from "../../../terminal/shared/peer-message.mjs";

const ME = "00000000-0000-4000-a000-000000000001";
const TASK = "00000000-0000-4000-a000-0000000000a1";
const OTHER_TASK = "00000000-0000-4000-a000-0000000000a2";
const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256)).toString("base64");

type Row = Record<string, unknown>;
let sessions: Row[] = [];
let tasks: Row[] = [];
let runs: Row[] = [];
let offers: Row[] = [];
let upsertCalls: Row[] = [];
let updateFilters: Array<[string, unknown]> = [];
let updateValues: Row | null = null;
let nextTaskRows: Row[] = [];

function ctx(): McpContext {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let op: "select" | "update" = "select";
    const c: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "range", "neq", "or", "in", "not"]) c[m] = vi.fn(() => c);
    c.update = vi.fn((v: Row) => ((op = "update"), (updateValues = v), c));
    c.eq = vi.fn((k: string, v: unknown) => (filters.push([k, v]), c));
    c.upsert = vi.fn(async (row: Row) => {
      upsertCalls.push(row);
      offers = [row];
      return { error: null };
    });
    const rows = () => {
      if (table === "terminal_sessions") return sessions.filter((r) => filters.every(([k, v]) => r[k] === v));
      if (table === "board_tasks") {
        // pickNextCard asks for a column; the tool asks for one id.
        if (filters.some(([k]) => k === "column_id")) return nextTaskRows.filter((r) => r.column_id === filters.find(([k]) => k === "column_id")![1]);
        return tasks.filter((r) => filters.every(([k, v]) => r[k] === v));
      }
      if (table === "workflow_runs") return runs.filter((r) => filters.every(([k, v]) => r[k] === v));
      if (table === "board_columns") return [{ id: "c-todo", title: "To Do" }];
      return [];
    };
    c.maybeSingle = vi.fn(async () => ({ data: rows()[0] ?? null, error: null }));
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      if (op === "update") updateFilters = filters;
      return Promise.resolve({ data: op === "update" ? null : rows(), error: null }).then(res, rej);
    };
    return c;
  };
  return { supabase: { from } as unknown as McpContext["supabase"], userId: ME };
}

const mine = () => buildSessionEnvValue(Buffer.from(KEY, "base64"), "sid-1");

beforeEach(() => {
  process.env.TERMINAL_SESSION_SECRET = "test-secret";
  upsertCalls = [];
  updateFilters = [];
  updateValues = null;
  offers = [];
  sessions = [
    {
      sid: "sid-1", user_id: ME, status: "active", idea_id: "idea-1", agent: "codex", display_name: "S",
      machine_label: "Mac", task_id: null, task_title: null, e2ee_session_key: KEY,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    },
  ];
  tasks = [
    { id: TASK, title: "Finished card", idea_id: "idea-1" },
    { id: OTHER_TASK, title: "Elsewhere", idea_id: "idea-2" },
  ];
  runs = [{ id: "r1", task_id: TASK, status: "completed" }];
  nextTaskRows = [
    { id: "n1", title: "The next one", column_id: "c-todo", position: 1, archived: false, workflow_step_in_progress: 0, workflow_step_awaiting_approval: 0 },
  ];
});

describe("offerNextCard", () => {
  it("refuses with no session value and stores nothing", async () => {
    const r = await offerNextCard(ctx(), { finished_task_id: TASK });
    expect(r.shown).toBe(false);
    expect(r.message).toContain("printenv VIBECODES_SESSION");
    expect(upsertCalls).toHaveLength(0);
  });

  it("refuses a wrong session value", async () => {
    const r = await offerNextCard(ctx(), { finished_task_id: TASK, from_session: "sid-1.wrongproof" });
    expect(r.shown).toBe(false);
    expect(upsertCalls).toHaveLength(0);
  });

  it("refuses a card whose newest run is not finished", async () => {
    for (const status of ["running", "pending", "paused", "failed"]) {
      runs = [{ id: "r1", task_id: TASK, status }];
      const r = await offerNextCard(ctx(), { finished_task_id: TASK, from_session: mine() });
      expect(r.shown).toBe(false);
      expect(r.message).toContain("whole workflow has finished");
    }
    expect(upsertCalls).toHaveLength(0);
  });

  it("refuses a card with no workflow", async () => {
    runs = [];
    const r = await offerNextCard(ctx(), { finished_task_id: TASK, from_session: mine() });
    expect(r.shown).toBe(false);
    expect(upsertCalls).toHaveLength(0);
  });

  it("refuses a card from another board", async () => {
    const r = await offerNextCard(ctx(), { finished_task_id: OTHER_TASK, from_session: mine() });
    expect(r.shown).toBe(false);
    expect(r.message).toContain("isn't on this session's board");
    expect(upsertCalls).toHaveLength(0);
  });

  it("stores the offer with the server-chosen next card and the session's own agent", async () => {
    const r = await offerNextCard(ctx(), { finished_task_id: TASK, still_working_on: 2, from_session: mine() });
    expect(r.shown).toBe(true);
    expect(r.next_card).toEqual({ id: "n1", title: "The next one" });
    expect(upsertCalls[0]).toMatchObject({
      sid: "sid-1", user_id: ME, idea_id: "idea-1", finished_task_id: TASK, finished_task_title: "Finished card",
      next_task_id: "n1", next_task_title: "The next one", agent: "codex", still_working_on: 2, status: "offered",
    });
  });

  it("never takes the next card from the caller", async () => {
    const params = { finished_task_id: TASK, next_task_id: OTHER_TASK, from_session: mine() } as unknown as Parameters<typeof offerNextCard>[1];
    await offerNextCard(ctx(), params);
    expect(upsertCalls[0].next_task_id).toBe("n1");
  });

  it("stores a 'nothing next' offer when no card is waiting", async () => {
    nextTaskRows = [];
    const r = await offerNextCard(ctx(), { finished_task_id: TASK, from_session: mine() });
    expect(r.shown).toBe(true);
    expect(r.next_card).toBeNull();
    expect(upsertCalls[0]).toMatchObject({ next_task_id: null, next_task_title: null });
  });

  it("a second offer replaces the first (upsert on the session id)", async () => {
    await offerNextCard(ctx(), { finished_task_id: TASK, from_session: mine() });
    await offerNextCard(ctx(), { finished_task_id: TASK, from_session: mine() });
    expect(upsertCalls).toHaveLength(2);
    expect(offers).toHaveLength(1);
  });

  it("withdraw marks only this session's own offer dismissed (never deletes: delete events can't reach a filtered live feed), and is safe to repeat", async () => {
    const a = await offerNextCard(ctx(), { withdraw: true, from_session: mine() });
    const b = await offerNextCard(ctx(), { withdraw: true, from_session: mine() });
    expect(a.withdrawn).toBe(true);
    expect(b.withdrawn).toBe(true);
    expect(updateValues).toMatchObject({ status: "dismissed" });
    expect(updateFilters).toEqual([["sid", "sid-1"], ["user_id", ME]]);
  });

  it("asks for finished_task_id when not withdrawing", async () => {
    const r = await offerNextCard(ctx(), { from_session: mine() });
    expect(r.shown).toBe(false);
    expect(upsertCalls).toHaveLength(0);
  });
});
