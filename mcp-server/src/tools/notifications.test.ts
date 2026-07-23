import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { logger } from "../../../src/lib/logger";
import { buildNotificationUrl } from "../../../src/lib/notification-url";
import { listNotifications, listNotificationsSchema } from "./notifications";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-a000-000000000001";
const IDEA_ID = "00000000-0000-4000-a000-000000000040";
const TASK_ID = "00000000-0000-4000-a000-000000000010";
const TASK_ID_2 = "00000000-0000-4000-a000-000000000011";
const ACTOR_ID = "00000000-0000-4000-a000-000000000050";
const ACTOR_ID_2 = "00000000-0000-4000-a000-000000000060";
const DISCUSSION_ID = "00000000-0000-4000-a000-000000000070";
const REPLY_ID = "00000000-0000-4000-a000-000000000080";
const COMMENT_ID = "00000000-0000-4000-a000-000000000090";

/** Creates a chainable Supabase query mock that captures every call per method. */
function createChain(resolveWith: unknown[] = [], error: { message: string } | null = null) {
  const calls: Record<string, unknown[][]> = {};
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "or", "in", "filter"]) {
    chain[m] = vi.fn((...args: unknown[]) => {
      (calls[m] ??= []).push(args);
      return chain;
    });
  }
  chain.then = (resolve: (val: unknown) => void) =>
    Promise.resolve({ data: error ? null : resolveWith, error }).then(resolve);
  return Object.assign(chain, { __calls: calls });
}

