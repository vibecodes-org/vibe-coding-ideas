import { describe, it, expect } from "vitest";
import { buildWeeklyReport, shortHash, stepVersion, weekIndex, weekWindows, type WeeklyInput, type WeeklyStepRow } from "./weekly";
import { buildStepPerformanceReport } from "./report";

const END = new Date("2026-10-31T06:00:00.000Z");
const DAY = 86_400_000;
const at = (daysBeforeEnd: number) => new Date(END.getTime() - daysBeforeEnd * DAY).toISOString();

const step = (id: string, run: string, title: string, when: string, o: Partial<WeeklyStepRow> = {}): WeeklyStepRow => ({
  id, idea_id: "i1", run_id: run, title, status: "completed", started_at: when, completed_at: when,
  model_tier: "standard", effort_override: null, description: "do it", ...o,
});
const usage = (step_id: string, run_id: string, read: number, model = "claude-opus-5-5") => ({
  step_id, run_id, model, input_tokens: 0, output_tokens: 0, cache_read_tokens: read, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0,
});
// Opus 5.5 cache read is $0.2 per million: 5M tokens = $1.
const ONE_DOLLAR = 5_000_000;

function input(o: Partial<WeeklyInput> = {}): WeeklyInput {
  return {
    steps: [], runs: [{ id: "r1", template_id: "t1", status: "completed" }, { id: "r2", template_id: "t1", status: "completed" }],
    templates: [{ id: "t1", idea_id: "i1", name: "Bug Fix", updated_at: "2026-10-01T00:00:00Z", steps: [{ title: "Build" }, { title: "Review" }] }],
    sentBackStepIds: new Set(), usage: [], ideas: [{ id: "i1", title: "Board One" }], paths: [],
    weekEndsAt: END, weeks: 3, ...o,
  };
}

describe("week windows", () => {
  it("makes 7-day windows, newest last, the latest ending at week_ends_at", () => {
    const w = weekWindows(END, 3);
    expect(w).toHaveLength(3);
    expect(w[2].end).toBe(END.toISOString());
    expect(w[2].start).toBe(at(7));
    expect(w[0].start).toBe(at(21));
  });
  it("puts a time in the window it falls in; the end moment is inside, the start moment is in the earlier one", () => {
    expect(weekIndex(at(0), END, 3)).toBe(2);
    expect(weekIndex(at(3), END, 3)).toBe(2);
    expect(weekIndex(at(7), END, 3)).toBe(1);
    expect(weekIndex(at(20), END, 3)).toBe(0);
    expect(weekIndex(at(21), END, 3)).toBe(-1);
    expect(weekIndex(new Date(END.getTime() + 1).toISOString(), END, 3)).toBe(-1);
    expect(weekIndex(null, END, 3)).toBe(-1);
  });
});

describe("step version", () => {
  it("changes when tier, effort or instructions change, and not otherwise", () => {
    const base = { model_tier: "standard", effort_override: null, description: "a" };
    expect(stepVersion(base)).toBe(stepVersion({ ...base }));
    expect(stepVersion(base)).not.toBe(stepVersion({ ...base, model_tier: "frontier" }));
    expect(stepVersion(base)).not.toBe(stepVersion({ ...base, effort_override: "high" }));
    expect(stepVersion(base)).not.toBe(stepVersion({ ...base, description: "b" }));
    expect(shortHash("x")).toMatch(/^[0-9a-f]{6}$/);
  });
});

