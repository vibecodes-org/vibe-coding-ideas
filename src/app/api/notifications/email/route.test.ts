// The notification-email route is the seam that previously shipped a real
// defect: selectSnippetSource() was unit-tested thoroughly, but nothing
// tested that the ROUTE derives its inputs correctly from the notification
// row — which table it queries for a given type, and whether hasCommentId/
// hasReplyId are set from the row rather than assumed. That is exactly where
// discussion_reply notifications ended up quoting the idea description: the
// route fetched it and handed it in even though nothing about the type
// should have used it.
//
// These tests exercise the route end-to-end (POST -> Resend payload) with a
// fake Supabase client, asserting on the actual snippet source AND on which
// table/id the route queried — not just that some snippet came out right.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFrom, calls } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}));

type TableRow = Record<string, unknown> | null;

function makeChain(table: string, row: TableRow) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["select", "eq", "maybeSingle"]) {
    chain[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve({ data: row, error: null }).then(resolve, reject);
  return chain;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: (...args: unknown[]) => mockFrom(...args) }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST } from "./route";

function req(record: Record<string, unknown>) {
  return new Request("http://localhost/api/notifications/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-secret" },
    body: JSON.stringify({ record }),
  });
}

const baseNotification = {
  id: "notif-1",
  user_id: "user-1",
  actor_id: "actor-1",
  idea_id: "idea-1",
  comment_id: null,
  task_comment_id: null,
  task_id: null,
  discussion_id: null,
  reply_id: null,
};

const recipientRow = {
  email: "recipient@example.com",
  full_name: "Rec Ipient",
  notification_preferences: { email_notifications: true },
  is_bot: false,
};

const actorRow = { full_name: "Actor Name", email: "actor@example.com" };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("NOTIFICATION_WEBHOOK_SECRET", "test-secret");
  vi.stubEnv("RESEND_API_KEY", "resend-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  calls.length = 0;
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "resend-id" }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function sentPayload() {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("api.resend.com"));
  expect(call).toBeDefined();
  return JSON.parse((call![1] as RequestInit).body as string) as { subject: string; html: string };
}

