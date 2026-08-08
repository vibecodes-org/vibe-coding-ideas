/**
 * Work-token comment attribution (docs/agent-voice-comments-design.html §1.4,
 * §1.6). Shared by add_task_comment and add_step_comment so both transports
 * (remote + stdio) apply IDENTICAL rules — this is what makes stdio safe
 * despite its service-role client bypassing RLS.
 *
 * Resolution order (design §1.4): no token -> human, unchanged; ct_ token ->
 * err-5; otherwise find the step (by step_id, or by task_id + hash for task
 * comments); verify hash/status/bot_id; attribute. Every rejection logs a
 * structured warning (§4.2) — that's the new anomaly signal now that the
 * persona-mismatch warning on completion is gone. No rejection here ever
 * mutates state — a work token check is read-only.
 */
import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import type { McpContext } from "../context";
import { hashClaimToken, verifyClaimToken } from "../claim-token";

export const workTokenSchema = z
  .string()
  .optional()
  .describe(
    "Optional. The wt_… work token from claim_next_step, for a workflow step that is " +
    "currently in progress. When valid, this comment is posted in the VOICE of that " +
    "step's assigned agent — it renders under the agent's name and avatar, and any " +
    "@mentions notify with the agent as the actor. Omit it to comment as the human " +
    "account (the default, and the only option outside workflow execution). An " +
    "invalid or expired token is REJECTED with the reason — the comment is never " +
    "silently re-attributed. Do not pass the ct_… claim_token here."
  );

export interface WorkTokenAttribution {
  authorId: string;
  stepId: string;
  /** Populated by resolveStepCommentAuthor (the step lookup already has it),
   *  so add_step_comment can skip a second round-trip to resolve mention
   *  routing. Not set by resolveTaskCommentAuthor — the caller already
   *  knows the task_id there. */
  taskId?: string;
}

/**
 * err-6: a work_token (wt_…) was presented to complete_step/fail_step. Those
 * tools verify the caller's claim_token against claim_token_hash exactly as
 * before this feature — this constant exists only so the "wrong token, right
 * neighbourhood" mistake gets a message that names the mix-up, instead of
 * the generic "isn't claimed by you" a plain hash mismatch would produce.
 */
export const WORK_TOKEN_IN_COMPLETION_TOOL_MESSAGE =
  "That's a work_token (wt_…) — it can voice comments but can never complete or fail a step. complete_step " +
  "requires the claim_token (ct_…) that the orchestrator kept from claim_next_step. If you are the subagent: " +
  "you don't complete steps — return your deliverable to the orchestrator instead.";

type WorkTokenTool = "add_task_comment" | "add_step_comment";

function rejectWorkToken(
  ctx: McpContext,
  tool: WorkTokenTool,
  reason: string,
  message: string,
  extra?: { taskId?: string; stepId?: string }
): never {
  logger.warn("work token rejected", {
    tool,
    reason,
    callerUserId: ctx.userId,
    ownerUserId: ctx.ownerUserId,
    ...extra,
  });
  throw new Error(message);
}

/** err-5: a claim_token (ct_…) was passed to a comment tool instead of a work_token. */
function rejectIfClaimToken(
  ctx: McpContext,
  tool: WorkTokenTool,
  token: string,
  extra?: { taskId?: string; stepId?: string }
): void {
  if (!token.startsWith("ct_")) return;
  rejectWorkToken(
    ctx,
    tool,
    "claim_token_in_comment_tool",
    "That's a claim_token (ct_…), which authorises complete_step/fail_step and stays with the orchestrator. " +
      "Comments take the work_token (wt_…) from the same claim_next_step response. If you weren't given a wt_… " +
      "token, ask your orchestrator for it, or omit work_token to comment as the human account.",
    extra
  );
}

/**
 * add_step_comment path: the step is already known by step_id, so fetch it
 * directly and verify the presented token against ITS work_token_hash
 * (constant-time — reuses verifyClaimToken exactly as complete_step does for
 * claim_token_hash). Returns null when no work_token was presented — the
 * caller's job is to fall back to ctx.userId, byte-identical to today.
 */