describe("buildWeeklyReport", () => {
  const steps = [
    step("s1", "r1", "Build", at(2)), step("s2", "r1", "Review", at(1)),
    step("s3", "r2", "Build", at(9)), // previous week
  ];
  const us = [usage("s1", "r1", ONE_DOLLAR * 3), usage("s2", "r1", ONE_DOLLAR), usage("s3", "r2", ONE_DOLLAR * 2)];

  it("totals cost per week, per board, per workflow and per step", () => {
    const r = buildWeeklyReport(input({ steps, usage: us }));
    expect(r.vibecodes_total_usd).toEqual([0, 2, 4]);
    expect(r.boards).toEqual([{ idea_id: "i1", title: "Board One", project_path: null, usd: [0, 2, 4], runs: [0, 1, 1] }]);
    expect(r.workflows).toEqual([{ name: "Bug Fix", runs: [0, 1, 1], usd: [0, 2, 4], median_usd: [null, null, 4], sent_back: [0, 0, 0], cost_missing: [0, 0, 0] }]);
    const build = r.steps.find((s) => s.step === "Build")!;
    expect(build.runs).toEqual([0, 1, 1]);
    expect(build.usd).toEqual([0, 2, 3]);
    expect(build.median_usd).toEqual([null, 2, 3]);
    expect(r.prices["claude-opus-5-5"]).toEqual({ in: 4, out: 20, cache_read: 0.2, cache_write_5m: 5, cache_write_1h: 8 });
  });

  it("lists this week's runs with cost and whether work was sent back", () => {
    const r = buildWeeklyReport(input({ steps, usage: us, sentBackStepIds: new Set(["s2"]) }));
    expect(r.runs_this_week).toEqual([{ run_id: "r1", workflow: "Bug Fix", usd: 4, sent_back: true }]);
    expect(r.workflows[0].sent_back).toEqual([0, 0, 1]);
  });

  it("matches the admin report's median cost per step for the same rows", () => {
    const full = [...steps, step("s4", "r2", "Review", at(8))];
    const fullUsage = [...us, usage("s4", "r2", ONE_DOLLAR * 4)];
    const admin = buildStepPerformanceReport({
      steps: full.map((s) => ({ ...s, step_order: 0, human_check_required: false, executed_model: null, reasoning_effort_used: null })),
      runs: [{ id: "r1", template_id: "t1", status: "completed" }, { id: "r2", template_id: "t1", status: "completed" }],
      templates: [{ id: "t1", idea_id: "i1", name: "Bug Fix", steps: [{ title: "Build" }, { title: "Review" }], updated_at: "x" }],
      comments: [], botIds: new Set(), usage: fullUsage, runSteps: [], singleBoard: true,
    });
    const weekly = buildWeeklyReport(input({ steps: full, usage: fullUsage, weeks: 4 }));
    for (const row of admin.templates[0].current) {
      const w = weekly.steps.find((s) => s.step === row.title)!;
      const all = w.median_usd.filter((m): m is number => m !== null);
      // One run per week here, so each week's median is that run's cost; the median of those is the admin figure.
      const sorted = [...all].sort((a, b) => a - b);
      const mid = sorted.length / 2;
      const med = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
      expect(med).toBe(row.medianCost);
    }
    expect(weekly.vibecodes_total_usd.reduce((a, b) => a + b, 0)).toBeCloseTo(admin.summary.costRecorded, 6);
  });

  it("splits a step into versions when its instructions change", () => {
    const s = [step("a", "r1", "Build", at(2), { description: "v1" }), step("b", "r2", "Build", at(3), { description: "v2" })];
    const r = buildWeeklyReport(input({ steps: s }));
    expect(r.steps.filter((x) => x.step === "Build")).toHaveLength(2);
  });

  it("combines same-named workflows from different boards", () => {
    const r = buildWeeklyReport(input({
      steps: [step("a", "r1", "Build", at(2)), step("b", "r2", "Build", at(2), { idea_id: "i2" })],
      runs: [{ id: "r1", template_id: "t1", status: "completed" }, { id: "r2", template_id: "t2", status: "completed" }],
      templates: [
        { id: "t1", idea_id: "i1", name: "Bug Fix", updated_at: "1", steps: [] },
        { id: "t2", idea_id: "i2", name: "bug fix ", updated_at: "2", steps: [] },
      ],
      ideas: [{ id: "i1", title: "A" }, { id: "i2", title: "B" }],
      usage: [usage("a", "r1", ONE_DOLLAR), usage("b", "r2", ONE_DOLLAR)],
    }));
    expect(r.workflows).toHaveLength(1);
    expect(r.workflows[0].runs[2]).toBe(2);
    expect(r.boards.map((b) => b.title).sort()).toEqual(["A", "B"]);
  });

  it("leaves out unfinished steps, steps outside the windows and runs with no workflow, and lists unpriced models", () => {
    const r = buildWeeklyReport(input({
      steps: [
        step("a", "r1", "Build", at(1), { status: "in_progress" }),
        step("b", "r1", "Build", at(40)),
        step("c", "rX", "Build", at(1)),
        step("d", "r2", "Build", at(1)),
      ],
      usage: [usage("d", "r2", ONE_DOLLAR, "claude-mystery-9")],
    }));
    expect(r.workflows[0].runs).toEqual([0, 0, 1]);
    expect(r.unpriced_models).toEqual(["claude-mystery-9"]);
    expect(r.vibecodes_total_usd).toEqual([0, 0, 0]);
    expect(r.steps[0].median_usd).toEqual([null, null, null]);
  });

  it("gives the most recent recorded project folder, or null", () => {
    const r = buildWeeklyReport(input({
      steps, usage: us,
      paths: [
        { idea_id: "i1", absolute_path: "/old", updated_at: "2026-01-01" },
        { idea_id: "i1", absolute_path: "/new", updated_at: "2026-09-01" },
      ],
    }));
    expect(r.boards[0].project_path).toBe("/new");
  });

  it("carries no card text: only names, ids and numbers", () => {
    const r = buildWeeklyReport(input({ steps, usage: us }));
    expect(JSON.stringify(r)).not.toContain("do it");
  });

  it("reports a step with no recorded cost as missing, never as zero dollars", () => {
    const r = buildWeeklyReport(input({ steps, usage: [usage("s1", "r1", ONE_DOLLAR)] }));
    // s2 (this week) and s3 (last week) have no cost rows.
    expect(r.cost_missing).toEqual([0, 1, 1]);
    expect(r.workflows[0].cost_missing).toEqual([0, 1, 1]);
    expect(r.steps.find((x) => x.step === "Review")!.cost_missing).toEqual([0, 0, 1]);
    expect(r.steps.find((x) => x.step === "Review")!.median_usd).toEqual([null, null, null]);
    // Nothing read at all (no cost rows visible): every finished step is missing.
    const none = buildWeeklyReport(input({ steps, usage: [] }));
    expect(none.cost_missing).toEqual([0, 1, 2]);
  });

  it("counts an unpriced model's step as missing", () => {
    const r = buildWeeklyReport(input({ steps: [step("a", "r1", "Build", at(1))], usage: [usage("a", "r1", ONE_DOLLAR, "claude-mystery-9")] }));
    expect(r.cost_missing).toEqual([0, 0, 1]);
  });

  it("keeps a sent-back step that is waiting to re-run, in the week of its last costed attempt", () => {
    const waiting = step("w", "r1", "Build", at(2), { status: "pending", started_at: null, completed_at: null });
    const u = { ...usage("w", "r1", ONE_DOLLAR * 2), created_at: at(2) };
    const r = buildWeeklyReport(input({ steps: [waiting], usage: [u], sentBackStepIds: new Set(["w"]) }));
    expect(r.vibecodes_total_usd).toEqual([0, 0, 2]);
    expect(r.workflows[0].sent_back).toEqual([0, 0, 1]);
    // A pending step with no cost and no send-back is still left out.
    const idle = buildWeeklyReport(input({ steps: [step("p", "r1", "Build", at(2), { status: "pending" })] }));
    expect(idle.workflows).toEqual([]);
  });
  describe("typical cost per run follows the Admin whole-run rule", () => {
    // A finished run on the template (Build + Review), costed $1 + $2 = $3.
    const whole = (run: string, w: number) => [
      step(`${run}b`, run, "Build", at(w)), step(`${run}r`, run, "Review", at(w - 0.5)),
    ];
    const wholeUsage = (run: string, b = 1, r = 2) => [usage(`${run}b`, run, ONE_DOLLAR * b), usage(`${run}r`, run, ONE_DOLLAR * r)];
    const runsOf = (extra: { id: string; status: string }[]) =>
      [{ id: "r1", template_id: "t1", status: "completed" }, ...extra.map((e) => ({ ...e, template_id: "t1" }))];
    const wf = (r: ReturnType<typeof buildWeeklyReport>) => r.workflows[0];

    it("leaves out a dropped plan-only run but still counts its cost and run", () => {
      const steps = [...whole("r1", 2), step("r2b", "r2", "Build", at(2))];
      const r = buildWeeklyReport(input({ steps, usage: [...wholeUsage("r1"), usage("r2b", "r2", ONE_DOLLAR * 10)], runs: runsOf([{ id: "r2", status: "completed" }]) }));
      expect(wf(r).median_usd[2]).toBe(3);
      expect(wf(r).runs[2]).toBe(2);
      expect(wf(r).usd[2]).toBe(13);
    });
    it("leaves out an in-flight run", () => {
      const steps = [...whole("r1", 2), ...whole("r2", 1)];
      const r = buildWeeklyReport(input({ steps, usage: [...wholeUsage("r1"), ...wholeUsage("r2", 9, 9)], runs: runsOf([{ id: "r2", status: "running" }]) }));
      expect(wf(r).median_usd[2]).toBe(3);
      expect(wf(r).runs[2]).toBe(2);
      expect(wf(r).usd[2]).toBe(21);
    });
    it("leaves out a partly costed run but counts it as missing", () => {
      const steps = [...whole("r1", 2), ...whole("r2", 1)];
      const r = buildWeeklyReport(input({ steps, usage: [...wholeUsage("r1"), usage("r2b", "r2", ONE_DOLLAR * 9)], runs: runsOf([{ id: "r2", status: "completed" }]) }));
      expect(wf(r).median_usd[2]).toBe(3);
      expect(wf(r).cost_missing[2]).toBe(1);
      expect(wf(r).usd[2]).toBe(12);
    });
    it("is null when no run qualifies", () => {
      const r = buildWeeklyReport(input({ steps: whole("r1", 2), usage: wholeUsage("r1"), runs: [{ id: "r1", template_id: "t1", status: "running" }] }));
      expect(wf(r).median_usd[2]).toBeNull();
    });
    it("equals the Admin wholeRun.medianCost for the same data", () => {
      const rs = [{ id: "r1", status: "completed" }, { id: "r2", status: "completed" }, { id: "r3", status: "completed" }, { id: "r4", status: "running" }, { id: "r5", status: "completed" }];
      const steps = [...whole("r1", 2), ...whole("r2", 3), ...whole("r3", 1), ...whole("r4", 1), step("r5b", "r5", "Build", at(2))];
      const us = [...wholeUsage("r1", 1, 2), ...wholeUsage("r2", 5, 5), ...wholeUsage("r3", 2, 2), ...wholeUsage("r4", 9, 9), usage("r5b", "r5", ONE_DOLLAR * 7)];
      const runs = rs.map((x) => ({ ...x, template_id: "t1" }));
      const admin = buildStepPerformanceReport({
        steps: steps.map((s) => ({ ...s, step_order: 0, human_check_required: false, executed_model: null, reasoning_effort_used: null })),
        runs, templates: [{ id: "t1", idea_id: "i1", name: "Bug Fix", steps: [{ title: "Build" }, { title: "Review" }], updated_at: "x" }],
        comments: [], botIds: new Set(), usage: us, runSteps: [], singleBoard: true,
      });
      const weekly = buildWeeklyReport(input({ steps, usage: us, runs }));
      expect(admin.templates[0].wholeRun?.medianCost).toBe(4);
      expect(wf(weekly).median_usd[2]).toBe(admin.templates[0].wholeRun!.medianCost);
    });
  });
});
