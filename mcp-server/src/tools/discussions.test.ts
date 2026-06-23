import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import {
  listDiscussions,
  listDiscussionsSchema,
  getDiscussion,
  getDiscussionSchema,
  addDiscussionReply,
  addDiscussionReplySchema,
  createDiscussion,
  createDiscussionSchema,
  updateDiscussion,
  updateDiscussionSchema,
  deleteDiscussion,
  deleteDiscussionSchema,
} from "./discussions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-a000-000000000001";
const IDEA_ID = "00000000-0000-4000-a000-000000000010";
const DISCUSSION_ID = "00000000-0000-4000-a000-000000000020";

/** Return type of `supabase.from()` — what the mocked query chains stand in for. */
type FromReturn = ReturnType<McpContext["supabase"]["from"]>;

/** Creates a chainable Supabase query mock that captures method calls. */
function createChain(resolveWith: unknown = null) {
  const captured = {
    eqs: [] as [string, unknown][],
    inserted: null as unknown,
    updated: null as unknown,
    selectedFields: null as string | null,
  };

  const chain: Record<string, unknown> = {};

  for (const m of [
    "order",
    "limit",
    "range",
    "or",
    "filter",
    "delete",
  ]) {
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

  chain.insert = vi.fn((data: unknown) => {
    captured.inserted = data;
    return chain;
  });

  chain.update = vi.fn((data: unknown) => {
    captured.updated = data;
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
  fromFn: McpContext["supabase"]["from"]
): McpContext {
  return {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: USER_ID,
  };
}

// ---------------------------------------------------------------------------
// Schema validation tests
// ---------------------------------------------------------------------------

describe("discussion schemas", () => {
  describe("createDiscussionSchema", () => {
    it("accepts valid input", () => {
      const result = createDiscussionSchema.parse({
        idea_id: IDEA_ID,
        title: "My Discussion",
        body: "Some body text",
      });
      expect(result.title).toBe("My Discussion");
    });

    it("rejects empty title", () => {
      expect(() =>
        createDiscussionSchema.parse({
          idea_id: IDEA_ID,
          title: "",
          body: "Body",
        })
      ).toThrow();
    });

    it("rejects title over 200 chars", () => {
      expect(() =>
        createDiscussionSchema.parse({
          idea_id: IDEA_ID,
          title: "a".repeat(201),
          body: "Body",
        })
      ).toThrow();
    });

    it("accepts title at 200 chars", () => {
      const result = createDiscussionSchema.parse({
        idea_id: IDEA_ID,
        title: "a".repeat(200),
        body: "Body",
      });
      expect(result.title).toHaveLength(200);
    });

    it("rejects body over 10000 chars", () => {
      expect(() =>
        createDiscussionSchema.parse({
          idea_id: IDEA_ID,
          title: "Title",
          body: "a".repeat(10001),
        })
      ).toThrow();
    });

    it("rejects empty body", () => {
      expect(() =>
        createDiscussionSchema.parse({
          idea_id: IDEA_ID,
          title: "Title",
          body: "",
        })
      ).toThrow();
    });

    it("rejects invalid uuid for idea_id", () => {
      expect(() =>
        createDiscussionSchema.parse({
          idea_id: "not-a-uuid",
          title: "Title",
          body: "Body",
        })
      ).toThrow();
    });
  });

  describe("updateDiscussionSchema", () => {
    it("accepts all optional fields", () => {
      const result = updateDiscussionSchema.parse({
        discussion_id: DISCUSSION_ID,
        idea_id: IDEA_ID,
        title: "New title",
        body: "New body",
        status: "resolved",
        pinned: true,
      });
      expect(result.status).toBe("resolved");
      expect(result.pinned).toBe(true);
    });

    it("accepts with no optional fields", () => {
      const result = updateDiscussionSchema.parse({
        discussion_id: DISCUSSION_ID,
        idea_id: IDEA_ID,
      });
      expect(result.title).toBeUndefined();
      expect(result.body).toBeUndefined();
      expect(result.status).toBeUndefined();
      expect(result.pinned).toBeUndefined();
    });

    it("rejects invalid status", () => {
      expect(() =>
        updateDiscussionSchema.parse({
          discussion_id: DISCUSSION_ID,
          idea_id: IDEA_ID,
          status: "invalid",
        })
      ).toThrow();
    });

    it("accepts all valid statuses", () => {
      for (const status of ["open", "resolved", "converted"]) {
        const result = updateDiscussionSchema.parse({
          discussion_id: DISCUSSION_ID,
          idea_id: IDEA_ID,
          status,
        });
        expect(result.status).toBe(status);
      }
    });
  });

  describe("deleteDiscussionSchema", () => {
    it("requires both discussion_id and idea_id", () => {
      expect(() =>
        deleteDiscussionSchema.parse({ discussion_id: DISCUSSION_ID })
      ).toThrow();
      expect(() =>
        deleteDiscussionSchema.parse({ idea_id: IDEA_ID })
      ).toThrow();
    });

    it("accepts valid input", () => {
      const result = deleteDiscussionSchema.parse({
        discussion_id: DISCUSSION_ID,
        idea_id: IDEA_ID,
      });
      expect(result.discussion_id).toBe(DISCUSSION_ID);
      expect(result.idea_id).toBe(IDEA_ID);
    });
  });
});

// ---------------------------------------------------------------------------
// Tool function tests
// ---------------------------------------------------------------------------

describe("createDiscussion", () => {
  it("inserts a discussion with ctx.userId as author_id", async () => {
    const { chain, captured } = createChain({
      id: DISCUSSION_ID,
      title: "Test Discussion",
      created_at: "2026-01-01T00:00:00Z",
    });
    const ctx = makeContext(() => chain as unknown as FromReturn);

    const result = await createDiscussion(ctx, {
      idea_id: IDEA_ID,
      title: "Test Discussion",
      body: "Discussion body content",
    });

    expect(result.success).toBe(true);
    expect(result.discussion.id).toBe(DISCUSSION_ID);
    expect(result.discussion.title).toBe("Test Discussion");

    // Verify insert payload
    expect(captured.inserted).toEqual({
      idea_id: IDEA_ID,
      author_id: USER_ID,
      title: "Test Discussion",
      body: "Discussion body content",
    });
  });

  it("selects id, title, created_at from the insert", async () => {
    const { chain, captured } = createChain({
      id: DISCUSSION_ID,
      title: "Test",
      created_at: "2026-01-01T00:00:00Z",
    });
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await createDiscussion(ctx, {
      idea_id: IDEA_ID,
      title: "Test",
      body: "Body",
    });

    expect(captured.selectedFields).toBe("id, title, created_at");
  });

  it("throws on database error", async () => {
    const chain = createErrorChain("RLS policy violation");
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await expect(
      createDiscussion(ctx, {
        idea_id: IDEA_ID,
        title: "Test",
        body: "Body",
      })
    ).rejects.toThrow("Failed to create discussion: RLS policy violation");
  });
});

describe("updateDiscussion", () => {
  it("updates title only", async () => {
    const { chain, captured } = createChain({
      id: DISCUSSION_ID,
      title: "Updated Title",
      status: "open",
      pinned: false,
    });
    const ctx = makeContext(() => chain as unknown as FromReturn);

    const result = await updateDiscussion(ctx, {
      discussion_id: DISCUSSION_ID,
      idea_id: IDEA_ID,
      title: "Updated Title",
    });

    expect(result.success).toBe(true);
    expect(captured.updated).toEqual({ title: "Updated Title" });
  });

  it("updates status only", async () => {
    const { chain, captured } = createChain({
      id: DISCUSSION_ID,
      title: "Title",
      status: "resolved",
      pinned: false,
    });
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await updateDiscussion(ctx, {
      discussion_id: DISCUSSION_ID,
      idea_id: IDEA_ID,
      status: "resolved",
    });

    expect(captured.updated).toEqual({ status: "resolved" });
  });

  it("updates pinned only", async () => {
    const { chain, captured } = createChain({
      id: DISCUSSION_ID,
      title: "Title",
      status: "open",
      pinned: true,
    });
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await updateDiscussion(ctx, {
      discussion_id: DISCUSSION_ID,
      idea_id: IDEA_ID,
      pinned: true,
    });

    expect(captured.updated).toEqual({ pinned: true });
  });

  it("updates body only", async () => {
    const { chain, captured } = createChain({
      id: DISCUSSION_ID,
      title: "Title",
      status: "open",
      pinned: false,
    });
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await updateDiscussion(ctx, {
      discussion_id: DISCUSSION_ID,
      idea_id: IDEA_ID,
      body: "New body content",
    });

    expect(captured.updated).toEqual({ body: "New body content" });
  });

  it("updates multiple fields at once", async () => {
    const { chain, captured } = createChain({
      id: DISCUSSION_ID,
      title: "New Title",
      status: "resolved",
      pinned: true,
    });
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await updateDiscussion(ctx, {
      discussion_id: DISCUSSION_ID,
      idea_id: IDEA_ID,
      title: "New Title",
      status: "resolved",
      pinned: true,
    });

    expect(captured.updated).toEqual({
      title: "New Title",
      status: "resolved",
      pinned: true,
    });
  });

  it("applies eq filters for discussion_id and idea_id", async () => {
    const { chain, captured } = createChain({
      id: DISCUSSION_ID,
      title: "Title",
      status: "open",
      pinned: false,
    });
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await updateDiscussion(ctx, {
      discussion_id: DISCUSSION_ID,
      idea_id: IDEA_ID,
      title: "Updated",
    });

    expect(captured.eqs).toContainEqual(["id", DISCUSSION_ID]);
    expect(captured.eqs).toContainEqual(["idea_id", IDEA_ID]);
  });

  it("throws when no fields to update", async () => {
    const { chain } = createChain(null);
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await expect(
      updateDiscussion(ctx, {
        discussion_id: DISCUSSION_ID,
        idea_id: IDEA_ID,
      })
    ).rejects.toThrow("No fields to update");
  });

  it("throws on database error", async () => {
    const chain = createErrorChain("permission denied");
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await expect(
      updateDiscussion(ctx, {
        discussion_id: DISCUSSION_ID,
        idea_id: IDEA_ID,
        title: "Updated",
      })
    ).rejects.toThrow("Failed to update discussion: permission denied");
  });
});

describe("deleteDiscussion", () => {
  it("deletes discussion by id and idea_id", async () => {
    const { chain, captured } = createChain(null);
    // Override delete's then to resolve with no error
    chain.then = (resolve: (val: unknown) => void) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
    const ctx = makeContext(() => chain as unknown as FromReturn);

    const result = await deleteDiscussion(ctx, {
      discussion_id: DISCUSSION_ID,
      idea_id: IDEA_ID,
    });

    expect(result.success).toBe(true);
    expect(result.deleted.id).toBe(DISCUSSION_ID);
    expect(captured.eqs).toContainEqual(["id", DISCUSSION_ID]);
    expect(captured.eqs).toContainEqual(["idea_id", IDEA_ID]);
  });

  it("throws on database error", async () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "delete", "eq"]) {
      chain[m] = vi.fn(() => chain);
    }
    chain.then = (resolve: (val: unknown) => void) =>
      Promise.resolve({
        data: null,
        error: { message: "foreign key violation" },
      }).then(resolve);

    const ctx = makeContext(() => chain as unknown as FromReturn);

    await expect(
      deleteDiscussion(ctx, {
        discussion_id: DISCUSSION_ID,
        idea_id: IDEA_ID,
      })
    ).rejects.toThrow("Failed to delete discussion: foreign key violation");
  });
});

