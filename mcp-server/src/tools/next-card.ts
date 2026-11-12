import { logger } from "../../../src/lib/logger";
import type { McpContext } from "../context";
import { UP_NEXT_COLUMNS } from "./board-read";

export interface NextCardColumn {
  id: string;
  title: string;
}

export interface NextCardTask {
  id: string;
  title: string;
  column_id: string;
  position: number;
  archived?: boolean | null;
  workflow_step_in_progress?: number | null;
  workflow_step_awaiting_approval?: number | null;
}

export interface NextCard {
  id: string;
  title: string;
  column: string;
}

const MAX_TITLE = 120;

/** One line, whitespace collapsed, cut to 120 characters. */
export function oneLine(title: string): string {
  const flat = title.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TITLE ? `${flat.slice(0, MAX_TITLE - 1).trimEnd()}…` : flat;
}

/**
 * The next card to offer: first eligible card (position, then id) in To Do,
 * then Backlog. Skips the card that just finished, archived cards and cards
 * whose workflow has a step running or waiting for approval. Other columns are
 * never looked at. Same column rule as get_board's up_next.
 */
export function chooseNextCard(
  columns: NextCardColumn[],
  tasks: NextCardTask[],
  excludeTaskId: string
): NextCard | null {
  for (const name of UP_NEXT_COLUMNS) {
    for (const col of columns.filter((c) => c.title.toLowerCase() === name)) {
      const candidates = tasks
        .filter(
          (t) =>
            t.column_id === col.id &&
            t.id !== excludeTaskId &&
            !t.archived &&
            !(t.workflow_step_in_progress && t.workflow_step_in_progress > 0) &&
            !(t.workflow_step_awaiting_approval && t.workflow_step_awaiting_approval > 0)
        )
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      if (candidates.length > 0) {
        return { id: candidates[0].id, title: candidates[0].title, column: col.title };
      }
    }
  }
  return null;
}

/** The exact words the session says to the user (Option A wording). */
export function workflowFinishedText(finishedTitle: string, next: NextCard | null): string {
  const done = `"${oneLine(finishedTitle)}" is finished.`;
  if (!next) {
    return `${done} Nothing is waiting in To Do or Backlog. Close this session when you're done with it.`;
  }
  return (
    `${done} Next up on the board: "${oneLine(next.title)}". ` +
    `I suggest starting it in a fresh session. A fresh session starts small instead of re-reading this whole conversation, so every step on the next card costs less. ` +
    `To start it: open that card's "..." menu and pick "Launch in browser terminal". ` +
    `Or say "keep going here" and I'll carry on in this session.`
  );
}

export async function pickNextCard(
  ctx: McpContext,
  ideaId: string,
  excludeTaskId: string
): Promise<NextCard | null> {
  const { data: columns, error: colError } = await ctx.supabase
    .from("board_columns")
    .select("id, title")
    .eq("idea_id", ideaId);
  if (colError) throw new Error(`Failed to fetch columns: ${colError.message}`);

  const wanted = ((columns ?? []) as NextCardColumn[]).filter((c) =>
    UP_NEXT_COLUMNS.includes(c.title.toLowerCase())
  );
  if (wanted.length === 0) return null;

  // One column at a time, To Do first, so a long Backlog can never push To Do
  // cards out of the cap. Busy, archived and the finished card are filtered in
  // the query (null-safe), so the cap counts only eligible cards.
  for (const name of UP_NEXT_COLUMNS) {
    for (const col of wanted.filter((c) => c.title.toLowerCase() === name)) {
      const { data: tasks, error: taskError } = await ctx.supabase
        .from("board_tasks")
        .select(
          "id, title, column_id, position, archived, workflow_step_in_progress, workflow_step_awaiting_approval"
        )
        .eq("idea_id", ideaId)
        .eq("column_id", col.id)
        .eq("archived", false)
        .neq("id", excludeTaskId)
        .or("workflow_step_in_progress.is.null,workflow_step_in_progress.eq.0")
        .or("workflow_step_awaiting_approval.is.null,workflow_step_awaiting_approval.eq.0")
        .order("position", { ascending: true })
        .order("id", { ascending: true })
        .range(0, 49);
      if (taskError) throw new Error(`Failed to fetch cards: ${taskError.message}`);
      const next = chooseNextCard([col], (tasks ?? []) as NextCardTask[], excludeTaskId);
      if (next) return next;
    }
  }
  return null;
}

const STAY_PUT =
  'Do NOT claim, move or start any other card in this session unless the user says "keep going here" or names another card.';

/**
 * Fields added to a tool reply when a card's whole workflow is finished.
 * Never throws: a failed lookup still says the card is finished.
 */
export async function workflowFinishedReply(ctx: McpContext, taskId: string) {
  try {
    const { data: card, error } = await ctx.supabase
      .from("board_tasks")
      .select("id, title, idea_id")
      .eq("id", taskId)
      .maybeSingle();
    if (error || !card) throw new Error(error?.message ?? "card not found");
    const finished = card as { id: string; title: string; idea_id: string };
    const next = await pickNextCard(ctx, finished.idea_id, finished.id);
    return {
      workflow_finished: true,
      finished_card: { id: finished.id, title: finished.title },
      next_card: next,
      instruction:
        `This card's whole workflow is finished. Say this to the user, in these words, then STOP: ${workflowFinishedText(finished.title, next)} ` +
        `${STAY_PUT} If you are still looking after other cards, say so and carry on with those only.`,
    };
  } catch (err) {
    logger.warn("Next-card lookup failed", {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      workflow_finished: true,
      finished_card: { id: taskId, title: null as string | null },
      next_card: null,
      instruction: `This card's whole workflow is finished. Tell the user, then STOP. The next card could not be looked up. ${STAY_PUT}`,
    };
  }
}