describe("POST /api/notifications/email — snippet source seam", () => {
  it("task_mention WITH a task_comment_id: queries board_task_comments (not comments) and quotes it", async () => {
    mockFrom.mockImplementation((table: string) => {
      const fixtures: Record<string, TableRow> = {
        users: { ...recipientRow, ...actorRow },
        ideas: { title: "Idea Title", description: "idea desc — must not appear" },
        board_tasks: { title: "Task Title", description: "task desc — must not appear" },
        board_task_comments: { content: "the real task comment" },
        comments: { content: "WRONG TABLE — idea comment body" },
      };
      return makeChain(table, fixtures[table] ?? null);
    });

    const res = await POST(
      req({ ...baseNotification, type: "task_mention", task_id: "task-1", task_comment_id: "tc-1" })
    );
    expect(res.status).toBe(200);

    const commentTableCalls = calls.filter((c) => c.table === "board_task_comments");
    expect(commentTableCalls.length).toBeGreaterThan(0);
    const wrongTableCalls = calls.filter((c) => c.table === "comments");
    expect(wrongTableCalls.length).toBe(0);

    const payload = sentPayload();
    expect(payload.html).toContain("the real task comment");
    expect(payload.html).not.toContain("task desc");
    expect(payload.html).not.toContain("idea desc");
  });

  it("task_mention WITH only comment_id set (never happens today, but must not be trusted): still degrades to the description branch", async () => {
    // Regression guard for the exact defect this rework fixes: comment_id is
    // FK'd to `comments`, not `board_task_comments` — the route must key off
    // task_comment_id for this type, never comment_id.
    mockFrom.mockImplementation((table: string) => {
      const fixtures: Record<string, TableRow> = {
        users: { ...recipientRow, ...actorRow },
        ideas: { title: "Idea Title", description: "idea desc — must not appear" },
        board_tasks: { title: "Task Title", description: "updated scope to include mobile" },
        comments: { content: "WRONG — must never be queried for task_mention" },
      };
      return makeChain(table, fixtures[table] ?? null);
    });

    const res = await POST(
      req({ ...baseNotification, type: "task_mention", task_id: "task-1", comment_id: "c-1", task_comment_id: null })
    );
    expect(res.status).toBe(200);

    expect(calls.some((c) => c.table === "comments")).toBe(false);
    const payload = sentPayload();
    expect(payload.html).toContain("updated scope to include mobile");
    expect(payload.html).not.toContain("WRONG");
  });

  it("task_mention WITHOUT a task_comment_id (description-edit mention, or an unresolvable step-comment mention): quotes the task description, not idea description", async () => {
    mockFrom.mockImplementation((table: string) => {
      const fixtures: Record<string, TableRow> = {
        users: { ...recipientRow, ...actorRow },
        ideas: { title: "Idea Title", description: "idea desc — must not appear" },
        board_tasks: { title: "Task Title", description: "updated scope to include mobile" },
      };
      return makeChain(table, fixtures[table] ?? null);
    });

    const res = await POST(
      req({ ...baseNotification, type: "task_mention", task_id: "task-1", task_comment_id: null })
    );
    expect(res.status).toBe(200);

    // Must never query board_task_comments/comments when there is no task_comment_id.
    expect(calls.some((c) => c.table === "board_task_comments")).toBe(false);
    expect(calls.some((c) => c.table === "comments")).toBe(false);

    const payload = sentPayload();
    expect(payload.html).toContain("updated scope to include mobile");
    expect(payload.html).toContain("in the description of");
    expect(payload.html).not.toContain("idea desc");
  });

  it("discussion_reply: renders no quote even though the idea description is fetchable — the historical defect", async () => {
    mockFrom.mockImplementation((table: string) => {
      const fixtures: Record<string, TableRow> = {
        users: { ...recipientRow, ...actorRow },
        ideas: { title: "Idea Title", description: "THIS MUST NEVER APPEAR AS A REPLY" },
      };
      return makeChain(table, fixtures[table] ?? null);
    });

    const res = await POST(
      req({ ...baseNotification, type: "discussion_reply", discussion_id: "disc-1" })
    );
    expect(res.status).toBe(200);

    const payload = sentPayload();
    expect(payload.html).not.toContain("THIS MUST NEVER APPEAR AS A REPLY");
    expect(payload.html).not.toContain("<blockquote");
  });

  it("discussion_mention WITH a reply_id: queries idea_discussion_replies and quotes the reply, not the discussion post", async () => {
    mockFrom.mockImplementation((table: string) => {
      const fixtures: Record<string, TableRow> = {
        users: { ...recipientRow, ...actorRow },
        ideas: { title: "Idea Title", description: "idea desc" },
        idea_discussion_replies: { content: "the actual reply text" },
        idea_discussions: { body: "the discussion post body — must not appear" },
      };
      return makeChain(table, fixtures[table] ?? null);
    });

    const res = await POST(
      req({
        ...baseNotification,
        type: "discussion_mention",
        discussion_id: "disc-1",
        reply_id: "reply-1",
      })
    );
    expect(res.status).toBe(200);

    const payload = sentPayload();
    expect(payload.html).toContain("the actual reply text");
    expect(payload.html).not.toContain("discussion post body");
  });

  it("discussion_mention WITHOUT a reply_id (mentioned in the post): queries idea_discussions.body and quotes it", async () => {
    mockFrom.mockImplementation((table: string) => {
      const fixtures: Record<string, TableRow> = {
        users: { ...recipientRow, ...actorRow },
        ideas: { title: "Idea Title", description: "idea desc" },
        idea_discussions: { body: "mentioned right in the post" },
      };
      return makeChain(table, fixtures[table] ?? null);
    });

    const res = await POST(
      req({
        ...baseNotification,
        type: "discussion_mention",
        discussion_id: "disc-1",
        reply_id: null,
      })
    );
    expect(res.status).toBe(200);

    expect(calls.some((c) => c.table === "idea_discussion_replies")).toBe(false);
    const payload = sentPayload();
    expect(payload.html).toContain("mentioned right in the post");
  });

  it("status_change: never quotes the idea description, and states the new status fetched from the idea row", async () => {
    mockFrom.mockImplementation((table: string) => {
      const fixtures: Record<string, TableRow> = {
        users: { ...recipientRow, ...actorRow },
        ideas: { title: "Idea Title", status: "in_progress" },
      };
      return makeChain(table, fixtures[table] ?? null);
    });

    const res = await POST(req({ ...baseNotification, type: "status_change" }));
    expect(res.status).toBe(200);

    const payload = sentPayload();
    expect(payload.html).not.toContain("<blockquote");
    expect(payload.html).toContain("has been updated to");
    expect(payload.html).toContain("In Progress");
    // Subject truncates the idea title like every other type now.
    expect(payload.subject).toBe('Status updated: "Idea Title"');
  });

  it("status_change: degrades to the plain sentence when the idea's status can't be resolved", async () => {
    mockFrom.mockImplementation((table: string) => {
      const fixtures: Record<string, TableRow> = {
        users: { ...recipientRow, ...actorRow },
        ideas: null,
      };
      return makeChain(table, fixtures[table] ?? null);
    });

    const res = await POST(req({ ...baseNotification, type: "status_change" }));
    expect(res.status).toBe(200);

    const payload = sentPayload();
    expect(payload.html).toContain("has been updated.");
    expect(payload.html).not.toContain("has been updated to");
  });

  it("discussion_reply: names the discussion in the subject, fetched from idea_discussions.title", async () => {
    mockFrom.mockImplementation((table: string) => {
      const fixtures: Record<string, TableRow> = {
        users: { ...recipientRow, ...actorRow },
        ideas: { title: "Idea Title", status: "open" },
        idea_discussions: { title: "Should we support dark mode?", body: "must not appear" },
      };
      return makeChain(table, fixtures[table] ?? null);
    });

    const res = await POST(
      req({ ...baseNotification, type: "discussion_reply", discussion_id: "disc-1" })
    );
    expect(res.status).toBe(200);

    const payload = sentPayload();
    expect(payload.subject).toBe(
      'Actor Name replied to "Should we support dark mode?" (Idea Title)'
    );
    expect(payload.html).not.toContain("must not appear");
  });

  it("task_mention: a notification row shaped the way the MCP server creates it (task_comment_id set on a real task comment) quotes the comment, not the description", async () => {
    // This mirrors exactly what mcp-server/src/lib/mention-notify.ts inserts
    // for add_task_comment after this rework: type "task_mention" with a
    // real task_comment_id. Before this rework, the MCP server (and the web
    // composer) wrote board_task_comments.id into comment_id — which is
    // FK'd to `comments`, not `board_task_comments`, so the insert was
    // rejected outright on a real database and NO notification row (let
    // alone an email) was ever created. This fixture is what a genuine,
    // successfully-inserted task-comment mention looks like now.
    mockFrom.mockImplementation((table: string) => {
      const fixtures: Record<string, TableRow> = {
        users: { ...recipientRow, ...actorRow },
        ideas: { title: "Idea Title", status: "open" },
        board_tasks: { title: "Task Title", description: "must not appear — not the trigger" },
        board_task_comments: { content: "great work, one nit: rename the prop" },
      };
      return makeChain(table, fixtures[table] ?? null);
    });

    const res = await POST(
      req({
        ...baseNotification,
        type: "task_mention",
        task_id: "task-1",
        task_comment_id: "mcp-comment-1",
      })
    );
    expect(res.status).toBe(200);

    const payload = sentPayload();
    expect(payload.html).toContain("great work, one nit: rename the prop");
    expect(payload.html).toContain("mentioned you in a comment on");
    expect(payload.html).not.toContain("mentioned you in the description of");
    expect(payload.html).not.toContain("must not appear");
  });

  it("comment: queries the comments table by comment_id, never board_task_comments", async () => {
    mockFrom.mockImplementation((table: string) => {
      const fixtures: Record<string, TableRow> = {
        users: { ...recipientRow, ...actorRow },
        ideas: { title: "Idea Title", description: "idea desc" },
        comments: { content: "a real idea comment" },
      };
      return makeChain(table, fixtures[table] ?? null);
    });

    const res = await POST(req({ ...baseNotification, type: "comment", comment_id: "c-1" }));
    expect(res.status).toBe(200);

    expect(calls.some((c) => c.table === "board_task_comments")).toBe(false);
    const payload = sentPayload();
    expect(payload.html).toContain("a real idea comment");
  });

  it("subject line is plain text (not HTML-escaped) end to end through the route", async () => {
    mockFrom.mockImplementation((table: string) => {
      const fixtures: Record<string, TableRow> = {
        users: { ...recipientRow, ...actorRow },
        ideas: { title: `Tom & Jerry's "Big" Idea`, description: "idea desc" },
      };
      return makeChain(table, fixtures[table] ?? null);
    });

    const res = await POST(req({ ...baseNotification, type: "comment" }));
    expect(res.status).toBe(200);

    const payload = sentPayload();
    expect(payload.subject).toContain(`Tom & Jerry's "Big" Idea`);
    expect(payload.subject).not.toContain("&amp;");
  });
});

