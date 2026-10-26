import { describe, it, expect } from "vitest";
import { buildStepPerformanceReport, median, templateTitles, type ReportCommentRow, type ReportInput, type ReportStepRow } from "./report";

const BOT = "bot";
const HUMAN = "human";
const T_FEATURE = {
  id: "t1", idea_id: "board-a", name: "Feature Development", updated_at: "2026-10-13T00:00:00Z",
  steps: [{ title: "Plan" }, { title: "Build" }, { title: "Code review" }],
};
const AT = "2026-10-14T10:20:00Z";

let n = 0;
function step(run: string, title: string, o: Partial<ReportStepRow> = {}): ReportStepRow {
  n++;
  return {
    id: `s${n}`, idea_id: "board-a", run_id: run, title, status: "completed", step_order: 1, human_check_required: false,
    started_at: "2026-10-14T10:00:00Z", completed_at: "2026-10-14T10:10:00Z",
    executed_model: "opus", reasoning_effort_used: "high", ...o,
  };
}
const comment = (step_id: string, type: string, author_id: string, created_at = AT): ReportCommentRow => ({ step_id, type, author_id, created_at });
/** What fail_step with reset_to_step_id writes: a failure on the failing step, a send-back on the target, same author, same moment. */
const sendBack = (from: ReportStepRow, to: ReportStepRow, author = BOT, at = AT) => [comment(from.id, "failure", author, at), comment(to.id, "changes_requested", author, at)];
const opus = (step_id: string, run_id: string, read: number, model = "claude-opus-5-5") => ({
  step_id, run_id, model, input_tokens: 0, output_tokens: 0, cache_read_tokens: read, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0,
});
const done = (...ids: string[]) => ids.map((id) => ({ id, template_id: "t1", status: "completed" }));

/** A run's whole step list, as the database holds it. */
const runOf = (run: string, ...titles: string[]) => titles.map((title) => ({ run_id: run, title }));

/** Unless a test says otherwise, every run used its template's current steps. */
function input(o: Partial<ReportInput>): ReportInput {
  const base = { steps: [], runs: [], templates: [T_FEATURE], comments: [], botIds: new Set([BOT]), usage: [], singleBoard: true, ...o };
  const runSteps =
    o.runSteps ??
    base.runs.flatMap((r) => runOf(r.id, ...templateTitles(base.templates.find((t) => t.id === r.template_id)?.steps)));
  return { ...base, runSteps };
}
const rowsOf = (r: ReturnType<typeof buildStepPerformanceReport>, i = 0) => Object.fromEntries(r.templates[i].current.map((s) => [s.title, s]));