describe("listDiscussions", () => {
  it("queries idea_discussions with correct idea_id", async () => {
    const mockDiscussions = [
      {
        id: "d1",
        title: "Discussion 1",
        status: "open",
        pinned: false,
        reply_count: 3,
        upvotes: 5,
        last_activity_at: "2026-01-02T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
        users: { full_name: "Alice" },
      },
    ];
    const { chain, captured } = createChain(mockDiscussions);
    const ctx = makeContext(() => chain as unknown as FromReturn);

    const result = await listDiscussions(ctx, {
      idea_id: IDEA_ID,
      limit: 20,
    });

    expect(captured.eqs).toContainEqual(["idea_id", IDEA_ID]);
    expect(result).toHaveLength(1);
    expect(result[0].author).toEqual({ full_name: "Alice" });
    expect(result[0].users).toBeUndefined();
  });

  it("applies status filter when provided", async () => {
    const { chain, captured } = createChain([]);
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await listDiscussions(ctx, {
      idea_id: IDEA_ID,
      status: "resolved",
      limit: 20,
    });

    expect(captured.eqs).toContainEqual(["status", "resolved"]);
  });

  it("does not filter by status when not provided", async () => {
    const { chain, captured } = createChain([]);
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await listDiscussions(ctx, {
      idea_id: IDEA_ID,
      limit: 20,
    });

    const statusEq = captured.eqs.find(([col]) => col === "status");
    expect(statusEq).toBeUndefined();
  });

  it("throws on database error", async () => {
    const chain = createErrorChain("connection failed");
    // Override thenable to return error
    chain.then = (resolve: (val: unknown) => void) =>
      Promise.resolve({
        data: null,
        error: { message: "connection failed" },
      }).then(resolve);
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await expect(
      listDiscussions(ctx, { idea_id: IDEA_ID, limit: 20 })
    ).rejects.toThrow("Failed to list discussions: connection failed");
  });
});

