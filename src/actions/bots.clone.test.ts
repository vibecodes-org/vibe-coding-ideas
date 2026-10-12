import { describe, it, expect, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import type { BotProfile } from "@/types";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { createClient } from "@/lib/supabase/server";
import { addFeaturedTeam, cloneBotProfile } from "./bots";

// Task d04408b0: cloneBotProfile is the one routine behind cloneAgent,
// addFeaturedTeam and the app's kit apply, so covering it covers all three.

const OWNER = "22222222-2222-4222-a222-222222222222";
const COPY = "11111111-1111-4111-a111-111111111111";
const SOURCE = {
  id: "37e8ffb2-3f88-49e5-9ab4-a516c1088f77",
  name: "Atlas",
  role: "Full Stack Engineer",
  system_prompt: "Ship it.",
  avatar_url: null,
  bio: "bio",
  skills: ["ts"],
} as unknown as BotProfile;
const SKILLS = [
  { name: "backend", description: "d", content: "c1", source_url: null, source_type: "file", category: null, created_at: "2026-06-01T00:00:00Z" },
];

function setup(skillsResult: { data?: unknown; error?: { message: string } | null }) {
  return fakeSupabase({
    tables: { agent_skills: (c) => (c.op === "select" ? skillsResult : { error: null }) },
    rpc: (name) => (name === "create_bot_user" ? { data: COPY } : { error: null }),
  });
}

describe("cloneBotProfile", () => {
  it("copies the source's skills to the new agent and returns its id (AC12)", async () => {
    const fake = setup({ data: SKILLS });
    const id = await cloneBotProfile(fake.client, SOURCE, OWNER);

    expect(id).toBe(COPY);
    expect(fake.writesTo("agent_skills", "insert")[0].payload).toEqual([{ ...SKILLS[0], bot_id: COPY }]);
    expect(fake.rpcCalls.map((c) => c.name)).toEqual(["create_bot_user", "increment_times_cloned"]);
  });

  it("copies the source's tool access to the new agent", async () => {
    const fake = setup({ data: [] });
    await cloneBotProfile(fake.client, { ...SOURCE, tool_access: "read_only" } as BotProfile, OWNER);

    expect(fake.writesTo("bot_profiles", "update")[0].payload).toMatchObject({
      tool_access: "read_only",
      cloned_from: SOURCE.id,
    });
  });

  it("clones an agent without skills exactly as before", async () => {
    const fake = setup({ data: [] });
    expect(await cloneBotProfile(fake.client, SOURCE, OWNER)).toBe(COPY);
    expect(fake.writesTo("agent_skills", "insert")).toEqual([]);
  });

  it("throws, discards the copy and leaves the source's counter alone when the skills can't be copied", async () => {
    const fake = setup({ data: null, error: { message: "boom" } });

    await expect(cloneBotProfile(fake.client, SOURCE, OWNER)).rejects.toThrow("Couldn't copy the agent's skills: boom");
    expect(fake.rpcCalls.map((c) => c.name)).toEqual(["create_bot_user", "delete_bot_user"]);
    expect(fake.writesTo("bot_profiles", "update")).toEqual([]);
  });
});

describe("addFeaturedTeam", () => {
  const OK_BOT = { ...SOURCE, id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", name: "Compass", role: "UX Designer" };
  const BAD_BOT = { ...SOURCE, id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", name: "Atlas", role: "Full Stack Engineer" };

  /** A two-agent team; with `failFirstSkillsRead` the first agent's skills can't be read. */
  function setupTeam(failFirstSkillsRead: boolean) {
    let reads = 0;
    const fake = fakeSupabase({
      tables: {
        featured_teams: () => ({ data: { id: "t", agents: [{ bot: BAD_BOT }, { bot: OK_BOT }] } }),
        bot_profiles: () => ({ data: [] }),
        agent_skills: (c) => {
          if (c.op !== "select") return { error: null };
          return failFirstSkillsRead && ++reads === 1 ? { data: null, error: { message: "boom" } } : { data: SKILLS };
        },
      },
      rpc: (name) => (name === "create_bot_user" ? { data: COPY } : { error: null }),
    });
    Object.assign(fake.client, { auth: { getUser: async () => ({ data: { user: { id: OWNER } } }) } });
    vi.mocked(createClient).mockResolvedValue(fake.client as never);
  }

  it("reports an agent whose copy failed, and still adds the rest of the team", async () => {
    setupTeam(true);
    const result = await addFeaturedTeam("t");

    expect(result.created).toEqual(["UX Designer"]);
    expect(result.createdBotIds).toEqual([COPY]);
    expect(result.failed).toEqual([
      { role: "Full Stack Engineer", reason: "Couldn't copy the agent's skills: boom" },
    ]);
  });

  it("reports nothing failed when every copy works", async () => {
    setupTeam(false);
    const result = await addFeaturedTeam("t");

    expect(result.created).toEqual(["Full Stack Engineer", "UX Designer"]);
    expect(result.failed).toEqual([]);
  });
});
