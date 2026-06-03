/**
 * Tests that MCP tool handlers use the correct identity (human vs bot)
 * when operating in bot-identity mode (ctx.ownerUserId is set).
 *
 * Rule: ctx.userId = active identity (bot when bot mode is active)
 *       ctx.ownerUserId = the real human (only set in bot mode)
 *
 * Human-identity operations (notifications, votes, idea ownership, admin checks)
 * must use ctx.ownerUserId ?? ctx.userId, NOT ctx.userId alone.
 */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { McpContext } from "./context";
import type { Database } from "../../src/types/database";
import { resolveActiveBotId } from "./bot-identity";

import { listBots, createBot } from "./tools/bots";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "./tools/notifications";
import { createIdea, deleteIdea } from "./tools/ideas";
import { toggleVote } from "./tools/votes";

const HUMAN_ID = "00000000-0000-4000-a000-000000000001";
const BOT_ID = "00000000-0000-4000-a000-000000000002";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a chainable Supabase query mock that captures .eq() and .insert() args. */
function createChain(resolveWith: unknown = null) {
  const captured = {
    eqs: [] as [string, unknown][],
    inserted: null as unknown,
    allInserts: [] as unknown[],
  };

  const chain: Record<string, unknown> = {};

  // Chainable methods that just return the chain
  for (const m of [
    "select",
    "order",
    "limit",
    "range",
    "or",
    "filter",
    "ilike",
    "delete",
    "update",
  ]) {
    chain[m] = vi.fn(() => chain);
  }

  // eq — captures column + value
  chain.eq = vi.fn((col: string, val: unknown) => {
    captured.eqs.push([col, val]);
    return chain;
  });

  // insert — captures the data object
  chain.insert = vi.fn((data: unknown) => {
    captured.inserted = data;
    captured.allInserts.push(data);
    return chain;
  });

  // Terminal methods that resolve to { data, error }
  chain.single = vi.fn(() =>
    Promise.resolve({ data: resolveWith, error: null })
  );
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: resolveWith, error: null })
  );

  // Make chain thenable for `await query` (non-terminal)
  chain.then = (resolve: (val: unknown) => void) =>
    Promise.resolve({
      data: Array.isArray(resolveWith) ? resolveWith : [],
      error: null,
    }).then(resolve);

  return { chain, captured };
}

/** Creates a McpContext in bot-identity mode. */
function botContext(fromFn: McpContext["supabase"]["from"]): McpContext {
  return {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: BOT_ID,
    ownerUserId: HUMAN_ID,
  };
}