describe("getDiscussion", () => {
  it("returns discussion with replies", async () => {
    const mockDiscussion = {
      id: DISCUSSION_ID,
      title: "Test",
      body: "Body",
      status: "open",
      pinned: false,
      upvotes: 2,
      reply_count: 1,
      last_activity_at: "2026-01-01T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
      users: { id: USER_ID, full_name: "Alice" },
    };
    const mockReplies = [
      {
        id: "r1",
        content: "A reply",
        parent_reply_id: null,
        created_at: "2026-01-01T01:00:00Z",
        updated_at: null,
        users: { id: "u2", full_name: "Bob" },
      },
    ];

    let callNum = 0;
    const ctx = makeContext(() => {
      callNum++;
      if (callNum === 1) {
        // idea_discussions query
        return createChain(mockDiscussion).chain as unknown as FromReturn;
      }
      // idea_discussion_replies query
      return createChain(mockReplies).chain as unknown as FromReturn;
    });

    const result = await getDiscussion(ctx, {
      discussion_id: DISCUSSION_ID,
      idea_id: IDEA_ID,
    });

    expect(result.title).toBe("Test");
    expect(result.author).toEqual({ id: USER_ID, full_name: "Alice" });
    expect(result.users).toBeUndefined();
    expect(result.replies).toHaveLength(1);
  });

  it("throws when discussion not found", async () => {
    const { chain } = createChain(null); // maybeSingle returns null
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await expect(
      getDiscussion(ctx, {
        discussion_id: DISCUSSION_ID,
        idea_id: IDEA_ID,
      })
    ).rejects.toThrow(`Discussion not found: ${DISCUSSION_ID}`);
  });

  it("nests child replies under their parent", async () => {
    const mockDiscussion = {
      id: DISCUSSION_ID,
      title: "Test",
      body: "Body",
      status: "open",
      pinned: false,
      upvotes: 0,
      reply_count: 2,
      last_activity_at: "2026-01-01T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
      users: { id: USER_ID, full_name: "Alice" },
    };
    const mockReplies = [
      {
        id: "r1",
        content: "Parent reply",
        parent_reply_id: null,
        created_at: "2026-01-01T01:00:00Z",
        updated_at: null,
        users: { id: "u2", full_name: "Bob" },
      },
      {
        id: "r2",
        content: "Child reply",
        parent_reply_id: "r1",
        created_at: "2026-01-01T02:00:00Z",
        updated_at: null,
        users: { id: "u3", full_name: "Charlie" },
      },
    ];

    let callNum = 0;
    const ctx = makeContext(() => {
      callNum++;
      if (callNum === 1) return createChain(mockDiscussion).chain as unknown as FromReturn;
      return createChain(mockReplies).chain as unknown as FromReturn;
    });

    const result = await getDiscussion(ctx, {
      discussion_id: DISCUSSION_ID,
      idea_id: IDEA_ID,
    });

    // Top-level has 1 reply, with 1 child
    expect(result.replies).toHaveLength(1);
    const parent = result.replies[0] as { id: string; replies: unknown[] };
    expect(parent.id).toBe("r1");
    expect(parent.replies).toHaveLength(1);
  });
});

