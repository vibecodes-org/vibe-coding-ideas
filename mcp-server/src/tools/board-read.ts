import { z } from "zod";
import { DEFAULT_BOARD_COLUMNS } from "../constants";
import { pickCurrentRunKey, pickNextOpenStep } from "../../../src/lib/workflow-current-run";
import type { McpContext } from "../context";
import {
  groupStepComments,
  type StepCommentRow,
} from "../lib/step-comments";

/**
 * The fields selected for an open workflow suggestion, in agent-pickup payloads.
 * Shared between get_task (FR-1) and claim_next_step (FR-2) so both surface an
 * identical suggestion shape. A suggestion is NOT a workflow step — it never
 * affects workflow_step_total or any claim token.
 */
export const OPEN_SUGGESTION_FIELDS =
  "id, label_id, rule_id, suggested_template_id, recommended_template_id, source, ai_confidence, reason, detected_categories, status, adjudication_started_at";

/** Maps a raw workflow_suggestions row to the agent-facing payload shape. */
export function shapeOpenSuggestion(row: Record<string, unknown>) {
  return {
    suggestion_id: row.id as string,
    label_id: row.label_id as string,
    rule_id: (row.rule_id as string | null) ?? null,
    suggested_template_id: (row.suggested_template_id as string | null) ?? null,
    recommended_template_id: (row.recommended_template_id as string | null) ?? null,
    source: row.source as string,
    ai_confidence: (row.ai_confidence as number | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    detected_categories: row.detected_categories ?? null,
    status: row.status as string,
    adjudication_started_at: (row.adjudication_started_at as string | null) ?? null,
  };
}

/**
 * Fetch all OPEN (status = 'suggested') workflow suggestions for a task, shaped
 * for agent pickup. Returns [] when there are none.
 */
export async function fetchOpenSuggestions(
  ctx: McpContext,
  taskId: string
): Promise<ReturnType<typeof shapeOpenSuggestion>[]> {
  const { data, error } = await ctx.supabase
    .from("workflow_suggestions")
    .select(OPEN_SUGGESTION_FIELDS)
    .eq("task_id", taskId)
    .eq("status", "suggested");

  if (error) throw new Error(`Failed to fetch workflow suggestions: ${error.message}`);
  return (data ?? []).map((r) => shapeOpenSuggestion(r as Record<string, unknown>));
}

export const getBoardSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  column_ids: z
    .array(z.string().uuid())
    .optional()
    .describe("Only return these columns (by ID). Overrides exclude_done when provided."),
  column_names: z
    .array(z.string())
    .optional()
    .describe(
      "Only return columns matching these names (case-insensitive). Overrides exclude_done when provided."
    ),
  include_archived: z
    .boolean()
    .default(false)
    .describe("Include archived tasks"),
  exclude_done: z
    .boolean()
    .default(true)
    .describe("Exclude tasks in done columns (default true)"),
});

