import { describe, it, expect, vi } from "vitest";
import { fakeSupabase, type FakeCall } from "@/test/fake-supabase";
import { VIBECODES_USER_ID } from "@/lib/constants";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./idea-agents", () => ({ allocateAllAgents: vi.fn() }));
vi.mock("./board", () => ({ triggerAutoRulesForTasks: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { createClient } from "@/lib/supabase/server";
import { applyKit } from "./kits";

// Task d04408b0: the app's kit apply makes agents with cloneBotProfile, so a
// failed skills copy has to show up in the result rather than as one agent short.

const USER = "22222222-2222-4222-a222-222222222222";
const COPY = "11111111-1111-4111-a111-111111111111";
const LIBRARY_BOT = {
  id: "37e8ffb2-3f88-49e5-9ab4-a516c1088f77",
  name: "Atlas",
  role: "Full Stack Engineer",
  system_prompt: "Ship it.",
  avatar_url: null,
  bio: null,
  skills: [],
};

const eqValue = (c: FakeCall, col: string) =>
  (c.filters.find((f) => f[0] === "eq" && (f[1] as unknown[])[0] === col)?.[1] as unknown[] | undefined)?.[1];

function setup(skillsResult: { data?: unknown; error?: { message: string } | null }) {
  const fake = fakeSupabase({
    tables: {
      project_kits: () => ({ data: { id: "kit", agent_roles: [{ role: "Full Stack Engineer", name_suggestion: "Atlas" }], label_presets: [] } }),
      bot_profiles: (c) =>
        c.op !== "select" ? { error: null } : eqValue(c, "owner_id") === VIBECODES_USER_ID ? { data: [LIBRARY_BOT] } : { data: [] },
      agent_skills: (c) => (c.op === "select" ? skillsResult : { error: null }),
      kit_workflow_mappings: () => ({ data: [] }),
    },
    rpc: (name) => (name === "create_bot_user" ? { data: COPY } : { error: null }),
  });
  Object.assign(fake.client, { auth: { getUser: async () => ({ data: { user: { id: USER } } }) } });
  vi.mocked(createClient).mockResolvedValue(fake.client as never);
  return fake;
}

describe("applyKit (app)", () => {
  it("reports an agent whose skills couldn't be copied instead of silently creating one fewer", async () => {
    setup({ data: null, error: { message: "boom" } });
    const result = await applyKit("idea", "kit");

    expect(result.agentsCreated).toBe(0);
    expect(result.agentsFailed).toEqual([
      { role: "Full Stack Engineer", reason: "Couldn't copy the agent's skills: boom" },
    ]);
  });

  it("creates the agent and reports no failures when the skills copy", async () => {
    const fake = setup({ data: [{ name: "backend", description: "d", content: "c", source_url: null, source_type: "file", category: null, created_at: "2026-06-01T00:00:00Z" }] });
    const result = await applyKit("idea", "kit");

    expect(result.agentsCreated).toBe(1);
    expect(result.agentsFailed).toEqual([]);
    expect(fake.writesTo("agent_skills", "insert")).toHaveLength(1);
  });
});
