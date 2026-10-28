"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { logger } from "@/lib/logger";
import {
  buildStepPerformanceReport,
  type ReportCommentRow,
  type ReportRunRow,
  type ReportRunStepRow,
  type ReportStepRow,
  type ReportTemplateRow,
  type ReportUsageRow,
  type StepPerformanceReport,
} from "@/lib/step-cost/report";
import { buildCostTrends, type CostTrends, type TrendsUnmeasuredRow } from "@/lib/step-cost/trends";
import { backfillFileSchema } from "@/lib/step-cost/usage-schema";
import { readAll, readAllByIds, readByIds } from "@/lib/step-cost/paging";
import { importKey, planImport, type UsageInsert } from "@/lib/step-cost/backfill-import";

// Admin step report (card ba37039b). Admins can read every workflow step, but
// not every board's runs, templates or step comments, so after the admin
// check the reads go through the service role. Read-only.

export type StepReportPeriod = "30" | "60" | "90" | "all";

export interface StepReportBoard { id: string; title: string }

export interface StepReportResult {
  report: StepPerformanceReport;
  trends: CostTrends;
  boards: StepReportBoard[];
}

const PERIODS: StepReportPeriod[] = ["30", "60", "90", "all"];

async function requireAdmin(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: profile } = await supabase.from("users").select("is_admin").eq("id", user.id).single();
  if (!profile?.is_admin) throw new Error("Admin access required");
  return user.id;
}

function serviceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
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

  // Every step of those runs, unfinished or before the period too: a run's
  // whole step list is what says which version of its template it used.
  const runIds = [...new Set(steps.map((s) => s.run_id).filter((id): id is string => !!id))];
  const runSteps = await readAllByIds<ReportRunStepRow>(runIds, (chunk, from, to) =>
    db.from("task_workflow_steps").select("run_id, title").in("run_id", chunk).order("id").range(from, to)
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
  const usage = await readAll<ReportUsageRow & { created_at?: string }>((from, to) => {
    let q = db
      .from("workflow_step_usage")
      .select("step_id, run_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, created_at");
    // No date filter: every attempt of a step that ran in the period counts, even one before it.
    if (board) q = q.eq("idea_id", board);
    return q.order("id").range(from, to);
  }).catch((err: unknown) => {
    logger.warn("step report: usage read failed, showing no cost", { error: err instanceof Error ? err.message : String(err) });
    return [] as (ReportUsageRow & { created_at?: string })[];
  });

  // Card 1117ac6b stage 2: why some steps have no cost. Until migration 00204 is applied the table
  // is absent: show no reasons rather than no report.
  const unmeasured = await readAll<TrendsUnmeasuredRow>((from, to) => {
    let q = db.from("workflow_step_unmeasured").select("step_id, kind, reason, created_at");
    if (board) q = q.eq("idea_id", board);
    return q.order("id").range(from, to);
  }).catch((err: unknown) => {
    logger.warn("step report: unmeasured read failed, showing no reasons", { error: err instanceof Error ? err.message : String(err) });
    return [] as TrendsUnmeasuredRow[];
  });

  // Board choices: every board that has a workflow template.
  const boardIdeaIds = [...new Set(templates.map((t) => t.idea_id))];
  const boards = (
    await readByIds<StepReportBoard>(boardIdeaIds, (chunk) => db.from("ideas").select("id, title").in("id", chunk))
  ).sort((a, b) => a.title.localeCompare(b.title));

  return {
    report: buildStepPerformanceReport({ steps, runs, templates, comments, botIds, usage, runSteps, singleBoard: !!board }),
    // Bars are days for the 30-day view, weeks otherwise; same rows as the report, so the bars add up to its tiles.
    trends: buildCostTrends({
      steps,
      runs,
      templates,
      comments,
      botIds,
      usage,
      unmeasured,
      grain: params.period === "30" ? "day" : "week",
      from: since,
      now: new Date(),
    }),
    boards,
  };
}

export interface StepUsageImportResult {
  /** Step attempts stored. */
  imported: number;
  /** Attempts left out because their step already had a cost recorded. */
  alreadyCosted: number;
  /** Attempts for steps that no longer exist. */
  unknownSteps: number;
}

// The page sends a big file in pieces (src/lib/step-cost/backfill-chunks.ts); one call is capped at 1 MB.
const MAX_IMPORT_CHARS = 1_000_000;

/**
 * Stores past step costs from the file scripts/step-usage-backfill.mjs writes.
 * A step that already has a cost is left alone, except attempts marked
 * adds_to_existing (session share only), which are stored unless a row with the
 * same step, model and time exists. Either way, importing a file twice, or
 * files from two machines, never counts anything twice.
 */
export async function importStepUsageBackfill(fileText: string): Promise<StepUsageImportResult> {
  const adminId = await requireAdmin();
  if (typeof fileText !== "string" || fileText.length > MAX_IMPORT_CHARS) throw new Error("That file is too big to be a step cost file.");
  let json: unknown;
  try {
    json = JSON.parse(fileText);
  } catch {
    throw new Error("That file isn't JSON. Choose the file scripts/step-usage-backfill.mjs wrote.");
  }
  const parsed = backfillFileSchema.safeParse(json);
  if (!parsed.success) throw new Error("That isn't a step cost file from scripts/step-usage-backfill.mjs.");
  const attempts = parsed.data.attempts;
  const db = serviceClient();

  const stepIds = [...new Set(attempts.map((a) => a.step_id))];
  const steps = new Map(
    (
      await readByIds<{ id: string; run_id: string | null; idea_id: string }>(stepIds, (chunk) =>
        db.from("task_workflow_steps").select("id, run_id, idea_id").in("id", chunk)
      )
    ).map((s) => [s.id, s])
  );
  const costed = new Set(
    (
      await readAllByIds<{ step_id: string }>(stepIds, (chunk, from, to) =>
        db.from("workflow_step_usage").select("step_id").in("step_id", chunk).order("id").range(from, to)
      )
    ).map((r) => r.step_id)
  );

  // Session-share attempts are matched against rows already stored, so a re-import adds nothing.
  const existingKeys = new Set<string>();
  const addIds = [...new Set(attempts.filter((a) => a.adds_to_existing).map((a) => a.step_id))];
  if (addIds.length > 0) {
    const rows = await readAllByIds<{ step_id: string; model: string; created_at: string }>(addIds, (chunk, from, to) =>
      db.from("workflow_step_usage").select("step_id, model, created_at").in("step_id", chunk).order("id").range(from, to)
    );
    for (const r of rows) existingKeys.add(importKey(r.step_id, r.model, r.created_at));
  }

  // Grouped by step: a batch never splits one, so a partly stored file can be imported again.
  const plan = planImport(attempts, { steps, costedStepIds: costed, existingKeys, reportedBy: adminId });
  const result: StepUsageImportResult = { imported: plan.imported, alreadyCosted: plan.alreadyCosted, unknownSteps: plan.unknownSteps };
  const byStep = plan.rowsByStep;
  const batches: UsageInsert[][] = [[]];
  for (const rows of byStep.values()) {
    if (batches[batches.length - 1].length + rows.length > 500) batches.push([]);
    batches[batches.length - 1].push(...rows);
  }
  for (const [i, batch] of batches.entries()) {
    if (batch.length === 0) continue;
    const { error } = await db.from("workflow_step_usage").insert(batch);
    if (error) {
      logger.error("step usage import failed", { error: error.message, batch: i });
      throw new Error(i === 0 ? "Couldn't store the costs." : "Only part of the file was stored. Import it again to add the rest.");
    }
  }
  logger.info("step usage imported", { ...result, adminId });
  return result;
}
