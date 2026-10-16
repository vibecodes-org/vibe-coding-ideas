"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { logger } from "@/lib/logger";
import {
  buildStepPerformanceReport,
  type ReportCommentRow,
  type ReportRunRow,
  type ReportStepRow,
  type ReportTemplateRow,
  type ReportUsageRow,
  type StepPerformanceReport,
} from "@/lib/step-cost/report";

// Admin step report (card ba37039b). Admins can read every workflow step, but
// not every board's runs, templates or step comments, so after the admin
// check the reads go through the service role. Read-only.

export type StepReportPeriod = "30" | "60" | "90" | "all";

export interface StepReportBoard { id: string; title: string }

export interface StepReportResult {
  report: StepPerformanceReport;
  boards: StepReportBoard[];
}

const PERIODS: StepReportPeriod[] = ["30", "60", "90", "all"];
const PAGE = 1000;
const CHUNK = 100;

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: profile } = await supabase.from("users").select("is_admin").eq("id", user.id).single();
  if (!profile?.is_admin) throw new Error("Admin access required");
}

function serviceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Reads every page: a plain read stops at 1,000 rows without an error. */
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Large `.in()` lists come back empty at scale, so they go in chunks. */
async function readByIds<T>(
  ids: string[],
  read: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}

export async function getStepPerformanceReport(params: {
  boardId: string | null;
  period: StepReportPeriod;
}): Promise<StepReportResult> {
  await requireAdmin();
  if (!PERIODS.includes(params.period)) throw new Error("Unknown period");
  const db = serviceClient();
  const since = params.period === "all" ? null : new Date(Date.now() - Number(params.period) * 86_400_000).toISOString();
  const board = params.boardId;

  const steps = await readAll<ReportStepRow>((from, to) => {
    let q = db
      .from("task_workflow_steps")
      .select("id, idea_id, run_id, title, status, step_order, human_check_required, started_at, completed_at, executed_model, reasoning_effort_used")
      .not("run_id", "is", null);
    // Steps that ran in the period (fail_step sets completed_at too).
    if (since) q = q.or(`started_at.gte.${since},completed_at.gte.${since}`);
    if (board) q = q.eq("idea_id", board);
    return q.order("id").range(from, to);
  });

  // Runs and templates are small tables: reading them whole beats thousands of id lookups.
  const runs = await readAll<ReportRunRow>((from, to) =>
    db.from("workflow_runs").select("id, template_id, status").order("id").range(from, to)
  );
  const templates = await readAll<ReportTemplateRow>((from, to) =>
    db.from("workflow_templates").select("id, idea_id, name, steps, updated_at").order("id").range(from, to)
  );

  const stepIds = new Set(steps.map((s) => s.id));
  const comments = (
    await readAll<ReportCommentRow>((from, to) => {
      let q = db
        .from("workflow_step_comments")
        .select("step_id, type, author_id, created_at")
        .in("type", ["failure", "changes_requested"]);
      // No date filter: a step that ran in the period may have been sent back before it.
      if (board) q = q.eq("idea_id", board);
      return q.order("id").range(from, to);
    })
  ).filter((c) => stepIds.has(c.step_id));

  const botIds = new Set(
    (await readAll<{ id: string }>((from, to) => db.from("bot_profiles").select("id").order("id").range(from, to))).map((b) => b.id)
  );

  // Until migration 00196 is applied there is no usage table: show no cost rather than no report.
  const usage = await readAll<ReportUsageRow>((from, to) => {
    let q = db
      .from("workflow_step_usage")
      .select("step_id, run_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens");
    // No date filter: every attempt of a step that ran in the period counts, even one before it.
    if (board) q = q.eq("idea_id", board);
    return q.order("id").range(from, to);
  }).catch((err: unknown) => {
    logger.warn("step report: usage read failed, showing no cost", { error: err instanceof Error ? err.message : String(err) });
    return [] as ReportUsageRow[];
  });

  // Board choices: every board that has a workflow template.
  const boardIdeaIds = [...new Set(templates.map((t) => t.idea_id))];
  const boards = (
    await readByIds<StepReportBoard>(boardIdeaIds, (chunk) => db.from("ideas").select("id, title").in("id", chunk))
  ).sort((a, b) => a.title.localeCompare(b.title));

  return {
    report: buildStepPerformanceReport({ steps, runs, templates, comments, botIds, usage, singleBoard: !!board }),
    boards,
  };
}
