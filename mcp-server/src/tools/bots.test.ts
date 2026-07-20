import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { setBotIdentity, setBotIdentitySchema } from "./bots";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER_ID = "00000000-0000-4000-a000-000000000001";
const IDEA_ID = "00000000-0000-4000-a000-000000000003";
const TEAM_BOT_ID = "00000000-0000-4000-a000-000000000010";
const OTHER_BOT_ID = "00000000-0000-4000-a000-000000000011";
const SESSION_ID = "test-session";

function createChain(resolveWith: unknown = null) {
  const chain: Record<string, unknown> = {};

  for (const m of ["order", "limit", "range", "or", "filter", "delete", "ilike"]) {
    chain[m] = vi.fn(() => chain);
  }

  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.upsert = vi.fn(() => chain);

  chain.single = vi.fn(() => Promise.resolve({ data: resolveWith, error: null }));
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: resolveWith, error: null }));

  chain.then = (resolve: (val: unknown) => void) =>
    Promise.resolve({
      data: Array.isArray(resolveWith) ? resolveWith : [],
      error: null,
    }).then(resolve);

  return chain;
}

/**
 * Build a ctx whose supabase.from dispatches per-table, consuming one queued
 * chain per call (FIFO). Throws if a table gets more calls than queued chains.
 */
function createCtx(queues: Record<string, unknown[]>): McpContext {
  const fromMock = vi.fn((table: string) => {
    const queue = queues[table];
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected query on table "${table}"`);
    }
    return queue.shift();
  });

  return {
    supabase: { from: fromMock } as unknown as McpContext["supabase"],
    userId: OWNER_ID,
    ownerUserId: OWNER_ID,
    sessionId: SESSION_ID,
  } as unknown as McpContext;
}

const noop = () => {};

const teamBot = { id: TEAM_BOT_ID, name: "Sentinel", role: "QA Engineer", is_active: true };
const otherBot = { id: OTHER_BOT_ID, name: "Sentinel", role: "QA Engineer", is_active: true };
const teamBotProfile = { ...teamBot, system_prompt: "## Goal\nQA everything." };

// ---------------------------------------------------------------------------
// setBotIdentity — name resolution
// ---------------------------------------------------------------------------

describe("setBotIdentity name resolution", () => {
  it("resolves a unique owner-scoped name match", async () => {
    const ctx = createCtx({
      bot_profiles: [
        createChain([teamBot]), // owner tier list
        createChain(teamBotProfile), // profile fetch
      ],
      mcp_agent_sessions: [createChain(null)],
      agent_skills: [createChain([])],
    });

    const result = await setBotIdentity(
      ctx,
      setBotIdentitySchema.parse({ agent_name: "Sentinel" }),
      noop
    );

    expect((result.active_bot as { id: string }).id).toBe(TEAM_BOT_ID);
  });

  it("errors with the candidate list when several active agents share the name", async () => {
    const ctx = createCtx({
      bot_profiles: [createChain([teamBot, otherBot])], // owner tier: 2 matches
    });

    await expect(
      setBotIdentity(ctx, setBotIdentitySchema.parse({ agent_name: "Sentinel" }), noop)
    ).rejects.toThrow(/Multiple agents match name "Sentinel"[\s\S]*Pass agent_id/);
  });

  it("prefers the idea team tier when idea_id is provided", async () => {
    const ctx = createCtx({
      idea_agents: [createChain([{ bot: teamBot }])], // team tier wins
      bot_profiles: [
        createChain(teamBotProfile), // profile fetch — owner/global tiers never queried
      ],
      mcp_agent_sessions: [createChain(null)],
      agent_skills: [createChain([])],
    });

    const result = await setBotIdentity(
      ctx,
      setBotIdentitySchema.parse({ agent_name: "Sentinel", idea_id: IDEA_ID }),
      noop
    );

    expect((result.active_bot as { id: string }).id).toBe(TEAM_BOT_ID);
  });

  it("falls through team and owner tiers to the legacy unscoped lookup", async () => {
    const ctx = createCtx({
      idea_agents: [createChain([])], // team tier: no match
      bot_profiles: [
        createChain([]), // owner tier: no match
        createChain([otherBot]), // unscoped tier: teammate-owned bot
        createChain({ ...otherBot, system_prompt: null }), // profile fetch
      ],
      mcp_agent_sessions: [createChain(null)],
      agent_skills: [createChain([])],
    });

    const result = await setBotIdentity(
      ctx,
      setBotIdentitySchema.parse({ agent_name: "Sentinel", idea_id: IDEA_ID }),
      noop
    );

    expect((result.active_bot as { id: string }).id).toBe(OTHER_BOT_ID);
  });

  it("throws a not-found error when no tier matches", async () => {
    const ctx = createCtx({
      bot_profiles: [createChain([]), createChain([])], // owner + unscoped tiers empty
    });

    await expect(
      setBotIdentity(ctx, setBotIdentitySchema.parse({ agent_name: "Nobody" }), noop)
    ).rejects.toThrow('No agent found with name "Nobody"');
  });

  it("still surfaces the inactive-agent error for a single inactive match", async () => {
    const inactive = { ...teamBot, is_active: false };
    const ctx = createCtx({
      bot_profiles: [
        createChain([inactive]), // owner tier: single inactive match
        createChain({ ...inactive, system_prompt: null }), // profile fetch
      ],
    });

    await expect(
      setBotIdentity(ctx, setBotIdentitySchema.parse({ agent_name: "Sentinel" }), noop)
    ).rejects.toThrow(/inactive/i);
  });

  it("resets to default when neither agent_id nor agent_name is given", async () => {
    const ctx = createCtx({
      mcp_agent_sessions: [createChain(null)],
    });

    const result = await setBotIdentity(ctx, setBotIdentitySchema.parse({}), noop);
    expect(result.active_bot).toBeNull();
  });
});
