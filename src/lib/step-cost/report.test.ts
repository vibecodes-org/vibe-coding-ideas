import { describe, it, expect } from "vitest";
import { buildStepPerformanceReport, median, type ReportInput, type ReportStepRow } from "./report";

const BOT = "bot";
const HUMAN = "human";
const T_FEATURE = { id: "t1", idea_id: "board-a", name: "Feature Development", steps: [{ title: "Plan" }, { title: "Build" }, { title: "Code review" }] };

let n = 0;
function step(run: string, title: string, o: Partial<ReportStepRow> = {}): ReportStepRow {
  n++;
  return {
    id: `s${n}`, idea_id: "board-a", run_id: run, title, status: "completed", step_order: 1,
    started_at: "2026-10-14T10:00:00Z", completed_at: "2026-10-14T10:10:00Z",
    executed_model: "opus", reasoning_effort_used: "high", ...o,
  };
}
const opus = (step_id: string, run_id: string, read: number) => ({
  step_id, run_id, model: "claude-opus-5-5", input_tokens: 0, output_tokens: 0, cache_read_tokens: read, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0,
});

function input(o: Partial<ReportInput>): ReportInput {
  return { steps: [], runs: [], templates: [T_FEATURE], comments: [], botIds: new Set([BOT]), usage: [], singleBoard: true, ...o };
}

