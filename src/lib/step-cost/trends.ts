// Cost trends for the Admin "Token usage" tab (card a1790638). Pure: the server
// action fetches the rows, this turns them into the series the charts draw.
// Which steps count, what each costs and the median all come from report.ts, so
// the bars add up to the report's "Cost recorded" tile.
// Days and weeks are UK time; weeks run Monday to Sunday.

import { priceKey, usageCost } from "./pricing";
import {
  countedSteps,
  median,
  stepCostsFor,
  wholeRunCost,
  type ReportCommentRow,
  type ReportRunRow,
  type ReportStepRow,
  type ReportTemplateRow,
  type ReportUsageRow,
} from "./report";

/** A recorded attempt; created_at says when, for a step that was sent back and is waiting to re-run. */
export type TrendsUsageRow = ReportUsageRow & { created_at?: string };

export type TrendsGrain = "day" | "week";

export interface TrendsInput {
  steps: ReportStepRow[];
  runs: ReportRunRow[];
  templates: ReportTemplateRow[];
  /** changes_requested and failure comments (the rest are ignored). */
  comments: ReportCommentRow[];
  botIds: Set<string>;
  usage: TrendsUsageRow[];
  /** Bars are days or weeks; the run charts are always weeks. */
  grain: TrendsGrain;
  /** Start of the period (ISO), or null for all time: then the first recorded step starts the chart. */
  from: string | null;
  now: Date;
}

export interface CostBucket {
  /** UK date (YYYY-MM-DD): the day, or the Monday of the week. */
  start: string;
  /** The day or week isn't over yet. */
  partial: boolean;
  /** A week that starts before the period does, so it only holds part of a week. */
  cutShort: boolean;
  opus: number;
  sonnet: number;
  other: number;
  total: number;
  /** Finished steps in the bucket, and how many of them have a cost recorded. */
  finished: number;
  costed: number;
}

export interface RunCostSeries {
  name: string;
  /** One point per week; median is null when no finished run had every step costed. */
  points: { start: string; median: number | null; runs: number }[];
}

export interface SentBackWeek { start: string; partial: boolean; runs: number; sentBack: number }

export interface TrendsSummary {
  /**
   * The last complete week against the average of the (up to 4) complete weeks before it.
   * A week cut short by the start of the period is left out; changePct is null (hidden)
   * unless at least 2 full weeks are left to compare, and comparedWeeks says how many.
   */
  lastFullWeek: { start: string; total: number; changePct: number | null; comparedWeeks: number } | null;
  /** For the busiest workflows: typical run cost in the latest two weeks that have one. */
  workflowMoves: { name: string; fromStart: string; toStart: string; from: number; to: number }[];
}

export interface CostTrends {
  grain: TrendsGrain;
  /** Bars at the chosen grain. */
  cost: CostBucket[];
  /** Weekly figures, always (the run charts and the summary use these). */
  weeks: CostBucket[];
  runCost: RunCostSeries[];
  sentBack: SentBackWeek[];
  summary: TrendsSummary;
}

const MAX_RUN_LINES = 3;
const ukFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

/** The UK calendar date (YYYY-MM-DD) of a moment. */
export function ukDay(iso: string | Date): string {
  const parts = ukFormat.formatToParts(typeof iso === "string" ? new Date(iso) : iso);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** The Monday (UK date) of the week a moment falls in. */
export function ukWeekStart(iso: string | Date): string {
  return mondayOf(ukDay(iso));
}

function range(first: string, last: string, step: number): string[] {
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, step)) out.push(d);
  return out;
}

const family = (model: string): "opus" | "sonnet" | "other" => {
  const key = priceKey(model);
  if (key?.includes("opus")) return "opus";
  if (key?.includes("sonnet")) return "sonnet";
  return "other";
};

/** Fewer full weeks than this and the percentage change isn't shown. */
const MIN_COMPARED_WEEKS = 2;

