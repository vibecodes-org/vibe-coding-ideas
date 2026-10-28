import { describe, it, expect } from "vitest";
import { buildCostTrends, ukDay, ukWeekStart, type TrendsInput } from "./trends";
import { buildStepPerformanceReport, type ReportStepRow } from "./report";

const NOW = new Date("2026-10-28T09:00:00Z"); // Wednesday
// Opus 5.5 cache read is $0.2 per million tokens: 5M tokens = $1.
const ONE = 5_000_000;
const usage = (step_id: string, run_id: string, dollars: number, model = "claude-opus-5-5", created_at?: string) => ({
  step_id, run_id, model, input_tokens: 0, output_tokens: 0, cache_read_tokens: ONE * dollars, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, created_at,
});
const step = (id: string, run: string, title: string, when: string, o: Partial<ReportStepRow> = {}): ReportStepRow => ({
  id, idea_id: "i1", run_id: run, title, status: "completed", step_order: 1, human_check_required: false,
  started_at: when, completed_at: when, executed_model: null, reasoning_effort_used: null, ...o,
});
const tpl = (id: string, name: string) => ({ id, idea_id: "i1", name, updated_at: "2026-10-01T00:00:00Z", steps: [{ title: "Build" }, { title: "Review" }] });

function input(o: Partial<TrendsInput> = {}): TrendsInput {
  return {
    steps: [], runs: [], templates: [tpl("t1", "Bug Fix")], comments: [], botIds: new Set(), usage: [],
    grain: "week", from: "2026-09-28T00:00:00Z", now: NOW, ...o,
  };
}
const run = (id: string, template_id = "t1", status = "completed") => ({ id, template_id, status });

describe("UK-time buckets", () => {
  it("finds the UK day and the Monday of its week", () => {
    expect(ukDay("2026-10-28T09:00:00Z")).toBe("2026-10-28");
    expect(ukWeekStart("2026-10-28T09:00:00Z")).toBe("2026-10-26");
    expect(ukWeekStart("2026-10-25T23:30:00Z")).toBe("2026-10-19"); // Sunday night
  });
  it("handles the clock change on 25 Oct and summer time", () => {
    // Sunday 18 Oct 23:30 UTC is already Monday 00:30 in summer time: next week.
    expect(ukDay("2026-10-18T23:30:00Z")).toBe("2026-10-19");
    expect(ukWeekStart("2026-10-18T23:30:00Z")).toBe("2026-10-19");
    // 00:30 UTC Monday 26 Oct is 00:30 GMT: that Monday.
    expect(ukWeekStart("2026-10-26T00:30:00Z")).toBe("2026-10-26");
    // 23:30 UTC on Saturday 24 Oct is Sunday 00:30 BST: still the 19 Oct week.
    expect(ukDay("2026-10-24T23:30:00Z")).toBe("2026-10-25");
  });
});

