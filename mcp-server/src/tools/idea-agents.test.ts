import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import {
  allocateAgent,
  allocateAgentSchema,
  removeIdeaAgent,
  removeIdeaAgentSchema,
  listIdeaAgents,
  listIdeaAgentsSchema,
} from "./idea-agents";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-a000-000000000001";
const OWNER_ID = "00000000-0000-4000-a000-000000000002";
const IDEA_ID = "00000000-0000-4000-a000-000000000010";
const BOT_ID = "00000000-0000-4000-a000-000000000030";

/** Creates a chainable Supabase query mock that captures method calls. */
function createChain(resolveWith: unknown = null) {
  const captured = {
    eqs: [] as [string, unknown][],
    ins: [] as [string, unknown[]][],
    inserted: null as unknown,
    selectedFields: null as string | null,
  };

  const chain: Record<string, unknown> = {};

  for (const m of ["order", "limit", "range", "or", "filter", "delete"]) {
    chain[m] = vi.fn(() => chain);
  }

  chain.select = vi.fn((fields?: string) => {
    if (fields) captured.selectedFields = fields;
    return chain;
  });

  chain.eq = vi.fn((col: string, val: unknown) => {
    captured.eqs.push([col, val]);
    return chain;
  });

  chain.in = vi.fn((col: string, vals: unknown[]) => {
    captured.ins.push([col, vals]);
    return chain;
  });

  chain.insert = vi.fn((data: unknown) => {
    captured.inserted = data;
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

function createErrorChain(errorMessage: string, code?: string) {
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
  ]) {
    chain[m] = vi.fn(() => chain);
  }

  const error = code
    ? { message: errorMessage, code }
    : { message: errorMessage };

  chain.single = vi.fn(() => Promise.resolve({ data: null, error }));
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error }));
  chain.then = (resolve: (val: unknown) => void) =>
    Promise.resolve({ data: null, error }).then(resolve);

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