export async function getBoard(ctx: McpContext, params: z.infer<typeof getBoardSchema>) {
  // Check if columns exist; if not, initialize defaults
  const colResult = await ctx.supabase
    .from("board_columns")
    .select("*")
    .eq("idea_id", params.idea_id)
    .order("position");

  let columns = colResult.data;
  if (colResult.error) throw new Error(`Failed to get board: ${colResult.error.message}`);

  if (!columns || columns.length === 0) {
    // Before initializing, verify the idea exists and user has access
    const { data: idea, error: ideaError } = await ctx.supabase
      .from("ideas")
      .select("id")
      .eq("id", params.idea_id)
      .maybeSingle();

    if (ideaError) throw new Error(`Failed to check idea access: ${ideaError.message}`);
    if (!idea) throw new Error(`Idea not found or access denied: ${params.idea_id}`);

    // Check user's custom default columns
    const { data: userProfile } = await ctx.supabase
      .from("users")
      .select("default_board_columns")
      .eq("id", ctx.ownerUserId ?? ctx.userId)
      .single();

    const columnDefs = userProfile?.default_board_columns ?? DEFAULT_BOARD_COLUMNS;

    const { data: newCols, error: initError } = await ctx.supabase
      .from("board_columns")
      .insert(
        columnDefs.map((col: { title: string; is_done_column: boolean }, i: number) => ({
          idea_id: params.idea_id,
          title: col.title,
          position: i * 1000,
          is_done_column: col.is_done_column,
        }))
      )
      .select();

    if (initError)
      throw new Error(`Failed to initialize board: ${initError.message}`);
    columns = newCols;
  }

  // Fetch tasks
  let taskQuery = ctx.supabase
    .from("board_tasks")
    .select(
      "*, users!board_tasks_assignee_id_fkey(id, full_name), board_task_labels(label_id, board_labels(id, name, color))"
    )
    .eq("idea_id", params.idea_id)
    // Secondary tiebreaker: two tasks can share a position (e.g. both moved
    // to the same column's top in quick succession before move_task's
    // gap-based placement existed), and a bare .order("position") then
    // resolves ties to an undefined order. .order("id") makes it deterministic.
    .order("position")
    .order("id");

  if (!params.include_archived) {
    taskQuery = taskQuery.eq("archived", false);
  }

  const { data: tasks, error: taskError } = await taskQuery;
  if (taskError) throw new Error(`Failed to get tasks: ${taskError.message}`);

  // Fetch labels
  const { data: labels } = await ctx.supabase
    .from("board_labels")
    .select("*")
    .eq("idea_id", params.idea_id);

  // Filter columns: explicit filters override exclude_done
  const hasExplicitFilter = params.column_ids || params.column_names;

  const columnIdSet = params.column_ids ? new Set(params.column_ids) : null;
  const columnNameSet = params.column_names
    ? new Set(params.column_names.map((n) => n.toLowerCase()))
    : null;

  const doneColumnIds =
    !hasExplicitFilter && params.exclude_done
      ? new Set(columns!.filter((c) => c.is_done_column).map((c) => c.id))
      : new Set<string>();

  // Group tasks by column, keep payload compact (use get_task for full details)
  const board = columns!
    .filter((col) => {
      if (columnIdSet) return columnIdSet.has(col.id);
      if (columnNameSet) return columnNameSet.has(col.title.toLowerCase());
      return !doneColumnIds.has(col.id);
    })
    .map((col) => ({
      id: col.id,
      title: col.title,
      is_done_column: col.is_done_column,
      tasks: (tasks ?? [])
        .filter((t) => t.column_id === col.id)
        .map((t) => {
          const assigneeData = (t as Record<string, unknown>).users as Record<string, unknown> | null;
          const labelData =
            ((t as Record<string, unknown>).board_task_labels as Array<Record<string, unknown>>)?.map(
              (tl) => {
                const label = tl.board_labels as Record<string, unknown>;
                return label?.name as string;
              }
            ).filter(Boolean) ?? [];

          // Build compact task summary — only include non-null/non-zero fields
          const summary: Record<string, unknown> = {
            id: t.id,
            title: t.title,
          };
          if (assigneeData) summary.assignee = assigneeData.full_name;
          if (t.due_date) summary.due_date = t.due_date;
          if (labelData.length > 0) summary.labels = labelData;
          if (t.workflow_step_total > 0) {
            summary.workflow = `${t.workflow_step_completed}/${t.workflow_step_total} done`;
            if (t.workflow_step_in_progress > 0) summary.workflow += `, ${t.workflow_step_in_progress} in progress`;
            if (t.workflow_step_failed > 0) summary.workflow += `, ${t.workflow_step_failed} failed`;
            if (t.workflow_step_awaiting_approval > 0) summary.workflow += `, ${t.workflow_step_awaiting_approval} awaiting approval`;
          }
          if (t.attachment_count > 0) summary.attachments = t.attachment_count;
          return summary;
        }),
    }));

  return { columns: board, labels: (labels ?? []).map((l) => l.name) };
}

/** Most step ids one get_task call may ask for in full. */
export const MAX_STEP_IDS_PER_GET_TASK = 10;
/** Latest comments shown by default (card level, and on the active step). */
const LEAN_COMMENT_COUNT = 5;
/** Comments shown per step when the step is asked for by id. */
const REQUESTED_STEP_COMMENTS = 20;
/** Most characters of step write-ups one get_task call returns. */
export const MAX_STEP_OUTPUT_CHARS = 80_000;

/** Token hashes are secrets-at-rest: never part of any get_task reply. */
const STEP_HASH_COLUMNS = ["claim_token_hash", "work_token_hash"] as const;

const DETAIL_STATUSES = new Set(["in_progress", "awaiting_approval", "failed"]);

export const getTaskSchema = z.object({
  task_id: z.string().uuid().describe("The task ID"),
  idea_id: z.string().uuid().describe("The idea ID (for context)"),
  step_ids: z
    .array(z.string().uuid())
    .max(MAX_STEP_IDS_PER_GET_TASK)
    .optional()
    .describe(
      "Up to 10 step ids from this card to return in full (write-up, description and up to 20 comments). " +
        "Use it to read earlier steps; the default reply only carries a short line per step."
    ),
  full: z
    .boolean()
    .optional()
    .describe(
      "true returns the complete card: every step in every run with its write-up, recent activity and 10 comments per step. " +
        "Large; only ask for it when the short reply is not enough."
    ),
});

