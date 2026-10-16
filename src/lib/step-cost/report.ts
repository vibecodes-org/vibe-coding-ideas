// The admin step report (card ba37039b): what each workflow step contributes
// — problems it caught, rejections at its gate, rework it needed, time and
// cost — per template, split into the template's current steps and the steps
// of its earlier versions. Pure: the server action fetches the rows, this
// turns them into the report.

import { usageCost, type ModelUsage } from "./pricing";

export interface ReportStepRow {
  id: string;
  idea_id: string;
  run_id: string | null;
  title: string;
  status: string;
  step_order: number | null;
  started_at: string | null;
  completed_at: string | null;
  executed_model: string | null;
  reasoning_effort_used: string | null;
}
export interface ReportRunRow { id: string; template_id: string | null; status: string }
export interface ReportTemplateRow { id: string; idea_id: string; name: string; steps: unknown }
export interface ReportCommentRow { step_id: string; type: string; author_id: string }
export interface ReportUsageRow extends ModelUsage { step_id: string; run_id: string | null }

export interface ReportInput {
  steps: ReportStepRow[];
  runs: ReportRunRow[];
  templates: ReportTemplateRow[];
  comments: ReportCommentRow[];
  botIds: Set<string>;
  usage: ReportUsageRow[];
  /** One board: templates are kept apart by id. All boards: same-named templates are combined. */
  singleBoard: boolean;
}

export type StepChip = "catches" | "never" | null;

export interface StepPerformanceRow {
  title: string;
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
  };
  templates: TemplatePerformance[];
}

/** Statuses that mean the step actually ran (an in-progress or reset step hasn't finished an attempt). */
const RAN = new Set(["completed", "failed", "awaiting_approval"]);
/** Below this many runs a step gets no label. */
const CATCHES_MIN_RUNS = 5;
const CATCHES_MIN_SHARE = 0.2;
const NEVER_MIN_RUNS = 10;
/** Earlier-version steps that ran fewer times than this are left out. */
const EARLIER_MIN_RUNS = 3;

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

function templateTitles(steps: unknown): string[] {
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

interface Signals { caught: number; rejected: number; redo: number }

export function buildStepPerformanceReport(input: ReportInput): StepPerformanceReport {
  const runs = new Map(input.runs.map((r) => [r.id, r]));
  const templates = new Map(input.templates.map((t) => [t.id, t]));

  const signals = new Map<string, Signals>();
  let workSentBack = 0;
  for (const c of input.comments) {
    const s = signals.get(c.step_id) ?? { caught: 0, rejected: 0, redo: 0 };
    if (c.type === "failure") {
      if (input.botIds.has(c.author_id)) s.caught++;
      else s.rejected++;
    } else if (c.type === "changes_requested") s.redo++;
    signals.set(c.step_id, s);
  }

  // Cost per step row (every attempt), and per run. A step whose usage names
  // a model with no price still counts as recorded, at the price it has.
  const stepCost = new Map<string, number>();
  let costRecorded = 0;
  const runsWithCost = new Set<string>();
  for (const u of input.usage) {
    const cost = usageCost(u) ?? 0;
    stepCost.set(u.step_id, (stepCost.get(u.step_id) ?? 0) + cost);
    costRecorded += cost;
    if (u.run_id) runsWithCost.add(u.run_id);
  }

  interface Acc { key: string; name: string; current: string[]; rows: ReportStepRow[] }
  const groups = new Map<string, Acc>();
  const ranRuns = new Set<string>();

  for (const step of input.steps) {
    const sig = signals.get(step.id);
    const ran = RAN.has(step.status) || (sig?.caught ?? 0) > 0 || (sig?.rejected ?? 0) > 0;
    if (!ran || !step.run_id) continue;
    const run = runs.get(step.run_id);
    const template = run?.template_id ? templates.get(run.template_id) : undefined;
    if (!template) continue;
    ranRuns.add(step.run_id);
    const key = input.singleBoard ? template.id : template.name.trim().toLowerCase();
    let acc = groups.get(key);
    if (!acc) {
      acc = { key, name: template.name, current: templateTitles(template.steps), rows: [] };
      groups.set(key, acc);
    }
    acc.rows.push(step);
    if ((sig?.caught ?? 0) > 0) workSentBack++;
  }

  const finishedRunCosts: number[] = [];
  const result: TemplatePerformance[] = [];

  for (const acc of groups.values()) {
    const currentSet = new Set(acc.current);
    const byTitle = new Map<string, ReportStepRow[]>();
    for (const r of acc.rows) {
      const list = byTitle.get(r.title) ?? [];
      list.push(r);
      byTitle.set(r.title, list);
    }

    const toRow = (title: string, rows: ReportStepRow[]): StepPerformanceRow => {
      let caught = 0, rejected = 0, redo = 0;
      for (const r of rows) {
        const s = signals.get(r.id);
        if (!s) continue;
        if (s.caught > 0) caught++;
        if (s.rejected > 0) rejected++;
        if (s.redo > 0) redo++;
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

    const current = acc.current.filter((t) => byTitle.has(t)).map((t) => toRow(t, byTitle.get(t)!));
    const currentRows = acc.rows.filter((r) => currentSet.has(r.title));
    const earlierRows = acc.rows.filter((r) => !currentSet.has(r.title));

    const earlier = [...byTitle.entries()]
      .filter(([t, rows]) => !currentSet.has(t) && rows.length >= EARLIER_MIN_RUNS)
      .sort((a, b) => Math.min(...a[1].map((r) => r.step_order ?? 0)) - Math.min(...b[1].map((r) => r.step_order ?? 0)))
      .map(([t, rows]) => toRow(t, rows));

    // Whole run, over finished runs of the current version.
    const perRun = new Map<string, ReportStepRow[]>();
    for (const r of currentRows) {
      const list = perRun.get(r.run_id!) ?? [];
      list.push(r);
      perRun.set(r.run_id!, list);
    }
    const runMinutes: number[] = [];
    const runCosts: number[] = [];
    for (const [runId, rows] of perRun) {
      if (runs.get(runId)?.status !== "completed") continue;
      const mins = rows.map(minutes);
      if (mins.every((m) => m !== null)) runMinutes.push(mins.reduce<number>((a, m) => a + (m ?? 0), 0));
      const costs = rows.map((r) => stepCost.get(r.id));
      if (costs.every((c) => c !== undefined)) {
        const total = costs.reduce<number>((a, c) => a + (c ?? 0), 0);
        runCosts.push(total);
        finishedRunCosts.push(total);
      }
    }

    const since = currentRows.map((r) => r.started_at ?? r.completed_at).filter((d): d is string => !!d).sort()[0] ?? null;
    result.push({
      key: acc.key,
      name: acc.name,
      currentRuns: new Set(currentRows.map((r) => r.run_id)).size,
      currentSince: since,
      current,
      wholeRun: current.length > 0 ? { medianMinutes: median(runMinutes), medianCost: median(runCosts) } : null,
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
    },
    templates: result,
  };
}
