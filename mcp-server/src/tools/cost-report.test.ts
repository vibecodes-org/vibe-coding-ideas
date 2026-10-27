import { describe, it, expect } from "vitest";
import type { McpContext } from "../context";
import { fitReport, getCostReport, getCostReportSchema, MAX_REPORT_CHARS } from "./cost-report";
import { buildWeeklyReport } from "../../../src/lib/step-cost/weekly";
import { jsonResult } from "../register-tools";

const ME = "00000000-0000-4000-a000-00000000000a";
const END = "2026-10-31T06:00:00.000Z";
const WHEN = "2026-10-28T10:00:00.000Z";

type Row = Record<string, unknown>;

/** A supabase stand-in: each table returns its rows, pages honour range(), and every eq() is recorded. */
function fakeDb(tables: Record<string, Row[]>) {
  const eqs: { table: string; col: string; val: unknown }[] = [];
  const from = (table: string) => {
    let start = 0;
    let end = Infinity;
    const mine: { col: string; val: unknown }[] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "not", "or", "gte", "order", "in"]) chain[m] = () => chain;
    chain.eq = (col: string, val: unknown) => {
      eqs.push({ table, col, val });
      mine.push({ col, val });
      return chain;
    };
    chain.range = (a: number, b: number) => {
      start = a;
      end = b;
      return chain;
    };
    chain.then = (resolve: (v: unknown) => unknown) => {
      let rows = tables[table] ?? [];
      // Honour eq filters on the columns the rows carry, as the real database would.
      for (const e of mine) rows = rows.filter((r) => !(e.col in r) || r[e.col] === e.val);
      return Promise.resolve({ data: rows.slice(start, end + 1), error: null }).then(resolve);
    };
    return chain;
  };
  return { db: { from } as unknown as McpContext["supabase"], eqs };
}

const world = (): Record<string, Row[]> => ({
  ideas: [
    { id: "mine", author_id: ME, title: "My Board" },
    { id: "shared", author_id: "someone", title: "Shared Board" },
    { id: "other", author_id: "someone", title: "Not Mine" },
  ],
  collaborators: [{ idea_id: "shared", user_id: ME }],
  idea_project_paths: [
    { idea_id: "mine", owner_user_id: ME, absolute_path: "/Users/x/proj/.claude/worktrees/abc", updated_at: "2026-10-01" },
    { idea_id: "mine", owner_user_id: "someone", absolute_path: "/not/mine", updated_at: "2026-10-02" },
  ],
  workflow_templates: [
    { id: "t-mine", idea_id: "mine", name: "Bug Fix", updated_at: "1" },
    { id: "t-other", idea_id: "other", name: "Bug Fix", updated_at: "1" },
  ],
  task_workflow_steps: [
    { id: "s1", idea_id: "mine", run_id: "r1", title: "Fix", status: "completed", started_at: WHEN, completed_at: WHEN, model_tier: "standard", effort_override: null, description: "SECRET PROMPT" },
    { id: "s2", idea_id: "other", run_id: "r2", title: "Fix", status: "completed", started_at: WHEN, completed_at: WHEN, model_tier: "standard", effort_override: null, description: "x" },
  ],
  workflow_runs: [
    { id: "r1", template_id: "t-mine" },
    { id: "r2", template_id: "t-other" },
  ],
  workflow_step_comments: [{ step_id: "s1", idea_id: "mine", type: "changes_requested" }],
  workflow_step_usage: [
    { step_id: "s1", run_id: "r1", idea_id: "mine", model: "claude-opus-5-5", input_tokens: 0, output_tokens: 0, cache_read_tokens: 5_000_000, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 },
    { step_id: "s2", run_id: "r2", idea_id: "other", model: "claude-opus-5-5", input_tokens: 0, output_tokens: 0, cache_read_tokens: 50_000_000, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 },
  ],
});