export function buildCostTrends(input: TrendsInput): CostTrends {
  const today = ukDay(input.now);
  const templates = new Map(input.templates.map((t) => [t.id, t]));
  const runs = new Map(input.runs.map((r) => [r.id, r]));

  const lastUsage = new Map<string, string>();
  for (const u of input.usage) {
    if (u.created_at && u.created_at > (lastUsage.get(u.step_id) ?? "")) lastUsage.set(u.step_id, u.created_at);
  }
  const counted = countedSteps({
    steps: input.steps,
    runs: input.runs,
    templates: input.templates,
    comments: input.comments,
    botIds: input.botIds,
    lastUsage,
  }).filter((c) => !!c.when);
  const days = new Map(counted.map((c) => [c.step.id, ukDay(c.when!)]));
  const { stepCost } = stepCostsFor(input.usage, new Set(counted.map((c) => c.step.id)));

  // Cost by model family, per step (only steps with a cost; the rest are "no cost", never zero).
  const familyCost = new Map<string, { opus: number; sonnet: number; other: number }>();
  for (const u of input.usage) {
    if (!stepCost.has(u.step_id)) continue;
    const cost = usageCost(u);
    if (cost === null) continue;
    const f = familyCost.get(u.step_id) ?? { opus: 0, sonnet: 0, other: 0 };
    f[family(u.model)] += cost;
    familyCost.set(u.step_id, f);
  }

  // The chart starts at the period's first day (or the first recorded step), and
  // never after a counted step, so the bars always add up to the report.
  const earliest = [...days.values()].sort()[0];
  const firstDay = [input.from ? ukDay(input.from) : null, earliest].filter((d): d is string => !!d).sort()[0] ?? today;

  const bucketsFor = (grain: TrendsGrain): CostBucket[] => {
    const starts = grain === "day" ? range(firstDay, today, 1) : range(mondayOf(firstDay), mondayOf(today), 7);
    const key = (day: string) => (grain === "day" ? day : mondayOf(day));
    const byStart = new Map<string, CostBucket>(
      starts.map((start) => [
        start,
        { start, partial: grain === "day" ? start === today : addDays(start, 6) >= today, cutShort: grain === "week" && !!input.from && start < firstDay, opus: 0, sonnet: 0, other: 0, total: 0, finished: 0, costed: 0 },
      ])
    );
    for (const c of counted) {
      const b = byStart.get(key(days.get(c.step.id)!));
      if (!b) continue; // a step dated after today (clock skew)
      b.finished++;
      const cost = stepCost.get(c.step.id);
      if (cost === undefined) continue;
      b.costed++;
      b.total += cost;
      const f = familyCost.get(c.step.id)!;
      b.opus += f.opus;
      b.sonnet += f.sonnet;
      b.other += f.other;
    }
    return starts.map((s) => byStart.get(s)!);
  };
  const weeks = bucketsFor("week");
  const cost = input.grain === "week" ? weeks : bucketsFor("day");

  // Runs: a run belongs to the week of its latest step.
  interface RunAcc { id: string; wf: string; week: string; stepIds: string[]; sentBack: boolean }
  const sentBackSteps = new Set(input.comments.filter((c) => c.type === "changes_requested").map((c) => c.step_id));
  const runAcc = new Map<string, RunAcc>();
  const nameOf = new Map<string, string>();
  const nameStamp = new Map<string, string>();
  for (const t of input.templates) {
    const key = t.name.trim().toLowerCase();
    if (!nameStamp.has(key) || t.updated_at > nameStamp.get(key)!) {
      nameStamp.set(key, t.updated_at);
      nameOf.set(key, t.name.trim());
    }
  }
  for (const c of counted) {
    const runId = c.step.run_id!;
    const week = mondayOf(days.get(c.step.id)!);
    let r = runAcc.get(runId);
    if (!r) {
      r = { id: runId, wf: templates.get(c.templateId)!.name.trim().toLowerCase(), week, stepIds: [], sentBack: false };
      runAcc.set(runId, r);
    }
    if (week > r.week) r.week = week;
    r.stepIds.push(c.step.id);
    if (sentBackSteps.has(c.step.id)) r.sentBack = true;
  }

  // Finished runs only. The cost line is looser than the report's whole-run rule
  // (which also needs the run to match today's template steps, and so empties
  // most of the past): a finished run counts when every step it ran has a cost.
  const finishedByWf = new Map<string, number>();
  const costByWfWeek = new Map<string, Map<string, number[]>>();
  const sent = new Map(weeks.map((w) => [w.start, { runs: 0, sentBack: 0 }]));
  for (const r of runAcc.values()) {
    if (runs.get(r.id)?.status !== "completed") continue;
    finishedByWf.set(r.wf, (finishedByWf.get(r.wf) ?? 0) + 1);
    const s = sent.get(r.week);
    if (s) {
      s.runs++;
      if (r.sentBack) s.sentBack++;
    }
    const total = wholeRunCost(r.stepIds, stepCost);
    if (total === null) continue;
    const perWeek = costByWfWeek.get(r.wf) ?? new Map<string, number[]>();
    costByWfWeek.set(r.wf, perWeek);
    perWeek.set(r.week, [...(perWeek.get(r.week) ?? []), total]);
  }
  const runCost: RunCostSeries[] = [...finishedByWf.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_RUN_LINES)
    .map(([key]) => ({
      name: nameOf.get(key) ?? key,
      points: weeks.map((w) => {
        const costs = costByWfWeek.get(key)?.get(w.start) ?? [];
        return { start: w.start, median: median(costs), runs: costs.length };
      }),
    }));
  const sentBack: SentBackWeek[] = weeks.map((w) => ({ start: w.start, partial: w.partial, ...sent.get(w.start)! }));

  // Summary
  const full = weeks.filter((w) => !w.partial && !w.cutShort);
  const last = full[full.length - 1];
  const before = full.slice(-5, -1);
  let lastFullWeek: TrendsSummary["lastFullWeek"] = null;
  if (last && weeks.some((w) => w.total > 0)) {
    const avg = before.length ? before.reduce((a, w) => a + w.total, 0) / before.length : 0;
    const enough = before.length >= MIN_COMPARED_WEEKS && avg > 0;
    lastFullWeek = { start: last.start, total: last.total, changePct: enough ? ((last.total - avg) / avg) * 100 : null, comparedWeeks: before.length };
  }
  const workflowMoves: TrendsSummary["workflowMoves"] = [];
  for (const series of runCost.slice(0, 2)) {
    const pts = series.points.filter((p) => p.median !== null);
    if (pts.length < 2) continue;
    const [a, b] = pts.slice(-2);
    workflowMoves.push({ name: series.name, fromStart: a.start, toStart: b.start, from: a.median!, to: b.median! });
  }

  return { grain: input.grain, cost, weeks, runCost, sentBack, summary: { lastFullWeek, workflowMoves } };
}