describe("idea-agent schemas", () => {
  describe("allocateAgentSchema", () => {
    it("accepts valid input", () => {
      const result = allocateAgentSchema.parse({
        idea_id: IDEA_ID,
        bot_id: BOT_ID,
      });
      expect(result.idea_id).toBe(IDEA_ID);
      expect(result.bot_id).toBe(BOT_ID);
    });

    it("rejects invalid uuid for idea_id", () => {
      expect(() =>
        allocateAgentSchema.parse({ idea_id: "not-a-uuid", bot_id: BOT_ID })
      ).toThrow();
    });

    it("rejects invalid uuid for bot_id", () => {
      expect(() =>
        allocateAgentSchema.parse({ idea_id: IDEA_ID, bot_id: "bad" })
      ).toThrow();
    });

    it("rejects missing fields", () => {
      expect(() => allocateAgentSchema.parse({ idea_id: IDEA_ID })).toThrow();
      expect(() => allocateAgentSchema.parse({ bot_id: BOT_ID })).toThrow();
    });
  });

  describe("removeIdeaAgentSchema", () => {
    it("accepts valid input", () => {
      const result = removeIdeaAgentSchema.parse({
        idea_id: IDEA_ID,
        bot_id: BOT_ID,
      });
      expect(result.idea_id).toBe(IDEA_ID);
      expect(result.bot_id).toBe(BOT_ID);
    });

    it("rejects invalid uuids", () => {
      expect(() =>
        removeIdeaAgentSchema.parse({ idea_id: "x", bot_id: BOT_ID })
      ).toThrow();
    });
  });

  describe("listIdeaAgentsSchema", () => {
    it("accepts valid input", () => {
      const result = listIdeaAgentsSchema.parse({ idea_id: IDEA_ID });
      expect(result.idea_id).toBe(IDEA_ID);
    });

    it("rejects invalid uuid", () => {
      expect(() =>
        listIdeaAgentsSchema.parse({ idea_id: "not-uuid" })
      ).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// allocateAgent
// ---------------------------------------------------------------------------

describe("allocateAgent", () => {
  it("inserts with correct idea_id, bot_id, and added_by from ctx.userId", async () => {
    const { chain, captured } = createChain(null);
    // Override thenable — insert resolves with no error
    chain.then = (resolve: (val: unknown) => void) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
    const ctx = makeContext(() => chain as any);

    const result = await allocateAgent(ctx, {
      idea_id: IDEA_ID,
      bot_id: BOT_ID,
    });

    expect(result.success).toBe(true);
    expect(result.idea_id).toBe(IDEA_ID);
    expect(result.bot_id).toBe(BOT_ID);
    expect(captured.inserted).toEqual({
      idea_id: IDEA_ID,
      bot_id: BOT_ID,
      added_by: USER_ID,
    });
  });

  it("uses ownerUserId for added_by when present", async () => {
    const { chain, captured } = createChain(null);
    chain.then = (resolve: (val: unknown) => void) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
    const ctx = makeContext(() => chain as any, { ownerUserId: OWNER_ID });

    await allocateAgent(ctx, { idea_id: IDEA_ID, bot_id: BOT_ID });

    expect(captured.inserted).toEqual({
      idea_id: IDEA_ID,
      bot_id: BOT_ID,
      added_by: OWNER_ID,
    });
  });

  it("ignores duplicate allocation (error code 23505)", async () => {
    const chain = createErrorChain("duplicate key value", "23505");
    const ctx = makeContext(() => chain as any);

    const result = await allocateAgent(ctx, {
      idea_id: IDEA_ID,
      bot_id: BOT_ID,
    });

    // Should succeed — duplicate is not an error
    expect(result.success).toBe(true);
  });

  it("throws on non-duplicate database error", async () => {
    const chain = createErrorChain("RLS policy violation", "42501");
    const ctx = makeContext(() => chain as any);

    await expect(
      allocateAgent(ctx, { idea_id: IDEA_ID, bot_id: BOT_ID })
    ).rejects.toThrow("Failed to allocate agent: RLS policy violation");
  });
});

// ---------------------------------------------------------------------------
// removeIdeaAgent
// ---------------------------------------------------------------------------

describe("removeIdeaAgent", () => {
  it("deletes with correct eq filters", async () => {
    const { chain, captured } = createChain(null);
    chain.then = (resolve: (val: unknown) => void) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
    const ctx = makeContext(() => chain as any);

    const result = await removeIdeaAgent(ctx, {
      idea_id: IDEA_ID,
      bot_id: BOT_ID,
    });

    expect(result.success).toBe(true);
    expect(result.idea_id).toBe(IDEA_ID);
    expect(result.bot_id).toBe(BOT_ID);
    expect(captured.eqs).toContainEqual(["idea_id", IDEA_ID]);
    expect(captured.eqs).toContainEqual(["bot_id", BOT_ID]);
  });

  it("throws on database error", async () => {
    const chain = createErrorChain("permission denied");
    const ctx = makeContext(() => chain as any);

    await expect(
      removeIdeaAgent(ctx, { idea_id: IDEA_ID, bot_id: BOT_ID })
    ).rejects.toThrow("Failed to remove idea agent: permission denied");
  });
});

// ---------------------------------------------------------------------------
// listIdeaAgents
// ---------------------------------------------------------------------------

describe("listIdeaAgents", () => {
  it("returns mapped agent list with correct fields", async () => {
    const mockRows = [
      {
        bot_id: BOT_ID,
        added_by: OWNER_ID,
        created_at: "2026-01-01T00:00:00Z",
        bot: {
          id: BOT_ID,
          name: "Test Bot",
          role: "developer",
          avatar_url: "https://example.com/avatar.png",
          is_active: true,
          owner_id: OWNER_ID,
        },
        adder: { id: OWNER_ID, full_name: "Alice" },
      },
    ];
    const { chain, captured } = createChain(mockRows);
    const ctx = makeContext(() => chain as any);

    const result = await listIdeaAgents(ctx, { idea_id: IDEA_ID });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      bot_id: BOT_ID,
      bot_name: "Test Bot",
      bot_role: "developer",
      bot_avatar_url: "https://example.com/avatar.png",
      is_active: true,
      owner_id: OWNER_ID,
      added_by: OWNER_ID,
      added_by_name: "Alice",
      allocated_at: "2026-01-01T00:00:00Z",
    });
    expect(captured.eqs).toContainEqual(["idea_id", IDEA_ID]);
  });

  it("returns empty array when no agents allocated", async () => {
    const { chain } = createChain([]);
    const ctx = makeContext(() => chain as any);

    const result = await listIdeaAgents(ctx, { idea_id: IDEA_ID });

    expect(result).toEqual([]);
  });

  it("handles null bot and adder gracefully", async () => {
    const mockRows = [
      {
        bot_id: BOT_ID,
        added_by: OWNER_ID,
        created_at: "2026-01-01T00:00:00Z",
        bot: null,
        adder: null,
      },
    ];
    const { chain } = createChain(mockRows);
    const ctx = makeContext(() => chain as any);

    const result = await listIdeaAgents(ctx, { idea_id: IDEA_ID });

    expect(result).toHaveLength(1);
    expect(result[0].bot_name).toBeNull();
    expect(result[0].bot_role).toBeNull();
    expect(result[0].is_active).toBe(false);
    expect(result[0].owner_id).toBeNull();
    expect(result[0].added_by_name).toBeNull();
  });

  it("throws on database error", async () => {
    const chain = createErrorChain("connection failed");
    chain.then = (resolve: (val: unknown) => void) =>
      Promise.resolve({
        data: null,
        error: { message: "connection failed" },
      }).then(resolve);
    const ctx = makeContext(() => chain as any);

    await expect(
      listIdeaAgents(ctx, { idea_id: IDEA_ID })
    ).rejects.toThrow("Failed to list idea agents: connection failed");
  });
});