describe("buildCostTrends cost buckets", () => {
  const steps = [
    step("s1", "r1", "Build", "2026-10-20T10:00:00Z"),
    step("s2", "r1", "Review", "2026-10-21T10:00:00Z"),
    step("s3", "r2", "Build", "2026-10-27T10:00:00Z"),
    step("s4", "r2", "Review", "2026-10-27T11:00:00Z"),
  ];
  const us = [
    usage("s1", "r1", 3), usage("s2", "r1", 1, "claude-sonnet-5-5"),
    usage("s3", "r2", 2, "claude-haiku-5-5"), // other
    // s4 has no cost
  ];
  const base = () => input({ steps, runs: [run("r1"), run("r2")], usage: us });

  it("splits cost by model family and week, marks the current week partial", () => {
    const t = buildCostTrends(base());
    const wk = (s: string) => t.cost.find((b) => b.start === s)!;
    expect(wk("2026-10-19")).toMatchObject({ partial: false, finished: 2, costed: 2 });
    expect(wk("2026-10-19").opus).toBeCloseTo(3, 6);
    expect(wk("2026-10-19").sonnet).toBeCloseTo(1, 6);
    expect(wk("2026-10-26")).toMatchObject({ partial: true, finished: 2, costed: 1 });
    expect(wk("2026-10-26").other).toBeGreaterThan(0);
    expect(t.cost.map((b) => b.start)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  });

  it("bucket totals add up to the report's cost recorded", () => {
    const i = base();
    const t = buildCostTrends(i);
    const report = buildStepPerformanceReport({ ...i, runSteps: [], singleBoard: false });
    const sum = t.cost.reduce((a, b) => a + b.total, 0);
    expect(sum).toBeCloseTo(report.summary.costRecorded, 9);
    expect(sum).toBeGreaterThan(0);
  });

  it("groups by day when asked, with a bar for every day", () => {
    const t = buildCostTrends({ ...base(), grain: "day", from: "2026-10-19T00:00:00Z" });
    expect(t.cost).toHaveLength(10);
    expect(t.cost[0].start).toBe("2026-10-19");
    expect(t.cost[9]).toMatchObject({ start: "2026-10-28", partial: true });
    expect(t.cost.find((b) => b.start === "2026-10-20")!.opus).toBeCloseTo(3, 6);
    expect(t.cost.find((b) => b.start === "2026-10-22")!.total).toBe(0);
    // weekly figures are still given for the run charts
    expect(t.weeks[0].start).toBe("2026-10-19");
  });

  it("a step with an unpriced model counts as no cost, not a low cost", () => {
    const t = buildCostTrends(input({ steps: [steps[0]], runs: [run("r1")], usage: [usage("s1", "r1", 1), usage("s1", "r1", 1, "mystery-model")] }));
    const b = t.cost.find((x) => x.start === "2026-10-19")!;
    expect(b).toMatchObject({ finished: 1, costed: 0, total: 0 });
  });

  it("puts a step waiting to re-run (its agent caught a problem) at its last usage time", () => {
    // The review failed and sent work back to Build; both were reset and are waiting again.
    const build = step("w1", "r1", "Build", "2026-10-06T10:00:00Z");
    const review = step("w2", "r1", "Review", "2026-10-21T10:00:00Z", { status: "pending", completed_at: null, started_at: null });
    const t = buildCostTrends(input({
      steps: [build, review], runs: [run("r1", "t1", "in_progress")], botIds: new Set(["bot"]),
      comments: [
        { step_id: "w2", type: "failure", author_id: "bot", created_at: "2026-10-21T10:00:00Z" },
        { step_id: "w1", type: "changes_requested", author_id: "bot", created_at: "2026-10-21T10:00:05Z" },
      ],
      usage: [usage("w2", "r1", 2, "claude-opus-5-5", "2026-10-21T09:50:00Z")],
    }));
    expect(t.cost.find((b) => b.start === "2026-10-19")!.opus).toBeCloseTo(2, 6);
  });

  it("is empty with no input", () => {
    const t = buildCostTrends(input());
    expect(t.cost.every((b) => b.total === 0)).toBe(true);
    expect(t.runCost).toEqual([]);
    expect(t.sentBack.every((s) => s.runs === 0)).toBe(true);
    expect(t.summary.lastFullWeek).toBeNull();
    expect(t.summary.workflowMoves).toEqual([]);
  });
});

describe("buildCostTrends run charts", () => {
  const mk = (n: number, tid: string, when: string, cost: number, skipCostOn?: string) => {
    const steps: ReportStepRow[] = [];
    const us = [];
    const runs = [];
    for (let i = 0; i < n; i++) {
      const r = `${tid}-${when}-${i}`;
      runs.push(run(r, tid));
      for (const title of ["Build", "Review"]) {
        const id = `${r}-${title}`;
        steps.push(step(id, r, title, when));
        if (!(skipCostOn && i === 0 && title === "Review")) us.push(usage(id, r, cost / 2));
      }
    }
    return { steps, us, runs };
  };

  it("takes the median of finished runs, leaving out a run with one uncosted step", () => {
    const a = mk(3, "t1", "2026-10-20T10:00:00Z", 6, "skip"); // first run has an uncosted step
    const t = buildCostTrends(input({ steps: a.steps, usage: a.us, runs: a.runs }));
    const bf = t.runCost.find((r) => r.name === "Bug Fix")!;
    const p = bf.points.find((x) => x.start === "2026-10-19")!;
    expect(p.runs).toBe(2);
    expect(p.median).toBeCloseTo(6, 6);
    expect(bf.points.find((x) => x.start === "2026-10-12")!.median).toBeNull();
  });

  it("keeps only the 3 workflows with the most runs, combining same names across templates", () => {
    const w = "2026-10-20T10:00:00Z";
    const parts = [mk(5, "t1", w, 4), mk(4, "t2", w, 4), mk(3, "t3", w, 4), mk(2, "t4", w, 4), mk(1, "t5", w, 4), mk(2, "t6", w, 4)];
    const t = buildCostTrends(input({
      steps: parts.flatMap((p) => p.steps), usage: parts.flatMap((p) => p.us), runs: parts.flatMap((p) => p.runs),
      templates: [tpl("t1", "Bug Fix"), tpl("t2", "Feature"), tpl("t3", "Build slice"), tpl("t4", "Tiny"), tpl("t5", "Rare"), tpl("t6", "bug fix")],
    }));
    expect(t.runCost.map((r) => r.name)).toEqual(["Bug Fix", "Feature", "Build slice"]);
    expect(t.runCost[0].points.find((p) => p.start === "2026-10-19")!.runs).toBe(7); // t1 + t6 combined
  });

  it("counts finished runs and those sent back at least once", () => {
    const a = mk(4, "t1", "2026-10-20T10:00:00Z", 2);
    const comments = [
      { step_id: a.steps[0].id, type: "changes_requested", author_id: "bot", created_at: "2026-10-20T11:00:00Z" },
      { step_id: a.steps[2].id, type: "changes_requested", author_id: "bot", created_at: "2026-10-20T11:00:00Z" },
    ];
    const runs = a.runs.map((r, i) => (i === 3 ? { ...r, status: "in_progress" } : r));
    const t = buildCostTrends(input({ steps: a.steps, usage: a.us, runs, comments }));
    const w = t.sentBack.find((s) => s.start === "2026-10-19")!;
    expect(w).toMatchObject({ runs: 3, sentBack: 2, partial: false });
  });

  it("summary compares the last full week with the 4 before it, and the run cost of the busiest workflows", () => {
    const weeks = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"];
    const parts = weeks.map((d, i) => mk(1, "t1", `${d}T10:00:00Z`, i === 3 ? 20 : 10));
    const now = mk(2, "t1", "2026-10-27T10:00:00Z", 8);
    const all = [...parts, now];
    const t = buildCostTrends(input({
      steps: all.flatMap((p) => p.steps), usage: all.flatMap((p) => p.us), runs: all.flatMap((p) => p.runs),
    }));
    expect(t.summary.lastFullWeek).toMatchObject({ start: "2026-10-19" });
    expect(t.summary.lastFullWeek!.total).toBeCloseTo(20, 6);
    expect(t.summary.lastFullWeek!.changePct).toBeCloseTo(100, 6); // 20 vs average 10
    expect(t.summary.workflowMoves).toHaveLength(1);
    expect(t.summary.workflowMoves[0]).toMatchObject({ name: "Bug Fix", from: 20, to: 8 });
  });

  it("leaves a week cut short by a mid-week start out of the comparison, and says how many weeks it used", () => {
    const mkAll = () => {
      // The cut-short week (from Thu 1 Oct) holds a big step that would inflate the average.
      const parts = [mk(1, "t1", "2026-10-01T10:00:00Z", 100), mk(1, "t1", "2026-10-06T10:00:00Z", 10), mk(1, "t1", "2026-10-13T10:00:00Z", 10), mk(1, "t1", "2026-10-20T10:00:00Z", 20)];
      return { steps: parts.flatMap((p) => p.steps), usage: parts.flatMap((p) => p.us), runs: parts.flatMap((p) => p.runs) };
    };
    const t = buildCostTrends(input({ ...mkAll(), from: "2026-10-01T00:00:00Z" }));
    expect(t.weeks[0]).toMatchObject({ start: "2026-09-28", cutShort: true });
    expect(t.weeks[1].cutShort).toBe(false);
    expect(t.summary.lastFullWeek).toMatchObject({ start: "2026-10-19", comparedWeeks: 2 });
    expect(t.summary.lastFullWeek!.changePct).toBeCloseTo(100, 6); // 20 vs 10, not vs the 4-week mean with the cut-short week

    // With the period starting later, only one full week is left to compare: no percentage.
    const late = mkAll();
    const keep = new Set(late.steps.filter((x) => x.started_at! >= "2026-10-08").map((x) => x.id));
    const few = buildCostTrends(input({
      steps: late.steps.filter((x) => keep.has(x.id)), usage: late.usage.filter((u) => keep.has(u.step_id)),
      runs: late.runs.filter((r) => late.steps.some((x) => x.run_id === r.id && keep.has(x.id))), from: "2026-10-08T00:00:00Z",
    }));
    expect(few.summary.lastFullWeek).toMatchObject({ comparedWeeks: 1, changePct: null });
  });
});

describe("buildCostTrends unmeasured (card 1117ac6b stage 2)", () => {
  const steps = [
    step("s1", "r1", "Build", "2026-10-20T10:00:00Z"),
    step("s2", "r1", "Review", "2026-10-21T10:00:00Z"),
    step("s3", "r2", "Build", "2026-10-27T10:00:00Z"),
    step("s4", "r2", "Review", "2026-10-27T11:00:00Z"),
    step("s5", "r2", "Test", "2026-10-27T12:00:00Z"),
  ];
  const us = [usage("s1", "r1", 3), usage("s3", "r2", 2)];
  const rec = (step_id: string, kind: "unavailable" | "no_transcript" | "unreadable" | "codex", reason: string | null, created_at: string) => ({ step_id, kind, reason, created_at });
  const unmeasured = [
    rec("s2", "no_transcript", "no-script", "2026-10-21T10:00:00Z"),
    rec("s4", "no_transcript", "no-script", "2026-10-27T11:00:00Z"),
    rec("s1", "unavailable", "no shell", "2026-10-19T10:00:00Z"), // s1 has a cost: stays costed
  ];
  const base = (o: Partial<TrendsInput> = {}) => input({ steps, runs: [run("r1"), run("r2")], usage: us, unmeasured, ...o });

  it("costed + unmeasured + missing = finished in every bucket, at week and day grain", () => {
    for (const grain of ["week", "day"] as const) {
      const t = buildCostTrends(base({ grain }));
      for (const b of t.cost) expect(b.costed + b.unmeasured).toBeLessThanOrEqual(b.finished);
      const sum = (k: "finished" | "costed" | "unmeasured") => t.cost.reduce((a, b) => a + b[k], 0);
      expect(sum("finished")).toBe(5);
      expect(sum("costed")).toBe(2);
      expect(sum("unmeasured")).toBe(2);
    }
    const wk = buildCostTrends(base()).cost.find((b) => b.start === "2026-10-26")!;
    expect(wk).toMatchObject({ finished: 3, costed: 1, unmeasured: 1 }); // s5 is missing
  });

  it("a step with a cost counts as costed even if an attempt couldn't be measured", () => {
    const t = buildCostTrends(base());
    expect(t.cost.find((b) => b.start === "2026-10-19")).toMatchObject({ finished: 2, costed: 1, unmeasured: 1 });
    expect(t.unmeasuredReasons.map((r) => r.steps).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("groups the reasons, uses each step's latest record, and sorts by steps then recency", () => {
    const more = [
      ...unmeasured,
      rec("s5", "unavailable", "No  Shell", "2026-10-27T12:00:00Z"),
      rec("s5", "unreadable", "not JSON", "2026-10-27T12:30:00Z"), // later record replaces s5's earlier one
    ];
    const t = buildCostTrends(base({ unmeasured: more }));
    expect(t.unmeasuredReasons).toEqual([
      { key: "no_transcript:no-script", kind: "no_transcript", reason: "no-script", steps: 2, lastAt: "2026-10-27T11:00:00Z" },
      { key: "unreadable", kind: "unreadable", reason: "not JSON", steps: 1, lastAt: "2026-10-27T12:30:00Z" },
    ]);
  });

  it("with no unmeasured input everything is zero and the list is empty", () => {
    const t = buildCostTrends(base({ unmeasured: undefined }));
    expect(t.cost.every((b) => b.unmeasured === 0)).toBe(true);
    expect(t.unmeasuredReasons).toEqual([]);
  });
});
