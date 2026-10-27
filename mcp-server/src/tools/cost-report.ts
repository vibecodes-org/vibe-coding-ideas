import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import { stripClaudeWorktreeSuffix } from "../../../src/lib/launch-claude-code";
import { readAll, readByIds } from "../../../src/lib/step-cost/paging";
import type { ReportUsageRow } from "../../../src/lib/step-cost/report";
import {
  buildWeeklyReport,
  type WeeklyIdeaRow,
  type WeeklyPathRow,
  type WeeklyReportData,
  type WeeklyRunRow,
  type WeeklyStepRow,
  type WeeklyTemplateRow,
} from "../../../src/lib/step-cost/weekly";
import type { McpContext } from "../context";

// get_cost_report (card 5e654dd1, stage 13): the admin step-cost report's
// figures as raw weekly series, for the caller's own boards only. Read-only.
// Returns names, ids and numbers: never card titles, card content, prompts or
// outputs. Pricing, per-step cost and medians come from src/lib/step-cost, the
// same code as Admin > Reports > Step Performance.

/** The reply (pretty-printed, as jsonResult sends it) stays under this many characters. */
export const MAX_REPORT_CHARS = 12_000;
const TARGET_CHARS = 11_500;
/** Boards are read this many at a time. */
const BOARD_CONCURRENCY = 4;

export const getCostReportSchema = z.object({
  week_ends_at: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("ISO time the weekly allowance resets; the latest 7-day window ends here. Defaults to now."),
  weeks: z.number().int().min(1).max(26).default(8).describe("How many 7-day windows to return, 1-26 (default 8)"),
});

type Db = McpContext["supabase"];

async function memberIdeaIds(db: Db, userId: string): Promise<string[]> {
  const authored = await readAll<{ id: string }>((from, to) =>
    db.from("ideas").select("id").eq("author_id", userId).order("id").range(from, to)
  );
  const collab = await readAll<{ idea_id: string }>((from, to) =>
    db.from("collaborators").select("idea_id").eq("user_id", userId).order("id").range(from, to)
  );
  return [...new Set([...authored.map((i) => i.id), ...collab.map((c) => c.idea_id)])];
}

interface BoardRows {
  steps: WeeklyStepRow[];
  runs: WeeklyRunRow[];
  templates: WeeklyTemplateRow[];
  sentBackStepIds: string[];
  usage: ReportUsageRow[];
}

/** Everything for one board, always scoped by idea_id. */
async function readBoard(db: Db, ideaId: string, since: string): Promise<BoardRows> {
  const templates = await readAll<WeeklyTemplateRow>((from, to) =>
    db.from("workflow_templates").select("id, idea_id, name, updated_at").eq("idea_id", ideaId).order("id").range(from, to)
  );
  const steps = await readAll<WeeklyStepRow>((from, to) =>
    db
      .from("task_workflow_steps")
      .select("id, idea_id, run_id, title, status, started_at, completed_at, model_tier, effort_override, description")
      .eq("idea_id", ideaId)
      .not("run_id", "is", null)
      .or(`started_at.gte.${since},completed_at.gte.${since}`)
      .order("id")
      .range(from, to)
  );
  if (steps.length === 0) return { steps, runs: [], templates, sentBackStepIds: [], usage: [] };
  const runIds = [...new Set(steps.map((s) => s.run_id).filter((id): id is string => !!id))];
  const runs = await readByIds<WeeklyRunRow>(runIds, (chunk) => db.from("workflow_runs").select("id, template_id").in("id", chunk));
  const comments = await readAll<{ step_id: string }>((from, to) =>
    db
      .from("workflow_step_comments")
      .select("step_id")
      .eq("idea_id", ideaId)
      .eq("type", "changes_requested")
      .gte("created_at", since)
      .order("id")
      .range(from, to)
  );
  const usage = await readAll<ReportUsageRow>((from, to) =>
    db
      .from("workflow_step_usage")
      .select("step_id, run_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens")
      .eq("idea_id", ideaId)
      .gte("created_at", since)
      .order("id")
      .range(from, to)
  );
  return { steps, runs, templates, sentBackStepIds: comments.map((c) => c.step_id), usage };
}

