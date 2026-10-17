// Card 6b2cb8ac: the bridge asks VibeCodes where this board's project lives
// before the agent starts, so the HELPER can resolve the folder on the Mac
// (this Mac's own saved folder → search → clone → new folder). These tests
// use REAL signed bridge tokens so the auth (including the aged-token waiver
// for the row's own owner) is exercised for real.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type FakeCall, type FakeResult } from "@/test/fake-supabase";
import { mintSessionTokens } from "../../../../../../terminal/shared/session-token.mjs";

const SECRET = "test-secret";
const SID = "11111111-2222-4333-8444-555555555555";
const IDEA = "faed9703-f223-4a32-8f3b-1aee2f2ddefd";
const OWNER = "user-1";

const { state } = vi.hoisted(() => ({
  state: { tables: {} as Record<string, (call: FakeCall) => FakeResult> },
}));

vi.mock("@supabase/supabase-js", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return {
    createClient: () => {
      const fake = fakeSupabase({ tables: state.tables });
      lastFake = fake;
      return fake.client;
    },
  };
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastFake: any = null;

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST } from "./route";
import { logger } from "@/lib/logger";

const future = () => new Date(Date.now() + 3_600_000).toISOString();

async function bridgeToken(opts: { sub?: string; ageSeconds?: number } = {}) {
  const now = Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 0);
  const t = await mintSessionTokens({ sub: opts.sub ?? OWNER, idea: IDEA, sid: SID, secret: SECRET, now });
  return t.bridge;
}

