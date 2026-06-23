import { describe, it, expect, vi, type Mock } from "vitest";
import type { McpContext } from "../context";
import { getAgentMentions, getAgentMentionsSchema } from "./agent-mentions";

/** Return type of `supabase.from()` — what the mocked query chains stand in for. */
type FromReturn = ReturnType<McpContext["supabase"]["from"]>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-a000-000000000001";
const OWNER_ID = "00000000-0000-4000-a000-000000000002";
const BOT_ID = "00000000-0000-4000-a000-000000000010";
const IDEA_ID = "00000000-0000-4000-a000-000000000020";
const DISCUSSION_ID = "00000000-0000-4000-a000-000000000030";
const NOTIF_ID = "00000000-0000-4000-a000-000000000040";
const REPLY_ID = "00000000-0000-4000-a000-000000000050";

/** Creates a chainable Supabase query mock that captures method calls. */
function createChain(resolveWith: unknown = null) {
  const captured = {
    eqs: [] as [string, unknown][],
    ins: [] as [string, unknown[]][],
  };

  const chain: Record<string, unknown> = {};

  for (const m of [
    "select",
    "order",
    "limit",
    "range",
    "or",
    "filter",
    "delete",
    "insert",
    "update",
  ]) {
    chain[m] = vi.fn(() => chain);
  }

  chain.eq = vi.fn((col: string, val: unknown) => {
    captured.eqs.push([col, val]);
    return chain;
  });

  chain.in = vi.fn((col: string, vals: unknown[]) => {
    captured.ins.push([col, vals]);
    return chain;
  });

  chain.single = vi.fn(() =>
    Promise.resolve({ data: resolveWith, error: null })
  );
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: resolveWith, error: null })
  );

  // Make chain thenable for `await query`
  chain.then = (resolve: (val: unknown) => void) =>
    Promise.resolve({
      data: Array.isArray(resolveWith) ? resolveWith : [],
      error: null,
    }).then(resolve);

  return { chain, captured };
}

function createErrorChain(errorMessage: string) {
  const chain: Record<string, unknown> = {};

  for (const m of [
    "select",
    "order",
    "limit",
    "range",
    "or",
    "filter",
    "delete",
    "insert",
    "update",
    "eq",
    "in",
  ]) {
    chain[m] = vi.fn(() => chain);
  }

  chain.single = vi.fn(() =>
    Promise.resolve({ data: null, error: { message: errorMessage } })
  );
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: null, error: { message: errorMessage } })
  );
  chain.then = (resolve: (val: unknown) => void) =>
    Promise.resolve({
      data: null,
      error: { message: errorMessage },
    }).then(resolve);

  return chain;
}

