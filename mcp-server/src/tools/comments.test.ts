import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { logger } from "../../../src/lib/logger";
import { addTaskComment, addTaskCommentSchema } from "./comments";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-a000-000000000001"; // the poster (ctx.userId)
const OWNER_ID = "00000000-0000-4000-a000-000000000002"; // ctx.ownerUserId (human owner)
const IDEA_ID = "00000000-0000-4000-a000-000000000040";
const TASK_ID = "00000000-0000-4000-a000-000000000010";
const NICK_ID = "00000000-0000-4000-a000-000000000050";
const ADA_ID = "00000000-0000-4000-a000-000000000060";
const OUTSIDER_ID = "00000000-0000-4000-a000-000000000099";

/** Creates a chainable Supabase query mock resolving to `resolveWith`. */
function createChain(resolveWith: unknown = null) {
  const chain: Record<string, unknown> = {};
  for (const m of ["order", "limit", "range", "or", "filter", "delete", "not"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.insert = vi.fn((data: unknown) => {
    (chain as Record<string, unknown> & { inserted?: unknown }).inserted = data;
    return chain;
  });
  chain.update = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({ data: resolveWith, error: null }));
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: resolveWith, error: null }));
  chain.then = (resolve: (val: unknown) => void) =>
    Promise.resolve({ data: Array.isArray(resolveWith) ? resolveWith : resolveWith, error: null }).then(resolve);
  return chain;
}

const TEAM_ROW = {
  id: IDEA_ID,
  author: { id: NICK_ID, full_name: "Nick Ball", notification_preferences: { task_mentions: true } },
  collaborators: [
    { user: { id: ADA_ID, full_name: "Ada Lovelace", notification_preferences: { task_mentions: false } } },
  ],
};

function makeCtx(overrides: {
  ideasResult?: unknown;
  notificationsError?: { message: string } | null;
  ownerUserId?: string;
  workflowStepResult?: unknown;
}) {
  const commentChain = createChain({ id: "comment-1", content: "hi", created_at: "2026-01-01" });
  const activityChain = createChain(null);
  const ideasChain = createChain(overrides.ideasResult ?? TEAM_ROW);
  const notificationsChain = createChain(null);
  const workflowStepChain = createChain(overrides.workflowStepResult ?? null);
  if (overrides.notificationsError) {
    notificationsChain.then = (resolve: (val: unknown) => void) =>
      Promise.resolve({ data: null, error: overrides.notificationsError }).then(resolve);
  }

  const fromFn = vi.fn((table: string) => {
    switch (table) {
      case "board_task_comments":
        return commentChain;
      case "board_task_activity":
        return activityChain;
      case "ideas":
        return ideasChain;
      case "notifications":
        return notificationsChain;
      case "task_workflow_steps":
        return workflowStepChain;
      default:
        return createChain(null);
    }
  });

  const ctx: McpContext = {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: USER_ID,
    ownerUserId: overrides.ownerUserId,
  };

  return { ctx, fromFn, notificationsChain, commentChain, workflowStepChain };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("addTaskComment — mentions", () => {
  it("posts with no mentions when content has no @ and no mentioned_user_ids", async () => {
    const { ctx } = makeCtx({});
    const params = addTaskCommentSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      content: "just a plain comment",
    });

    const result = await addTaskComment(ctx, params);

    expect(result.success).toBe(true);
    expect(result.mentions).toEqual({ notified: [], unresolved: [] });
  });

  it("detects @Full Name, writes an exact-shape notification row, and reports notified[]", async () => {
    const { ctx, notificationsChain } = makeCtx({});
    const params = addTaskCommentSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      content: "great work @Nick Ball",
    });

    const result = await addTaskComment(ctx, params);

    expect(result.mentions.notified).toEqual([{ user_id: NICK_ID, full_name: "Nick Ball" }]);
    expect(result.mentions.unresolved).toEqual([]);
    expect(notificationsChain.insert).toHaveBeenCalledWith([
      { user_id: NICK_ID, actor_id: USER_ID, type: "task_mention", idea_id: IDEA_ID, task_id: TASK_ID },
    ]);
  });

  it("self-skip via ctx.userId — the poster never notifies themselves", async () => {
    const { ctx } = makeCtx({});
    const params = addTaskCommentSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      content: "note to self",
      mentioned_user_ids: [USER_ID],
    });
    // USER_ID must be a team member for this scenario to exercise self, not not_team_member.
    const teamRowWithSelf = {
      ...TEAM_ROW,
      collaborators: [...TEAM_ROW.collaborators, { user: { id: USER_ID, full_name: "Me", notification_preferences: { task_mentions: true } } }],
    };
    const { ctx: ctx2 } = makeCtx({ ideasResult: teamRowWithSelf });
    const result = await addTaskComment(ctx2, params);
    expect(result.mentions.notified).toEqual([]);
    expect(result.mentions.unresolved).toEqual([{ user_id: USER_ID, reason: "self" }]);
    void ctx;
  });

  it("self-skip via ctx.ownerUserId", async () => {
    const teamRowWithOwner = {
      ...TEAM_ROW,
      collaborators: [...TEAM_ROW.collaborators, { user: { id: OWNER_ID, full_name: "Owner", notification_preferences: { task_mentions: true } } }],
    };
    const { ctx } = makeCtx({ ideasResult: teamRowWithOwner, ownerUserId: OWNER_ID });
    const params = addTaskCommentSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      content: "note",
      mentioned_user_ids: [OWNER_ID],
    });
    const result = await addTaskComment(ctx, params);
    expect(result.mentions.unresolved).toEqual([{ user_id: OWNER_ID, reason: "self" }]);
  });

  it("opted_out when the mentioned member has task_mentions disabled", async () => {
    const { ctx } = makeCtx({});
    const params = addTaskCommentSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      content: "cc @Ada Lovelace",
    });
    const result = await addTaskComment(ctx, params);
    expect(result.mentions.notified).toEqual([]);
    expect(result.mentions.unresolved).toEqual([{ user_id: ADA_ID, reason: "opted_out" }]);
  });

  it("not_team_member for an explicit id outside the idea roster", async () => {
    const { ctx } = makeCtx({});
    const params = addTaskCommentSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      content: "no names here",
      mentioned_user_ids: [OUTSIDER_ID],
    });
    const result = await addTaskComment(ctx, params);
    expect(result.mentions.unresolved).toEqual([{ user_id: OUTSIDER_ID, reason: "not_team_member" }]);
  });

  it("union dedupe: explicit id + parsed name for the same user -> one notified entry", async () => {
    const { ctx, notificationsChain } = makeCtx({});
    const params = addTaskCommentSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      content: "thanks @Nick Ball",
      mentioned_user_ids: [NICK_ID],
    });
    const result = await addTaskComment(ctx, params);
    expect(result.mentions.notified).toEqual([{ user_id: NICK_ID, full_name: "Nick Ball" }]);
    expect((notificationsChain.insert as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(1);
  });

  it("batch insert failure: logged, comment still succeeds, notified[] empty", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const { ctx } = makeCtx({ notificationsError: { message: "insert failed" } });
    const params = addTaskCommentSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      content: "great work @Nick Ball",
    });

    const result = await addTaskComment(ctx, params);

    expect(result.success).toBe(true);
    expect(result.comment).toBeTruthy();
    expect(result.mentions.notified).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("unknown_name never blocks the comment and is reported with a warning", async () => {
    const { ctx } = makeCtx({});
    const params = addTaskCommentSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      content: "@Nicky started it",
    });
    const result = await addTaskComment(ctx, params);
    expect(result.success).toBe(true);
    expect(result.mentions.unresolved).toEqual([{ token: "Nicky", reason: "unknown_name" }]);
    expect(result.mentions.warning).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// addTaskComment — agent voice via work_token
