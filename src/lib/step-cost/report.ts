// The admin step report (card ba37039b): what each workflow step contributes
// — problems it caught, rejections at its gate, rework it needed, time and
// cost — per template, split into runs of the template's current version and
// runs of its earlier versions. Pure: the server action fetches the rows, this
// turns them into the report.

import { priceKey, usageCost, type ModelUsage } from "./pricing";

export interface ReportStepRow {
  id: string;
  idea_id: string;
  run_id: string | null;
  title: string;
  status: string;
  step_order: number | null;
  human_check_required: boolean;
  started_at: string | null;
  completed_at: string | null;
  executed_model: string | null;
  reasoning_effort_used: string | null;
}
export interface ReportRunRow { id: string; template_id: string | null; status: string }
export interface ReportTemplateRow { id: string; idea_id: string; name: string; steps: unknown; updated_at: string }
export interface ReportCommentRow { step_id: string; type: string; author_id: string; created_at: string }
export interface ReportUsageRow extends ModelUsage { step_id: string; run_id: string | null }
/** Every step of a run, whatever its status or date: which version of the template the run used. */
export interface ReportRunStepRow { run_id: string | null; title: string }

export interface ReportInput {
  steps: ReportStepRow[];
  runs: ReportRunRow[];
  templates: ReportTemplateRow[];
  comments: ReportCommentRow[];
  botIds: Set<string>;
  usage: ReportUsageRow[];
  runSteps: ReportRunStepRow[];
  /** One board: templates are kept apart by id. All boards: same-named templates are combined. */
  singleBoard: boolean;
}

export type StepChip = "catches" | "never" | null;

export interface StepPerformanceRow {
  title: string;
  /** 0 for a current step no run of the current version has finished yet. */
  ran: number;
  caught: number;
  rejected: number;
  redo: number;
  medianMinutes: number | null;
  /** Median cost of one run of this step (all its attempts), over runs that recorded it. */
  medianCost: number | null;
  costRuns: number;
  model: string | null;
  chip: StepChip;
}

export interface TemplatePerformance {
  key: string;
  name: string;
  currentRuns: number;
  currentSince: string | null;
  current: StepPerformanceRow[];
  wholeRun: { medianMinutes: number | null; medianCost: number | null } | null;
  earlierRuns: number;
  earlier: StepPerformanceRow[];
}

export interface StepPerformanceReport {
  summary: {
    runs: number;
    costRecorded: number;
    runsWithCost: number;
    medianCostPerFinishedRun: number | null;
    workSentBack: number;
    /** Models in recorded usage that have no price yet; those steps show no cost. */
    unpricedModels: string[];
  };
  templates: TemplatePerformance[];
}

/** Statuses that mean the step finished an attempt (an in-progress or reset step hasn't). */
const RAN = new Set(["completed", "failed", "awaiting_approval"]);
/** Below this many runs a step gets no label. */
const CATCHES_MIN_RUNS = 5;
const CATCHES_MIN_SHARE = 0.2;
const NEVER_MIN_RUNS = 10;
/** Earlier-version steps that ran fewer times than this are left out. */
const EARLIER_MIN_RUNS = 3;
/**
 * fail_step with reset_to_step_id writes the failing step's 'failure' comment
 * and the target's 'changes_requested' comment in the same call, as the same
 * author. Pairing them within this window is how a catch is told apart from
 * an agent that simply failed.
 */
const CASCADE_PAIR_MS = 60_000;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mode(values: string[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (best === null || n > (counts.get(best) ?? 0)) best = v;
  }
  return best;
}

export function templateTitles(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((s) => (s && typeof s === "object" && typeof (s as { title?: unknown }).title === "string" ? (s as { title: string }).title : null))
    .filter((t): t is string => t !== null);
}

function minutes(step: ReportStepRow): number | null {
  if (step.status !== "completed" && step.status !== "awaiting_approval") return null;
  if (!step.started_at || !step.completed_at) return null;
  const ms = Date.parse(step.completed_at) - Date.parse(step.started_at);
  return Number.isFinite(ms) && ms >= 0 ? ms / 60000 : null;
}

interface Signals { caught: boolean; rejected: boolean; redo: boolean }