function req(body: unknown) {
  return new Request("http://localhost/api/terminal/session/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sessionRow(over: Record<string, unknown> = {}) {
  return { user_id: OWNER, idea_id: IDEA, status: "active", expires_at: future(), ...over };
}

function setTables(opts: {
  row?: unknown;
  idea?: unknown;
  paths?: unknown[];
  live?: unknown[];
}) {
  state.tables = {
    terminal_sessions: (call) => {
      // The single-row lookup by sid vs. the live-sibling list.
      const bySid = call.filters.some(([f, a]) => f === "eq" && Array.isArray(a) && a[0] === "sid");
      return bySid ? { data: opts.row ?? null, error: null } : { data: opts.live ?? [], error: null };
    },
    ideas: () => ({ data: opts.idea ?? { title: "VibeCodes", github_url: "https://github.com/vibecodes-org/vibe-coding-ideas" }, error: null }),
    idea_project_paths: () => ({ data: opts.paths ?? [], error: null }),
  };
}

beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  setTables({ row: sessionRow() });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const names = ["Nicks-Mac-mini.local", "Nicks-Mac-mini"];

describe("POST /api/terminal/session/workspace", () => {
  it("returns the repo, folder names, THIS Mac's saved folders and its live-session count", async () => {
    setTables({
      row: sessionRow(),
      paths: [
        // newest first (the route orders by updated_at desc)
        { hostname: "nicks-mac-mini.local", absolute_path: "/Users/n/vibe-coding-ideas/.claude/worktrees/abc", updated_at: "2026-10-17T10:00:00Z" },
        { hostname: "Nicks-MacBook-Pro.local", absolute_path: "/Users/n/projects/vibe-coding-ideas", updated_at: "2026-10-17T09:00:00Z" },
        { hostname: "Nicks-Mac-mini", absolute_path: "/Users/n/vibe-coding-ideas", updated_at: "2026-10-16T09:00:00Z" },
        { hostname: "Nicks-Mac-mini.local", absolute_path: "/Users/n", updated_at: "2026-10-15T09:00:00Z" },
        { hostname: "Nicks-Mac-mini.local", absolute_path: "/Users/n/old/copy", updated_at: "2026-10-14T09:00:00Z" },
      ],
      live: [
        { sid: "other-1", machine_label: "Nicks-Mac-mini.local", expires_at: future() },
        { sid: "other-2", machine_label: "Nicks-MacBook-Pro.local", expires_at: future() },
        { sid: "other-3", machine_label: null, expires_at: future() },
        { sid: "other-4", machine_label: "nicks-mac-mini", expires_at: new Date(Date.now() - 1000).toISOString() },
      ],
    });

    const res = await POST(req({ sid: SID, token: await bridgeToken(), machineNames: names }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      workspace: {
        repo: {
          owner: "vibecodes-org",
          name: "vibe-coding-ideas",
          cloneUrl: "https://github.com/vibecodes-org/vibe-coding-ideas.git",
        },
        repoFolderName: "vibe-coding-ideas",
        newFolderName: "vibecodes",
        // Worktree collapsed + deduped; the MacBook's row and the home folder never appear.
        savedFolders: ["/Users/n/vibe-coding-ideas", "/Users/n/old/copy"],
        // Same-Mac row + the unlabelled one; never the MacBook's, never an expired one.
        otherLiveSessionsOnThisMac: 2,
      },
    });

    const live = lastFake.calls.find(
      (c: FakeCall) => c.table === "terminal_sessions" && c.filters.some(([f]) => f === "neq"),
    );
    expect(live.filters).toEqual(
      expect.arrayContaining([
        ["eq", ["user_id", OWNER]],
        ["eq", ["idea_id", IDEA]],
        ["eq", ["status", "active"]],
        ["neq", ["sid", SID]],
      ]),
    );
    const paths = lastFake.calls.find((c: FakeCall) => c.table === "idea_project_paths");
    expect(paths.filters).toEqual(
      expect.arrayContaining([
        ["eq", ["idea_id", IDEA]],
        ["eq", ["owner_user_id", OWNER]],
      ]),
    );
    // Metadata only: never a folder path in the log line.
    const logged = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(logged).not.toContain("/Users/");
  });

  it("a board with no GitHub repo gets repo null and the slugged new-folder name", async () => {
    setTables({ row: sessionRow(), idea: { title: "My new idea!", github_url: null } });
    const body = await (await POST(req({ sid: SID, token: await bridgeToken(), machineNames: names }))).json();
    expect(body.workspace.repo).toBeNull();
    expect(body.workspace.repoFolderName).toBeNull();
    expect(body.workspace.newFolderName).toBe("my-new-idea");
  });

  it("a GitHub address whose owner or name starts with '-' gets repo null (it could read as a command option)", async () => {
    for (const github_url of ["https://github.com/-acme/widget", "https://github.com/acme/-widget"]) {
      setTables({ row: sessionRow(), idea: { title: "Widget", github_url } });
      const body = await (await POST(req({ sid: SID, token: await bridgeToken(), machineNames: names }))).json();
      expect(body.workspace.repo, github_url).toBeNull();
      expect(body.workspace.repoFolderName, github_url).toBeNull();
    }
  });

  it("401s a bad token", async () => {
    const res = await POST(req({ sid: SID, token: "not-a-token", machineNames: names }));
    expect(res.status).toBe(401);
  });

  it("401s a token for another owner", async () => {
    const res = await POST(req({ sid: SID, token: await bridgeToken({ sub: "someone-else" }), machineNames: names }));
    expect(res.status).toBe(401);
  });

  it("an ended or expired session → workspace null", async () => {
    setTables({ row: sessionRow({ status: "ended" }) });
    expect(await (await POST(req({ sid: SID, token: await bridgeToken(), machineNames: names }))).json()).toEqual({
      workspace: null,
    });
    setTables({ row: sessionRow({ expires_at: new Date(Date.now() - 1000).toISOString() }) });
    expect(await (await POST(req({ sid: SID, token: await bridgeToken(), machineNames: names }))).json()).toEqual({
      workspace: null,
    });
  });

  it("no session row → workspace null", async () => {
    setTables({ row: null });
    expect(await (await POST(req({ sid: SID, token: await bridgeToken(), machineNames: names }))).json()).toEqual({
      workspace: null,
    });
  });

  it("an aged (expired) token is accepted only for the row's own owner, within 24h", async () => {
    const aged = await bridgeToken({ ageSeconds: 3600 });
    expect((await POST(req({ sid: SID, token: aged, machineNames: names }))).status).toBe(200);

    const agedOther = await bridgeToken({ sub: "someone-else", ageSeconds: 3600 });
    setTables({ row: sessionRow() });
    expect((await POST(req({ sid: SID, token: agedOther, machineNames: names }))).status).toBe(401);

    const ancient = await bridgeToken({ ageSeconds: 25 * 3600 });
    expect((await POST(req({ sid: SID, token: ancient, machineNames: names }))).status).toBe(401);

    // Without a row there is no owner to waive for.
    setTables({ row: null });
    expect((await POST(req({ sid: SID, token: aged, machineNames: names }))).status).toBe(401);
  });

  it("400s a malformed body (no machine names, or too many)", async () => {
    const token = await bridgeToken();
    expect((await POST(req({ sid: SID, token, machineNames: [] }))).status).toBe(400);
    expect((await POST(req({ sid: SID, token, machineNames: ["a", "b", "c", "d", "e", "f"] }))).status).toBe(400);
  });

  it("503s when the secret is unset", async () => {
    vi.stubEnv("TERMINAL_SESSION_SECRET", "");
    expect((await POST(req({ sid: SID, token: "x", machineNames: names }))).status).toBe(503);
  });
});