describe("median", () => {
  it("handles empty, odd and even lists", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("buildStepPerformanceReport", () => {
  it("counts catches by agents, rejections by people and rework sent to a step", () => {
    const plan = step("r1", "Plan");
    const build = step("r1", "Build");
    const review = step("r1", "Code review");
    const r = buildStepPerformanceReport(input({
      steps: [plan, build, review],
      runs: [{ id: "r1", template_id: "t1", status: "completed" }],
      comments: [
        { step_id: review.id, type: "failure", author_id: BOT },
        { step_id: build.id, type: "changes_requested", author_id: BOT },
        { step_id: plan.id, type: "failure", author_id: HUMAN },
        { step_id: plan.id, type: "failure", author_id: HUMAN },
      ],
    }));
    const rows = Object.fromEntries(r.templates[0].current.map((s) => [s.title, s]));
    expect(rows["Code review"]).toMatchObject({ ran: 1, caught: 1, rejected: 0, redo: 0 });
    expect(rows["Build"]).toMatchObject({ caught: 0, redo: 1 });
    // Two rejections of one run count once: "rejected in 1 of 1 runs".
    expect(rows["Plan"]).toMatchObject({ rejected: 1 });
    expect(r.summary.workSentBack).toBe(1);
  });

  it("keeps current steps in template order and moves renamed steps to earlier versions", () => {
    const steps = [
      step("r1", "Code review"), step("r1", "Plan"),
      ...["r2", "r3", "r4"].map((run) => step(run, "Requirements", { step_order: 1 })),
      ...["r2", "r3", "r4"].map((run) => step(run, "QA Testing", { step_order: 5 })),
      step("r2", "Old one-off", { step_order: 9 }),
    ];
    const r = buildStepPerformanceReport(input({
      steps,
      runs: ["r1", "r2", "r3", "r4"].map((id) => ({ id, template_id: "t1", status: "completed" })),
    }));
    const t = r.templates[0];
    expect(t.current.map((s) => s.title)).toEqual(["Plan", "Code review"]);
    expect(t.currentRuns).toBe(1);
    // Ran fewer than 3 times, so left out.
    expect(t.earlier.map((s) => s.title)).toEqual(["Requirements", "QA Testing"]);
    expect(t.earlierRuns).toBe(3);
  });

  it("ignores steps that haven't finished an attempt, and steps outside a template", () => {
    const r = buildStepPerformanceReport(input({
      steps: [step("r1", "Plan", { status: "pending" }), step("r1", "Build", { status: "in_progress" }), step("r2", "Plan")],
      runs: [{ id: "r1", template_id: "t1", status: "running" }, { id: "r2", template_id: null, status: "completed" }],
    }));
    expect(r.templates).toEqual([]);
    expect(r.summary.runs).toBe(0);
  });

  it("works out median time and cost per step, and the whole run's", () => {
    const a = step("r1", "Plan", { completed_at: "2026-10-14T10:20:00Z" });
    const b = step("r1", "Build");
    const c = step("r2", "Plan", { completed_at: "2026-10-14T10:40:00Z" });
    const d = step("r2", "Build");
    const r = buildStepPerformanceReport(input({
      steps: [a, b, c, d],
      runs: [{ id: "r1", template_id: "t1", status: "completed" }, { id: "r2", template_id: "t1", status: "completed" }],
      // $0.20 per million cache-read tokens on Opus 5.5.
      usage: [opus(a.id, "r1", 10_000_000), opus(a.id, "r1", 5_000_000), opus(b.id, "r1", 5_000_000), opus(c.id, "r2", 20_000_000), opus(d.id, "r2", 5_000_000)],
    }));
    const t = r.templates[0];
    const plan = t.current.find((s) => s.title === "Plan")!;
    expect(plan.medianMinutes).toBe(30);
    // Each run's Plan cost includes every attempt: $3 and $4.
    expect(plan.medianCost).toBeCloseTo(3.5);
    expect(plan.costRuns).toBe(2);
    expect(t.wholeRun?.medianMinutes).toBe(40);
    expect(t.wholeRun?.medianCost).toBeCloseTo(4.5);
    expect(r.summary).toMatchObject({ runs: 2, runsWithCost: 2 });
    expect(r.summary.costRecorded).toBeCloseTo(9);
    expect(r.summary.medianCostPerFinishedRun).toBeCloseTo(4.5);
  });

  it("leaves a run out of the whole-run cost when one of its steps recorded none", () => {
    const a = step("r1", "Plan");
    const b = step("r1", "Build");
    const r = buildStepPerformanceReport(input({
      steps: [a, b],
      runs: [{ id: "r1", template_id: "t1", status: "completed" }],
      usage: [opus(a.id, "r1", 5_000_000)],
    }));
    expect(r.templates[0].wholeRun?.medianCost).toBeNull();
    expect(r.summary.medianCostPerFinishedRun).toBeNull();
    expect(r.summary.costRecorded).toBeCloseTo(1);
  });

  it("labels steps that catch problems and steps that never have", () => {
    const steps: ReportStepRow[] = [];
    const comments = [];
    const runs = [];
    for (let i = 0; i < 10; i++) {
      runs.push({ id: `r${i}`, template_id: "t1", status: "completed" });
      steps.push(step(`r${i}`, "Plan"));
      const review = step(`r${i}`, "Code review");
      steps.push(review);
      if (i < 3) comments.push({ step_id: review.id, type: "failure", author_id: BOT });
      steps.push(step(`r${i}`, "Build"));
    }
    const rows = Object.fromEntries(buildStepPerformanceReport(input({ steps, runs, comments })).templates[0].current.map((s) => [s.title, s.chip]));
    expect(rows).toEqual({ Plan: "never", Build: "never", "Code review": "catches" });
  });

  it("combines same-named templates across boards, and keeps them apart on one board", () => {
    const other = { ...T_FEATURE, id: "t2", idea_id: "board-b" };
    const s1 = step("r1", "Plan");
    const s2 = step("r2", "Plan", { idea_id: "board-b" });
    const base = { steps: [s1, s2], templates: [T_FEATURE, other], runs: [{ id: "r1", template_id: "t1", status: "completed" }, { id: "r2", template_id: "t2", status: "completed" }] };
    expect(buildStepPerformanceReport(input({ ...base, singleBoard: false })).templates).toHaveLength(1);
    expect(buildStepPerformanceReport(input({ ...base, singleBoard: true })).templates).toHaveLength(2);
  });

  it("names the most common model and effort", () => {
    const r = buildStepPerformanceReport(input({
      steps: [step("r1", "Plan"), step("r2", "Plan"), step("r3", "Plan", { executed_model: "sonnet", reasoning_effort_used: "unknown" })],
      runs: ["r1", "r2", "r3"].map((id) => ({ id, template_id: "t1", status: "completed" })),
    }));
    expect(r.templates[0].current[0].model).toBe("opus · high");
  });
});
