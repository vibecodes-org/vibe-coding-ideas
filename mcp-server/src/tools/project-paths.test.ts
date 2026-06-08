/**
 * Tests for record_project_path:
 *  - rejects non-absolute / empty / tilde paths (validation error path)
 *  - upserts on (idea_id, owner_user_id, hostname)
 *  - binds owner_user_id to the REAL human (ctx.ownerUserId), never the bot
 *    (Design Review change #4)
 */
import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { recordProjectPath } from "./project-paths";

const HUMAN_ID = "00000000-0000-4000-a000-000000000001";
const BOT_ID = "00000000-0000-4000-a000-000000000002";
const IDEA_ID = "00000000-0000-4000-a000-0000000000aa";

/** Chainable supabase mock capturing the upsert payload + onConflict option. */
function createChain(resolveWith: unknown) {
  const captured = {
    upserted: null as unknown,
    onConflict: null as unknown,
  };
  const chain: Record<string, unknown> = {};
  chain.upsert = vi.fn((data: unknown, opts: { onConflict?: string }) => {
    captured.upserted = data;
    captured.onConflict = opts?.onConflict ?? null;
    return chain;
  });
  chain.select = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({ data: resolveWith, error: null }));
  return { chain, captured };
}

function botContext(fromFn: McpContext["supabase"]["from"]): McpContext {
  return {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: BOT_ID,
    ownerUserId: HUMAN_ID,
  };
}

function normalContext(fromFn: McpContext["supabase"]["from"]): McpContext {
  return {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: HUMAN_ID,
  };
}

const STORED = {
  id: "row-1",
  idea_id: IDEA_ID,
  hostname: "Nicks-MacBook",
  absolute_path: "/Users/nick/projects/vibecodes",
  updated_at: "2026-06-08T00:00:00.000Z",
};

describe("recordProjectPath — validation (error path)", () => {
  it("rejects an empty absolute_path", async () => {
    const { chain } = createChain(STORED);
    const ctx = normalContext(() => chain as never);
    await expect(
      recordProjectPath(ctx, { idea_id: IDEA_ID, hostname: "host", absolute_path: "  " })
    ).rejects.toThrow(/absolute path/i);
  });

  it("rejects a relative path", async () => {
    const { chain } = createChain(STORED);
    const ctx = normalContext(() => chain as never);
    await expect(
      recordProjectPath(ctx, { idea_id: IDEA_ID, hostname: "host", absolute_path: "projects/x" })
    ).rejects.toThrow(/absolute path/i);
  });

  it("rejects a tilde-home path (must be the expanded pwd)", async () => {
    const { chain } = createChain(STORED);
    const ctx = normalContext(() => chain as never);
    await expect(
      recordProjectPath(ctx, {
        idea_id: IDEA_ID,
        hostname: "host",
        absolute_path: "~/projects/x",
      })
    ).rejects.toThrow(/absolute path/i);
  });

  it("rejects an empty hostname", async () => {
    const { chain } = createChain(STORED);
    const ctx = normalContext(() => chain as never);
    await expect(
      recordProjectPath(ctx, {
        idea_id: IDEA_ID,
        hostname: "   ",
        absolute_path: "/Users/nick/x",
      })
    ).rejects.toThrow(/hostname/i);
  });

  it("does NOT touch the database when validation fails", async () => {
    const { chain, captured } = createChain(STORED);
    const ctx = normalContext(() => chain as never);
    await expect(
      recordProjectPath(ctx, { idea_id: IDEA_ID, hostname: "host", absolute_path: "" })
    ).rejects.toThrow();
    expect(captured.upserted).toBeNull();
  });
});

describe("recordProjectPath — upsert (happy path)", () => {
  it("upserts on (idea_id, owner_user_id, hostname) and returns the stored value", async () => {
    const { chain, captured } = createChain(STORED);
    const ctx = normalContext(() => chain as never);

    const result = await recordProjectPath(ctx, {
      idea_id: IDEA_ID,
      hostname: "Nicks-MacBook",
      absolute_path: "/Users/nick/projects/vibecodes",
    });

    expect(captured.onConflict).toBe("idea_id,owner_user_id,hostname");
    expect(result.success).toBe(true);
    expect(result.recorded.absolute_path).toBe("/Users/nick/projects/vibecodes");
    expect(result.recorded.hostname).toBe("Nicks-MacBook");
  });

  it("binds owner_user_id to the human (ownerUserId), NOT the bot (Change #4)", async () => {
    const { chain, captured } = createChain(STORED);
    const ctx = botContext(() => chain as never);

    await recordProjectPath(ctx, {
      idea_id: IDEA_ID,
      hostname: "Nicks-MacBook",
      absolute_path: "/Users/nick/projects/vibecodes",
    });

    const payload = captured.upserted as { owner_user_id: string };
    expect(payload.owner_user_id).toBe(HUMAN_ID);
    expect(payload.owner_user_id).not.toBe(BOT_ID);
  });

  it("falls back to userId when ownerUserId is not set (normal mode)", async () => {
    const { chain, captured } = createChain(STORED);
    const ctx = normalContext(() => chain as never);

    await recordProjectPath(ctx, {
      idea_id: IDEA_ID,
      hostname: "host",
      absolute_path: "/Users/nick/x",
    });

    const payload = captured.upserted as { owner_user_id: string };
    expect(payload.owner_user_id).toBe(HUMAN_ID);
  });

  it("trims the absolute_path and hostname before storing", async () => {
    const { chain, captured } = createChain(STORED);
    const ctx = normalContext(() => chain as never);

    await recordProjectPath(ctx, {
      idea_id: IDEA_ID,
      hostname: "  host  ",
      absolute_path: "  /Users/nick/x  ",
    });

    const payload = captured.upserted as { absolute_path: string; hostname: string };
    expect(payload.absolute_path).toBe("/Users/nick/x");
    expect(payload.hostname).toBe("host");
  });
});