/** Creates a McpContext in normal (no bot) mode. */
function normalContext(fromFn: McpContext["supabase"]["from"]): McpContext {
  return {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: HUMAN_ID,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bot identity context — human-identity operations", () => {
  describe("listBots", () => {
    it("queries by ownerUserId (human), not userId (bot)", async () => {
      const { chain, captured } = createChain([]);
      const ctx = botContext(() => chain as any);

      await listBots(ctx, {});

      const ownerEq = captured.eqs.find(([col]) => col === "owner_id");
      expect(ownerEq).toBeDefined();
      expect(ownerEq![1]).toBe(HUMAN_ID);
    });

    it("uses userId when ownerUserId is not set", async () => {
      const { chain, captured } = createChain([]);
      const ctx = normalContext(() => chain as any);

      await listBots(ctx, {});

      const ownerEq = captured.eqs.find(([col]) => col === "owner_id");
      expect(ownerEq![1]).toBe(HUMAN_ID);
    });
  });

  describe("listNotifications", () => {
    it("queries human's notifications, not bot's", async () => {
      const { chain, captured } = createChain([]);
      const ctx = botContext(() => chain as any);

      await listNotifications(ctx, { unread_only: false, limit: 20 });

      const userEq = captured.eqs.find(([col]) => col === "user_id");
      expect(userEq).toBeDefined();
      expect(userEq![1]).toBe(HUMAN_ID);
    });
  });

  describe("markNotificationRead", () => {
    it("marks human's notification, not bot's", async () => {
      const { chain, captured } = createChain(null);
      const ctx = botContext(() => chain as any);

      await markNotificationRead(ctx, {
        notification_id: "00000000-0000-4000-a000-000000000099",
      });

      const userEq = captured.eqs.find(([col]) => col === "user_id");
      expect(userEq).toBeDefined();
      expect(userEq![1]).toBe(HUMAN_ID);
    });
  });

  describe("markAllNotificationsRead", () => {
    it("marks human's notifications as read, not bot's", async () => {
      const { chain, captured } = createChain(null);
      const ctx = botContext(() => chain as any);

      await markAllNotificationsRead(ctx);

      const userEq = captured.eqs.find(([col]) => col === "user_id");
      expect(userEq).toBeDefined();
      expect(userEq![1]).toBe(HUMAN_ID);
    });
  });

  describe("createIdea", () => {
    it("sets author_id to human, not bot", async () => {
      const { chain, captured } = createChain({
        id: "new-idea",
        title: "Test",
        status: "open",
      });
      const ctx = botContext(() => chain as any);

      await createIdea(ctx, {
        title: "Test Idea",
        description: "A test",
        tags: [],
        visibility: "public",
      });

      expect(captured.inserted).toBeDefined();
      expect((captured.inserted as Record<string, unknown>).author_id).toBe(
        HUMAN_ID
      );
    });
  });

  describe("deleteIdea", () => {
    it("recognizes human as author even when acting as bot", async () => {
      // First from("ideas") call returns the idea owned by the human
      const selectChain = createChain({
        id: "idea-1",
        title: "My Idea",
        author_id: HUMAN_ID,
      });
      // Second from("ideas") call is the delete
      const deleteChain = createChain(null);
      let ideaCallNum = 0;

      const ctx = botContext((table: string) => {
        if (table === "ideas") {
          ideaCallNum++;
          return (ideaCallNum === 1
            ? selectChain.chain
            : deleteChain.chain) as any;
        }
        return createChain(null).chain as any;
      });

      // Should succeed because human is the author
      const result = await deleteIdea(ctx, {
        idea_id: "00000000-0000-4000-a000-000000000010",
      });
      expect(result.success).toBe(true);
    });

    it("checks human's admin status, not bot's", async () => {
      // Idea is owned by someone else
      const selectChain = createChain({
        id: "idea-2",
        title: "Other Idea",
        author_id: "00000000-0000-4000-a000-000000000099",
      });
      const usersChain = createChain({ is_admin: true });
      const deleteChain = createChain(null);
      let ideaCallNum = 0;

      const ctx = botContext((table: string) => {
        if (table === "users") return usersChain.chain as any;
        if (table === "ideas") {
          ideaCallNum++;
          return (ideaCallNum === 1
            ? selectChain.chain
            : deleteChain.chain) as any;
        }
        return createChain(null).chain as any;
      });

      const result = await deleteIdea(ctx, {
        idea_id: "00000000-0000-4000-a000-000000000010",
      });

      // Admin check should query the human's profile
      const adminEq = usersChain.captured.eqs.find(([col]) => col === "id");
      expect(adminEq).toBeDefined();
      expect(adminEq![1]).toBe(HUMAN_ID);
      expect(result.success).toBe(true);
    });
  });

  describe("toggleVote", () => {
    it("votes as human, not bot", async () => {
      // No existing vote — will insert
      const { chain, captured } = createChain(null);
      const ctx = botContext(() => chain as any);

      await toggleVote(ctx, {
        idea_id: "00000000-0000-4000-a000-000000000010",
      });

      // Check that user_id in the eq (existence check) is the human
      const userEqs = captured.eqs.filter(([col]) => col === "user_id");
      expect(userEqs.length).toBeGreaterThan(0);
      for (const [, val] of userEqs) {
        expect(val).toBe(HUMAN_ID);
      }

      // Check that the insert also uses human ID
      expect(captured.inserted).toBeDefined();
      expect((captured.inserted as Record<string, unknown>).user_id).toBe(
        HUMAN_ID
      );
    });
  });

  describe("createBot", () => {
    it("sets owner_id to human, not bot", async () => {
      const rpcMock = vi.fn().mockResolvedValue({ data: BOT_ID, error: null });
      const { chain } = createChain({
        id: BOT_ID,
        name: "TestBot",
        role: "Tester",
        system_prompt: null,
        is_active: true,
        avatar_url: null,
      });

      const ctx: McpContext = {
        supabase: {
          rpc: rpcMock,
          from: () => chain,
        } as unknown as McpContext["supabase"],
        userId: BOT_ID,
        ownerUserId: HUMAN_ID,
      };

      await createBot(ctx, { name: "TestBot", role: "Tester" });

      expect(rpcMock).toHaveBeenCalledWith("create_bot_user", {
        p_name: "TestBot",
        p_owner_id: HUMAN_ID,
        p_role: "Tester",
        p_system_prompt: null,
        p_avatar_url: null,
      });
    });
  });
});