/** Per step: did its agent send work back, did a person reject it at its gate, was work sent back to it. */
function stepSignals(input: ReportInput): Map<string, Signals> {
  const stepById = new Map(input.steps.map((s) => [s.id, s]));
  const signals = new Map<string, Signals>();
  const get = (id: string) => {
    let s = signals.get(id);
    if (!s) {
      s = { caught: false, rejected: false, redo: false };
      signals.set(id, s);
    }
    return s;
  };

  // Send-backs keyed by run + author, to pair with the failure that caused them.
  const sendBacks = new Map<string, { stepId: string; at: number }[]>();
  for (const c of input.comments) {
    if (c.type !== "changes_requested") continue;
    get(c.step_id).redo = true;
    const run = stepById.get(c.step_id)?.run_id;
    if (!run) continue;
    const key = `${run}|${c.author_id}`;
    const list = sendBacks.get(key) ?? [];
    list.push({ stepId: c.step_id, at: Date.parse(c.created_at) });
    sendBacks.set(key, list);
  }

  for (const c of input.comments) {
    if (c.type !== "failure") continue;
    const step = stepById.get(c.step_id);
    if (!step) continue;
    if (input.botIds.has(c.author_id)) {
      const at = Date.parse(c.created_at);
      const paired = (sendBacks.get(`${step.run_id}|${c.author_id}`) ?? []).some(
        (b) => b.stepId !== c.step_id && Math.abs(b.at - at) <= CASCADE_PAIR_MS
      );
      if (paired) get(c.step_id).caught = true;
    } else if (step.human_check_required) {
      get(c.step_id).rejected = true;
    }
  }
  return signals;
}