function makeCtx(opts: {
  notificationRows: unknown[];
  notificationsError?: { message: string } | null;
  mentionRows?: unknown[];
  mentionError?: { message: string } | null;
}) {
  const notificationsChain = createChain(opts.notificationRows, opts.notificationsError ?? null);
  const mentionChain = createChain(opts.mentionRows ?? [], opts.mentionError ?? null);

  const fromFn = vi.fn((table: string) => {
    if (table === "notifications") return notificationsChain;
    if (table === "board_task_comments") return mentionChain;
    throw new Error(`Unexpected table: ${table}`);
  });

  const ctx: McpContext = {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: USER_ID,
  };

  return { ctx, fromFn, notificationsChain, mentionChain };
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    type: "vote",
    read: false,
    created_at: "2026-07-23T10:00:00Z",
    idea_id: IDEA_ID,
    task_id: null,
    comment_id: null,
    discussion_id: null,
    reply_id: null,
    actor: { id: ACTOR_ID, full_name: "Amy Lin" },
    idea: { id: IDEA_ID, title: "Realtime board sync" },
    task: null,
    discussion: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("listNotifications — enrichment", () => {
  it("maps enriched shape: raw FK ids, task/discussion embeds, discussion_title, url", async () => {
    const row = baseRow({
      id: "n1",
      type: "task_mention",
      task_id: TASK_ID,
      task: { id: TASK_ID, title: "Fix websocket reconnect" },
      discussion_id: DISCUSSION_ID,
      discussion: { title: "Should we drop Firefox from CI?" },
    });
    const { ctx } = makeCtx({ notificationRows: [row] });

    const result = await listNotifications(ctx, listNotificationsSchema.parse({}));

    expect(result.notifications).toHaveLength(1);
    const n = result.notifications[0] as Record<string, unknown>;
    expect(n.id).toBe("n1");
    expect(n.idea_id).toBe(IDEA_ID);
    expect(n.task_id).toBe(TASK_ID);
    expect(n.comment_id).toBeNull();
    expect(n.discussion_id).toBe(DISCUSSION_ID);
    expect(n.reply_id).toBeNull();
    expect(n.task).toEqual({ id: TASK_ID, title: "Fix websocket reconnect" });
    expect(n.discussion_title).toBe("Should we drop Firefox from CI?");
    expect(n).not.toHaveProperty("discussion"); // nested embed dropped in favor of flat discussion_title
    expect(typeof n.url).toBe("string");
  });

  it("discussion_title and task are null when the FK is absent or the row was deleted (embed miss)", async () => {
    const row = baseRow({ task_id: TASK_ID, task: null, discussion_id: null, discussion: null });
    const { ctx } = makeCtx({ notificationRows: [row] });

    const result = await listNotifications(ctx, listNotificationsSchema.parse({}));
    const n = result.notifications[0] as Record<string, unknown>;
    expect(n.task).toBeNull();
    expect(n.discussion_title).toBeNull();
    // raw task_id survives a deleted/embed-miss task so the url still builds
    expect(n.task_id).toBe(TASK_ID);
  });

  it("regression: total/unread_count/unread_only unchanged", async () => {
    const rows = [baseRow({ id: "n1", read: false }), baseRow({ id: "n2", read: true })];
    const { ctx, notificationsChain } = makeCtx({ notificationRows: rows });

    const result = await listNotifications(ctx, listNotificationsSchema.parse({ unread_only: true }));

    expect(result.total).toBe(2);
    expect(result.unread_count).toBe(1);
    expect(notificationsChain.eq).toHaveBeenCalledWith("read", false);
  });
});

describe("listNotifications — url branches (vs buildNotificationUrl directly)", () => {
  const cases: { name: string; overrides: Record<string, unknown> }[] = [
    { name: "no ideaId -> app base", overrides: { idea_id: null, task_id: null } },
    { name: "task_mention with task_id -> board?taskId=", overrides: { type: "task_mention", task_id: TASK_ID } },
    { name: "task_mention without task_id -> board (type fallback)", overrides: { type: "task_mention", task_id: null } },
    {
      name: "discussion_mention with discussion+reply -> discussions/{id}#reply-{id}",
      overrides: { type: "discussion_mention", discussion_id: DISCUSSION_ID, reply_id: REPLY_ID },
    },
    {
      name: "discussion without discussion_id -> discussions (type fallback)",
      overrides: { type: "discussion", discussion_id: null },
    },
    { name: "comment with comment_id -> #comment-{id}", overrides: { type: "comment", comment_id: COMMENT_ID } },
    { name: "vote, idea only -> idea base", overrides: { type: "vote" } },
  ];

  for (const { name, overrides } of cases) {
    it(name, async () => {
      const row = baseRow(overrides);
      const { ctx } = makeCtx({ notificationRows: [row] });
      const result = await listNotifications(ctx, listNotificationsSchema.parse({}));
      const n = result.notifications[0] as Record<string, unknown>;

      const expectedUrl = buildNotificationUrl({
        type: row.type as never,
        ideaId: row.idea_id as string | null,
        commentId: row.comment_id as string | null,
        taskId: row.task_id as string | null,
        discussionId: row.discussion_id as string | null,
        replyId: row.reply_id as string | null,
        appUrl: "https://vibecodes.co.uk", // default fallback (NEXT_PUBLIC_APP_URL unset in tests)
      });

      expect(n.url).toBe(expectedUrl);
      expect(n.url).not.toBeNull();
    });
  }
});

describe("listNotifications — mention_context", () => {
  it("found: task_mention with a matching board_task_comment yields mention_context", async () => {
    const row = baseRow({ id: "n1", type: "task_mention", task_id: TASK_ID, actor: { id: ACTOR_ID, full_name: "Amy" } });
    const comment = {
      task_id: TASK_ID,
      author_id: ACTOR_ID,
      content: "check the reconnect backoff",
      created_at: "2026-07-23T10:04:00Z",
    };
    const { ctx } = makeCtx({ notificationRows: [row], mentionRows: [comment] });

    const result = await listNotifications(ctx, listNotificationsSchema.parse({}));
    const n = result.notifications[0] as Record<string, unknown>;

    expect(n.mention_context).toEqual({
      text: "check the reconnect backoff",
      source: "board_task_comment",
      best_effort: true,
    });
  });

  it("not-found: no matching comment -> mention_context key is omitted, not null", async () => {
    const row = baseRow({ id: "n1", type: "task_mention", task_id: TASK_ID, actor: { id: ACTOR_ID, full_name: "Amy" } });
    const { ctx } = makeCtx({ notificationRows: [row], mentionRows: [] });

    const result = await listNotifications(ctx, listNotificationsSchema.parse({}));
    const n = result.notifications[0] as Record<string, unknown>;

    expect(n).not.toHaveProperty("mention_context");
  });

  it("omitted for non task_mention types and for task_mention without task_id", async () => {
    const rows = [
      baseRow({ id: "n1", type: "vote", task_id: null }),
      baseRow({ id: "n2", type: "task_mention", task_id: null }),
    ];
    const { ctx } = makeCtx({ notificationRows: rows, mentionRows: [] });

    const result = await listNotifications(ctx, listNotificationsSchema.parse({}));
    for (const n of result.notifications as Record<string, unknown>[]) {
      expect(n).not.toHaveProperty("mention_context");
    }
  });

  it("truncation: content over 200 chars is sliced to 200 + ellipsis", async () => {
    const longContent = "x".repeat(250);
    const row = baseRow({ id: "n1", type: "task_mention", task_id: TASK_ID, actor: { id: ACTOR_ID, full_name: "Amy" } });
    const comment = { task_id: TASK_ID, author_id: ACTOR_ID, content: longContent, created_at: "2026-07-23T10:04:00Z" };
    const { ctx } = makeCtx({ notificationRows: [row], mentionRows: [comment] });

    const result = await listNotifications(ctx, listNotificationsSchema.parse({}));
    const n = result.notifications[0] as Record<string, unknown>;
    const mc = n.mention_context as { text: string };

    expect(mc.text).toBe(`${"x".repeat(200)}…`);
    expect(mc.text.length).toBe(201);
  });

  it("keeps the newest comment per (task_id, author_id) when multiple rows match one pair", async () => {
    const row = baseRow({ id: "n1", type: "task_mention", task_id: TASK_ID, actor: { id: ACTOR_ID, full_name: "Amy" } });
    // Query orders created_at desc, so the newest row must arrive first.
    const newest = { task_id: TASK_ID, author_id: ACTOR_ID, content: "newest comment", created_at: "2026-07-23T10:10:00Z" };
    const older = { task_id: TASK_ID, author_id: ACTOR_ID, content: "older comment", created_at: "2026-07-23T09:00:00Z" };
    const { ctx } = makeCtx({ notificationRows: [row], mentionRows: [newest, older] });

    const result = await listNotifications(ctx, listNotificationsSchema.parse({}));
    const n = result.notifications[0] as Record<string, unknown>;
    const mc = n.mention_context as { text: string };

    expect(mc.text).toBe("newest comment");
  });

  it("query error: logger.warn, mention_context omitted from all rows, notifications still returned in full", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const row = baseRow({ id: "n1", type: "task_mention", task_id: TASK_ID, actor: { id: ACTOR_ID, full_name: "Amy" } });
    const { ctx } = makeCtx({ notificationRows: [row], mentionError: { message: "boom" } });

    const result = await listNotifications(ctx, listNotificationsSchema.parse({}));

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]).not.toHaveProperty("mention_context");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("skips the mention query entirely when there are zero task_mention pairs", async () => {
    const rows = [baseRow({ id: "n1", type: "vote" }), baseRow({ id: "n2", type: "comment", comment_id: COMMENT_ID })];
    const { ctx, fromFn } = makeCtx({ notificationRows: rows });

    await listNotifications(ctx, listNotificationsSchema.parse({}));

    expect(fromFn).toHaveBeenCalledTimes(1);
    expect(fromFn).toHaveBeenCalledWith("notifications");
  });

  it("PAIR-FILTER PROOF: .or() pairs task_id with its own actor_id — no cross-product", async () => {
    const rowA = baseRow({ id: "n1", type: "task_mention", task_id: TASK_ID, actor: { id: ACTOR_ID, full_name: "Amy" } });
    const rowB = baseRow({ id: "n2", type: "task_mention", task_id: TASK_ID_2, actor: { id: ACTOR_ID_2, full_name: "Bo" } });
    const { ctx, mentionChain } = makeCtx({ notificationRows: [rowA, rowB], mentionRows: [] });

    await listNotifications(ctx, listNotificationsSchema.parse({}));

    const orArg = (mentionChain.__calls.or?.[0]?.[0] as string) ?? "";
    const expectedFilter = [
      `and(task_id.eq.${TASK_ID},author_id.eq.${ACTOR_ID})`,
      `and(task_id.eq.${TASK_ID_2},author_id.eq.${ACTOR_ID_2})`,
    ].join(",");

    expect(orArg).toBe(expectedFilter);
    // A naive .in()x.in() cross-product string would look like this instead —
    // assert we did NOT produce that (would wrongly match task A x actor 2).
    expect(orArg).not.toContain(`task_id.in.(${TASK_ID},${TASK_ID_2})`);
    expect(orArg).not.toContain(`and(task_id.eq.${TASK_ID},author_id.eq.${ACTOR_ID_2})`);
    expect(orArg).not.toContain(`and(task_id.eq.${TASK_ID_2},author_id.eq.${ACTOR_ID})`);
  });

  it("dedupes identical (task_id, actor_id) pairs across multiple notifications into one filter entry", async () => {
    const rowA = baseRow({ id: "n1", type: "task_mention", task_id: TASK_ID, actor: { id: ACTOR_ID, full_name: "Amy" } });
    const rowB = baseRow({ id: "n2", type: "task_mention", task_id: TASK_ID, actor: { id: ACTOR_ID, full_name: "Amy" } });
    const { ctx, mentionChain } = makeCtx({ notificationRows: [rowA, rowB], mentionRows: [] });

    await listNotifications(ctx, listNotificationsSchema.parse({}));

    const orArg = (mentionChain.__calls.or?.[0]?.[0] as string) ?? "";
    expect(orArg).toBe(`and(task_id.eq.${TASK_ID},author_id.eq.${ACTOR_ID})`);
  });

  it("≤2 total queries regardless of how many notifications/mentions are present", async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      baseRow({ id: `n${i}`, type: "task_mention", task_id: TASK_ID, actor: { id: ACTOR_ID, full_name: "Amy" } })
    );
    const { ctx, fromFn } = makeCtx({ notificationRows: rows, mentionRows: [] });

    await listNotifications(ctx, listNotificationsSchema.parse({}));

    expect(fromFn).toHaveBeenCalledTimes(2);
  });
});
