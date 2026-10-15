import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { buildSkillsSection } from "@/lib/skills-section";
import { sessionAgentClaimHint } from "@/lib/terminal/session-agents";
import { isBoardMember, loadStepSessionAgent } from "./board-session-agents";

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

const tables: Record<string, { data: unknown; error?: unknown }> = {};
const filters: { table: string; col: string; val: unknown }[] = [];

function makeSupabase() {
  const from = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    for (const m of ["select", "in", "not", "order", "limit", "range", "maybeSingle"]) chain[m] = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, val: unknown) => {
      filters.push({ table, col, val });
      return chain;
    });
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ error: null, ...(tables[table] ?? { data: null }) }).then(resolve, reject);
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
      effort: "high",
      skillsText: buildSkillsSection(ATLAS.id, [{ name: "testing", content: "Test first." }]).text,
    });
    expect(got!.name).toBe(hint.name);
    expect(got!.def.description.endsWith(hint.tag)).toBe(true);
    expect(got!.def).toMatchObject({ model: "opus", effort: "high" });
    expect(got!.def.prompt).toContain("### testing\nTest first.");
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
