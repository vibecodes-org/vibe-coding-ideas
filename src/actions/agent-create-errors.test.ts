import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { createClient } from "@/lib/supabase/server";
import { createBot, importAgentFromSkill } from "./bots";
import { createAdminAgent } from "./admin-agents";
import type { ParsedSkill } from "@/lib/skill-md";

// Card 5d8274fe, fixes 1 and 2.

const USER = "22222222-2222-4222-a222-222222222222";
const BOT = "11111111-1111-4111-a111-111111111111";

function setup(profileResult: { error: { message: string } | null }) {
  const fake = fakeSupabase({
    tables: {
      bot_profiles: () => profileResult,
      users: () => ({ data: { is_admin: true }, error: null }),
    },
    rpc: (name) => (name === "create_bot_user" ? { data: BOT } : { error: null }),
  });
  const client = Object.assign(fake.client, {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
  });
  vi.mocked(createClient).mockResolvedValue(client as never);
  return fake;
}

beforeEach(() => vi.clearAllMocks());

describe("creating an agent whose follow-up settings update fails", () => {
  it("createBot throws instead of leaving a Read-only agent on Full access", async () => {
    setup({ error: { message: "update failed" } });
    await expect(createBot("Lens", null, "x", null, null, "read_only")).rejects.toThrow("update failed");
  });

  it("createAdminAgent throws when the extras update fails", async () => {
    setup({ error: { message: "update failed" } });
    await expect(createAdminAgent("Lens", null, "x", null, null, "read_only")).rejects.toThrow("update failed");
  });

  it("still succeeds when the update works", async () => {
    setup({ error: null });
    await expect(createBot("Lens", null, "x", null, null, "read_only")).resolves.toBe(BOT);
  });
});

describe("importing a file with a mistyped tool_access", () => {
  function skill(metaToolAccess: unknown): ParsedSkill {
    return {
      name: "lens",
      description: "d",
      body: "Review it.",
      metadata: { tool_access: metaToolAccess },
    } as unknown as ParsedSkill;
  }

  it("does not reset an existing agent's tool access", async () => {
    const fake = setup({ error: null });
    await importAgentFromSkill(skill("readonly"), BOT);
    expect(fake.writesTo("bot_profiles", "update")[0].payload).not.toHaveProperty("tool_access");
  });

  it("still applies an exact read_only", async () => {
    const fake = setup({ error: null });
    await importAgentFromSkill(skill("read_only"), BOT);
    expect(fake.writesTo("bot_profiles", "update")[0].payload).toMatchObject({ tool_access: "read_only" });
  });
});
