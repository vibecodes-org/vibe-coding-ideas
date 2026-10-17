// Card 6b2cb8ac: once the helper has resolved the project folder on a Mac it
// records it here — for THAT Mac only, under every name the Mac reports —
// and sets the session's folder. Real signed bridge tokens, like the
// workspace route's tests.
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastFake: any = null;

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

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST } from "./route";

const future = () => new Date(Date.now() + 3_600_000).toISOString();

async function bridgeToken(sub = OWNER) {
  const t = await mintSessionTokens({ sub, idea: IDEA, sid: SID, secret: SECRET });
  return t.bridge;
}

function req(body: unknown) {
  return new Request("http://localhost/api/terminal/session/folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setTables(opts: { row?: unknown; existing?: unknown[]; upsertError?: unknown } = {}) {
  state.tables = {
    terminal_sessions: (call) =>
      call.op === "update"
        ? { data: null, error: null }
        : {
            data:
              opts.row === undefined
                ? { user_id: OWNER, idea_id: IDEA, status: "active", expires_at: future() }
                : opts.row,
            error: null,
          },
    idea_project_paths: (call) =>
      call.op === "upsert"
        ? { data: null, error: (opts.upsertError as { message: string }) ?? null }
        : { data: opts.existing ?? [], error: null },
  };
}

beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  setTables();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const names = ["Nicks-Mac-mini.local", "Nicks-Mac-mini"];

describe("POST /api/terminal/session/folder", () => {
  it("records the folder under every name this Mac reports and sets the session's folder", async () => {
    const res = await POST(
      req({ sid: SID, token: await bridgeToken(), machineNames: names, path: "/Users/n/vibe-coding-ideas", how: "found" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, path: "/Users/n/vibe-coding-ideas" });

    const [upsert] = lastFake.writesTo("idea_project_paths", "upsert");
    expect(upsert.payload).toEqual([
      expect.objectContaining({ idea_id: IDEA, owner_user_id: OWNER, hostname: "Nicks-Mac-mini.local", absolute_path: "/Users/n/vibe-coding-ideas" }),
      expect.objectContaining({ idea_id: IDEA, owner_user_id: OWNER, hostname: "Nicks-Mac-mini", absolute_path: "/Users/n/vibe-coding-ideas" }),
    ]);
    expect(upsert.payload[0]).toHaveProperty("updated_at");

    const [update] = lastFake.writesTo("terminal_sessions", "update");
    expect(update.payload).toEqual({ cwd: "/Users/n/vibe-coding-ideas" });
    expect(update.filters).toContainEqual(["eq", ["sid", SID]]);
  });

  it("reuses an existing row's spelling of a name, so a case change never makes a duplicate", async () => {
    setTables({ existing: [{ hostname: "nicks-mac-mini.local" }] });
    await POST(req({ sid: SID, token: await bridgeToken(), machineNames: names, path: "/Users/n/p", how: "saved" }));
    const [upsert] = lastFake.writesTo("idea_project_paths", "upsert");
    expect(upsert.payload.map((r: { hostname: string }) => r.hostname)).toEqual(["nicks-mac-mini.local", "Nicks-Mac-mini"]);
  });

  it("strips a worktree suffix before recording", async () => {
    const body = await (
      await POST(
        req({ sid: SID, token: await bridgeToken(), machineNames: names, path: "/Users/n/p/.claude/worktrees/x", how: "saved" }),
      )
    ).json();
    expect(body.path).toBe("/Users/n/p");
  });

  it.each(["/", "/Users", "/Users/n", "/tmp", "relative/p", "~/p"])("refuses %j", async (path) => {
    const res = await POST(req({ sid: SID, token: await bridgeToken(), machineNames: names, path, how: "found" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not-a-project-folder" });
    expect(lastFake.writesTo("idea_project_paths", "upsert")).toHaveLength(0);
  });

  it("401s a bad token or another owner's token, and writes nothing", async () => {
    expect((await POST(req({ sid: SID, token: "nope", machineNames: names, path: "/Users/n/p", how: "found" }))).status).toBe(401);
    expect(
      (await POST(req({ sid: SID, token: await bridgeToken("someone-else"), machineNames: names, path: "/Users/n/p", how: "found" })))
        .status,
    ).toBe(401);
    expect(lastFake.writesTo("idea_project_paths", "upsert")).toHaveLength(0);
  });

  it("an ended session records nothing (409)", async () => {
    setTables({ row: { user_id: OWNER, idea_id: IDEA, status: "ended", expires_at: future() } });
    const res = await POST(req({ sid: SID, token: await bridgeToken(), machineNames: names, path: "/Users/n/p", how: "found" }));
    expect(res.status).toBe(409);
    expect(lastFake.writesTo("idea_project_paths", "upsert")).toHaveLength(0);
  });

  it("400s an unknown `how` or an over-long path", async () => {
    const token = await bridgeToken();
    expect((await POST(req({ sid: SID, token, machineNames: names, path: "/Users/n/p", how: "guessed" }))).status).toBe(400);
    expect((await POST(req({ sid: SID, token, machineNames: names, path: "/Users/n/" + "a".repeat(1100), how: "found" }))).status).toBe(400);
  });

  it("500s when the folder record can't be written", async () => {
    setTables({ upsertError: { message: "boom" } });
    const res = await POST(req({ sid: SID, token: await bridgeToken(), machineNames: names, path: "/Users/n/p", how: "cloned" }));
    expect(res.status).toBe(500);
  });
});
