// Weekly cost series for the get_cost_report MCP tool (card 5e654dd1, stage 13).
// Pure: the tool fetches the rows, this turns them into raw per-week figures
// (no trends or flags; the caller works those out). Prices, per-step cost and
// medians come from the same code as the admin step report (pricing.ts,
// report.ts), so the figures agree. Returns totals and names only, never card
// titles, card content, prompts or outputs.

import { MODEL_PRICES, priceKey, usageCost } from "./pricing";
import {
  countedSteps,
  isWholeRun,
  median,
  stepCostsFor,
  wholeRunCost,
  type ReportCommentRow,
  type ReportUsageRow,
} from "./report";

/** A recorded attempt; created_at says when, for a step that was sent back and is waiting to re-run. */
export type WeeklyUsageRow = ReportUsageRow & { created_at?: string };

const WEEK_MS = 7 * 86_400_000;

export interface WeeklyStepRow {
  id: string;
  idea_id: string;
  run_id: string | null;
  title: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  /** A person approves this step; their failure on it is a rejection. */
  human_check_required: boolean;
  /** What the step ran with, copied from its template when the run started. */
  model_tier: string | null;
  effort_override: string | null;
  description: string | null;
}
export interface WeeklyRunRow { id: string; template_id: string | null; status: string }
export interface WeeklyTemplateRow { id: string; idea_id: string; name: string; updated_at: string; steps: unknown }
export interface WeeklyIdeaRow { id: string; title: string }
export interface WeeklyPathRow { idea_id: string; absolute_path: string; updated_at: string }

/** The main window's own usage for one hour and model, net of what steps counted (card f2a563ca). */
export interface WeeklyMainHourRow {
  conversation_id: string;
  idea_id: string;
  hour: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_5m_tokens: number;
  cache_write_1h_tokens: number;
}
/** One reported conversation: its first and last call, the steps it ran, and its newest session name. */
export interface WeeklyConversationRow {
  conversation_id: string;
  idea_id: string;
  first_call_at: string | null;
  last_call_at: string | null;
  step_ids: string[];
  name?: string | null;
}

export interface WeeklyInput {
  steps: WeeklyStepRow[];
  runs: WeeklyRunRow[];
  templates: WeeklyTemplateRow[];
  /** changes_requested and failure comments (the rest are ignored), to tell caught and rejected steps apart. */
  comments: ReportCommentRow[];
  /** Author ids that are agents (bot profiles), to tell an agent's failure from a person's. */
  botIds: Set<string>;
  usage: WeeklyUsageRow[];
  ideas: WeeklyIdeaRow[];
  paths: WeeklyPathRow[];
  /** Main-window usage rows (optional: nothing reported yet means zeros). */
  mainHours?: WeeklyMainHourRow[];
  conversations?: WeeklyConversationRow[];
  weekEndsAt: Date;
  weeks: number;
}

export interface WeeklySession {
  /** First 8 characters of the conversation id. */
  conversation: string;
  board: string;
  name: string | null;
  first_call_at: string | null;
  last_call_at: string | null;
  main_window_usd: number;
  steps_usd: number;
  steps: number;
}

export interface WeeklyReportData {
  weeks: { start: string; end: string }[];
  prices: Record<string, { in: number; out: number; cache_read: number; cache_write_5m: number; cache_write_1h: number }>;
  unpriced_models: string[];
  vibecodes_total_usd: number[];
  /** The main window's own usage per week (in-app Claude sessions only; steps and main window never overlap). */
  main_window_total_usd: number[];
  /** Finished steps per week with no cost recorded (or an unpriced model). Their cost is missing, not zero. */
  cost_missing: number[];
  boards: { idea_id: string; title: string; project_path: string | null; usd: number[]; main_window_usd: number[]; runs: number[] }[];
  workflows: { name: string; runs: number[]; usd: number[]; median_usd: (number | null)[]; sent_back: number[]; cost_missing: number[] }[];
  steps: { workflow: string; step: string; version: string; runs: number[]; median_usd: (number | null)[]; usd: number[]; cost_missing: number[] }[];
  runs_this_week: { run_id: string; workflow: string; usd: number; sent_back: boolean }[];
  /** This week's busiest in-app sessions: main window next to the steps they ran. Biggest first. */
  sessions_this_week: WeeklySession[];
}

/** Dollars to the cent, or to the tenth of a cent for tiny amounts, so small figures don't read as zero. */
export function roundUsd(v: number): number {
  return Math.abs(v) >= 0.1 ? Math.round(v * 100) / 100 : Math.round(v * 1000) / 1000;
}

