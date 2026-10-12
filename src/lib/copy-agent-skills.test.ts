import { describe, it, expect, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { copyAgentSkills } from "./copy-agent-skills";
import { SKILLS_READ_LIMIT } from "./fetch-agent-skills";

const SOURCE = "37e8ffb2-3f88-49e5-9ab4-a516c1088f77";
const COPY = "11111111-1111-4111-a111-111111111111";
const OWNER = "22222222-2222-4222-a222-222222222222";

const SKILLS = [
  {
    name: "backend",
    description: "Data access",
    content: "Scope by parent FK.",
    source_url: null,
    source_type: "file",
    category: "engineering",
    created_at: "2026-06-01T10:00:00Z",
  },
  {
    name: "design",
    description: "Visual design",
    content: "Pick a direction.",
    source_url: "https://example.com/design",
    source_type: "url",
    category: null,
    created_at: "2026-07-25T10:00:00Z",
  },
];

describe("copyAgentSkills", () => {
  it("copies every skill, with all its fields and creation order, onto the new agent (AC12)", async () => {
    const fake = fakeSupabase({ tables: { agent_skills: (c) => (c.op === "select" ? { data: SKILLS } : { error: null }) } });
    const copied = await copyAgentSkills(fake.client, SOURCE, COPY, OWNER);

    expect(copied).toBe(2);
    const [read] = fake.writesTo("agent_skills", "select");
    expect(read.filters).toContainEqual(["eq", ["bot_id", SOURCE]]);
    expect(read.filters).toContainEqual(["order", ["created_at", { ascending: true }]]);
    expect(read.filters).toContainEqual(["order", ["id", { ascending: true }]]);
    // Every skill is copied: the ceiling is the read limit, not the 50-skill send cap.
    expect(read.filters).toContainEqual(["limit", SKILLS_READ_LIMIT]);
    const [insert] = fake.writesTo("agent_skills", "insert");
    expect(insert.payload).toEqual(SKILLS.map((s) => ({ ...s, bot_id: COPY })));
    expect(fake.rpcCalls).toEqual([]);
  });

  it("does nothing for an agent without skills", async () => {
    const fake = fakeSupabase({ tables: { agent_skills: () => ({ data: [] }) } });
    expect(await copyAgentSkills(fake.client, SOURCE, COPY, OWNER)).toBe(0);
    expect(fake.writesTo("agent_skills", "insert")).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("discards the copy and throws when the skills can't be read", async () => {
    const fake = fakeSupabase({ tables: { agent_skills: () => ({ data: null, error: { message: "read failed" } }) } });
    await expect(copyAgentSkills(fake.client, SOURCE, COPY, OWNER)).rejects.toThrow(
      "Couldn't copy the agent's skills: read failed",
    );
    expect(fake.rpcCalls).toEqual([{ name: "delete_bot_user", args: { p_bot_id: COPY, p_owner_id: OWNER } }]);
  });

  it("discards the copy and throws when the skills can't be written", async () => {
    const fake = fakeSupabase({
      tables: { agent_skills: (c) => (c.op === "select" ? { data: SKILLS } : { error: { message: "denied" } }) },
    });
    await expect(copyAgentSkills(fake.client, SOURCE, COPY, OWNER)).rejects.toThrow("Couldn't copy the agent's skills: denied");
    expect(fake.rpcCalls).toHaveLength(1);
  });

  it("still throws the copy error when discarding the copy fails too", async () => {
    const fake = fakeSupabase({
      tables: { agent_skills: () => ({ data: null, error: { message: "read failed" } }) },
      rpc: () => ({ error: { message: "cleanup failed" } }),
    });
    await expect(copyAgentSkills(fake.client, SOURCE, COPY, OWNER)).rejects.toThrow("read failed");
  });
});