describe("bot identity context — bot-identity operations", () => {
  // These should use ctx.userId (the bot), NOT ownerUserId

  describe("addIdeaComment", () => {
    it("posts as bot identity (userId), not human", async () => {
      const { addIdeaComment } = await import("./tools/comments");

      const { chain, captured } = createChain({
        id: "comment-1",
        content: "Hello",
        type: "comment",
        created_at: new Date().toISOString(),
      });
      const ctx = botContext(() => chain as any);

      await addIdeaComment(ctx, {
        idea_id: "00000000-0000-4000-a000-000000000010",
        content: "Hello from bot",
        type: "comment",
      });

      expect(captured.inserted).toBeDefined();
      expect((captured.inserted as Record<string, unknown>).author_id).toBe(
        BOT_ID
      );
    });
  });

  describe("addTaskComment", () => {
    it("posts as bot identity (userId), not human", async () => {
      const { addTaskComment } = await import("./tools/comments");

      const { chain, captured } = createChain({
        id: "tc-1",
        content: "Task note",
        created_at: new Date().toISOString(),
      });
      const ctx = botContext(() => chain as any);

      await addTaskComment(ctx, {
        task_id: "00000000-0000-4000-a000-000000000020",
        idea_id: "00000000-0000-4000-a000-000000000010",
        content: "Task note from bot",
      });

      // First insert is the comment, second is the activity log
      const commentInsert = captured.allInserts[0] as Record<string, unknown>;
      expect(commentInsert).toBeDefined();
      expect(commentInsert.author_id).toBe(BOT_ID);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveActiveBotId — per-request identity resolution from the DB
// ---------------------------------------------------------------------------

/**
 * Build a Supabase client mock whose `.from("users")` resolves to the given
 * active_bot_id and `.from("bot_profiles")` resolves to the given bot row.
 * Records which tables were queried so we can assert read behaviour.
 */
function resolveClient(opts: {
  activeBotId: string | null;
  bot?: { id: string; is_active: boolean } | null;
}) {
  const tablesQueried: string[] = [];
  const client = {
    from: (table: string) => {
      tablesQueried.push(table);
      const data =
        table === "users"
          ? { active_bot_id: opts.activeBotId }
          : (opts.bot ?? null);
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }));
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, tablesQueried };
}

describe("resolveActiveBotId", () => {
  it("returns null when the user has no active_bot_id (acts as owner)", async () => {
    const { client, tablesQueried } = resolveClient({ activeBotId: null });
    const result = await resolveActiveBotId(client, HUMAN_ID);
    expect(result).toBeNull();
    // Short-circuits before querying bot_profiles
    expect(tablesQueried).toEqual(["users"]);
  });

  it("returns the bot id when the active bot exists and is active", async () => {
    const { client, tablesQueried } = resolveClient({
      activeBotId: BOT_ID,
      bot: { id: BOT_ID, is_active: true },
    });
    const result = await resolveActiveBotId(client, HUMAN_ID);
    expect(result).toBe(BOT_ID);
    expect(tablesQueried).toEqual(["users", "bot_profiles"]);
  });

  it("returns null when the active bot is inactive (falls back to owner)", async () => {
    const { client } = resolveClient({
      activeBotId: BOT_ID,
      bot: { id: BOT_ID, is_active: false },
    });
    expect(await resolveActiveBotId(client, HUMAN_ID)).toBeNull();
  });

  it("returns null when active_bot_id points to a missing bot row", async () => {
    const { client } = resolveClient({ activeBotId: BOT_ID, bot: null });
    expect(await resolveActiveBotId(client, HUMAN_ID)).toBeNull();
  });

  it("reads the DB on every call — no caching across calls", async () => {
    // First call: bot active. Second call (after a hypothetical identity switch
    // to none): must reflect the new DB state, not a cached value.
    const active = resolveClient({ activeBotId: BOT_ID, bot: { id: BOT_ID, is_active: true } });
    expect(await resolveActiveBotId(active.client, HUMAN_ID)).toBe(BOT_ID);

    const cleared = resolveClient({ activeBotId: null });
    expect(await resolveActiveBotId(cleared.client, HUMAN_ID)).toBeNull();
  });
});