/** Short marker (6 hex chars, FNV-1a) that changes when the text it was made from changes. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 6);
}

/** The step's version: changes when its model tier, effort or instructions change. */
export function stepVersion(s: Pick<WeeklyStepRow, "model_tier" | "effort_override" | "description">): string {
  return shortHash(`${s.model_tier ?? ""}\u0000${s.effort_override ?? ""}\u0000${s.description ?? ""}`);
}

/** The 7-day windows, newest last, the latest ending at weekEndsAt. */
export function weekWindows(weekEndsAt: Date, weeks: number): { start: string; end: string }[] {
  const end = weekEndsAt.getTime();
  return Array.from({ length: weeks }, (_, i) => {
    const e = end - (weeks - 1 - i) * WEEK_MS;
    return { start: new Date(e - WEEK_MS).toISOString(), end: new Date(e).toISOString() };
  });
}

/** Window index for a time (windows are start < t <= end), or -1 when outside all of them. */
export function weekIndex(iso: string | null, weekEndsAt: Date, weeks: number): number {
  if (!iso) return -1;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return -1;
  const d = weekEndsAt.getTime() - t;
  if (d < 0) return -1;
  const k = Math.floor(d / WEEK_MS);
  return k >= weeks ? -1 : weeks - 1 - k;
}

const zeros = (n: number) => Array.from({ length: n }, () => 0);

