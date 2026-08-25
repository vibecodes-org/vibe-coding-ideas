// Cross-board resume fix (bug 62e57071, Sentinel's investigation): the mint
// route is the SERVER backstop for the same bug the client-side chooser/
// task-choice fixes close — `terminal_sessions.task_id` carries no FK to
// `idea_id` (see the 00141_terminal_sessions migration), so nothing at the
// DB layer stops a client from minting a session that claims a task from one
// board while registering it under a different idea_id. These tests cover
// only the NEW task/idea guard this card adds — the route's pre-existing
// auth/cap/rate-limit/budget behaviour is unchanged and untested here.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// BodySchema requires ideaId/taskId to be real (RFC4122-variant) UUIDs
// (z.string().uuid()) — plain slugs like "idea-1", or an all-same-digit
// string, fail validation before the guard under test ever runs.
const { NOW_ISO, IDEA_1, IDEA_OTHER, TASK_ID } = vi.hoisted(() => ({
  NOW_ISO: "2026-08-19T12:00:00.000Z",
  IDEA_1: "faed9703-f223-4a32-8f3b-1aee2f2ddefd",
  IDEA_OTHER: "2100fcf5-6d9b-4d4f-a53d-7fcf9f70d16a",
  TASK_ID: "3d75a431-bc13-4f03-ae38-f90bb759e56b",
}));

// One configurable chain per table name — every chain method returns the
// SAME chain object, which is itself thenable (resolves to that table's
// configured `result` no matter which method the route happened to call
// last), mirroring oauth.test.ts's makeChain pattern in this repo.
function makeChain(result: { data?: unknown; error?: unknown; count?: number | null } = { data: null, error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const methods = ["select", "insert", "eq", "gte", "order", "limit", "maybeSingle"];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const { mockFrom, mockGetUser, tableResults, insertSpy } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockGetUser = vi.fn();
  const tableResults: Record<string, { data?: unknown; error?: unknown; count?: number | null }> = {};
  const insertSpy = vi.fn();
  return { mockFrom, mockGetUser, tableResults, insertSpy };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: () => mockGetUser() },
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Reap is exercised elsewhere (session-reap.test.ts) — stub it to "nothing to
// reap" so the cap/rate-limit reads below see a clean 0 active count.
vi.mock("@/lib/terminal/session-reap", () => ({
  reapExpiredSessions: vi.fn().mockResolvedValue({ activeBefore: 0, reapedIds: [] }),
}));

vi.mock("../../../../../terminal/shared/session-token.mjs", () => ({
  mintSessionTokens: vi.fn().mockResolvedValue({
    sid: "sid-minted-1",
    idea: IDEA_1,
    exp: Date.parse(NOW_ISO) + 60_000,
    browser: "browser-tok",
    bridge: "bridge-tok",
  }),
  mintHelperToken: vi.fn().mockResolvedValue("helper-tok"),
}));

import { POST } from "./route";
import { logger } from "@/lib/logger";
import { MACHINE_DEFAULT_TERMINAL_MODEL } from "@/lib/terminal/model-resolution";

function req(body: unknown) {
  return new Request("http://localhost/api/terminal/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", "test-secret");
  vi.setSystemTime(new Date(NOW_ISO));
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  for (const key of Object.keys(tableResults)) delete tableResults[key];
  tableResults.ideas = { data: { id: IDEA_1, author_id: "user-1" }, error: null };
  tableResults.collaborators = { data: null, error: null };
  tableResults.board_tasks = { data: null, error: null }; // "no such task" by default
  // terminal_sessions backs the daily-budget read, the rate-limit read, AND
  // the final insert — all three only ever read `.count`/`.error`, so one
  // shared shape (0 rows so far, insert succeeds) covers every call.
  tableResults.terminal_sessions = { data: null, error: null, count: 0 };
  mockFrom.mockImplementation((table: string) => {
    if (table === "terminal_sessions") {
      // Distinguish the insert (asserted on separately) from the read-only
      // count queries, without changing what either resolves to.
      const chain = makeChain(tableResults.terminal_sessions);
      const realInsert = chain.insert;
      chain.insert = (...args: unknown[]) => {
        insertSpy(...args);
        return realInsert(...args);
      };
      return chain;
    }
    return makeChain(tableResults[table] ?? { data: null, error: null });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("POST /api/terminal/session — task/idea correctness guard (bug 62e57071)", () => {
  it("rejects a task_id that resolves to a DIFFERENT idea_id than the mint is targeting", async () => {
    tableResults.board_tasks = { data: { id: "task-1", idea_id: IDEA_OTHER }, error: null };

    const res = await POST(req({ ideaId: IDEA_1, taskId: TASK_ID }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/doesn't belong to this board/);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Terminal session mint refused: task belongs to a different board",
      expect.objectContaining({ ideaId: IDEA_1, taskIdeaId: IDEA_OTHER }),
    );
  });

  it("accepts a task_id that resolves to the SAME idea_id as the mint", async () => {
    tableResults.board_tasks = { data: { id: "task-1", idea_id: IDEA_1 }, error: null };

    const res = await POST(req({ ideaId: IDEA_1, taskId: TASK_ID }));

    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ idea_id: IDEA_1, task_id: TASK_ID }),
    );
  });

  it("accepts a task_id that resolves to NO row at all — no FK exists, so a task deleted between page load and this click is a benign race, not a boundary this guard polices", async () => {
    tableResults.board_tasks = { data: null, error: null };

    const res = await POST(req({ ideaId: IDEA_1, taskId: TASK_ID }));

    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalled();
  });

  it("accepts a board-level launch with NO task_id at all — the guard only ever runs when a task_id is present", async () => {
    const res = await POST(req({ ideaId: IDEA_1 }));

    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ idea_id: IDEA_1, task_id: null }));
  });

  it("fails open (mints anyway, logs an error) when the task lookup read itself errors — a transient read failure must never block a legitimate mint", async () => {
    tableResults.board_tasks = { data: null, error: { message: "connection reset" } };

    const res = await POST(req({ ideaId: IDEA_1, taskId: TASK_ID }));

    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Terminal session mint: task lookup failed",
      expect.objectContaining({ error: "connection reset" }),
    );
  });
});

