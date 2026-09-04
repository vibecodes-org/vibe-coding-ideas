import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { notifyMentions } from "./mention-notify";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HUMAN_ID = "00000000-0000-4000-a000-000000000001"; // ctx.userId (posts under this JWT)
const OWNER_ID = "00000000-0000-4000-a000-000000000002"; // ctx.ownerUserId
const AGENT_ID = "00000000-0000-4000-a000-000000000003"; // step.bot_id — the speaking agent
const IDEA_ID = "00000000-0000-4000-a000-000000000040";
const TASK_ID = "00000000-0000-4000-a000-000000000010";
const NICK_ID = "00000000-0000-4000-a000-000000000050";

/** Creates a chainable Supabase query mock resolving to `resolveWith`. */
function createChain(resolveWith: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.insert = vi.fn((data: unknown) => {
    (chain as Record<string, unknown> & { inserted?: unknown }).inserted = data;
    return chain;
  });
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: resolveWith, error: null }));
  chain.then = (resolve: (val: unknown) => void) =>
    Promise.resolve({ data: resolveWith, error: null }).then(resolve);
  return chain;
}

// The idea team is just Nick — the human who wrote @Nick in the agent's comment.
const TEAM_ROW = {
  id: IDEA_ID,
  author: { id: NICK_ID, full_name: "Nick Ball", notification_preferences: { task_mentions: true } },
  collaborators: [],
};

function makeCtx(overrides: { userId?: string; ownerUserId?: string } = {}) {
  const ideasChain = createChain(TEAM_ROW);
  const notificationsChain = createChain(null);

  const fromFn = vi.fn((table: string) => {
    switch (table) {
      case "ideas":
        return ideasChain;
      case "notifications":
        return notificationsChain;
      default:
        return createChain(null);
    }
  });

  const ctx: McpContext = {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: overrides.userId ?? HUMAN_ID,
    ownerUserId: overrides.ownerUserId,
  };

  return { ctx, notificationsChain };
}

// ---------------------------------------------------------------------------
// Tests — mention self-suppression flip (design §1.4, decision 1 §7)
// ---------------------------------------------------------------------------

describe("notifyMentions — actorId (agent voice) self-suppression flip", () => {
  it("without actorId: suppresses on ctx.userId/ownerUserId — today's behaviour", async () => {
    // Nick's own JWT posting "@Nick" never notifies Nick — unchanged path.
    const { ctx, notificationsChain } = makeCtx({ userId: NICK_ID });

    const result = await notifyMentions(ctx, {
      ideaId: IDEA_ID,
      taskId: TASK_ID,
      content: "@Nick Ball can you take a look?",
    });

    expect(result.notified).toEqual([]);
    expect(result.unresolved).toEqual([{ user_id: NICK_ID, reason: "self" }]);
    expect(notificationsChain.insert).not.toHaveBeenCalled();
  });

  it("with actorId set to the speaking agent: Nick IS notified even though his JWT posted it", async () => {
    // Human posts under his own JWT (ctx.userId = NICK_ID via a stale/irrelevant
    // ambient value), but the comment carries a valid work_token for AGENT_ID —
    // the tool layer passes actorId: AGENT_ID. Self-suppression must key on the
    // agent, not the connection, so Nick's own mention notification fires.
    const { ctx, notificationsChain } = makeCtx({ userId: NICK_ID });

    const result = await notifyMentions(ctx, {
      ideaId: IDEA_ID,
      taskId: TASK_ID,
      content: "@Nick Ball is the legacy import in scope?",
      actorId: AGENT_ID,
    });

    expect(result.notified).toEqual([{ user_id: NICK_ID, full_name: "Nick Ball" }]);
    expect(notificationsChain.insert).toHaveBeenCalledWith([
      { user_id: NICK_ID, actor_id: AGENT_ID, type: "task_mention", idea_id: IDEA_ID, task_id: TASK_ID },
    ]);
  });

  it("with actorId set: does NOT suppress on the connection's ctx.userId/ownerUserId", async () => {
    // The connection belongs to Nick (userId AND ownerUserId), but the agent is
    // the speaker — Nick mentioning himself via the agent's voice still notifies.
    const { ctx, notificationsChain } = makeCtx({ userId: NICK_ID, ownerUserId: NICK_ID });

    const result = await notifyMentions(ctx, {
      ideaId: IDEA_ID,
      taskId: TASK_ID,
      content: "@Nick Ball, done.",
      actorId: AGENT_ID,
    });

    expect(result.notified).toEqual([{ user_id: NICK_ID, full_name: "Nick Ball" }]);
    expect(notificationsChain.insert).toHaveBeenCalled();
  });

  it("with actorId set: the agent itself IS suppressed if it mentions itself", async () => {
    const agentSelfTeam = {
      ...TEAM_ROW,
      collaborators: [
        { user: { id: AGENT_ID, full_name: "Compass", notification_preferences: { task_mentions: true } } },
      ],
    };
    const { ctx } = makeCtx({ userId: HUMAN_ID });
    (ctx.supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) =>
      table === "ideas" ? createChain(agentSelfTeam) : createChain(null)
    );

    const result = await notifyMentions(ctx, {
      ideaId: IDEA_ID,
      taskId: TASK_ID,
      content: "@Compass please review",
      actorId: AGENT_ID,
    });

    expect(result.unresolved).toEqual([{ user_id: AGENT_ID, reason: "self" }]);
  });

  it("with actorId set: uses the agent as actor_id even for an explicit mentioned_user_ids id", async () => {
    const { ctx, notificationsChain } = makeCtx({ userId: OWNER_ID, ownerUserId: OWNER_ID });

    await notifyMentions(ctx, {
      ideaId: IDEA_ID,
      taskId: TASK_ID,
      content: "no @ here",
      mentionedUserIds: [NICK_ID],
      actorId: AGENT_ID,
    });

    expect(notificationsChain.insert).toHaveBeenCalledWith([
      { user_id: NICK_ID, actor_id: AGENT_ID, type: "task_mention", idea_id: IDEA_ID, task_id: TASK_ID },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Tests — commentId (P0 fix: a genuine task-comment mention must carry
// comment_id, or the email route can't tell it apart from a description-edit
// mention and quotes the wrong thing — docs/... see mention-notify.ts).
// ---------------------------------------------------------------------------

describe("notifyMentions — commentId", () => {
  const COMMENT_ID = "00000000-0000-4000-a000-000000000099";

  it("writes comment_id on the notification row when passed", async () => {
    const { ctx, notificationsChain } = makeCtx();

    await notifyMentions(ctx, {
      ideaId: IDEA_ID,
      taskId: TASK_ID,
      content: "@Nick Ball can you take a look?",
      commentId: COMMENT_ID,
    });

    expect(notificationsChain.insert).toHaveBeenCalledWith([
      {
        user_id: NICK_ID,
        actor_id: HUMAN_ID,
        type: "task_mention",
        idea_id: IDEA_ID,
        task_id: TASK_ID,
        comment_id: COMMENT_ID,
      },
    ]);
  });

  it("omits comment_id entirely when not passed — byte-identical to before this fix", async () => {
    const { ctx, notificationsChain } = makeCtx();

    await notifyMentions(ctx, {
      ideaId: IDEA_ID,
      taskId: TASK_ID,
      content: "@Nick Ball can you take a look?",
    });

    const inserted = (notificationsChain.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(inserted[0]).not.toHaveProperty("comment_id");
  });
});