function makeContext(
  fromFn: McpContext["supabase"]["from"],
  overrides?: Partial<McpContext>
): McpContext {
  return {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: USER_ID,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema validation tests
// ---------------------------------------------------------------------------

describe("getAgentMentionsSchema", () => {
  it("applies defaults when no args provided", () => {
    const result = getAgentMentionsSchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.idea_id).toBeUndefined();
  });

  it("accepts a valid UUID for idea_id", () => {
    const result = getAgentMentionsSchema.parse({ idea_id: IDEA_ID });
    expect(result.idea_id).toBe(IDEA_ID);
  });

  it("rejects invalid UUID for idea_id", () => {
    expect(() =>
      getAgentMentionsSchema.parse({ idea_id: "not-a-uuid" })
    ).toThrow();
  });

  it("accepts custom limit within bounds", () => {
    const result = getAgentMentionsSchema.parse({ limit: 5 });
    expect(result.limit).toBe(5);
  });

  it("rejects limit below 1", () => {
    expect(() => getAgentMentionsSchema.parse({ limit: 0 })).toThrow();
  });

  it("rejects limit above 50", () => {
    expect(() => getAgentMentionsSchema.parse({ limit: 51 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tool function tests
// ---------------------------------------------------------------------------

describe("getAgentMentions", () => {
  it("returns empty when user has no bots", async () => {
    const { chain } = createChain([]);
    const ctx = makeContext(() => chain as unknown as FromReturn);

    const result = await getAgentMentions(ctx, { limit: 20 });

    expect(result.mentions).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.instructions).toContain("No active agents found");
  });

  it("returns enriched mentions for owned bots", async () => {
    const mockBots = [
      { id: BOT_ID, name: "TestBot", role: "Developer" },
    ];
    const mockNotifications = [
      {
        id: NOTIF_ID,
        user_id: BOT_ID,
        type: "discussion_mention",
        read: false,
        created_at: "2026-01-01T00:00:00Z",
        reply_id: REPLY_ID,
        actor: { id: USER_ID, full_name: "Alice" },
        idea: { id: IDEA_ID, title: "Test Idea" },
        discussion: { id: DISCUSSION_ID, title: "Test Discussion" },
      },
    ];

    let callNum = 0;
    const ctx = makeContext(() => {
      callNum++;
      if (callNum === 1) {
        // bot_profiles query
        return createChain(mockBots).chain as unknown as FromReturn;
      }
      // notifications query
      return createChain(mockNotifications).chain as unknown as FromReturn;
    });

    const result = await getAgentMentions(ctx, { limit: 20 });

    expect(result.total).toBe(1);
    expect(result.mentions[0]).toEqual({
      notification_id: NOTIF_ID,
      agent: { id: BOT_ID, name: "TestBot", role: "Developer" },
      actor: { id: USER_ID, full_name: "Alice" },
      idea: { id: IDEA_ID, title: "Test Idea" },
      discussion: { id: DISCUSSION_ID, title: "Test Discussion" },
      reply_id: REPLY_ID,
      mention_location: "reply",
      created_at: "2026-01-01T00:00:00Z",
    });
    expect(result.instructions).toContain("get_discussion");
  });

  it("uses ownerUserId for bot lookup when in bot-identity mode", async () => {
    const mockBots = [
      { id: BOT_ID, name: "TestBot", role: null },
    ];

    let callNum = 0;
    const capturedEqs: [string, unknown][] = [];
    const ctx = makeContext(
      () => {
        callNum++;
        if (callNum === 1) {
          const { chain } = createChain(mockBots);
          // Wrap eq to capture calls
          const origEq = chain.eq as Mock<(col: string, val: unknown) => unknown>;
          chain.eq = vi.fn((col: string, val: unknown) => {
            capturedEqs.push([col, val]);
            return origEq(col, val);
          });
          return chain as unknown as FromReturn;
        }
        return createChain([]).chain as unknown as FromReturn;
      },
      { ownerUserId: OWNER_ID }
    );

    await getAgentMentions(ctx, { limit: 20 });

    // Bot lookup should use ownerUserId
    expect(capturedEqs).toContainEqual(["owner_id", OWNER_ID]);
  });

  it("falls back to userId when no ownerUserId", async () => {
    let callNum = 0;
    const capturedEqs: [string, unknown][] = [];
    const ctx = makeContext(() => {
      callNum++;
      if (callNum === 1) {
        const { chain } = createChain([]);
        const origEq = chain.eq as Mock<(col: string, val: unknown) => unknown>;
        chain.eq = vi.fn((col: string, val: unknown) => {
          capturedEqs.push([col, val]);
          return origEq(col, val);
        });
        return chain as unknown as FromReturn;
      }
      return createChain([]).chain as unknown as FromReturn;
    });

    await getAgentMentions(ctx, { limit: 20 });

    expect(capturedEqs).toContainEqual(["owner_id", USER_ID]);
  });

  it("filters by idea_id when provided", async () => {
    const mockBots = [
      { id: BOT_ID, name: "TestBot", role: null },
    ];

    let callNum = 0;
    const notifCapturedEqs: [string, unknown][] = [];
    const ctx = makeContext(() => {
      callNum++;
      if (callNum === 1) {
        return createChain(mockBots).chain as unknown as FromReturn;
      }
      // notifications query — capture eq calls
      const { chain } = createChain([]);
      const origEq = chain.eq as Mock<(col: string, val: unknown) => unknown>;
      chain.eq = vi.fn((col: string, val: unknown) => {
        notifCapturedEqs.push([col, val]);
        return origEq(col, val);
      });
      return chain as unknown as FromReturn;
    });

    await getAgentMentions(ctx, { idea_id: IDEA_ID, limit: 20 });

    expect(notifCapturedEqs).toContainEqual(["idea_id", IDEA_ID]);
  });

  it("sets mention_location to 'reply' when reply_id is present", async () => {
    const mockBots = [{ id: BOT_ID, name: "TestBot", role: null }];
    const mockNotifications = [
      {
        id: NOTIF_ID,
        user_id: BOT_ID,
        type: "discussion_mention",
        read: false,
        created_at: "2026-01-01T00:00:00Z",
        reply_id: REPLY_ID,
        actor: { id: USER_ID, full_name: "Alice" },
        idea: { id: IDEA_ID, title: "Test Idea" },
        discussion: { id: DISCUSSION_ID, title: "Test Discussion" },
      },
    ];

    let callNum = 0;
    const ctx = makeContext(() => {
      callNum++;
      if (callNum === 1) return createChain(mockBots).chain as unknown as FromReturn;
      return createChain(mockNotifications).chain as unknown as FromReturn;
    });

    const result = await getAgentMentions(ctx, { limit: 20 });

    expect(result.mentions[0].mention_location).toBe("reply");
    expect(result.mentions[0].reply_id).toBe(REPLY_ID);
  });

  it("sets mention_location to 'discussion_body' when reply_id is null", async () => {
    const mockBots = [{ id: BOT_ID, name: "TestBot", role: null }];
    const mockNotifications = [
      {
        id: NOTIF_ID,
        user_id: BOT_ID,
        type: "discussion_mention",
        read: false,
        created_at: "2026-01-01T00:00:00Z",
        reply_id: null,
        actor: { id: USER_ID, full_name: "Alice" },
        idea: { id: IDEA_ID, title: "Test Idea" },
        discussion: { id: DISCUSSION_ID, title: "Test Discussion" },
      },
    ];

    let callNum = 0;
    const ctx = makeContext(() => {
      callNum++;
      if (callNum === 1) return createChain(mockBots).chain as unknown as FromReturn;
      return createChain(mockNotifications).chain as unknown as FromReturn;
    });

    const result = await getAgentMentions(ctx, { limit: 20 });

    expect(result.mentions[0].mention_location).toBe("discussion_body");
    expect(result.mentions[0].reply_id).toBeNull();
  });

  it("throws on bot_profiles query error", async () => {
    const chain = createErrorChain("permission denied");
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await expect(
      getAgentMentions(ctx, { limit: 20 })
    ).rejects.toThrow("Failed to list bots: permission denied");
  });

  it("throws on notifications query error", async () => {
    const mockBots = [{ id: BOT_ID, name: "TestBot", role: null }];

    let callNum = 0;
    const ctx = makeContext(() => {
      callNum++;
      if (callNum === 1) return createChain(mockBots).chain as unknown as FromReturn;
      return createErrorChain("connection failed") as unknown as FromReturn;
    });

    await expect(
      getAgentMentions(ctx, { limit: 20 })
    ).rejects.toThrow("Failed to fetch mentions: connection failed");
  });
});