describe("median", () => {
  it("handles empty, odd and even lists", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("buildStepPerformanceReport", () => {
  it("counts a catch only when the failing agent sent work back to an earlier step", () => {
    const plan = step("r1", "Plan");
    const build = step("r1", "Build");
    const review = step("r1", "Code review");
    const r = buildStepPerformanceReport(input({ steps: [plan, build, review], runs: done("r1"), comments: sendBack(review, build) }));
    const rows = rowsOf(r);
    expect(rows["Code review"]).toMatchObject({ ran: 1, caught: 1, redo: 0 });
    expect(rows["Build"]).toMatchObject({ caught: 0, redo: 1 });
    expect(r.summary.workSentBack).toBe(1);
  });

  it("doesn't count an agent failing on its own work, or a send-back long after, as a catch", () => {
    const build = step("r1", "Build", { status: "failed" });
    const review = step("r1", "Code review");
    const plan = step("r1", "Plan");
    const r = buildStepPerformanceReport(input({
      steps: [plan, build, review],
      runs: done("r1"),
      comments: [comment(build.id, "failure", BOT), comment(review.id, "failure", BOT, "2026-10-14T10:20:00Z"), comment(plan.id, "changes_requested", BOT, "2026-10-14T12:00:00Z")],
    }));
    const rows = rowsOf(r);
    expect(rows["Build"].caught).toBe(0);
    expect(rows["Code review"].caught).toBe(0);
    expect(r.summary.workSentBack).toBe(0);
  });

  it("counts a rejection only when a person fails a step that has an approval gate", () => {
    const plan = step("r1", "Plan", { human_check_required: true });
    const build = step("r1", "Build");
    const r = buildStepPerformanceReport(input({
      steps: [plan, build],
      runs: done("r1"),
      comments: [comment(plan.id, "failure", HUMAN), comment(plan.id, "failure", HUMAN), comment(build.id, "failure", HUMAN)],
    }));
    const rows = rowsOf(r);
    // Two rejections of one run count once.
    expect(rows["Plan"]).toMatchObject({ rejected: 1, caught: 0 });
    expect(rows["Build"].rejected).toBe(0);
  });

  it("lists every current step in template order and moves runs of an older version to earlier versions", () => {
    const steps = [
      step("r1", "Code review"), step("r1", "Plan"),
      ...["r2", "r3", "r4"].map((run) => step(run, "Requirements", { step_order: 1 })),
      ...["r2", "r3", "r4"].map((run) => step(run, "QA Testing", { step_order: 5 })),
      step("r2", "Old one-off", { step_order: 9 }),
    ];
    const runSteps = [
      ...runOf("r1", "Plan", "Build", "Code review"),
      ...runOf("r2", "Requirements", "QA Testing", "Old one-off"),
      ...runOf("r3", "Requirements", "QA Testing"),
      ...runOf("r4", "Requirements", "QA Testing"),
    ];
    const t = buildStepPerformanceReport(input({ steps, runSteps, runs: done("r1", "r2", "r3", "r4") })).templates[0];
    expect(t.current.map((s) => [s.title, s.ran])).toEqual([["Plan", 1], ["Build", 0], ["Code review", 1]]);
    expect(t.currentRuns).toBe(1);
    // Ran fewer than 3 times, so left out.
    expect(t.earlier.map((s) => s.title)).toEqual(["Requirements", "QA Testing"]);
    expect(t.earlierRuns).toBe(3);
  });

  it("puts a run of an older version under earlier versions even where a step kept its name", () => {
    // The template was rewritten from Requirements → Build → Code review to Plan → Build → Code review.
    // The old runs' Build and Code review must not count as the new version's.
    const old = ["r1", "r2", "r3"].flatMap((run) => [
      step(run, "Requirements", { step_order: 1 }), step(run, "Build", { step_order: 2 }), step(run, "Code review", { step_order: 3 }),
    ]);
    const runSteps = [
      ...["r1", "r2", "r3"].flatMap((run) => runOf(run, "Requirements", "Build", "Code review")),
      // A run of the new version that hasn't finished a step yet.
      ...runOf("r4", "Plan", "Build", "Code review"),
    ];
    const t = buildStepPerformanceReport(input({
      steps: [...old, step("r4", "Plan", { status: "pending", started_at: null, completed_at: null })],
      runSteps,
      runs: [...done("r1", "r2", "r3"), { id: "r4", template_id: "t1", status: "running" }],
    })).templates[0];
    expect(t.current.map((s) => [s.title, s.ran])).toEqual([["Plan", 0], ["Build", 0], ["Code review", 0]]);
    expect(t.currentRuns).toBe(0);
    expect(t.currentSince).toBeNull();
    expect(t.wholeRun).toBeNull();
    expect(t.earlier.map((s) => [s.title, s.ran])).toEqual([["Requirements", 3], ["Build", 3], ["Code review", 3]]);
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
    const run = (id: string, planEnd: string, planRead: number[], buildRead: number) => {
      const s = [step(id, "Plan", { completed_at: planEnd }), step(id, "Build"), step(id, "Code review")];
      return { steps: s, usage: [...planRead.map((r) => opus(s[0].id, id, r)), opus(s[1].id, id, buildRead), opus(s[2].id, id, 0)] };
    };
    const a = run("r1", "2026-10-14T10:20:00Z", [10_000_000, 5_000_000], 5_000_000);
    const b = run("r2", "2026-10-14T10:40:00Z", [20_000_000], 5_000_000);
    const r = buildStepPerformanceReport(input({ steps: [...a.steps, ...b.steps], runs: done("r1", "r2"), usage: [...a.usage, ...b.usage] }));
    const t = r.templates[0];
    const plan = t.current.find((s) => s.title === "Plan")!;
    expect(plan.medianMinutes).toBe(30);
    // $0.20 per million cache-read tokens on Opus 5.5; each run's Plan includes every attempt: $3 and $4.
    expect(plan.medianCost).toBeCloseTo(3.5);
    expect(plan.costRuns).toBe(2);
    expect(t.wholeRun?.medianMinutes).toBe(50);
    expect(t.wholeRun?.medianCost).toBeCloseTo(4.5);
    expect(r.summary).toMatchObject({ runs: 2, runsWithCost: 2, unpricedModels: [] });
    expect(r.summary.costRecorded).toBeCloseTo(9);
    expect(r.summary.medianCostPerFinishedRun).toBeCloseTo(4.5);
  });

  it("adds up the step rows as a separate line, because the whole run is a median of real totals that include redos", () => {
    const run = (id: string, planEnd: string, planRead: number[]) => {
      const s = [step(id, "Plan", { completed_at: planEnd }), step(id, "Build"), step(id, "Code review")];
      return { steps: s, usage: [...planRead.map((r) => opus(s[0].id, id, r)), opus(s[1].id, id, 5_000_000), opus(s[2].id, id, 0)] };
    };
    const a = run("r1", "2026-10-14T10:20:00Z", [10_000_000]);
    const b = run("r2", "2026-10-14T10:40:00Z", [20_000_000]);
    // r3 redoes Build: a second Build row in the same run, so its run total is bigger than the sum of per-step medians.
    const c = run("r3", "2026-10-14T10:20:00Z", [10_000_000]);
    const redo = step("r3", "Build");
    const r = buildStepPerformanceReport(input({
      steps: [...a.steps, ...b.steps, ...c.steps, redo],
      runs: done("r1", "r2", "r3"),
      usage: [...a.usage, ...b.usage, ...c.usage, opus(redo.id, "r3", 5_000_000)],
    }));
    const t = r.templates[0];
    const sum = (k: "medianMinutes" | "medianCost") => t.current.reduce((acc, s) => acc + (s[k] ?? 0), 0);
    expect(t.sumOfSteps).toEqual({
      minutes: sum("medianMinutes"),
      cost: expect.closeTo(sum("medianCost")),
      minutesMissing: 0,
      costMissing: 0,
    });
    // The real figure stays the median of real run totals, so it differs from the sum.
    expect(t.wholeRun?.medianMinutes).not.toBe(t.sumOfSteps?.minutes);
  });

  it("adds up the rows as displayed, so the sum matches adding the shown rows by hand", () => {
    // Each step takes 7 min 24 s: every row shows 7 min, so the sum must show 21, not 22.
    const steps = ["Plan", "Build", "Code review"].map((t) => step("r1", t, { completed_at: "2026-10-14T10:07:24Z" }));
    const r = buildStepPerformanceReport(input({ steps, runs: done("r1"), usage: [] }));
    expect(r.templates[0].sumOfSteps?.minutes).toBe(21);
  });

  it("counts rows shown as under a minute as nothing, so two of them don't add up to 1 min", () => {
    // Plan and Build take 36 s each (shown "<1 min"); Code review takes 7 min.
    const steps = [
      step("r1", "Plan", { completed_at: "2026-10-14T10:00:36Z" }),
      step("r1", "Build", { completed_at: "2026-10-14T10:00:36Z" }),
      step("r1", "Code review", { completed_at: "2026-10-14T10:07:00Z" }),
    ];
    const r = buildStepPerformanceReport(input({ steps, runs: done("r1"), usage: [] }));
    expect(r.templates[0].sumOfSteps?.minutes).toBe(7);
  });

  it("keeps a sum of only under-a-minute rows under a minute", () => {
    const steps = ["Plan", "Build", "Code review"].map((t) => step("r1", t, { completed_at: "2026-10-14T10:00:36Z" }));
    const r = buildStepPerformanceReport(input({ steps, runs: done("r1"), usage: [] }));
    const m = r.templates[0].sumOfSteps?.minutes ?? null;
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(1);
  });

  it("skips steps with no figure when adding up, and counts them", () => {
    const steps = [step("r1", "Plan"), step("r1", "Build"), step("r1", "Code review")];
    const r = buildStepPerformanceReport(input({
      steps,
      runs: done("r1"),
      usage: [opus(steps[0].id, "r1", 5_000_000)],
    }));
    const t = r.templates[0];
    expect(t.sumOfSteps?.cost).toBeCloseTo(1);
    expect(t.sumOfSteps?.costMissing).toBe(2);
    expect(t.sumOfSteps?.minutes).toBe(30);
    expect(t.sumOfSteps?.minutesMissing).toBe(0);
  });

  it("leaves a run out of the whole-run figures when a step recorded no cost or fell before the period", () => {
    const full = [step("r1", "Plan"), step("r1", "Build"), step("r1", "Code review")];
    // r2 started before the period: its Plan wasn't loaded.
    const partial = [step("r2", "Build"), step("r2", "Code review")];
    const r = buildStepPerformanceReport(input({
      steps: [...full, ...partial],
      runs: done("r1", "r2"),
      usage: [opus(full[0].id, "r1", 5_000_000), ...partial.map((s) => opus(s.id, "r2", 5_000_000))],
    }));
    const t = r.templates[0];
    expect(t.wholeRun?.medianMinutes).toBe(30);
    expect(t.wholeRun?.medianCost).toBeNull();
    expect(r.summary.medianCostPerFinishedRun).toBeNull();
  });

  it("shows no cost for a step whose usage names a model with no price, and lists the model", () => {
    const plan = step("r1", "Plan");
    const build = step("r1", "Build");
    const r = buildStepPerformanceReport(input({
      steps: [plan, build],
      runs: done("r1"),
      usage: [opus(plan.id, "r1", 5_000_000), opus(plan.id, "r1", 5_000_000, "claude-opus-9"), opus(build.id, "r1", 5_000_000)],
    }));
    const rows = rowsOf(r);
    expect(rows["Plan"].medianCost).toBeNull();
    expect(rows["Build"].medianCost).toBeCloseTo(1);
    expect(r.summary.costRecorded).toBeCloseTo(1);
    expect(r.summary.unpricedModels).toEqual(["claude-opus-9"]);
  });

  it("labels steps that catch problems and steps that never have", () => {
    const steps: ReportStepRow[] = [];
    const comments: ReportCommentRow[] = [];
    for (let i = 0; i < 10; i++) {
      steps.push(step(`r${i}`, "Plan"));
      const build = step(`r${i}`, "Build");
      const review = step(`r${i}`, "Code review");
      steps.push(build, review);
      if (i < 3) comments.push(...sendBack(review, build));
    }
    const runs = done(...Array.from({ length: 10 }, (_, i) => `r${i}`));
    const chips = Object.fromEntries(buildStepPerformanceReport(input({ steps, runs, comments })).templates[0].current.map((s) => [s.title, s.chip]));
    expect(chips).toEqual({ Plan: "never", Build: "never", "Code review": "catches" });
  });

  it("combines same-named templates across boards, counting any board's steps as current", () => {
    const other = { ...T_FEATURE, id: "t2", idea_id: "board-b", updated_at: "2026-10-14T00:00:00Z", steps: [{ title: "Plan" }, { title: "Security review" }] };
    const s1 = step("r1", "Plan");
    const s2 = step("r2", "Security review", { idea_id: "board-b" });
    const base = { steps: [s1, s2], templates: [T_FEATURE, other], runs: [{ id: "r1", template_id: "t1", status: "completed" }, { id: "r2", template_id: "t2", status: "completed" }] };
    const all = buildStepPerformanceReport(input({ ...base, singleBoard: false }));
    expect(all.templates).toHaveLength(1);
    // The more recently edited board's order comes first; every step either board has is listed.
    expect(all.templates[0].current.map((s) => [s.title, s.ran])).toEqual([["Plan", 1], ["Security review", 1], ["Build", 0], ["Code review", 0]]);
    expect(buildStepPerformanceReport(input({ ...base, singleBoard: true })).templates).toHaveLength(2);
  });

  it("names the most common model and effort", () => {
    const r = buildStepPerformanceReport(input({
      steps: [step("r1", "Plan"), step("r2", "Plan"), step("r3", "Plan", { executed_model: "sonnet", reasoning_effort_used: "unknown" })],
      runs: done("r1", "r2", "r3"),
    }));
    expect(r.templates[0].current[0].model).toBe("opus · high");
  });
});
