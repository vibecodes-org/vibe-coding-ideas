// The bridge's off-relay fetch of the board's agents (task 59889027). Every
// "nothing to give" case must answer { agents: null } so the bridge launches
// exactly as before; only auth failures are errors.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const NOW_ISO = "2026-10-10T12:00:00.000Z";
const SID = "sid-1";
const OWNER = "user-1";
const IDEA = "idea-1";
const ATLAS = { id: "37e8ffb2-3f88-49e5-9ab4-a516c1088f77", name: "Atlas", role: "Full Stack Engineer", system_prompt: "## Goal\nShip it." };
const LENS = { id: "87e09eb1-0c3e-4f96-9ddc-986fc10a58fd", name: "Lens", role: "Code Reviewer", system_prompt: "## Goal\nReview it." };

const { mockAuthorizeAttach, tables } = vi.hoisted(() => ({
  mockAuthorizeAttach: vi.fn(),
  tables: {} as Record<string, { data: unknown; error?: unknown }>,
}));

function makeChain(result: { data: unknown; error?: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["select", "eq", "in", "not", "limit", "order", "maybeSingle"]) chain[m] = vi.fn().mockReturnValue(chain);
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

vi.mock("../../../../../../terminal/shared/session-token.mjs", () => ({
  authorizeAttach: (...args: unknown[]) => mockAuthorizeAttach(...args),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/terminal/session/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const activeSession = {
  user_id: OWNER,
  idea_id: IDEA,
  status: "active",
  expires_at: new Date(Date.parse(NOW_ISO) + 60_000).toISOString(),
};

beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  vi.setSystemTime(new Date(NOW_ISO));
  mockAuthorizeAttach.mockResolvedValue({ ok: true, sub: OWNER });
  for (const key of Object.keys(tables)) delete tables[key];
  tables.terminal_sessions = { data: activeSession };
  tables.task_workflow_steps = {
    data: [
      { bot_id: ATLAS.id, model_tier: "frontier" },
      { bot_id: ATLAS.id, model_tier: "standard" },
      { bot_id: ATLAS.id, model_tier: "frontier" },
      { bot_id: LENS.id, model_tier: null },
    ],
  };
  tables.bot_profiles = { data: [ATLAS, LENS] };
  tables.agent_skills = { data: [{ bot_id: ATLAS.id, name: "testing", content: "Test first." }] };
  tables.users = { data: { model_tier_map: null } };
  tables.platform_settings = { data: null };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("POST /api/terminal/session/agents", () => {
  it("defines one subagent per agent + tier on the board's claimable steps", async () => {
    const res = await POST(req({ sid: SID, token: "bridge-tok" }));
    expect(res.status).toBe(200);
    const { agents } = await res.json();
    expect(Object.keys(agents).sort()).toEqual([
      "vc-atlas-37e8ffb2-frontier",
      "vc-atlas-37e8ffb2-standard",
      "vc-lens-87e09eb1",
    ]);
    // Seed platform defaults: frontier = opus/high, standard = sonnet/medium.
    expect(agents["vc-atlas-37e8ffb2-frontier"]).toMatchObject({ model: "opus", effort: "high" });
    expect(agents["vc-atlas-37e8ffb2-standard"]).toMatchObject({ model: "sonnet", effort: "medium" });
    expect(agents["vc-atlas-37e8ffb2-frontier"].prompt).toContain("### testing\nTest first.");
    expect(agents["vc-lens-87e09eb1"]).not.toHaveProperty("model");
  });

  it("honours the owner's own model choice for a tier", async () => {
    tables.users = { data: { model_tier_map: { frontier: { claude: { model: "fable", effort: "max" } } } } };
    const { agents } = await (await POST(req({ sid: SID, token: "bridge-tok" }))).json();
    expect(agents["vc-atlas-37e8ffb2-frontier"]).toMatchObject({ model: "fable", effort: "max" });
  });

  it("answers null when the board has no claimable agent steps", async () => {
    tables.task_workflow_steps = { data: [] };
    const res = await POST(req({ sid: SID, token: "bridge-tok" }));
    expect(await res.json()).toEqual({ agents: null });
  });

  it("answers null for an ended or expired session", async () => {
    tables.terminal_sessions = { data: { ...activeSession, status: "ended" } };
    expect(await (await POST(req({ sid: SID, token: "t" }))).json()).toEqual({ agents: null });
    tables.terminal_sessions = { data: { ...activeSession, expires_at: new Date(Date.parse(NOW_ISO) - 1).toISOString() } };
    expect(await (await POST(req({ sid: SID, token: "t" }))).json()).toEqual({ agents: null });
  });

  it("rejects a bad bridge token", async () => {
    mockAuthorizeAttach.mockResolvedValue({ ok: false, reason: "bad-signature" });
    const res = await POST(req({ sid: SID, token: "forged" }));
    expect(res.status).toBe(401);
  });

  it("rejects a token whose owner doesn't own the session", async () => {
    mockAuthorizeAttach.mockResolvedValue({ ok: true, sub: "someone-else" });
    const res = await POST(req({ sid: SID, token: "bridge-tok" }));
    expect(res.status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    const res = await POST(req({ sid: SID }));
    expect(res.status).toBe(400);
  });
});
