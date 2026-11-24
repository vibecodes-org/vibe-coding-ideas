import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import type { McpContext } from "../context";
import { oneLine, pickNextCard, type NextCard } from "./next-card";
import { verifyCallingSession, type CallingSessionRow } from "./session-identity";

// --- "Start the next card" offer (card 7c728159) ---
//
// offer_next_card lets an in-browser session post an offer to its OWN terminal
// tab once a card's whole workflow has finished. It only shows a bar; it never
// starts anything. The session is proven by its own helper
// (its VIBECODES_SESSION value). The next card is chosen here, on the server,
// never taken from the caller. Card titles and the session value are never
// logged.

export const offerNextCardSchema = z.object({
  finished_task_id: z
    .string()
    .uuid()
    .optional()
    .describe("The card whose whole workflow just finished (required unless withdraw is true)"),
  still_working_on: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe("How many OTHER cards this session is still looking after (default 0). The bar then says the session stays open for them."),
  withdraw: z
    .boolean()
    .optional()
    .describe("true hides this session's offer, for when the user says \"keep going here\". Safe to call when there is none."),
  from_session: z
    .string()
    .max(300)
    .optional()
    .describe("Your own session value: the VIBECODES_SESSION environment variable (run `printenv VIBECODES_SESSION`). Claude Code sessions fill this in automatically: leave it out."),
});

export const OFFER_SHOWN_MESSAGE =
  "Shown in your terminal tab. Don't start the next card yourself: wait for the user's click on \"Start in a new tab\". " +
  "If the user says \"keep going here\", call offer_next_card again with withdraw: true, then carry on.";

