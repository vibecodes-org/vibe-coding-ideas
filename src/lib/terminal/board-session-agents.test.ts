import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { buildSkillsSection } from "@/lib/skills-section";
import { sessionAgentClaimHint } from "@/lib/terminal/session-agents";
import { isBoardMember, loadRunSessionAgents, loadStepSessionAgent } from "./board-session-agents";

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const IDEA = "62e57071-3645-422f-96c0-b2042e39e6dd";
const STEP = "f78635ad-c57c-4907-8b0b-74b5c7fa8819";
const USER = "e07e3b95-f979-4281-a088-2637b2ca97e3";
const ATLAS = {
  id: "37e8ffb2-3f88-49e5-9ab4-a516c1088f77",
  name: "Atlas",
  role: "Full Stack Engineer",
  system_prompt: "## Goal\nShip it.",
  tool_access: "full" as const,
};

const tables: Record<string, { data: unknown; list?: unknown; error?: unknown }> = {};
const filters: { table: string; col: string; val: unknown }[] = [];

function makeSupabase() {
  const from = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    let single = false;
    for (const m of ["select", "in", "not", "neq", "order", "limit", "range"]) chain[m] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() => {
      single = true;
      return chain;
    });
    chain.eq = vi.fn((col: string, val: unknown) => {
      filters.push({ table, col, val });
      return chain;
    });
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ error: null, ...(tables[table] ?? { data: null }), ...(!single && tables[table]?.list !== undefined ? { data: tables[table].list } : {}) }).then(resolve, reject);
    return chain;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  filters.length = 0;
  tables.task_workflow_steps = { data: { bot_id: ATLAS.id, model_tier: "frontier" } };
  tables.bot_profiles = { data: [ATLAS] };
  tables.agent_skills = { data: [{ bot_id: ATLAS.id, name: "testing", content: "Test first." }] };
  tables.users = { data: { model_tier_map: null } };
  tables.platform_settings = { data: null };
});

describe("loadStepSessionAgent", () => {
  it("builds exactly the agent the claim hint names, with the same tag", async () => {
    const got = await loadStepSessionAgent(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER });
    const hint = sessionAgentClaimHint({
      bot: ATLAS,
      tier: "frontier",
      model: "opus",
      effort: "medium",
      skillsText: buildSkillsSection(ATLAS.id, [{ name: "testing", content: "Test first." }]).text,
    });
    expect(got!.name).toBe(hint.name);
    expect(got!.def.description.endsWith(hint.tag)).toBe(true);
    expect(got!.def).toMatchObject({ model: "opus", effort: "medium" });
    expect(got!.def.prompt).toContain("### testing\nTest first.");
  });

  it("a step with its own effort gets the -<level> agent at that effort, matching the claim hint", async () => {
    tables.task_workflow_steps = { data: { bot_id: ATLAS.id, model_tier: "frontier", effort_override: "high" } };
    const got = await loadStepSessionAgent(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER });
    const hint = sessionAgentClaimHint({
      bot: ATLAS,
      tier: "frontier",
      model: "opus",
      effort: "high",
      stepEffort: "high",
      skillsText: buildSkillsSection(ATLAS.id, [{ name: "testing", content: "Test first." }]).text,
    });
    expect(hint.name).toBe("vc-atlas-37e8ffb2-frontier-high");
    expect(got!.name).toBe(hint.name);
    expect(got!.def.description.endsWith(hint.tag)).toBe(true);
    expect(got!.def).toMatchObject({ model: "opus", effort: "high" });
  });

  it("reads the step scoped to its idea", async () => {
    await loadStepSessionAgent(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER });
    expect(filters).toContainEqual({ table: "task_workflow_steps", col: "id", val: STEP });
    expect(filters).toContainEqual({ table: "task_workflow_steps", col: "idea_id", val: IDEA });
  });

  it("builds the untiered agent for an Auto step", async () => {
    tables.task_workflow_steps = { data: { bot_id: ATLAS.id, model_tier: null } };
    const got = await loadStepSessionAgent(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER });
    expect(got!.name).toBe("vc-atlas-37e8ffb2");
    expect(got!.def).not.toHaveProperty("model");
  });

  it("honours the owner's own tier choice", async () => {
    tables.users = { data: { model_tier_map: { frontier: { claude: { model: "fable", effort: "max" } } } } };
    const got = await loadStepSessionAgent(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER });
    expect(got!.def).toMatchObject({ model: "fable", effort: "max" });
  });

  it("is null for a step that isn't on this idea, has no bot, or whose bot has no persona", async () => {
    tables.task_workflow_steps = { data: null };
    expect(await loadStepSessionAgent(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER })).toBeNull();
    tables.task_workflow_steps = { data: { bot_id: null, model_tier: null } };
    expect(await loadStepSessionAgent(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER })).toBeNull();
    tables.task_workflow_steps = { data: { bot_id: ATLAS.id, model_tier: "frontier" } };
    tables.bot_profiles = { data: [{ ...ATLAS, system_prompt: "  " }] };
    expect(await loadStepSessionAgent(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER })).toBeNull();
  });
});

