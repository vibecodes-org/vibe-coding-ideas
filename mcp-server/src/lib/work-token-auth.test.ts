import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { logger } from "../../../src/lib/logger";
import { mintWorkToken, mintClaimToken } from "../claim-token";
import { resolveStepCommentAuthor, resolveTaskCommentAuthor } from "./work-token-auth";

// ---------------------------------------------------------------------------
// Work-token comment attribution (docs/agent-voice-comments-design.html
// §1.4, §1.6). Covers the AC-4/AC-5 rejection paths from the design's test
// plan: valid / absent / invalid token, wrong-step token, completed-step
// token — for both add_step_comment (known step_id) and add_task_comment
// (found by task_id + hash).
// ---------------------------------------------------------------------------

const STEP_ID = "00000000-0000-4000-a000-000000000020";
const OTHER_STEP_ID = "00000000-0000-4000-a000-000000000021";
const TASK_ID = "00000000-0000-4000-a000-000000000010";
const BOT_ID = "00000000-0000-4000-a000-000000000030";
const USER_ID = "00000000-0000-4000-a000-000000000001";

/** Creates a chainable Supabase query mock resolving to `resolveWith`. */
function createChain(resolveWith: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: resolveWith, error: null }));
  return chain;
}

function makeCtx(stepRow: unknown): McpContext {
  return {
    supabase: { from: vi.fn(() => createChain(stepRow)) } as unknown as McpContext["supabase"],
    userId: USER_ID,
    ownerUserId: USER_ID,
  };
}

describe("resolveStepCommentAuthor (add_step_comment path)", () => {
  it("returns null — no query at all — when work_token is omitted", async () => {
    const ctx = makeCtx({ id: STEP_ID, task_id: TASK_ID, status: "in_progress", bot_id: BOT_ID });
    const result = await resolveStepCommentAuthor(ctx, STEP_ID, undefined);
    expect(result).toBeNull();
    expect(ctx.supabase.from).not.toHaveBeenCalled();
  });

  it("err-5: rejects a ct_ claim_token with the mix-up message, and logs a warning", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const ctx = makeCtx(null);
    const { token: claimToken } = mintClaimToken();

    await expect(resolveStepCommentAuthor(ctx, STEP_ID, claimToken)).rejects.toThrow(
      /That's a claim_token/
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "work token rejected",
      expect.objectContaining({ tool: "add_step_comment", reason: "claim_token_in_comment_tool" })
    );
    // No DB round-trip needed to catch the wrong-token-family mistake.
    expect(ctx.supabase.from).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("rejects when the step doesn't exist", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const ctx = makeCtx(null);
    const { token } = mintWorkToken();

    await expect(resolveStepCommentAuthor(ctx, STEP_ID, token)).rejects.toThrow(/No workflow step found/);
    warnSpy.mockRestore();
  });

  it("err-1: rejects a completed step's stale token, naming the step and status", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { token, hash } = mintWorkToken();
    const ctx = makeCtx({
      id: STEP_ID,
      task_id: TASK_ID,
      title: "Implement the thing",
      status: "completed",
      bot_id: BOT_ID,
      work_token_hash: hash,
    });

    await expect(resolveStepCommentAuthor(ctx, STEP_ID, token)).rejects.toThrow(
      /Step "Implement the thing" is no longer in progress \(status: completed\)/
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "work token rejected",
      expect.objectContaining({ reason: "step_not_in_progress", taskId: TASK_ID, stepId: STEP_ID })
    );
    warnSpy.mockRestore();
  });

  it("err-2: rejects a superseded token on a live step (re-claimed, fresh hash)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { token: staleToken } = mintWorkToken();
    const { hash: freshHash } = mintWorkToken(); // a different, currently-stored hash
    const ctx = makeCtx({
      id: STEP_ID,
      task_id: TASK_ID,
      title: "Step",
      status: "in_progress",
      bot_id: BOT_ID,
      work_token_hash: freshHash,
    });

    await expect(resolveStepCommentAuthor(ctx, STEP_ID, staleToken)).rejects.toThrow(
      /not the current one for this step/
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "work token rejected",
      expect.objectContaining({ reason: "token_superseded" })
    );
    warnSpy.mockRestore();
  });

  it("err-4: rejects when the step has no assigned agent (defensive)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { token, hash } = mintWorkToken();
    const ctx = makeCtx({
      id: STEP_ID,
      task_id: TASK_ID,
      title: "Step",
      status: "in_progress",
      bot_id: null,
      work_token_hash: hash,
    });

    await expect(resolveStepCommentAuthor(ctx, STEP_ID, token)).rejects.toThrow(
      /has no assigned agent/
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "work token rejected",
      expect.objectContaining({ reason: "no_assigned_agent" })
    );
    warnSpy.mockRestore();
  });

  it("attributes to the step's bot on a valid, current, in-progress token — and returns taskId for reuse", async () => {
    const { token, hash } = mintWorkToken();
    const ctx = makeCtx({
      id: STEP_ID,
      task_id: TASK_ID,
      title: "Step",
      status: "in_progress",
      bot_id: BOT_ID,
      work_token_hash: hash,
    });

    const result = await resolveStepCommentAuthor(ctx, STEP_ID, token);
    expect(result).toEqual({ authorId: BOT_ID, stepId: STEP_ID, taskId: TASK_ID });
  });

  it("a token minted for a DIFFERENT step's hash never verifies against this step", async () => {
    const { token: otherStepToken } = mintWorkToken();
    const { hash: thisStepHash } = mintWorkToken();
    const ctx = makeCtx({
      id: STEP_ID,
      task_id: TASK_ID,
      title: "Step",
      status: "in_progress",
      bot_id: BOT_ID,
      work_token_hash: thisStepHash,
    });

    await expect(resolveStepCommentAuthor(ctx, STEP_ID, otherStepToken)).rejects.toThrow(
      /not the current one for this step/
    );
    void OTHER_STEP_ID;
  });
});

