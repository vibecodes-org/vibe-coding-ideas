import { describe, it, expect } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { fetchAgentSkills, SKILLS_READ_LIMIT } from "./fetch-agent-skills";

const A = "37e8ffb2-3f88-49e5-9ab4-a516c1088f77";
const B = "da04a09c-c04f-43be-b167-d9b321fabdf6";
const C = "45d76225-704c-46dc-891a-047b24c918ea";

describe("fetchAgentSkills", () => {
  it("reads in creation order with id as the tie-break, bounded, for the given agents", async () => {
    const fake = fakeSupabase({ tables: { agent_skills: () => ({ data: [] }) } });
    await fetchAgentSkills(fake.client, [A, B]);

    const [read] = fake.writesTo("agent_skills", "select");
    expect(read.filters).toEqual([
      ["in", ["bot_id", [A, B]]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
      ["limit", SKILLS_READ_LIMIT],
    ]);
  });

  it("groups rows by agent, keeps their order, and gives every agent an entry", async () => {
    const fake = fakeSupabase({
      tables: {
        agent_skills: () => ({
          data: [
            { bot_id: A, name: "one", content: "1" },
            { bot_id: B, name: "other", content: "x" },
            { bot_id: A, name: "two", content: "2" },
          ],
        }),
      },
    });
    const byBot = await fetchAgentSkills(fake.client, [A, B, C]);

    expect(byBot.get(A)).toEqual([
      { name: "one", content: "1" },
      { name: "two", content: "2" },
    ]);
    expect(byBot.get(B)).toEqual([{ name: "other", content: "x" }]);
    expect(byBot.get(C)).toEqual([]);
  });

  it("makes no query for no agents", async () => {
    const fake = fakeSupabase({});
    expect((await fetchAgentSkills(fake.client, [])).size).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it("throws on a read error instead of reporting 'no skills'", async () => {
    const fake = fakeSupabase({ tables: { agent_skills: () => ({ data: null, error: { message: "boom" } }) } });
    await expect(fetchAgentSkills(fake.client, [A])).rejects.toThrow("Failed to read the agent's skills: boom");
  });
});
