import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import type { McpContext } from "../context";
import { oneLine, pickNextCard } from "./next-card";
import { verifyCallingSession } from "./session-messages";

// --- "Start the next card" offer (card 7c728159) ---
//
// offer_next_card lets an in-browser session post an offer to its OWN terminal
// tab once a card's whole workflow has finished. It only shows a bar; it never
// starts anything. The session is proven the same way as send_session_message
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
  const { error: upsertError } = await ctx.supabase.from("terminal_session_offers").upsert(
    {
      sid: sender.sid,
      user_id: owner,
      idea_id: task.idea_id,
      finished_task_id: task.id,
      finished_task_title: oneLine(task.title),
      next_task_id: next?.id ?? null,
      next_task_title: next ? oneLine(next.title) : null,
      agent: sender.agent === "codex" ? "codex" : "claude",
      still_working_on: params.still_working_on ?? 0,
      status: "offered",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "sid" }
  );
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