describe("resolveTaskCommentAuthor (add_task_comment path)", () => {
  function makeTaskCtx(matchedStep: unknown) {
    return {
      supabase: { from: vi.fn(() => createChain(matchedStep)) } as unknown as McpContext["supabase"],
      userId: USER_ID,
      ownerUserId: USER_ID,
    } as McpContext;
  }

  it("returns null — no query at all — when work_token is omitted", async () => {
    const ctx = makeTaskCtx(null);
    const result = await resolveTaskCommentAuthor(ctx, TASK_ID, undefined);
    expect(result).toBeNull();
    expect(ctx.supabase.from).not.toHaveBeenCalled();
  });

  it("err-5: rejects a ct_ claim_token", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const ctx = makeTaskCtx(null);
    const { token: claimToken } = mintClaimToken();

    await expect(resolveTaskCommentAuthor(ctx, TASK_ID, claimToken)).rejects.toThrow(
      /That's a claim_token/
    );
    expect(ctx.supabase.from).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("err-3: no matching in-progress step for this task+hash — covers finished/failed/reset/wrong-task in one message", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const ctx = makeTaskCtx(null); // .maybeSingle() finds nothing
    const { token } = mintWorkToken();

    await expect(resolveTaskCommentAuthor(ctx, TASK_ID, token)).rejects.toThrow(
      /doesn't match any in-progress workflow step on this task/
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "work token rejected",
      expect.objectContaining({ tool: "add_task_comment", reason: "no_matching_step", taskId: TASK_ID })
    );
    warnSpy.mockRestore();
  });

  it("err-4: rejects a matched step with no bot_id (defensive)", async () => {
    const ctx = makeTaskCtx({ id: STEP_ID, bot_id: null });
    const { token } = mintWorkToken();

    await expect(resolveTaskCommentAuthor(ctx, TASK_ID, token)).rejects.toThrow(
      /has no assigned agent/
    );
  });

  it("attributes to the matched step's bot on a valid match", async () => {
    const ctx = makeTaskCtx({ id: STEP_ID, bot_id: BOT_ID });
    const { token } = mintWorkToken();

    const result = await resolveTaskCommentAuthor(ctx, TASK_ID, token);
    expect(result).toEqual({ authorId: BOT_ID, stepId: STEP_ID });
  });

  it("scopes the lookup to this task_id — a valid token for a step on a different task never resolves here", async () => {
    // The query itself filters on task_id + hash + in_progress; simulating
    // "wrong task" is simulating the DB returning no row for THIS task_id,
    // which is exactly the err-3 case already covered above. This test
    // documents that expectation explicitly for the cross-task boundary.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const ctx = makeTaskCtx(null);
    const { token } = mintWorkToken();

    await expect(resolveTaskCommentAuthor(ctx, TASK_ID, token)).rejects.toThrow(
      /or the token belongs to a different task/
    );
    warnSpy.mockRestore();
  });
});