describe("POST /api/terminal/session — effective terminal model resolution (task c4ca2d95)", () => {
  it("omits model entirely when neither a user override nor a platform default is set", async () => {
    const res = await POST(req({ ideaId: IDEA_1 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty("model");
  });

  it("resolves to the platform default when the user has no override", async () => {
    tableResults.platform_settings = { data: { value: { model: "opus" } }, error: null };

    const res = await POST(req({ ideaId: IDEA_1 }));
    const body = await res.json();
    expect(body.model).toBe("opus");
  });

  it("resolves to the user's own override, beating the platform default", async () => {
    tableResults.users = { data: { terminal_model: "sonnet" }, error: null };
    tableResults.platform_settings = { data: { value: { model: "opus" } }, error: null };

    const res = await POST(req({ ideaId: IDEA_1 }));
    const body = await res.json();
    expect(body.model).toBe("sonnet");
  });

  it("omits model when the user opted into their machine's default, even with a platform default set (AC-5)", async () => {
    tableResults.users = { data: { terminal_model: MACHINE_DEFAULT_TERMINAL_MODEL }, error: null };
    tableResults.platform_settings = { data: { value: { model: "opus" } }, error: null };

    const res = await POST(req({ ideaId: IDEA_1 }));
    const body = await res.json();
    expect(body).not.toHaveProperty("model");
  });

  it("degrades to omitting the model (never blocks the mint) when reading the user's row errors", async () => {
    tableResults.users = { data: null, error: { message: "connection reset" } };
    tableResults.platform_settings = { data: { value: { model: "opus" } }, error: null };

    const res = await POST(req({ ideaId: IDEA_1 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    // Falls back to "no user override" -> resolves to the platform default,
    // rather than blocking or failing the mint.
    expect(body.model).toBe("opus");
    expect(logger.warn).toHaveBeenCalledWith(
      "Terminal session mint: failed to read terminal_model/terminal_auto_accept — omitting user overrides",
      expect.objectContaining({ error: "connection reset" }),
    );
  });
});

describe("POST /api/terminal/session — effective auto-accept resolution (task d3de150c)", () => {
  it("omits permissionMode entirely when the user's preference is off (default)", async () => {
    const res = await POST(req({ ideaId: IDEA_1 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty("permissionMode");
  });

  it("resolves to the literal 'auto' when the user's own preference is on", async () => {
    tableResults.users = { data: { terminal_model: null, terminal_auto_accept: true }, error: null };

    const res = await POST(req({ ideaId: IDEA_1 }));
    const body = await res.json();
    expect(body.permissionMode).toBe("auto");
  });

  it("has no platform-wide default input — a platform_settings row never turns this on by itself", async () => {
    tableResults.platform_settings = { data: { value: { permissionMode: "auto" } }, error: null };

    const res = await POST(req({ ideaId: IDEA_1 }));
    const body = await res.json();
    expect(body).not.toHaveProperty("permissionMode");
  });

  it("degrades to omitting permissionMode (never blocks the mint) when reading the user's row errors", async () => {
    tableResults.users = { data: null, error: { message: "connection reset" } };

    const res = await POST(req({ ideaId: IDEA_1 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty("permissionMode");
  });
});

// Card 0301fe8e (Nick, 2026-08-25): the SAME claude conversation resumed
// twice at once. The mint route is the server backstop — a resume whose
// conversation this user already has a LIVE row on is refused, and a
// permitted resume stamps its conversation id onto the new row at insert
// time (closing the window in which the row carried null until the bridge
// announced it).
describe("POST /api/terminal/session — duplicate-conversation guard (card 0301fe8e)", () => {
  const CONV = "5a22fd93-0aad-4872-a28f-61c90ff7f25b";

  it("refuses a resume whose conversation is already live — 409 conversation_live, naming the live session, and mints NOTHING", async () => {
    tableResults.terminal_sessions = { data: { sid: "live-1", idea_id: IDEA_1 }, error: null, count: 0 };
    const res = await POST(req({ ideaId: IDEA_1, resumeId: CONV }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("conversation_live");
    expect(body.liveSid).toBe("live-1");
    expect(body.liveIdeaId).toBe(IDEA_1);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Terminal session mint refused: conversation already live",
      expect.objectContaining({ resumeId: CONV, liveSid: "live-1" }),
    );
  });

  it("mints when no live row matches, stamping claude_session_id from resumeId at insert time", async () => {
    const res = await POST(req({ ideaId: IDEA_1, resumeId: CONV }));
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ claude_session_id: CONV }));
  });

  it("a fresh (non-resume) mint never runs the guard — a live row is irrelevant — and inserts claude_session_id null", async () => {
    tableResults.terminal_sessions = { data: { sid: "live-1", idea_id: IDEA_1 }, error: null, count: 0 };
    const res = await POST(req({ ideaId: IDEA_1 }));
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ claude_session_id: null }));
  });

  it("rejects a malformed resumeId at the schema (400) rather than passing it towards the shell", async () => {
    const res = await POST(req({ ideaId: IDEA_1, resumeId: "not-a-uuid; rm -rf /" }));
    expect(res.status).toBe(400);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("fails open (mints anyway, logs an error) when the live-conversation lookup itself errors", async () => {
    tableResults.terminal_sessions = { data: null, error: { message: "boom" }, count: 0 };
    const res = await POST(req({ ideaId: IDEA_1, resumeId: CONV }));
    expect(res.status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith(
      "Terminal session mint: live-conversation lookup failed",
      expect.objectContaining({ error: "boom", resumeId: CONV }),
    );
  });
});
