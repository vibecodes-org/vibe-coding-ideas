import { describe, it, expect } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { fetchSkillNamesByBot, normalizeBotIdList } from "./fetch-skill-names";

const A = "37e8ffb2-3f88-49e5-9ab4-a516c1088f77";
const B = "da04a09c-c04f-43be-b167-d9b321fabdf6";

describe("fetchSkillNamesByBot", () => {
  it("groups names by agent in order and gives every agent an entry", async () => {
    const fake = fakeSupabase({
      tables: {
        agent_skills: () => ({
          data: [
            { bot_id: B, name: "one" },
            { bot_id: B, name: "two" },
          ],
        }),
      },
    });
    expect(await fetchSkillNamesByBot(fake.client, [A, B])).toEqual({ [A]: [], [B]: ["one", "two"] });
  });

  it("does not read when there are no agents", async () => {
    const fake = fakeSupabase({ tables: { agent_skills: () => ({ data: [] }) } });
    expect(await fetchSkillNamesByBot(fake.client, [])).toEqual({});
    expect(fake.writesTo("agent_skills", "select")).toHaveLength(0);
  });

  it("splits a long id list into several reads", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-a000-${String(i).padStart(12, "0")}`);
    const fake = fakeSupabase({ tables: { agent_skills: () => ({ data: [] }) } });
    await fetchSkillNamesByBot(fake.client, ids);
    expect(fake.writesTo("agent_skills", "select")).toHaveLength(2);
  });

  it("throws on a failed read rather than reporting no skills", async () => {
    const fake = fakeSupabase({ tables: { agent_skills: () => ({ error: { message: "boom" } }) } });
    await expect(fetchSkillNamesByBot(fake.client, [A])).rejects.toThrow("Failed to read the agent's skills: boom");
  });
});

describe("normalizeBotIdList", () => {
  it("keeps valid ids and drops repeats", () => {
    expect(normalizeBotIdList([A, B, A])).toEqual([A, B]);
  });
  it("rejects an id that is not a uuid", () => {
    expect(() => normalizeBotIdList([A, "nope"])).toThrow();
  });
  it("rejects more than 50 agents", () => {
    const ids = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-a000-${String(i).padStart(12, "0")}`);
    expect(() => normalizeBotIdList(ids)).toThrow("At most 50");
  });
  it("accepts an empty list", () => {
    expect(normalizeBotIdList([])).toEqual([]);
  });
});