describe("loadRunSessionAgents", () => {
  const LENS = { ...ATLAS, id: "87e09eb1-0c3e-4f96-9ddc-986fc10a58fd", name: "Lens", role: "Code Reviewer", tool_access: "read_only" as const };
  const NOPERSONA = { ...ATLAS, id: "11111111-1111-4111-8111-111111111111", name: "Blank", system_prompt: " " };
  const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const names = (r: Awaited<ReturnType<typeof loadRunSessionAgents>>) => r!.agents.map((a) => a.name);

  beforeEach(() => {
    tables.task_workflow_steps = {
      data: { bot_id: ATLAS.id, model_tier: "frontier", run_id: RUN },
      list: [
        { id: "s2", bot_id: LENS.id, model_tier: "standard", step_order: 2 },
        { id: "s3", bot_id: ATLAS.id, model_tier: "frontier", step_order: 3 },
        { id: "s4", bot_id: NOPERSONA.id, model_tier: null, step_order: 4 },
        { id: "s5", bot_id: ATLAS.id, model_tier: "standard", step_order: 5 },
      ],
    };
    tables.bot_profiles = { data: [ATLAS, LENS, NOPERSONA] };
  });

  it("returns the claimed step's agent first, then the run's later steps, deduped by name", async () => {
    const got = await loadRunSessionAgents(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER });
    expect(names(got)).toEqual(["vc-atlas-37e8ffb2-frontier", "vc-lens-87e09eb1-standard", "vc-atlas-37e8ffb2-standard"]);
    expect(got!.omitted).toBe(0);
  });

  it("builds each agent exactly as loadStepSessionAgent builds it for that step", async () => {
    const run = await loadRunSessionAgents(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER });
    const single = await loadStepSessionAgent(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER });
    expect(run!.agents[0]).toEqual(single);
  });

  it("gives every synced Claude agent the 400k memory limit (task 5e654dd1 stage 9)", async () => {
    const run = await loadRunSessionAgents(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER });
    expect(run!.agents.length).toBeGreaterThan(0);
    for (const a of run!.agents) expect(a.def.autoCompactWindow).toBe(400_000);
  });

  it("scopes the run read by idea and run, and leaves out finished steps by status", async () => {
    await loadRunSessionAgents(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER });
    expect(filters).toContainEqual({ table: "task_workflow_steps", col: "run_id", val: RUN });
    expect(filters.filter((f) => f.table === "task_workflow_steps" && f.col === "idea_id")).toHaveLength(2);
  });

  it("stops adding agents at the byte budget but always keeps the claimed one", async () => {
    const all = await loadRunSessionAgents(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER });
    const first = Buffer.byteLength(JSON.stringify(all!.agents[0].def.prompt));
    const tight = await loadRunSessionAgents(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER, maxTotalBytes: first });
    expect(names(tight)).toEqual(["vc-atlas-37e8ffb2-frontier"]);
    expect(tight!.omitted).toBe(2);
    const none = await loadRunSessionAgents(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER, maxTotalBytes: 0 });
    expect(names(none)).toEqual(["vc-atlas-37e8ffb2-frontier"]);
  });

  it("still returns the claimed agent when the run read fails", async () => {
    tables.task_workflow_steps = { ...tables.task_workflow_steps, list: null, error: { message: "boom" } };
    const got = await loadRunSessionAgents(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER });
    expect(names(got)).toEqual(["vc-atlas-37e8ffb2-frontier"]);
  });

  it("works for a step with no run", async () => {
    tables.task_workflow_steps = { data: { bot_id: ATLAS.id, model_tier: "frontier", run_id: null } };
    const got = await loadRunSessionAgents(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER });
    expect(names(got)).toEqual(["vc-atlas-37e8ffb2-frontier"]);
  });

  it("is null when the claimed step isn't on this idea, has no bot, or its bot has no persona", async () => {
    tables.task_workflow_steps = { data: null };
    expect(await loadRunSessionAgents(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER })).toBeNull();
    tables.task_workflow_steps = { data: { bot_id: null, model_tier: null, run_id: RUN } };
    expect(await loadRunSessionAgents(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER })).toBeNull();
    tables.task_workflow_steps = { data: { bot_id: NOPERSONA.id, model_tier: null, run_id: RUN }, list: [] };
    expect(await loadRunSessionAgents(makeSupabase(), { stepId: STEP, ideaId: IDEA, userId: USER })).toBeNull();
  });
});

describe("isBoardMember", () => {
  it("is true for the author or a collaborator, false for anyone else", async () => {
    tables.ideas = { data: { id: IDEA } };
    expect(await isBoardMember(makeSupabase(), IDEA, USER)).toBe(true);
    tables.ideas = { data: null };
    tables.collaborators = { data: { user_id: USER } };
    expect(await isBoardMember(makeSupabase(), IDEA, USER)).toBe(true);
    tables.collaborators = { data: null };
    expect(await isBoardMember(makeSupabase(), IDEA, USER)).toBe(false);
  });
});