export async function resolveStepCommentAuthor(
  ctx: McpContext,
  stepId: string,
  workToken: string | undefined
): Promise<WorkTokenAttribution | null> {
  if (!workToken) return null;
  const tool: WorkTokenTool = "add_step_comment";
  rejectIfClaimToken(ctx, tool, workToken, { stepId });

  const { data: step, error } = await ctx.supabase
    .from("task_workflow_steps")
    .select("id, task_id, title, status, bot_id, work_token_hash")
    .eq("id", stepId)
    .maybeSingle();

  if (error) throw new Error(`Failed to verify work token: ${error.message}`);

  if (!step) {
    rejectWorkToken(
      ctx,
      tool,
      "step_not_found",
      "No workflow step found for this step_id. If you are the working subagent, stop and report back " +
        "to your orchestrator. To post as the human account instead, resend without work_token.",
      { stepId }
    );
  }

  // err-1: the step is known but its claim already ended — the work token
  // retired with it (design §1.6). Checked before the hash match so a stale
  // token on a finished step gets the more specific "no longer in progress"
  // explanation rather than a generic mismatch.
  if (step.status !== "in_progress") {
    rejectWorkToken(
      ctx,
      tool,
      "step_not_in_progress",
      `Step "${step.title}" is no longer in progress (status: ${step.status}). Its work token was retired ` +
        "when the claim ended — the agent's voice covers only work under a live claim. If you are the working " +
        "subagent, stop and report back to your orchestrator. If this note still matters, resend it WITHOUT " +
        "work_token to post it as the human account.",
      { taskId: step.task_id, stepId }
    );
  }

  // err-2: the step is live, but this isn't the CURRENT token for it — a
  // re-claim minted a fresh one (last-claim-wins, same rule as claim_token).
  if (!verifyClaimToken(step.work_token_hash, workToken)) {
    rejectWorkToken(
      ctx,
      tool,
      "token_superseded",
      "This work token is not the current one for this step — the step was re-claimed and a fresh token " +
        "was minted (last claim wins). Your run may have been restarted. If you are the working subagent, " +
        "stop and report back to your orchestrator rather than retrying.",
      { taskId: step.task_id, stepId }
    );
  }

  // err-4: defensive — claim_next_step only mints a work_token when a bot is
  // assigned, so a live token on a bot-less step should be unreachable.
  if (!step.bot_id) {
    rejectWorkToken(
      ctx,
      tool,
      "no_assigned_agent",
      "This step has no assigned agent, so there is no agent voice to post in. Resend without work_token " +
        "to comment as the human account.",
      { taskId: step.task_id, stepId }
    );
  }

  return { authorId: step.bot_id, stepId: step.id, taskId: step.task_id };
}

/**
 * add_task_comment path: the step isn't named directly, so it's found by
 * task_id + the token's own hash — scoped to the task, so a work token
 * minted for step A on task X can never resolve to a step on task Y (design
 * §1.4 step 3). A match against status "in_progress" is required in the same
 * query: work_token_hash is cleared at every claim-ending site, so a
 * finished/failed/reset/re-claimed step's old hash can never match here —
 * that's what makes "no row" the right generic err-3, covering every one of
 * those cases without distinguishing them.
 */
export async function resolveTaskCommentAuthor(
  ctx: McpContext,
  taskId: string,
  workToken: string | undefined
): Promise<WorkTokenAttribution | null> {
  if (!workToken) return null;
  const tool: WorkTokenTool = "add_task_comment";
  rejectIfClaimToken(ctx, tool, workToken, { taskId });

  const { data: step, error } = await ctx.supabase
    .from("task_workflow_steps")
    .select("id, bot_id")
    .eq("task_id", taskId)
    .eq("work_token_hash", hashClaimToken(workToken))
    .eq("status", "in_progress")
    .maybeSingle();

  if (error) throw new Error(`Failed to verify work token: ${error.message}`);

  // err-3: covers finished/failed/reset, superseded-by-re-claim, and
  // wrong-task in one message — work_token_hash is cleared everywhere a claim
  // ends, so none of those states can produce a match.
  if (!step) {
    rejectWorkToken(
      ctx,
      tool,
      "no_matching_step",
      "This work token doesn't match any in-progress workflow step on this task. Either the step finished, " +
        "failed, or was reset (tokens retire with the claim), or it was re-claimed with a fresh token, or the " +
        "token belongs to a different task. If you are the working subagent, report back to your orchestrator. " +
        "To post as the human account instead, resend without work_token.",
      { taskId }
    );
  }

  // err-4: defensive, see resolveStepCommentAuthor.
  if (!step.bot_id) {
    rejectWorkToken(
      ctx,
      tool,
      "no_assigned_agent",
      "This step has no assigned agent, so there is no agent voice to post in. Resend without work_token " +
        "to comment as the human account.",
      { taskId, stepId: step.id }
    );
  }

  return { authorId: step.bot_id, stepId: step.id };
}