describe("getCostReport", () => {
  it("covers only boards the caller authored or collaborates on, with no admin check", async () => {
    const { db, eqs } = fakeDb(world());
    const out = await getCostReport({ supabase: db, userId: "bot", ownerUserId: ME }, getCostReportSchema.parse({ week_ends_at: END, weeks: 2 }));
    expect(out.boards.map((b) => b.idea_id)).toEqual(["mine"]);
    expect(out.vibecodes_total_usd).toEqual([0, 1]);
    // Every board read is scoped by idea_id, and never for the board the caller isn't on.
    const scoped = eqs.filter((e) => e.col === "idea_id").map((e) => e.val);
    expect(scoped.length).toBeGreaterThan(0);
    expect(new Set(scoped)).toEqual(new Set(["mine", "shared"]));
  });

  it("gives the caller's own recorded folder with a worktree stripped, sent-back runs, and no card text", async () => {
    const { db } = fakeDb(world());
    const out = await getCostReport({ supabase: db, userId: ME }, getCostReportSchema.parse({ week_ends_at: END }));
    expect(out.boards[0].project_path).toBe("/Users/x/proj");
    expect(out.runs_this_week).toEqual([{ run_id: "r1", workflow: "Bug Fix", usd: 1, sent_back: true }]);
    expect(out.weeks).toHaveLength(8);
    expect(JSON.stringify(out)).not.toContain("SECRET PROMPT");
  });

  it("rejects weeks outside 1-26", () => {
    expect(() => getCostReportSchema.parse({ weeks: 27 })).toThrow();
    expect(() => getCostReportSchema.parse({ weeks: 0 })).toThrow();
    expect(getCostReportSchema.parse({}).weeks).toBe(8);
  });
});

describe("fitReport", () => {
  function big(weeks: number, n: number) {
    const end = new Date(END);
    const series = (v: number) => Array.from({ length: weeks }, (_, i) => v + i);
    const base = buildWeeklyReport({ steps: [], runs: [], templates: [], sentBackStepIds: new Set(), usage: [], ideas: [], paths: [], weekEndsAt: end, weeks });
    return {
      ...base,
      boards: Array.from({ length: n }, (_, i) => ({ idea_id: `00000000-0000-4000-a000-${String(i).padStart(12, "0")}`, title: `Board number ${i}`, project_path: `/Users/someone/projects/board-${i}`, usd: series(123.45), runs: series(3) })),
      workflows: Array.from({ length: n }, (_, i) => ({ name: `Workflow ${i}`, runs: series(3), usd: series(99.12), median_usd: series(12.34), sent_back: series(1) })),
      steps: Array.from({ length: n * 3 }, (_, i) => ({ workflow: `Workflow ${i}`, step: `Step ${i}`, version: "a1b2c3", runs: series(3), median_usd: series(2.5), usd: series(7.77) })),
      runs_this_week: Array.from({ length: n }, (_, i) => ({ run_id: `00000000-0000-4000-b000-${String(i).padStart(12, "0")}`, workflow: `Workflow ${i}`, usd: 12.5, sent_back: i % 2 === 0 })),
    };
  }

  it("keeps a large report under 12,000 characters as jsonResult sends it, and says what was cut", () => {
    const out = fitReport(big(26, 60), "2026-10-31T06:00:00.000Z");
    const text = jsonResult(out).content[0].text;
    expect(text.length).toBeLessThanOrEqual(MAX_REPORT_CHARS);
    expect(out.truncated?.steps?.total).toBe(180);
    expect(out.truncated?.steps?.shown).toBeLessThan(180);
    // The biggest spenders stay: lists arrive sorted and are only cut from the tail.
    expect(out.steps[0].step).toBe("Step 0");
  });

  it("leaves a small report whole, with no truncated field", () => {
    const out = fitReport(big(8, 2), "2026-10-31T06:00:00.000Z");
    expect(out.truncated).toBeUndefined();
    expect(out.boards).toHaveLength(2);
  });
});