// The trigger hand-picked which columns it sent, so every column added to
// `notifications` after it was written arrived here as undefined and the email
// rendered as though that id did not exist — which is how the task_mention fix
// shipped inert. The trigger now sends the whole row, and the route re-reads
// the row anyway. These tests pin the re-read: without it the first one renders
// the task description and mislabels a comment as a description edit.
describe("POST /api/notifications/email — re-reads the row, does not trust the payload", () => {
  it("uses ids present on the row but missing from the payload", async () => {
    mockFrom.mockImplementation((table: string) => {
      const fixtures: Record<string, TableRow> = {
        // What the old trigger would have sent: task_comment_id dropped.
        notifications: {
          ...baseNotification,
          type: "task_mention",
          task_id: "task-1",
          task_comment_id: "tc-1",
        },
        users: { ...recipientRow, ...actorRow },
        ideas: { title: "Idea Title", description: "idea desc" },
        board_tasks: { title: "Task Title", description: "task desc — must not appear" },
        board_task_comments: { content: "the real task comment" },
      };
      return makeChain(table, fixtures[table] ?? null);
    });

    const res = await POST(
      // Payload deliberately omits task_comment_id, exactly as the old trigger sent it.
      req({ ...baseNotification, type: "task_mention", task_id: "task-1" })
    );
    expect(res.status).toBe(200);

    expect(calls.some((c) => c.table === "notifications")).toBe(true);

    const payload = sentPayload();
    expect(payload.html).toContain("the real task comment");
    expect(payload.html).not.toContain("task desc");
    expect(payload.html).not.toContain("the description of");
  });

  it("falls back to the payload when the row has already been deleted", async () => {
    mockFrom.mockImplementation((table: string) => {
      const fixtures: Record<string, TableRow> = {
        notifications: null, // row gone between insert and delivery
        users: { ...recipientRow, ...actorRow },
        ideas: { title: "Idea Title", description: "idea desc" },
        comments: { content: "a real idea comment" },
      };
      return makeChain(table, fixtures[table] ?? null);
    });

    const res = await POST(req({ ...baseNotification, type: "comment", comment_id: "c-1" }));
    expect(res.status).toBe(200);
    expect(sentPayload().html).toContain("a real idea comment");
  });
});
