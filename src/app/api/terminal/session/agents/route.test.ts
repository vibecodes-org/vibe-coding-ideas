// The bridge's off-relay fetch of the board's agents (task 59889027). Every
// "nothing to give" case must answer { agents: null } so the bridge launches
// exactly as before; only auth failures are errors.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stepUsageScript } from "@/lib/step-cost/usage-command";

const NOW_ISO = "2026-10-10T12:00:00.000Z";
const SID = "sid-1";
const OWNER = "user-1";
const IDEA = "idea-1";
const ATLAS = { id: "37e8ffb2-3f88-49e5-9ab4-a516c1088f77", name: "Atlas", role: "Full Stack Engineer", system_prompt: "## Goal\nShip it." };
const PLANNER = { id: "d799aba2-dc93-4379-8172-786dd8be0246", name: "Planner", role: "Planner", system_prompt: "## Goal\nPlan it." };
const LENS = { id: "87e09eb1-0c3e-4f96-9ddc-986fc10a58fd", name: "Lens", role: "Code Reviewer", system_prompt: "## Goal\nReview it." };

const { mockAuthorizeAttach, tables } = vi.hoisted(() => ({
  mockAuthorizeAttach: vi.fn(),
  tables: {} as Record<string, { data: unknown; error?: unknown; pages?: unknown[][] }>,
}));