export async function offerNextCard(ctx: McpContext, params: z.infer<typeof offerNextCardSchema>) {
  // 1. Which session is this (proof of the helper's own key).
  const caller = await verifyCallingSession(ctx, params.from_session);
  if (!caller.ok) return { shown: false, message: caller.message };
  const { owner, sender } = caller;

  // 2. Withdraw: mark this session's offer dismissed (own row only; safe to
  // repeat). It is an update, not a delete: the browser's live feed is
  // filtered by user, and Supabase can't filter delete events, so a delete
  // would never reach the open page.
  if (params.withdraw) {
    const { error } = await ctx.supabase
      .from("terminal_session_offers")
      .update({ status: "dismissed", updated_at: new Date().toISOString() })
      .eq("sid", sender.sid)
      .eq("user_id", owner);
    if (error) {
      logger.error("Session offers: withdraw failed", { error: error.message });
      throw new Error("Couldn't withdraw the offer.");
    }
    return { shown: false, withdrawn: true, message: "The offer is removed. Carry on in this session." };
  }

  if (!params.finished_task_id) {
    return { shown: false, message: "Pass finished_task_id: the card whose whole workflow just finished." };
  }

  // 3. The card must be on this session's own board.
  const { data: task, error: taskError } = await ctx.supabase
    .from("board_tasks")
    .select("id, title, idea_id")
    .eq("id", params.finished_task_id)
    .maybeSingle();
  if (taskError) throw new Error("Couldn't look up that card.");
  if (!task || task.idea_id !== sender.idea_id) {
    return { shown: false, message: "That card isn't on this session's board, so no offer was made." };
  }

  // 4. Only when the card's whole workflow has finished (its newest run).
  const { data: run, error: runError } = await ctx.supabase
    .from("workflow_runs")
    .select("id, status")
    .eq("task_id", task.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw new Error("Couldn't look up the card's workflow.");
  if (!run || run.status !== "completed") {
    return {
      shown: false,
      message: "Only offered when the card's whole workflow has finished. This one hasn't (or has no workflow), so no offer was made.",
    };
  }

  // 5. The next card is the server's choice (To Do, then Backlog).
  const next = await pickNextCard(ctx, task.idea_id, task.id);

  // 6. One offer per session: a second replaces the first.
  const { error: upsertError } = await saveOffer(ctx, owner, sender, task, next, params.still_working_on ?? 0);
  if (upsertError) {
    logger.error("Session offers: save failed", { error: upsertError.message });
    throw new Error("Couldn't show the offer.");
  }
  logger.info("Session offer shown", { userId: owner, hasNext: Boolean(next) });

  return {
    shown: true,
    next_card: next ? { id: next.id, title: next.title } : null,
    message: OFFER_SHOWN_MESSAGE,
  };
}

/** The one offer row per session (a second replaces the first). */
function saveOffer(
  ctx: McpContext,
  owner: string,
  sender: CallingSessionRow,
  task: { id: string; title: string; idea_id: string },
  next: NextCard | null,
  stillWorkingOn: number
) {
  return ctx.supabase.from("terminal_session_offers").upsert(
    {
      sid: sender.sid,
      user_id: owner,
      idea_id: task.idea_id,
      finished_task_id: task.id,
      finished_task_title: oneLine(task.title),
      next_task_id: next?.id ?? null,
      next_task_title: next ? oneLine(next.title) : null,
      agent: sender.agent === "codex" ? "codex" : "claude",
      still_working_on: stillWorkingOn,
      status: "offered",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "sid" }
  );
}

/**
 * How many OTHER cards this session is still looking after, worked out on the
 * server: cards on the same board with a workflow step in progress right now
 * (not ones waiting for approval, and not ones that merely sit in the In
 * Progress column), leaving out the finished card and any card another open in-browser session of
 * the same person was launched for. Claims don't record which session made
 * them, so this is the closest the server can tell (card e6a612b8).
 */
async function countStillWorkingOn(
  ctx: McpContext,
  ideaId: string,
  finishedId: string,
  sender: CallingSessionRow,
  rows: CallingSessionRow[]
): Promise<number> {
  const { data, error } = await ctx.supabase
    .from("board_tasks")
    .select("id, workflow_step_in_progress")
    .eq("idea_id", ideaId)
    .eq("archived", false)
    .neq("id", finishedId)
    .gt("workflow_step_in_progress", 0)
    .range(0, 199);
  if (error) throw new Error(`Failed to count busy cards: ${error.message}`);
  const otherTabs = new Set(rows.filter((r) => r.sid !== sender.sid && r.task_id).map((r) => r.task_id));
  const busy = ((data ?? []) as Array<{ id: string; workflow_step_in_progress: number | null }>).filter(
    (t) => t.id !== finishedId && !otherTabs.has(t.id) && (t.workflow_step_in_progress ?? 0) > 0
  );
  return Math.min(busy.length, 20);
}

/**
 * The board raises the "Card finished. Next up" bar itself (card e6a612b8),
 * from the tool call that finished the card's whole workflow, so the session
 * never has to remember to call offer_next_card. Only for an in-browser
 * session that proved who it is on that call (from_session, which the Mac
 * helper fills in for Claude Code). Never throws: any failure is logged and
 * the caller falls back to the wording.
 */
export async function raiseNextCardOffer(
  ctx: McpContext,
  task: { id: string; title: string; idea_id: string },
  next: NextCard | null,
  fromSession: string | undefined
): Promise<{ shown: boolean }> {
  if (!fromSession) return { shown: false };
  try {
    const caller = await verifyCallingSession(ctx, fromSession);
    if (!caller.ok) return { shown: false };
    const { owner, sender, rows } = caller;
    if (sender.idea_id !== task.idea_id) return { shown: false };

    // Already offered for this card (claim_next_step can report the same
    // finish again): leave it, so a dismissed bar never comes back.
    const { data: existing, error: existingError } = await ctx.supabase
      .from("terminal_session_offers")
      .select("finished_task_id, status")
      .eq("sid", sender.sid)
      .eq("user_id", owner)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing && existing.finished_task_id === task.id) return { shown: existing.status === "offered" };

    const still = await countStillWorkingOn(ctx, task.idea_id, task.id, sender, rows);
    const { error } = await saveOffer(ctx, owner, sender, task, next, still);
    if (error) throw new Error(error.message);
    logger.info("Session offer raised by the board", { userId: owner, hasNext: Boolean(next) });
    return { shown: true };
  } catch (err) {
    logger.error("Session offers: automatic offer failed", {
      taskId: task.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { shown: false };
  }
}
