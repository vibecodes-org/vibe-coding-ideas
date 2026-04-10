import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import {
  exportAgentSkill,
  exportAgentSkillSchema,
  importAgentSkill,
  importAgentSkillSchema,
} from "./agent-skill";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-a000-000000000001";
const BOT_ID = "00000000-0000-4000-a000-000000000002";
const IDEA_ID = "00000000-0000-4000-a000-000000000003";

function createChain(resolveWith: unknown = null) {
  const chain: Record<string, unknown> = {};

  for (const m of ["order", "limit", "range", "or", "filter", "delete"]) {
    chain[m] = vi.fn(() => chain);
  }

  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);

  chain.single = vi.fn(() =>
    Promise.resolve({ data: resolveWith, error: null })
  );
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: resolveWith, error: null })
  );

  chain.then = (resolve: (val: unknown) => void) =>
    Promise.resolve({
      data: Array.isArray(resolveWith) ? resolveWith : [],
      error: null,
    }).then(resolve);

  return chain;
}

const sampleBot = {
  id: BOT_ID,
  name: "Atlas",
  role: "Full Stack Engineer",
  system_prompt: "## Goal\nBuild features.",
  bio: "Ship it right",
  skills: ["TypeScript", "React"],
  owner_id: USER_ID,
  is_published: false,
};

// ---------------------------------------------------------------------------
// export_agent_skill
// ---------------------------------------------------------------------------

describe("exportAgentSkill", () => {
  const params = exportAgentSkillSchema.parse({ agent_id: BOT_ID });

  it("returns SKILL.md content and filename", async () => {
    const chain = createChain(sampleBot);
    const ctx: McpContext = {
      supabase: { from: vi.fn(() => chain) } as unknown as McpContext["supabase"],
      userId: USER_ID,
    };

    const result = await exportAgentSkill(ctx, params);

    expect(result.skill_md).toContain("name: atlas");
    expect(result.skill_md).toContain("source: vibecodes");
    expect(result.skill_md).toContain(`source_id: ${BOT_ID}`);
    expect(result.skill_md).toContain("## Goal\nBuild features.");
    expect(result.filename).toBe("atlas.skill.md");
  });

  it("throws when agent not found", async () => {
    const chain = createChain(null);
    const ctx: McpContext = {
      supabase: { from: vi.fn(() => chain) } as unknown as McpContext["supabase"],
      userId: USER_ID,
    };

    await expect(exportAgentSkill(ctx, params)).rejects.toThrow("Agent not found");
  });
});

// ---------------------------------------------------------------------------
// import_agent_skill
// ---------------------------------------------------------------------------

describe("importAgentSkill", () => {
  const skillMdContent = [
    "---",
    "name: sentinel",
    "description: QA Engineer agent",
    "metadata:",
    "  source: external",
    "  role: QA Engineer",
    '  bio: "Break it before users do"',
    '  tags: ["E2E Testing","Cross-browser"]',
    "---",
    "",
    "## Goal",
    "Test everything.",
  ].join("\n");

  const params = importAgentSkillSchema.parse({ skill_md_content: skillMdContent });

  it("creates a new agent from SKILL.md", async () => {
    const NEW_BOT_ID = "00000000-0000-4000-a000-000000000099";
    const profileData = {
      id: NEW_BOT_ID,
      name: "Sentinel",
      role: "QA Engineer",
      system_prompt: "## Goal\nTest everything.",
      is_active: true,
      bio: "Break it before users do",
      skills: ["E2E Testing", "Cross-browser"],
    };

    // Chain for the duplicate check (no match)
    const dupChain = createChain(null);
    // Chain for update (extras)
    const updateChain = createChain(null);
    // Chain for single fetch
    const fetchChain = createChain(profileData);

    const rpcMock = vi.fn(() =>
      Promise.resolve({ data: NEW_BOT_ID, error: null })
    );

    let fromCallCount = 0;
    const fromMock = vi.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return updateChain; // bot_profiles update (extras)
      return fetchChain; // bot_profiles select (fetch created)
    });

    const ctx: McpContext = {
      supabase: {
        from: fromMock,
        rpc: rpcMock,
      } as unknown as McpContext["supabase"],
      userId: USER_ID,
    };

    const result = await importAgentSkill(ctx, params);

    expect(result.action).toBe("created");
    expect(result.bot_id).toBe(NEW_BOT_ID);
    expect(rpcMock).toHaveBeenCalledWith("create_bot_user", {
      p_name: "Sentinel",
      p_owner_id: USER_ID,
      p_role: "QA Engineer",
      p_system_prompt: "## Goal\nTest everything.",
      p_avatar_url: null,
    });
  });

  it("updates existing agent on round-trip import", async () => {
    const roundTripMd = [
      "---",
      "name: atlas",
      "description: Full Stack Engineer agent",
      "metadata:",
      "  source: vibecodes",
      `  source_id: ${BOT_ID}`,
      "  role: Full Stack Engineer",
      "---",
      "",
      "Updated prompt.",
    ].join("\n");

    const roundTripParams = importAgentSkillSchema.parse({
      skill_md_content: roundTripMd,
    });

    // Duplicate check finds existing
    const dupChain = createChain({ id: BOT_ID, name: "Atlas" });
    // Update chain
    const updateChain = createChain(null);

    let fromCallCount = 0;
    const fromMock = vi.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return dupChain;
      return updateChain;
    });

    const ctx: McpContext = {
      supabase: {
        from: fromMock,
      } as unknown as McpContext["supabase"],
      userId: USER_ID,
    };

    const result = await importAgentSkill(ctx, roundTripParams);

    expect(result.action).toBe("updated");
    expect(result.bot_id).toBe(BOT_ID);
  });
});

// ---------------------------------------------------------------------------
// get_agent_skill_content
// ---------------------------------------------------------------------------

describe("getAgentSkillContent", () => {
  it("returns skill content for active agent", async () => {
    const skillData = {
      name: "webapp-testing",
      description: "Test web applications",
      content: "## How to test\n1. Launch browser\n2. Navigate",
      category: "Development",
    };

    const chain = createChain(skillData);
    const ctx: McpContext = {
      supabase: { from: vi.fn(() => chain) } as unknown as McpContext["supabase"],
      userId: BOT_ID, // active agent identity
    };

    const { getAgentSkillContent, getAgentSkillContentSchema } = await import("./agent-skill");
    const params = getAgentSkillContentSchema.parse({ skill_name: "webapp-testing" });
    const result = await getAgentSkillContent(ctx, params);

    expect(result.skill_name).toBe("webapp-testing");
    expect(result.instructions).toContain("Launch browser");
  });

  it("throws when skill not found", async () => {
    const chain = createChain(null);
    const ctx: McpContext = {
      supabase: { from: vi.fn(() => chain) } as unknown as McpContext["supabase"],
      userId: BOT_ID,
    };

    const { getAgentSkillContent, getAgentSkillContentSchema } = await import("./agent-skill");
    const params = getAgentSkillContentSchema.parse({ skill_name: "nonexistent" });

    await expect(getAgentSkillContent(ctx, params)).rejects.toThrow("not found");
  });
});
