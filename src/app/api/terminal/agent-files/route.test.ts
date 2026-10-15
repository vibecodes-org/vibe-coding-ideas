// The agent-files download (card 7939ee17): token-gated, membership-checked,
// and its tar holds only vc-*.md files.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mintAgentFilesToken } from "@/lib/agent-files-token";

const NOW_ISO = "2026-10-14T12:00:00.000Z";
const NOW = Math.floor(Date.parse(NOW_ISO) / 1000);
const SECRET = "test-secret";
const USER = "user-1";
const IDEA = "idea-1";
const ATLAS = { id: "37e8ffb2-3f88-49e5-9ab4-a516c1088f77", name: "Atlas", role: "Full Stack Engineer", system_prompt: "## Goal\nShip it." };

const { tables } = vi.hoisted(() => ({
  tables: {} as Record<string, { data: unknown; error?: unknown }>,
}));

function makeChain(result: { data: unknown; error?: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["select", "eq", "in", "not", "limit", "order", "range", "maybeSingle"]) chain[m] = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve({ error: null, ...result }).then(resolve, reject);
  return chain;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: (table: string) => makeChain(tables[table] ?? { data: null }) }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { GET } from "./route";

function get(token: string | null) {
  const url = new URL("http://localhost/api/terminal/agent-files");
  if (token !== null) url.searchParams.set("t", token);
  return GET(new Request(url));
}
const goodToken = () => mintAgentFilesToken({ sub: USER, idea: IDEA }, SECRET, NOW);

beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
  for (const key of Object.keys(tables)) delete tables[key];
  tables.ideas = { data: { id: IDEA } };
  tables.collaborators = { data: null };
  tables.task_workflow_steps = { data: [{ bot_id: ATLAS.id, model_tier: "frontier" }] };
  tables.bot_profiles = { data: [ATLAS] };
  tables.agent_skills = { data: [] };
  tables.users = { data: { model_tier_map: null } };
  tables.platform_settings = { data: null };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("GET /api/terminal/agent-files", () => {
  it("answers 200 with a tar of only vc-*.md files, never cached", async () => {
    const res = await get(goodToken());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-tar");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = Buffer.from(await res.arrayBuffer());
    const listing = spawnSync("tar", ["-tf", "-"], { input: body, encoding: "utf8" });
    expect(listing.stdout.trim().split("\n")).toEqual(["vc-atlas-37e8ffb2-frontier.md"]);
  });

  it("lets a collaborator who isn't the author download", async () => {
    tables.ideas = { data: null };
    tables.collaborators = { data: { user_id: USER } };
    expect((await get(goodToken())).status).toBe(200);
  });

  it("answers 401 for a missing, tampered, expired, raw-secret-signed or wrong-purpose token", async () => {
    const [payload, sig] = goodToken().split(".");
    const tampered = `${Buffer.from(JSON.stringify({ sub: "someone-else", idea: IDEA, purpose: "agent-files", iat: NOW, exp: NOW + 300 })).toString("base64url")}.${sig}`;
    const expired = mintAgentFilesToken({ sub: USER, idea: IDEA }, SECRET, NOW - 400);
    const otherSecret = mintAgentFilesToken({ sub: USER, idea: IDEA }, "another", NOW);
    for (const t of [null, "", "garbage", tampered, expired, otherSecret, `${payload}.`]) {
      expect((await get(t)).status).toBe(401);
    }
  });

  it("answers 403 for a user who has left the board", async () => {
    tables.ideas = { data: null };
    tables.collaborators = { data: null };
    expect((await get(goodToken())).status).toBe(403);
  });

  it("answers 204 when the board has nothing to define", async () => {
    tables.task_workflow_steps = { data: [] };
    const res = await get(goodToken());
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 503 when the signing secret is blank", async () => {
    vi.stubEnv("TERMINAL_SESSION_SECRET", "  ");
    expect((await get(goodToken())).status).toBe(503);
  });
});
