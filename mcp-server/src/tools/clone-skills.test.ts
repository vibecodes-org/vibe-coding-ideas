import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { fakeSupabase, type FakeCall } from "../../../src/test/fake-supabase";
import { VIBECODES_USER_ID } from "../constants";

vi.mock("../../../src/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { cloneAgent, createBot, createBotSchema } from "./bots";
import { applyKitToIdea } from "./kits";

// Task d04408b0: both MCP copy routines carry the source agent's skills.

const OWNER = "00000000-0000-4000-a000-000000000001";
const SOURCE = "37e8ffb2-3f88-49e5-9ab4-a516c1088f77";
const COPY = "11111111-1111-4111-a111-111111111111";
const IDEA = "00000000-0000-4000-a000-0000000000aa";
const KIT = "00000000-0000-4000-a000-0000000000bb";

const SOURCE_BOT = {
  id: SOURCE,
  name: "Atlas",
  role: "Full Stack Engineer",
  system_prompt: "Ship it.",
  avatar_url: null,
  bio: "bio",
  is_published: true,
};
const SKILLS = [
  { name: "backend", description: "d", content: "c1", source_url: null, source_type: "file", category: null, created_at: "2026-06-01T00:00:00Z" },
  { name: "design", description: "d", content: "c2", source_url: null, source_type: "file", category: null, created_at: "2026-07-01T00:00:00Z" },
];

function ctxFor(fake: ReturnType<typeof fakeSupabase>): McpContext {
  return { supabase: fake.client, userId: OWNER, ownerUserId: OWNER, sessionId: "s" } as unknown as McpContext;
}

const eqValue = (c: FakeCall, col: string) => c.filters.find((f) => f[0] === "eq" && (f[1] as unknown[])[0] === col)?.[1] as unknown[] | undefined;

describe("MCP clone_agent", () => {
  function setup(skillsResult: { data?: unknown; error?: { message: string } | null }) {
    return fakeSupabase({
      tables: {
        bot_profiles: (c) => (c.op === "select" ? { data: SOURCE_BOT } : { error: null }),
        agent_skills: (c) => (c.op === "select" ? skillsResult : { error: null }),
      },
      rpc: (name) => (name === "create_bot_user" ? { data: COPY } : { error: null }),
    });
  }

  it("copies the source agent's skills to the new agent (AC12)", async () => {
    const fake = setup({ data: SKILLS });
    const result = await cloneAgent(ctxFor(fake), { bot_id: SOURCE });

    expect(result).toEqual({ cloned_bot_id: COPY, source_name: "Atlas" });
    const [insert] = fake.writesTo("agent_skills", "insert");
    expect(insert.payload).toEqual(SKILLS.map((s) => ({ ...s, bot_id: COPY })));
  });

  it("copies the source agent's tool access (task 472d5672)", async () => {
    const fake = fakeSupabase({
      tables: {
        bot_profiles: (c) => (c.op === "select" ? { data: { ...SOURCE_BOT, tool_access: "read_only" } } : { error: null }),
        agent_skills: (c) => (c.op === "select" ? { data: [] } : { error: null }),
      },
      rpc: (name) => (name === "create_bot_user" ? { data: COPY } : { error: null }),
    });
    await cloneAgent(ctxFor(fake), { bot_id: SOURCE });

    expect(fake.writesTo("bot_profiles", "update")[0].payload).toMatchObject({ tool_access: "read_only" });
  });

  it("copies an agent without skills exactly as before", async () => {
    const fake = setup({ data: [] });
    const result = await cloneAgent(ctxFor(fake), { bot_id: SOURCE });

    expect(result.cloned_bot_id).toBe(COPY);
    expect(fake.writesTo("agent_skills", "insert")).toEqual([]);
    expect(fake.rpcCalls.map((c) => c.name)).toEqual(["create_bot_user", "increment_times_cloned"]);
  });

  it("surfaces a skills copy failure, discards the copy and doesn't count the clone", async () => {
    const fake = setup({ data: null, error: { message: "boom" } });

    await expect(cloneAgent(ctxFor(fake), { bot_id: SOURCE })).rejects.toThrow("Couldn't copy the agent's skills: boom");
    expect(fake.rpcCalls.map((c) => c.name)).toEqual(["create_bot_user", "delete_bot_user"]);
  });
});

describe("MCP kit apply", () => {
  function setup(skillsResult: { data?: unknown; error?: { message: string } | null }) {
    return fakeSupabase({
      tables: {
        project_kits: () => ({
          data: { id: KIT, agent_roles: [{ role: "Full Stack Engineer" }], label_presets: [], workflow_library_template_id: null },
        }),
        bot_profiles: (c) => {
          if (c.op !== "select") return { error: null };
          // Library agents are selected by the platform owner; the caller's existing agents by their own id.
          return eqValue(c, "owner_id")?.[1] === VIBECODES_USER_ID ? { data: [SOURCE_BOT] } : { data: [] };
        },
        agent_skills: (c) => (c.op === "select" ? skillsResult : { error: null }),
        kit_workflow_mappings: () => ({ data: [] }),
      },
      rpc: (name) => (name === "create_bot_user" ? { data: COPY } : { error: null }),
    });
  }

  it("copies the library agent's skills onto the agent it creates (AC12)", async () => {
    const fake = setup({ data: SKILLS });
    const result = await applyKitToIdea(ctxFor(fake), IDEA, KIT);

    expect(result.agentsCreated).toBe(1);
    expect(result.agentsFailed).toEqual([]);
    const [insert] = fake.writesTo("agent_skills", "insert");
    expect(insert.payload).toEqual(SKILLS.map((s) => ({ ...s, bot_id: COPY })));
    expect(fake.writesTo("idea_agents", "upsert")).toHaveLength(1);
  });

  it("doesn't count or allocate an agent whose skills failed to copy", async () => {
    const fake = setup({ data: null, error: { message: "boom" } });
    const result = await applyKitToIdea(ctxFor(fake), IDEA, KIT);

    expect(result.agentsCreated).toBe(0);
    // ...and the failure is reported, not silently one agent short.
    expect(result.agentsFailed).toEqual([
      { role: "Full Stack Engineer", reason: "Couldn't copy the agent's skills: boom" },
    ]);
    expect(fake.writesTo("idea_agents", "upsert")).toEqual([]);
    expect(fake.rpcCalls.map((c) => c.name)).toContain("delete_bot_user");
  });
});

describe("MCP create_agent tool_access", () => {
  function setup() {
    return fakeSupabase({
      tables: { bot_profiles: (c) => (c.op === "select" ? { data: { id: COPY } } : { error: null }) },
      rpc: (name) => (name === "create_bot_user" ? { data: COPY } : { error: null }),
    });
  }

  it("stores read_only when asked", async () => {
    const fake = setup();
    await createBot(ctxFor(fake), createBotSchema.parse({ name: "Lens", tool_access: "read_only" }));

    expect(fake.writesTo("bot_profiles", "update")[0].payload).toEqual({ tool_access: "read_only" });
  });

  it("leaves new agents on full access by default, with no extra write", async () => {
    const fake = setup();
    await createBot(ctxFor(fake), createBotSchema.parse({ name: "Atlas" }));

    expect(fake.writesTo("bot_profiles", "update")).toEqual([]);
  });

  it("rejects a value that isn't full or read_only", () => {
    expect(createBotSchema.safeParse({ name: "X", tool_access: "admin" }).success).toBe(false);
  });
});