// (docs/agent-voice-comments-design.html §1.4)
// ---------------------------------------------------------------------------

describe("addTaskComment — work_token attribution", () => {
  const BOT_ID = "00000000-0000-4000-a000-000000000070";

  it("valid token: author_id is the step's bot_id, and mentions carry the agent as actor", async () => {
    const { ctx, commentChain, notificationsChain } = makeCtx({
      workflowStepResult: { id: "step-1", bot_id: BOT_ID },
    });
    const params = addTaskCommentSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      content: "@Nick Ball is the legacy import in scope?",
      work_token: "wt_faketoken",
    });

    const result = await addTaskComment(ctx, params);

    expect(result.success).toBe(true);
    expect((commentChain as unknown as { inserted: { author_id: string } }).inserted.author_id).toBe(BOT_ID);
    // Nick is notified even though ctx.userId (the JWT) posted it — the
    // mention self-suppression flip (decision 1, §7) keys on the agent.
    expect(notificationsChain.insert).toHaveBeenCalledWith([
      { user_id: NICK_ID, actor_id: BOT_ID, type: "task_mention", idea_id: IDEA_ID, task_id: TASK_ID },
    ]);
  });

  it("absent token: byte-identical human-attributed path, no extra query", async () => {
    const { ctx, commentChain } = makeCtx({});
    const params = addTaskCommentSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      content: "plain human comment",
    });

    await addTaskComment(ctx, params);

    expect((commentChain as unknown as { inserted: { author_id: string } }).inserted.author_id).toBe(USER_ID);
  });

  it("invalid token (ct_ claim_token passed by mistake): rejects, comment never inserted", async () => {
    const { ctx, commentChain } = makeCtx({});
    const params = addTaskCommentSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      content: "oops",
      work_token: "ct_notarworktoken",
    });

    await expect(addTaskComment(ctx, params)).rejects.toThrow(/That's a claim_token/);
    expect((commentChain as unknown as { insert: ReturnType<typeof vi.fn> }).insert).not.toHaveBeenCalled();
  });

  it("no matching step for this task (finished/failed/reset/wrong task): rejects with err-3", async () => {
    const { ctx } = makeCtx({ workflowStepResult: null });
    const params = addTaskCommentSchema.parse({
      task_id: TASK_ID,
      idea_id: IDEA_ID,
      content: "late note",
      work_token: "wt_stale",
    });

    await expect(addTaskComment(ctx, params)).rejects.toThrow(
      /doesn't match any in-progress workflow step/
    );
  });
});
