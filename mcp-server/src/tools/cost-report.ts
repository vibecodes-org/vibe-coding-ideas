import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import { stripClaudeWorktreeSuffix } from "../../../src/lib/launch-claude-code";
import { readAll, readByIds } from "../../../src/lib/step-cost/paging";
import type { ReportCommentRow } from "../../../src/lib/step-cost/report";
import {
  buildWeeklyReport,
  type WeeklyIdeaRow,
  type WeeklyPathRow,
  type WeeklyReportData,
  type WeeklyRunRow,
  type WeeklyStepRow,
  type WeeklyTemplateRow,
  type WeeklyUsageRow,
} from "../../../src/lib/step-cost/weekly";
import type { McpContext } from "../context";

// get_cost_report (card 5e654dd1, stage 13): the admin step-cost report's
// figures as raw weekly series, for the caller's own boards only. Read-only.
// Returns names, ids and numbers: never card titles, card content, prompts or
// outputs. Pricing, per-step cost and medians come from src/lib/step-cost, the
// same code as Admin > Reports > Step Performance.

/** The reply (compact JSON, see compactResult) stays under this many characters. */
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
  comments: ReportCommentRow[];
  botIds: string[];
  usage: WeeklyUsageRow[];
}

/**
 * Everything for one board, always scoped by idea_id. Comments and cost rows
 * are read without a date filter, as the admin report does: a step that ran in
 * the window may have been sent back or costed before it, and dropping those
 * would under-count the oldest week.
 */
async function readBoard(db: Db, ideaId: string, since: string): Promise<BoardRows> {
  const templates = await readAll<WeeklyTemplateRow>((from, to) =>
    db.from("workflow_templates").select("id, idea_id, name, updated_at, steps").eq("idea_id", ideaId).order("id").range(from, to)
  );
  const steps = await readAll<WeeklyStepRow>((from, to) =>
    db
      .from("task_workflow_steps")
      .select("id, idea_id, run_id, title, status, started_at, completed_at, human_check_required, model_tier, effort_override, description")
      .eq("idea_id", ideaId)
      .not("run_id", "is", null)
      .or(`started_at.gte.${since},completed_at.gte.${since}`)
      .order("id")
      .range(from, to)
  );
  // Send-backs and failures, as the admin report reads them: a failure paired
  // with a send-back means the step was caught, a person's failure at a
  // human-check step means it was rejected. Those are the steps that count
  // while they wait to re-run.
  const comments = await readAll<ReportCommentRow>((from, to) =>
    db
      .from("workflow_step_comments")
      .select("step_id, type, author_id, created_at")
      .eq("idea_id", ideaId)
      .in("type", ["changes_requested", "failure"])
      .order("id")
      .range(from, to)
  );
  const usage = await readAll<WeeklyUsageRow>((from, to) =>
    db
      .from("workflow_step_usage")
      .select("step_id, run_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, created_at")
      .eq("idea_id", ideaId)
      .order("id")
      .range(from, to)
  );
  // A step sent back to re-run has its times cleared, so the date filter above
  // misses it. Fetch the steps that were costed or sent back inside the window.
  const have = new Set(steps.map((s) => s.id));
  const extraIds = [
    ...new Set([
      ...usage.filter((u) => u.created_at && u.created_at >= since).map((u) => u.step_id),
      ...comments.filter((c) => c.created_at >= since).map((c) => c.step_id),
    ]),
  ].filter((id) => !have.has(id));
  steps.push(
    ...(await readByIds<WeeklyStepRow>(extraIds, (chunk) =>
      db
        .from("task_workflow_steps")
        .select("id, idea_id, run_id, title, status, started_at, completed_at, human_check_required, model_tier, effort_override, description")
        .eq("idea_id", ideaId)
        .not("run_id", "is", null)
        .in("id", chunk)
    ))
  );
  if (steps.length === 0) return { steps, runs: [], templates, comments: [], botIds: [], usage: [] };
  const runIds = [...new Set(steps.map((s) => s.run_id).filter((id): id is string => !!id))];
  const runs = await readByIds<WeeklyRunRow>(runIds, (chunk) => db.from("workflow_runs").select("id, template_id, status").in("id", chunk));
  // Which failure authors are agents. bot_profiles can be read by any signed-in user.
  const failureAuthors = [...new Set(comments.filter((c) => c.type === "failure").map((c) => c.author_id))];
  const botIds = (
    await readByIds<{ id: string }>(failureAuthors, (chunk) => db.from("bot_profiles").select("id").in("id", chunk))
  ).map((b) => b.id);
  return { steps, runs, templates, comments, botIds, usage };
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
  const size = (o: unknown) => JSON.stringify(o).length;
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

/** MCP text result as compact JSON: no pretty-print spacing, so long series stay small. */
export function compactResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
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

  const all: BoardRows = { steps: [], runs: [], templates: [], comments: [], botIds: [], usage: [] };
  for (let i = 0; i < ideaIds.length; i += BOARD_CONCURRENCY) {
    const rows = await Promise.all(ideaIds.slice(i, i + BOARD_CONCURRENCY).map((id) => readBoard(db, id, since)));
    for (const r of rows) {
      all.steps.push(...r.steps);
      all.runs.push(...r.runs);
      all.templates.push(...r.templates);
      all.comments.push(...r.comments);
      all.botIds.push(...r.botIds);
      all.usage.push(...r.usage);
    }
  }

  const data = buildWeeklyReport({
    ...all,
    botIds: new Set(all.botIds),
    ideas,
    paths,
    weekEndsAt,
    weeks,
  });
  return fitReport(data, new Date().toISOString());
}