type CappedList = "steps" | "runs_this_week" | "boards" | "workflows";

export type FittedReport = WeeklyReportData & {
  generated_at: string;
  truncated?: Partial<Record<CappedList, { shown: number; total: number }>>;
};

/**
 * Shrinks the report until it fits: the longest list is cut first, always
 * keeping the biggest spenders (lists arrive sorted by cost). Says what was cut.
 */
export function fitReport(data: WeeklyReportData, generatedAt: string, maxChars = TARGET_CHARS): FittedReport {
  const keys: CappedList[] = ["steps", "runs_this_week", "boards", "workflows"];
  const caps: Record<CappedList, number> = { steps: 25, runs_this_week: 10, boards: 15, workflows: 15 };
  const build = (): FittedReport => {
    const truncated: NonNullable<FittedReport["truncated"]> = {};
    for (const k of keys) {
      if (data[k].length > caps[k]) truncated[k] = { shown: caps[k], total: data[k].length };
    }
    return {
      generated_at: generatedAt,
      ...data,
      steps: data.steps.slice(0, caps.steps),
      runs_this_week: data.runs_this_week.slice(0, caps.runs_this_week),
      boards: data.boards.slice(0, caps.boards),
      workflows: data.workflows.slice(0, caps.workflows),
      ...(Object.keys(truncated).length > 0 ? { truncated } : {}),
    };
  };
  const size = (o: unknown) => JSON.stringify(o, null, 2).length;
  let out = build();
  while (size(out) > maxChars) {
    // Cut the list with the most items still shown; the first in order wins ties.
    const next = keys.filter((k) => caps[k] > 0).sort((a, b) => caps[b] - caps[a])[0];
    if (!next) break;
    caps[next] = Math.max(0, caps[next] - (caps[next] > 4 ? 3 : 1));
    out = build();
  }
  return out;
}

export async function getCostReport(ctx: McpContext, params: z.infer<typeof getCostReportSchema>) {
  const db = ctx.supabase;
  const caller = ctx.ownerUserId ?? ctx.userId;
  const weeks = params.weeks;
  const weekEndsAt = params.week_ends_at ? new Date(params.week_ends_at) : new Date();
  if (!Number.isFinite(weekEndsAt.getTime())) throw new Error("week_ends_at must be an ISO time");
  const since = new Date(weekEndsAt.getTime() - weeks * 7 * 86_400_000).toISOString();

  const ideaIds = await memberIdeaIds(db, caller);
  const ideas = await readByIds<WeeklyIdeaRow>(ideaIds, (chunk) => db.from("ideas").select("id, title").in("id", chunk));
  const paths = (
    await readByIds<WeeklyPathRow & { owner_user_id: string }>(ideaIds, (chunk) =>
      db.from("idea_project_paths").select("idea_id, absolute_path, updated_at, owner_user_id").in("idea_id", chunk)
    ).catch((err: unknown) => {
      logger.warn("cost report: project folders unreadable", { error: err instanceof Error ? err.message : String(err) });
      return [];
    })
  )
    .filter((p) => p.owner_user_id === caller)
    .map((p) => ({ idea_id: p.idea_id, absolute_path: stripClaudeWorktreeSuffix(p.absolute_path), updated_at: p.updated_at }));

  const all: BoardRows = { steps: [], runs: [], templates: [], sentBackStepIds: [], usage: [] };
  for (let i = 0; i < ideaIds.length; i += BOARD_CONCURRENCY) {
    const rows = await Promise.all(ideaIds.slice(i, i + BOARD_CONCURRENCY).map((id) => readBoard(db, id, since)));
    for (const r of rows) {
      all.steps.push(...r.steps);
      all.runs.push(...r.runs);
      all.templates.push(...r.templates);
      all.sentBackStepIds.push(...r.sentBackStepIds);
      all.usage.push(...r.usage);
    }
  }

  const data = buildWeeklyReport({
    ...all,
    sentBackStepIds: new Set(all.sentBackStepIds),
    ideas,
    paths,
    weekEndsAt,
    weeks,
  });
  return fitReport(data, new Date().toISOString());
}