export function buildStepPerformanceReport(input: ReportInput): StepPerformanceReport {
  const runs = new Map(input.runs.map((r) => [r.id, r]));
  const templates = new Map(input.templates.map((t) => [t.id, t]));
  const signals = stepSignals(input);

  interface Acc { key: string; templates: Map<string, ReportTemplateRow>; rows: ReportStepRow[] }
  const groups = new Map<string, Acc>();
  const counted = new Set<string>();
  const ranRuns = new Set<string>();
  let workSentBack = 0;

  for (const step of input.steps) {
    const sig = signals.get(step.id);
    const ran = RAN.has(step.status) || !!sig?.caught || !!sig?.rejected;
    if (!ran || !step.run_id) continue;
    const template = templates.get(runs.get(step.run_id)?.template_id ?? "");
    if (!template) continue;
    const key = input.singleBoard ? template.id : template.name.trim().toLowerCase();
    let acc = groups.get(key);
    if (!acc) {
      acc = { key, templates: new Map(), rows: [] };
      groups.set(key, acc);
    }
    acc.templates.set(template.id, template);
    acc.rows.push(step);
    counted.add(step.id);
    ranRuns.add(step.run_id);
    if (sig?.caught) workSentBack++;
  }

  // A run is on the current version only if its steps are exactly its
  // template's current steps. Matching step by step instead counted old runs
  // as current wherever a step kept its name through a rewrite.
  const runTitles = new Map<string, Set<string>>();
  for (const s of [...input.runSteps, ...input.steps]) {
    if (!s.run_id) continue;
    const set = runTitles.get(s.run_id) ?? new Set<string>();
    set.add(s.title);
    runTitles.set(s.run_id, set);
  }
  const onCurrentVersion = (runId: string): boolean => {
    const want = new Set(templateTitles(templates.get(runs.get(runId)?.template_id ?? "")?.steps));
    const have = runTitles.get(runId);
    return want.size > 0 && !!have && have.size === want.size && [...want].every((t) => have.has(t));
  };

  // Cost per step row (every attempt). A step with any usage from a model that
  // has no price shows no cost rather than a cost that's too low.
  const stepCost = new Map<string, number>();
  const unpricedSteps = new Set<string>();
  const unpricedModels = new Set<string>();
  for (const u of input.usage) {
    if (!counted.has(u.step_id)) continue;
    const cost = usageCost(u);
    if (cost === null) {
      unpricedSteps.add(u.step_id);
      if (!priceKey(u.model)) unpricedModels.add(u.model);
      continue;
    }
    stepCost.set(u.step_id, (stepCost.get(u.step_id) ?? 0) + cost);
  }
  for (const id of unpricedSteps) stepCost.delete(id);
  const runOfStep = new Map(input.steps.map((s) => [s.id, s.run_id]));
  const runsWithCost = new Set([...stepCost.keys()].map((id) => runOfStep.get(id)).filter((r): r is string => !!r));
  const costRecorded = [...stepCost.values()].reduce((a, c) => a + c, 0);

  const finishedRunCosts: number[] = [];
  const result: TemplatePerformance[] = [];

  for (const acc of groups.values()) {
    // Current steps: every title any merged template still has, the most
    // recently edited template's order first.
    const byRecent = [...acc.templates.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const currentTitles = [...new Set(byRecent.flatMap((t) => templateTitles(t.steps)))];

    const currentRows = acc.rows.filter((r) => onCurrentVersion(r.run_id!));
    const earlierRows = acc.rows.filter((r) => !onCurrentVersion(r.run_id!));
    const groupByTitle = (rows: ReportStepRow[]) => {
      const byTitle = new Map<string, ReportStepRow[]>();
      for (const r of rows) {
        const list = byTitle.get(r.title) ?? [];
        list.push(r);
        byTitle.set(r.title, list);
      }
      return byTitle;
    };
    const currentByTitle = groupByTitle(currentRows);

    const toRow = (title: string, rows: ReportStepRow[]): StepPerformanceRow => {
      let caught = 0, rejected = 0, redo = 0;
      for (const r of rows) {
        const s = signals.get(r.id);
        if (s?.caught) caught++;
        if (s?.rejected) rejected++;
        if (s?.redo) redo++;
      }
      const costs = rows.map((r) => stepCost.get(r.id)).filter((c): c is number => c !== undefined);
      const ran = rows.length;
      const chip: StepChip =
        ran >= CATCHES_MIN_RUNS && caught / ran >= CATCHES_MIN_SHARE ? "catches"
        : ran >= NEVER_MIN_RUNS && caught === 0 && rejected === 0 ? "never"
        : null;
      return {
        title,
        ran,
        caught,
        rejected,
        redo,
        medianMinutes: median(rows.map(minutes).filter((m): m is number => m !== null)),
        medianCost: median(costs),
        costRuns: costs.length,
        model: mode(rows.filter((r) => r.executed_model).map((r) => (r.reasoning_effort_used && r.reasoning_effort_used !== "unknown" ? `${r.executed_model} · ${r.reasoning_effort_used}` : r.executed_model!))),
        chip,
      };
    };

    // Every current step is listed, so the table matches the template; one that hasn't run yet shows ran 0.
    const current = currentTitles.map((t) => toRow(t, currentByTitle.get(t) ?? []));

    const earlier = [...groupByTitle(earlierRows).entries()]
      .filter(([, rows]) => rows.length >= EARLIER_MIN_RUNS)
      .sort((a, b) => Math.min(...a[1].map((r) => r.step_order ?? 0)) - Math.min(...b[1].map((r) => r.step_order ?? 0)))
      .map(([t, rows]) => toRow(t, rows));

    // Whole run: finished runs whose every current step is in this report.
    // A run that started before the period is missing its early steps, so
    // it is left out rather than counted short.
    const perRun = new Map<string, ReportStepRow[]>();
    for (const r of currentRows) {
      const list = perRun.get(r.run_id!) ?? [];
      list.push(r);
      perRun.set(r.run_id!, list);
    }
    const runMinutes: number[] = [];
    const runCosts: number[] = [];
    for (const [runId, rows] of perRun) {
      const run = runs.get(runId);
      if (run?.status !== "completed") continue;
      const runTitles = templateTitles(templates.get(run.template_id ?? "")?.steps);
      const present = new Set(rows.map((r) => r.title));
      if (runTitles.length === 0 || !runTitles.every((t) => present.has(t))) continue;
      const mins = rows.map(minutes);
      if (mins.every((m) => m !== null)) runMinutes.push(mins.reduce<number>((a, m) => a + (m ?? 0), 0));
      const costs = rows.map((r) => stepCost.get(r.id));
      if (costs.every((c) => c !== undefined)) {
        const total = costs.reduce<number>((a, c) => a + (c ?? 0), 0);
        runCosts.push(total);
        finishedRunCosts.push(total);
      }
    }

    const currentRuns = new Set(currentRows.map((r) => r.run_id)).size;
    const since = currentRows.map((r) => r.started_at ?? r.completed_at).filter((d): d is string => !!d).sort()[0] ?? null;
    result.push({
      key: acc.key,
      name: byRecent[0].name,
      currentRuns,
      currentSince: since,
      current,
      wholeRun: currentRuns > 0 ? { medianMinutes: median(runMinutes), medianCost: median(runCosts) } : null,
      earlierRuns: new Set(earlierRows.map((r) => r.run_id)).size,
      earlier,
    });
  }

  result.sort((a, b) => b.currentRuns + b.earlierRuns - (a.currentRuns + a.earlierRuns) || a.name.localeCompare(b.name));

  return {
    summary: {
      runs: ranRuns.size,
      costRecorded,
      runsWithCost: runsWithCost.size,
      medianCostPerFinishedRun: median(finishedRunCosts),
      workSentBack,
      unpricedModels: [...unpricedModels].sort(),
    },
    templates: result,
  };
}