type StepRow = Record<string, unknown>;

function withoutHashes(step: StepRow): StepRow {
  const copy: StepRow = { ...step };
  for (const col of STEP_HASH_COLUMNS) delete copy[col];
  return copy;
}

const outputLength = (s: StepRow) => (typeof s.output === "string" ? s.output.length : 0);
const stepOrderOf = (s: StepRow) => ((s.step_order as number | null) ?? (s.position as number) ?? 0);

export async function getTask(ctx: McpContext, params: z.infer<typeof getTaskSchema>) {
  const full = params.full === true;
  const requestedIds = Array.from(new Set(params.step_ids ?? []));

  const { data: task, error } = await ctx.supabase
    .from("board_tasks")
    .select(
      "*, users!board_tasks_assignee_id_fkey(id, full_name, email), board_task_labels(label_id, board_labels(id, name, color))"
    )
    .eq("id", params.task_id)
    .eq("idea_id", params.idea_id)
    .maybeSingle();

  if (error) throw new Error(`Failed to get task: ${error.message}`);
  if (!task) throw new Error(`Task not found: ${params.task_id}`);

  // Every step of the card (all runs). Output is read here for its length (and
  // for the steps asked for in full); the default reply never echoes it.
  const { data: workflowSteps } = await ctx.supabase
    .from("task_workflow_steps")
    .select("*")
    .eq("task_id", params.task_id)
    .order("position");
  const allSteps = ((workflowSteps ?? []) as StepRow[]).map(withoutHashes);

  // A step id that is not on this card is rejected outright, so a caller can
  // never read another card's write-ups through this card's id.
  const onCard = new Set(allSteps.map((s) => s.id as string));
  const foreign = requestedIds.filter((id) => !onCard.has(id));
  if (foreign.length > 0) {
    throw new Error(
      `Step ${foreign.join(", ")} is not on task ${params.task_id}. Use the step ids listed in this task's workflow_steps.`
    );
  }

  // Which steps do we describe?
  const currentRun = pickCurrentRunKey(allSteps);
  const inCurrentRun = (s: StepRow) => ((s.run_id as string | null) ?? null) === currentRun;
  const currentSteps = full ? allSteps : allSteps.filter(inCurrentRun);
  const earlierRuns = new Set(
    allSteps.filter((s) => !inCurrentRun(s)).map((s) => (s.run_id as string | null) ?? "none")
  ).size;

  // Which steps need their comments fetched, and how many each?
  const detailIds = currentSteps
    .filter((s) => DETAIL_STATUSES.has(s.status as string))
    .map((s) => s.id as string);
  const commentStepIds = full
    ? allSteps.map((s) => s.id as string)
    : Array.from(new Set([...currentSteps.map((s) => s.id as string), ...requestedIds]));

  // Step-level comments (type != 'output' - the UI mirror of complete_step's
  // `output`, which is canonical). Soft-fail to none rather than throwing.
  let commentRows: StepCommentRow[] = [];
  if (commentStepIds.length > 0) {
    const { data: stepCommentRows, error: stepCommentsError } = await ctx.supabase
      .from("workflow_step_comments")
      .select(
        "id, step_id, type, content, author_id, created_at, users!workflow_step_comments_author_id_fkey(full_name)"
      )
      .in("step_id", commentStepIds)
      .neq("type", "output")
      .order("created_at", { ascending: false });
    if (!stepCommentsError) commentRows = (stepCommentRows ?? []) as unknown as StepCommentRow[];
  }
  const commentTotals = new Map<string, number>();
  for (const r of commentRows) commentTotals.set(r.step_id, (commentTotals.get(r.step_id) ?? 0) + 1);
  const groupedAtFive = groupStepComments(commentRows, commentStepIds, LEAN_COMMENT_COUNT);
  const groupedAtTwenty = groupStepComments(commentRows, commentStepIds, REQUESTED_STEP_COMMENTS);
  const groupedAtTen = groupStepComments(commentRows, commentStepIds);

  // Card-level comments, newest first.
  const commentLimit = full ? 20 : LEAN_COMMENT_COUNT;
  const { data: comments, count: commentsCount } = await ctx.supabase
    .from("board_task_comments")
    .select("*, users!board_task_comments_author_id_fkey(id, full_name)", { count: "exact" })
    .eq("task_id", params.task_id)
    .order("created_at", { ascending: false })
    .limit(commentLimit);

  // Recent activity: only when the whole card was asked for.
  let activity: Array<Record<string, unknown>> | null = null;
  if (full) {
    const { data } = await ctx.supabase
      .from("board_task_activity")
      .select("*, users!board_task_activity_actor_id_fkey(full_name)")
      .eq("task_id", params.task_id)
      .order("created_at", { ascending: false })
      .limit(10);
    activity = (data ?? []) as Array<Record<string, unknown>>;
  }

  // Attachments (metadata only, no signed URLs - use list_attachments for URLs)
  const { data: attachments } = await ctx.supabase
    .from("board_task_attachments")
    .select("id, file_name, file_size, content_type, created_at")
    .eq("task_id", params.task_id)
    .order("created_at");

  // OPEN workflow suggestions (FR-1, AC-19). Not a step: blocks pickup but
  // never contributes to workflow_step_total.
  const workflow_suggestions = await fetchOpenSuggestions(ctx, params.task_id);

  // Workflow instruction for agents (counts cover the live attempt only, the
  // same one claim_next_step works in).
  const liveSteps = allSteps.filter(inCurrentRun);
  const steps = allSteps;
  const pendingCount = liveSteps.filter((s) => s.status === "pending").length;
  const hasApprovalGates = liveSteps.some(
    (s) => s.human_check_required && s.status !== "completed" && s.status !== "skipped"
  );

  const nextOpen = pickNextOpenStep(
    allSteps as unknown as Array<{
      id: string;
      run_id: string | null;
      created_at: string | null;
      status: string;
      step_order: number | null;
      position: number | null;
      title: string;
    }>
  );

  let workflow_instruction: string | null = null;
  if (nextOpen?.status === "failed") {
    workflow_instruction =
      `This task's workflow has stopped: step ${nextOpen.step_order ?? ""} "${nextOpen.title}" failed. ` +
      `Do NOT claim further steps or begin implementation. Tell the user; they can retry the failed step on the card, or send the work back.`;
  } else if (pendingCount > 0) {
    workflow_instruction =
      `This task has a workflow with ${liveSteps.length} steps (${pendingCount} pending). ` +
      `Do NOT begin implementation directly. Use claim_next_step(task_id) to claim and execute steps sequentially — ` +
      `each step has specific deliverables, role requirements, and instructions that are only revealed when claimed.` +
      (hasApprovalGates ? ` Some steps require human approval before proceeding.` : ``);
  } else if (liveSteps.length === 0) {
    if (workflow_suggestions.length > 0) {
      // Open suggestion + no steps (AC-20): suppress the self-assign instruction.
      workflow_instruction =
        `This task has an unresolved workflow suggestion. Do NOT begin work or assign yourself. ` +
        `Surface it to a human to Keep / Replace / Remove. Agents cannot resolve suggestions.`;
    } else {
      workflow_instruction =
        `This task has no workflow. Before starting work, pick the team agent that best fits it ` +
        `(your .vibecodes config botId, or choose from list_idea_agents) and call update_task with ` +
        `assignee_id set to that agent's ID so the board shows who is working on it. ` +
        `When finished, move the task to the appropriate done/verify column using move_task.`;
    }
  }

  const taskRecord = task as Record<string, unknown>;
  const assigneeRow = (taskRecord.users ?? null) as Record<string, unknown> | null;
  const taskBase = {
    ...task,
    assignee: full ? assigneeRow : assigneeRow ? { id: assigneeRow.id, full_name: assigneeRow.full_name } : null,
    users: undefined,
    labels:
      (taskRecord.board_task_labels as Array<Record<string, unknown>> | undefined)?.map(
        (tl) => tl.board_labels
      ) ?? [],
    board_task_labels: undefined,
  };
  const shapedComments =
    comments?.map((c) => ({
      ...c,
      author: (c as Record<string, unknown>).users,
      users: undefined,
    })) ?? [];

  if (full) {
    return {
      ...taskBase,
      workflow_steps: steps.map((s) => ({
        ...s,
        ...(groupedAtTen.get(s.id as string) ?? { comments: [], comments_truncated: false }),
      })),
      workflow_suggestions,
      workflow_instruction,
      comments: shapedComments,
      recent_activity:
        activity?.map((a) => ({
          ...a,
          actor: a.users,
          users: undefined,
        })) ?? [],
      attachments: attachments ?? [],
    };
  }

  // Steps asked for by id, in full, within the output budget (always at least
  // one). The rest are listed so the caller can fetch them next.
  const requestedSteps = requestedIds
    .map((id) => allSteps.find((s) => s.id === id))
    .filter((s): s is StepRow => Boolean(s));
  const sentFull = new Set<string>();
  const notIncluded: string[] = [];
  let budget = 0;
  for (const s of requestedSteps) {
    const len = outputLength(s);
    if (sentFull.size > 0 && budget + len > MAX_STEP_OUTPUT_CHARS) {
      notIncluded.push(s.id as string);
      continue;
    }
    budget += len;
    sentFull.add(s.id as string);
  }

  const leanStep = (s: StepRow) => {
    const id = s.id as string;
    const lean: Record<string, unknown> = {
      id,
      title: s.title,
      status: s.status,
      agent_role: s.agent_role ?? null,
      bot_id: s.bot_id ?? null,
      model_tier: s.model_tier ?? null,
      ...(s.effort_override ? { effort: s.effort_override } : {}),
      human_check_required: s.human_check_required,
      step_order: s.step_order ?? null,
      output_chars: outputLength(s),
      comment_count: commentTotals.get(id) ?? 0,
    };
    if (sentFull.has(id)) {
      const { users: _users, ...rest } = s as StepRow;
      void _users;
      return {
        ...rest,
        output_chars: outputLength(s),
        comment_count: commentTotals.get(id) ?? 0,
        ...(groupedAtTwenty.get(id) ?? { comments: [], comments_truncated: false }),
      };
    }
    if (detailIds.includes(id)) {
      lean.description = s.description ?? null;
      Object.assign(lean, groupedAtFive.get(id) ?? { comments: [], comments_truncated: false });
    }
    return lean;
  };

  const shownIds = new Set<string>(currentSteps.map((s) => s.id as string));
  const shownSteps = [
    ...currentSteps,
    ...requestedSteps.filter((s) => sentFull.has(s.id as string) && !shownIds.has(s.id as string)),
  ].sort((a, b) => (a.position as number) - (b.position as number));

  return {
    ...taskBase,
    workflow_steps: shownSteps.map(leanStep),
    earlier_runs: earlierRuns,
    ...(notIncluded.length > 0
      ? {
          not_included_step_ids: notIncluded,
          step_ids_note:
            `These write-ups would take the reply past ${MAX_STEP_OUTPUT_CHARS} characters. ` +
            `Call get_task again with step_ids set to not_included_step_ids to read them next.`,
        }
      : {}),
    workflow_suggestions,
    workflow_instruction,
    comments: shapedComments,
    comments_total: commentsCount ?? shapedComments.length,
    attachments: attachments ?? [],
  };
}