export function buildWeeklyReport(input: WeeklyInput): WeeklyReportData {
  const { weekEndsAt, weeks } = input;
  const idx = (iso: string | null) => weekIndex(iso, weekEndsAt, weeks);

  const runs = new Map(input.runs.map((r) => [r.id, r]));
  // Same-named workflows on different boards are combined, as in the admin all-boards report.
  const templates = new Map(input.templates.map((t) => [t.id, t]));
  const nameOf = new Map<string, string>(); // key -> display name (most recently edited template's)
  const nameStamp = new Map<string, string>();
  for (const t of input.templates) {
    const key = t.name.trim().toLowerCase();
    if (!nameStamp.has(key) || t.updated_at > nameStamp.get(key)!) {
      nameStamp.set(key, t.updated_at);
      nameOf.set(key, t.name.trim());
    }
  }

  // Steps that finished an attempt inside the windows, on a run with a known
  // workflow. A step waiting to re-run (pending or in progress again) still
  // counts when the Admin report would count it (caught by a send-back, or
  // rejected at its gate), in the week of its latest recorded attempt, so its
  // earlier attempt's cost doesn't vanish. A step that only has cost (for
  // example one from a run that was reset) does not.
  const sentBackStepIds = new Set(input.comments.filter((c) => c.type === "changes_requested").map((c) => c.step_id));
  const lastUsage = new Map<string, string>();
  for (const u of input.usage) {
    if (u.created_at && u.created_at > (lastUsage.get(u.step_id) ?? "")) lastUsage.set(u.step_id, u.created_at);
  }
  const counted: (WeeklyStepRow & { week: number; wf: string })[] = [];
  for (const { step: s, when, templateId } of countedSteps({
    steps: input.steps,
    runs: input.runs,
    templates: input.templates,
    comments: input.comments,
    botIds: input.botIds,
    lastUsage,
  })) {
    const week = idx(when);
    if (week < 0) continue;
    counted.push({ ...s, week, wf: templates.get(templateId)!.name.trim().toLowerCase() });
  }

  const { stepCost, unpricedModels } = stepCostsFor(input.usage, new Set(counted.map((s) => s.id)));
  const usedFamilies = new Set<string>();
  for (const u of input.usage) {
    if (!stepCost.has(u.step_id)) continue;
    const key = priceKey(u.model);
    if (key) usedFamilies.add(key);
  }
  // Main-window usage, priced from the same table.
  const mainHours = input.mainHours ?? [];
  const mainUsd = zeros(weeks);
  const mainByBoard = new Map<string, number[]>();
  const mainByConv = new Map<string, number>(); // conversation -> latest week's usd
  const unpricedMain = new Set<string>();
  for (const h of mainHours) {
    const week = idx(h.hour);
    if (week < 0) continue;
    const cost = usageCost(h);
    if (cost === null) {
      unpricedMain.add(h.model);
      continue;
    }
    const key = priceKey(h.model);
    if (key) usedFamilies.add(key);
    mainUsd[week] += cost;
    const b = mainByBoard.get(h.idea_id) ?? zeros(weeks);
    b[week] += cost;
    mainByBoard.set(h.idea_id, b);
    if (week === weeks - 1) mainByConv.set(h.conversation_id, (mainByConv.get(h.conversation_id) ?? 0) + cost);
  }
  for (const m of unpricedMain) unpricedModels.add(m);
  const prices: WeeklyReportData["prices"] = {};
  for (const key of [...usedFamilies].sort()) {
    const p = MODEL_PRICES[key];
    prices[key] = { in: p.input, out: p.output, cache_read: p.cacheRead, cache_write_5m: p.cacheWrite5m, cache_write_1h: p.cacheWrite1h };
  }

  // A run belongs to the week of its latest step; its cost is all its costed steps.
  interface RunAcc { id: string; wf: string; idea: string; week: number; usd: number; sentBack: boolean; stepIds: string[]; titles: string[] }
  const runAcc = new Map<string, RunAcc>();
  for (const s of counted) {
    let r = runAcc.get(s.run_id!);
    if (!r) {
      r = { id: s.run_id!, wf: s.wf, idea: s.idea_id, week: s.week, usd: 0, sentBack: false, stepIds: [], titles: [] };
      runAcc.set(r.id, r);
    }
    r.week = Math.max(r.week, s.week);
    r.usd += stepCost.get(s.id) ?? 0;
    r.stepIds.push(s.id);
    r.titles.push(s.title);
    if (sentBackStepIds.has(s.id)) r.sentBack = true;
  }

  const total = zeros(weeks);
  const missing = zeros(weeks);
  for (const s of counted) {
    total[s.week] += stepCost.get(s.id) ?? 0;
    if (!stepCost.has(s.id)) missing[s.week]++;
  }

  // Boards
  const titles = new Map(input.ideas.map((i) => [i.id, i.title]));
  const pathOf = new Map<string, WeeklyPathRow>();
  for (const p of input.paths) {
    const cur = pathOf.get(p.idea_id);
    if (!cur || p.updated_at > cur.updated_at) pathOf.set(p.idea_id, p);
  }
  const boardUsd = new Map<string, number[]>();
  const boardRuns = new Map<string, number[]>();
  for (const s of counted) {
    const u = boardUsd.get(s.idea_id) ?? zeros(weeks);
    u[s.week] += stepCost.get(s.id) ?? 0;
    boardUsd.set(s.idea_id, u);
  }
  for (const r of runAcc.values()) {
    const n = boardRuns.get(r.idea) ?? zeros(weeks);
    n[r.week]++;
    boardRuns.set(r.idea, n);
  }
  const boardIds = new Set([...boardUsd.keys(), ...mainByBoard.keys()]);
  const boards = [...boardIds]
    .map((id) => ({
      idea_id: id,
      title: titles.get(id) ?? "(unknown board)",
      project_path: pathOf.get(id)?.absolute_path ?? null,
      usd: (boardUsd.get(id) ?? zeros(weeks)).map(roundUsd),
      main_window_usd: (mainByBoard.get(id) ?? zeros(weeks)).map(roundUsd),
      runs: boardRuns.get(id) ?? zeros(weeks),
    }))
    .sort((a, b) => sum(b.usd) + sum(b.main_window_usd) - (sum(a.usd) + sum(a.main_window_usd)) || a.title.localeCompare(b.title));

  // Workflows
  const wfs = new Map<string, { usd: number[]; runs: number[]; sent: number[]; miss: number[]; runCosts: number[][] }>();
  const wf = (key: string) => {
    let w = wfs.get(key);
    if (!w) {
      w = { usd: zeros(weeks), runs: zeros(weeks), sent: zeros(weeks), miss: zeros(weeks), runCosts: Array.from({ length: weeks }, () => []) };
      wfs.set(key, w);
    }
    return w;
  };
  for (const s of counted) {
    wf(s.wf).usd[s.week] += stepCost.get(s.id) ?? 0;
    if (!stepCost.has(s.id)) wf(s.wf).miss[s.week]++;
  }
  for (const r of runAcc.values()) {
    const w = wf(r.wf);
    w.runs[r.week]++;
    if (r.sentBack) w.sent[r.week]++;
    // Typical cost per run uses the Admin whole-run rule: finished, every current
    // step present and costed. Other runs still count in usd, runs and the rest.
    const run = runs.get(r.id);
    if (isWholeRun(run?.status, templates.get(run?.template_id ?? "")?.steps, r.titles)) {
      const total = wholeRunCost(r.stepIds, stepCost);
      if (total !== null) w.runCosts[r.week].push(total);
    }
  }
  const workflows = [...wfs.entries()]
    .map(([key, w]) => ({
      name: nameOf.get(key) ?? key,
      runs: w.runs,
      usd: w.usd.map(roundUsd),
      median_usd: w.runCosts.map((c) => {
        const m = median(c);
        return m === null ? null : roundUsd(m);
      }),
      sent_back: w.sent,
      cost_missing: w.miss,
    }))
    .sort((a, b) => sum(b.usd) - sum(a.usd) || a.name.localeCompare(b.name));

  // Steps: one row per workflow + step title + version.
  const stepGroups = new Map<string, { wf: string; title: string; version: string; runs: number[]; usd: number[]; miss: number[]; costs: number[][] }>();
  for (const s of counted) {
    const version = stepVersion(s);
    const key = `${s.wf}\u0000${s.title}\u0000${version}`;
    let g = stepGroups.get(key);
    if (!g) {
      g = { wf: s.wf, title: s.title, version, runs: zeros(weeks), usd: zeros(weeks), miss: zeros(weeks), costs: Array.from({ length: weeks }, () => []) };
      stepGroups.set(key, g);
    }
    g.runs[s.week]++;
    const c = stepCost.get(s.id);
    if (c !== undefined) {
      g.usd[s.week] += c;
      g.costs[s.week].push(c);
    } else {
      g.miss[s.week]++;
    }
  }
  const steps = [...stepGroups.values()]
    .map((g) => ({
      workflow: nameOf.get(g.wf) ?? g.wf,
      step: g.title,
      version: g.version,
      runs: g.runs,
      median_usd: g.costs.map((c) => {
        const m = median(c);
        return m === null ? null : roundUsd(m);
      }),
      usd: g.usd.map(roundUsd),
      cost_missing: g.miss,
    }))
    .sort((a, b) => sum(b.usd) - sum(a.usd) || a.step.localeCompare(b.step));

  const latest = weeks - 1;
  const runsThisWeek = [...runAcc.values()]
    .filter((r) => r.week === latest)
    .map((r) => ({ run_id: r.id, workflow: nameOf.get(r.wf) ?? r.wf, usd: roundUsd(r.usd), sent_back: r.sentBack }))
    .sort((a, b) => b.usd - a.usd || a.run_id.localeCompare(b.run_id));

  // This week's sessions: main window next to the steps (counted this week) the conversation ran.
  const sessionsThisWeek: WeeklySession[] = [];
  const convs = new Map((input.conversations ?? []).map((c) => [c.conversation_id, c]));
  for (const [id, mainUsdWeek] of mainByConv) {
    const c = convs.get(id);
    const ideaId = c?.idea_id ?? mainHours.find((h) => h.conversation_id === id)?.idea_id ?? "";
    let stepsUsd = 0;
    let stepCount = 0;
    for (const sid of c?.step_ids ?? []) {
      const step = counted.find((x) => x.id === sid && x.week === latest);
      if (!step) continue;
      stepCount++;
      stepsUsd += stepCost.get(sid) ?? 0;
    }
    sessionsThisWeek.push({
      conversation: id.slice(0, 8),
      board: titles.get(ideaId) ?? "(unknown board)",
      name: c?.name ?? null,
      first_call_at: c?.first_call_at ?? null,
      last_call_at: c?.last_call_at ?? null,
      main_window_usd: roundUsd(mainUsdWeek),
      steps_usd: roundUsd(stepsUsd),
      steps: stepCount,
    });
  }
  sessionsThisWeek.sort(
    (a, b) => b.main_window_usd + b.steps_usd - (a.main_window_usd + a.steps_usd) || a.conversation.localeCompare(b.conversation),
  );

  return {
    weeks: weekWindows(weekEndsAt, weeks),
    prices,
    unpriced_models: [...unpricedModels].sort(),
    vibecodes_total_usd: total.map(roundUsd),
    main_window_total_usd: mainUsd.map(roundUsd),
    cost_missing: missing,
    boards,
    workflows,
    steps,
    runs_this_week: runsThisWeek,
    sessions_this_week: sessionsThisWeek,
  };
}

function sum(v: number[]): number {
  return v.reduce((a, b) => a + b, 0);
}