function makeChain(result: { data: unknown; error?: unknown; pages?: unknown[][] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["select", "eq", "in", "not", "limit", "order", "maybeSingle"]) chain[m] = vi.fn().mockReturnValue(chain);
  // A paged read answers from `pages`, by the page the range asks for.
  chain.range = vi.fn((from: number) => {
    if (result.pages) chain.pageData = result.pages[from / 1000] ?? [];
    return chain;
  });
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve({ error: null, ...result, ...(chain.pageData ? { data: chain.pageData } : {}) }).then(resolve, reject);
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
import { sessionAgentClaimHint } from "@/lib/terminal/session-agents";

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

describe("POST /api/terminal/session/agents — step-usage script (card 5e654dd1, stage 2b)", () => {
  it("serves the script to a Claude session, exactly as the hand-off's short command expects it", async () => {
    const body = await (await POST(req({ sid: SID, token: "bridge-tok", agent: "claude" }))).json();
    expect(body.stepUsageScript).toEqual(stepUsageScript());
    expect(body.stepUsageScript.file).toMatch(/^step-usage-[0-9a-f]{8}\.sh$/);
  });

  it("does not serve it to a Codex session", async () => {
    const body = await (await POST(req({ sid: SID, token: "bridge-tok", agent: "codex" }))).json();
    expect(body).not.toHaveProperty("stepUsageScript");
  });

  it("does not serve it for an ended session or a bad token", async () => {
    tables.terminal_sessions = { data: { ...activeSession, status: "ended" } };
    expect(await (await POST(req({ sid: SID, token: "t" }))).json()).toEqual({ agents: null });
  });
});

describe("POST /api/terminal/session/agents — memory limit (task 5e654dd1)", () => {
  async function ask(agent: "claude" | "codex") {
    const res = await POST(req({ sid: SID, token: "bridge-tok", agent }));
    expect(res.status).toBe(200);
    return res.json();
  }

  it("leaves the field out when nothing is set", async () => {
    expect(await ask("claude")).not.toHaveProperty("autoCompactWindow");
    expect(await ask("codex")).not.toHaveProperty("autoCompactWindow");
  });

  it("returns the user's own Claude value", async () => {
    tables.users = { data: { model_tier_map: null, terminal_auto_compact: 400000, terminal_codex_auto_compact: 150000 } };
    expect((await ask("claude")).autoCompactWindow).toBe(400000);
  });

  it("returns the user's own Codex value, not Claude's", async () => {
    tables.users = { data: { model_tier_map: null, terminal_auto_compact: 400000, terminal_codex_auto_compact: 150000 } };
    expect((await ask("codex")).autoCompactWindow).toBe(150000);
  });

  it("falls back to the site default when the user has none", async () => {
    tables.users = { data: { model_tier_map: null, terminal_auto_compact: null, terminal_codex_auto_compact: null } };
    tables.platform_settings = { data: { value: { window: 300000 } } };
    expect((await ask("claude")).autoCompactWindow).toBe(300000);
  });

  it("ignores an invalid saved value", async () => {
    tables.users = { data: { model_tier_map: null, terminal_auto_compact: 5, terminal_codex_auto_compact: null } };
    expect(await ask("claude")).not.toHaveProperty("autoCompactWindow");
  });

  it("a read error leaves the field out and never fails the answer", async () => {
    tables.users = { data: null, error: { message: "boom" } };
    const body = await ask("claude");
    expect(body).not.toHaveProperty("autoCompactWindow");
    expect(body).toHaveProperty("agents");
  });

  it("an inactive session still answers { agents: null } with no field", async () => {
    tables.terminal_sessions = { data: { ...activeSession, status: "ended" } };
    expect(await ask("claude")).toEqual({ agents: null });
  });
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
    // Seed platform defaults: frontier = opus/medium, standard = sonnet/medium.
    expect(agents["vc-atlas-37e8ffb2-frontier"]).toMatchObject({ model: "opus", effort: "medium" });
    expect(agents["vc-atlas-37e8ffb2-standard"]).toMatchObject({ model: "sonnet", effort: "medium" });
    expect(agents["vc-atlas-37e8ffb2-frontier"].prompt).toContain("### testing\nTest first.");
    expect(agents["vc-lens-87e09eb1"]).not.toHaveProperty("model");
  });

  it("gives Claude board agents the 400k limit, and gives Codex role definitions no such key (task 5e654dd1)", async () => {
    const claude = (await (await POST(req({ sid: SID, token: "bridge-tok" }))).json()).agents;
    expect(Object.values(claude).every((d) => (d as { autoCompactWindow?: number }).autoCompactWindow === 400_000)).toBe(true);
    const codex = (await (await POST(req({ sid: SID, token: "bridge-tok", agent: "codex" }))).json()).agents;
    expect(Object.values(codex).some((d) => "autoCompactWindow" in (d as object))).toBe(false);
  });

  it("switches file-editing tools off for a read-only agent and leaves a full-access one alone", async () => {
    tables.bot_profiles = { data: [{ ...ATLAS, tool_access: "full" }, { ...LENS, tool_access: "read_only" }] };
    const { agents } = await (await POST(req({ sid: SID, token: "bridge-tok" }))).json();
    expect(agents["vc-lens-87e09eb1"].disallowedTools).toEqual(["Edit", "Write", "NotebookEdit"]);
    expect(agents["vc-lens-87e09eb1"].prompt).toContain("## Tools\nYou're read-only");
    expect(agents["vc-atlas-37e8ffb2-frontier"]).not.toHaveProperty("disallowedTools");
  });

  it("honours the owner's own model choice for a tier", async () => {
    tables.users = { data: { model_tier_map: { frontier: { claude: { model: "fable", effort: "max" } } } } };
    const { agents } = await (await POST(req({ sid: SID, token: "bridge-tok" }))).json();
    expect(agents["vc-atlas-37e8ffb2-frontier"]).toMatchObject({ model: "fable", effort: "max" });
  });

  it("carries Codex's tier models and efforts for a Codex session", async () => {
    const { agents } = await (await POST(req({ sid: SID, token: "bridge-tok", agent: "codex" }))).json();
    // Seed platform defaults: frontier = gpt-6-astra/high, standard = gpt-5.6-sol/medium.
    expect(agents["vc-atlas-37e8ffb2-frontier"]).toMatchObject({ model: "gpt-6-astra", effort: "high" });
    expect(agents["vc-atlas-37e8ffb2-standard"]).toMatchObject({ model: "gpt-5.6-sol", effort: "medium" });
    expect(agents["vc-atlas-37e8ffb2-standard"].description).toContain(" gpt-5.6-sol medium]");
    expect(agents["vc-lens-87e09eb1"]).not.toHaveProperty("model");
  });

  it("honours the owner's own Codex model choice for a tier", async () => {
    tables.users = { data: { model_tier_map: { frontier: { codex: { model: "gpt-5.6-sol", effort: "xhigh" } } } } };
    const { agents } = await (await POST(req({ sid: SID, token: "bridge-tok", agent: "codex" }))).json();
    expect(agents["vc-atlas-37e8ffb2-frontier"]).toMatchObject({ model: "gpt-5.6-sol", effort: "xhigh" });
  });

  describe("agents the board's templates use", () => {
    beforeEach(() => {
      tables.bot_profiles = { data: [ATLAS, LENS, PLANNER] };
      tables.idea_agents = {
        data: [
          { bot_id: ATLAS.id, bot: { id: ATLAS.id, role: ATLAS.role } },
          { bot_id: PLANNER.id, bot: { id: PLANNER.id, role: PLANNER.role } },
        ],
      };
      tables.workflow_templates = { data: [{ steps: [{ role: "Planner", model_tier: "frontier" }] }] };
    });

    it("includes the Planner with no waiting step, with the tag a claim hands out", async () => {
      const { agents } = await (await POST(req({ sid: SID, token: "bridge-tok" }))).json();
      const hint = sessionAgentClaimHint({ bot: PLANNER, tier: "frontier", model: "opus", effort: "medium" });
      expect(agents[hint.name]).toBeDefined();
      expect(agents[hint.name].description.endsWith(hint.tag)).toBe(true);
      expect(Object.keys(agents)).toHaveLength(4);
    });

    it("carries Codex's model for a template-only agent", async () => {
      const { agents } = await (await POST(req({ sid: SID, token: "bridge-tok", agent: "codex" }))).json();
      expect(agents["vc-planner-d799aba2-frontier"]).toMatchObject({ model: "gpt-6-astra", effort: "high" });
    });

    it("resolves a role through the board's cached match", async () => {
      tables.workflow_templates = { data: [{ steps: [{ role: "Architect", model_tier: "frontier" }] }] };
      tables.idea_role_match_cache = { data: { matches: { Architect: { botId: PLANNER.id, tier: "ai" } } } };
      const { agents } = await (await POST(req({ sid: SID, token: "bridge-tok" }))).json();
      expect(agents["vc-planner-d799aba2-frontier"]).toBeDefined();
    });

    it("still answers with the waiting agents when the template reads fail", async () => {
      tables.workflow_templates = { data: null, error: { message: "boom" } };
      const { agents } = await (await POST(req({ sid: SID, token: "bridge-tok" }))).json();
      expect(Object.keys(agents).sort()).toEqual([
        "vc-atlas-37e8ffb2-frontier",
        "vc-atlas-37e8ffb2-standard",
        "vc-lens-87e09eb1",
      ]);
    });

    it("defines the template's agents even when nothing is waiting", async () => {
      tables.task_workflow_steps = { data: [] };
      const { agents } = await (await POST(req({ sid: SID, token: "bridge-tok" }))).json();
      expect(Object.keys(agents)).toEqual(["vc-planner-d799aba2-frontier"]);
    });
  });

  it("reads past 1,000 claimable steps instead of stopping at the first page", async () => {
    const full = Array.from({ length: 1000 }, () => ({ bot_id: ATLAS.id, model_tier: "frontier" }));
    tables.task_workflow_steps = { data: [], pages: [full, [{ bot_id: LENS.id, model_tier: null }]] };
    const { agents } = await (await POST(req({ sid: SID, token: "bridge-tok" }))).json();
    expect(Object.keys(agents).sort()).toEqual(["vc-atlas-37e8ffb2-frontier", "vc-lens-87e09eb1"]);
  });

  it("answers null when the board has no claimable agent steps", async () => {
    tables.task_workflow_steps = { data: [] };
    const res = await POST(req({ sid: SID, token: "bridge-tok" }));
    expect(await res.json()).toMatchObject({ agents: null });
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
    expect((await POST(req({ sid: SID, token: "t", agent: "bash" }))).status).toBe(400);
  });
});