describe("addDiscussionReply", () => {
  it("inserts a reply with ctx.userId as author_id", async () => {
    const { chain, captured } = createChain({
      id: "r1",
      content: "My reply",
      created_at: "2026-01-01T00:00:00Z",
    });
    const ctx = makeContext(() => chain as unknown as FromReturn);

    const result = await addDiscussionReply(ctx, {
      discussion_id: DISCUSSION_ID,
      idea_id: IDEA_ID,
      content: "My reply",
    });

    expect(result.success).toBe(true);
    expect(result.reply.id).toBe("r1");
    expect(captured.inserted).toEqual({
      discussion_id: DISCUSSION_ID,
      author_id: USER_ID,
      content: "My reply",
      parent_reply_id: null,
    });
  });

  it("flattens nested replies — child of child becomes child of grandparent", async () => {
    // First call: from("idea_discussion_replies").select().eq().single()
    //   → returns parent with parent_reply_id set (grandparent scenario)
    const parentChain = createChain({ parent_reply_id: "grandparent-id" });
    // Second call: from("idea_discussion_replies").insert().select().single()
    const insertChain = createChain({
      id: "r3",
      content: "Nested reply",
      created_at: "2026-01-01T00:00:00Z",
    });

    let callNum = 0;
    const ctx = makeContext(() => {
      callNum++;
      if (callNum === 1) return parentChain.chain as unknown as FromReturn;
      return insertChain.chain as unknown as FromReturn;
    });

    const result = await addDiscussionReply(ctx, {
      discussion_id: DISCUSSION_ID,
      idea_id: IDEA_ID,
      content: "Nested reply",
      parent_reply_id: "child-id",
    });

    expect(result.success).toBe(true);
    // Should have been flattened to grandparent
    expect(insertChain.captured.inserted).toEqual({
      discussion_id: DISCUSSION_ID,
      author_id: USER_ID,
      content: "Nested reply",
      parent_reply_id: "grandparent-id",
    });
  });

  it("keeps parent_reply_id when parent has no grandparent", async () => {
    const parentChain = createChain({ parent_reply_id: null });
    const insertChain = createChain({
      id: "r2",
      content: "Reply to top-level",
      created_at: "2026-01-01T00:00:00Z",
    });

    let callNum = 0;
    const ctx = makeContext(() => {
      callNum++;
      if (callNum === 1) return parentChain.chain as unknown as FromReturn;
      return insertChain.chain as unknown as FromReturn;
    });

    await addDiscussionReply(ctx, {
      discussion_id: DISCUSSION_ID,
      idea_id: IDEA_ID,
      content: "Reply to top-level",
      parent_reply_id: "parent-id",
    });

    expect(insertChain.captured.inserted).toEqual({
      discussion_id: DISCUSSION_ID,
      author_id: USER_ID,
      content: "Reply to top-level",
      parent_reply_id: "parent-id",
    });
  });

  it("throws on database error", async () => {
    const chain = createErrorChain("insert failed");
    const ctx = makeContext(() => chain as unknown as FromReturn);

    await expect(
      addDiscussionReply(ctx, {
        discussion_id: DISCUSSION_ID,
        idea_id: IDEA_ID,
        content: "A reply",
      })
    ).rejects.toThrow("Failed to add discussion reply: insert failed");
  });
});