export const getMyTasksSchema = z.object({
  idea_id: z
    .string()
    .uuid()
    .optional()
    .describe("Filter to a specific idea"),
  include_done: z
    .boolean()
    .default(false)
    .describe("Include tasks in done columns"),
});

export async function getMyTasks(ctx: McpContext, params: z.infer<typeof getMyTasksSchema>) {
  let query = ctx.supabase
    .from("board_tasks")
    .select(
      "*, board_columns!board_tasks_column_id_fkey(title, is_done_column), ideas!board_tasks_idea_id_fkey(id, title)"
    )
    .eq("assignee_id", ctx.userId)
    .eq("archived", false)
    .order("updated_at", { ascending: false });

  if (params.idea_id) {
    query = query.eq("idea_id", params.idea_id);
  }

  const { data: tasks, error } = await query;
  if (error) throw new Error(`Failed to get my tasks: ${error.message}`);

  const filtered = params.include_done
    ? tasks
    : tasks?.filter(
        (t) =>
          !((t as Record<string, unknown>).board_columns as Record<string, unknown>)
            ?.is_done_column
      );

  // Group by idea
  const grouped: Record<
    string,
    { idea_id: string; idea_title: string; tasks: unknown[] }
  > = {};
  for (const task of filtered ?? []) {
    const idea = (task as Record<string, unknown>).ideas as Record<string, unknown>;
    const ideaId = idea?.id as string;
    const ideaTitle = idea?.title as string;
    if (!grouped[ideaId]) {
      grouped[ideaId] = { idea_id: ideaId, idea_title: ideaTitle, tasks: [] };
    }
    const desc = task.description;
    grouped[ideaId].tasks.push({
      id: task.id,
      title: task.title,
      description: desc && desc.length > 200 ? desc.slice(0, 200) + "…" : desc,
      column: ((task as Record<string, unknown>).board_columns as Record<string, unknown>)?.title,
      due_date: task.due_date,
      workflow_step_total: task.workflow_step_total,
      workflow_step_completed: task.workflow_step_completed,
    });
  }

  return Object.values(grouped);
}
