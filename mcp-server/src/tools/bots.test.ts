import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { setBotIdentity, setBotIdentitySchema } from "./bots";

// ---------------------------------------------------------------------------
// set_agent_identity — Phase A deprecation stub
// (docs/agent-voice-comments-design.html §4.1, §4.3)
//
// The ambient-identity mechanism this tool used to drive is retired: it
// stays registered (a stale client gets an instructive error instead of an
// unknown-tool failure) but the handler now does nothing but reject. These
// tests replace the old name-resolution suite, which exercised logic that
// no longer exists.
// ---------------------------------------------------------------------------

const OWNER_ID = "00000000-0000-4000-a000-000000000001";
const SESSION_ID = "test-session";
const AGENT_ID = "00000000-0000-4000-a000-000000000010";

function makeCtx(): McpContext {
  const fromMock = vi.fn(() => {
    throw new Error("set_agent_identity must not touch the database");
  });
  return {
    supabase: { from: fromMock } as unknown as McpContext["supabase"],
    userId: OWNER_ID,
    ownerUserId: OWNER_ID,
    sessionId: SESSION_ID,
  } as unknown as McpContext;
}

describe("setBotIdentity (deprecation stub)", () => {
  it("rejects a reset call (no args) with the instructive error", async () => {
    const ctx = makeCtx();
    const onIdentityChange = vi.fn();

    await expect(
      setBotIdentity(ctx, setBotIdentitySchema.parse({}), onIdentityChange)
    ).rejects.toThrow(/set_agent_identity is retired/);

    expect(onIdentityChange).not.toHaveBeenCalled();
  });

  it("rejects an agent_id call the same way — args are accepted but ignored", async () => {
    const ctx = makeCtx();
    const onIdentityChange = vi.fn();

    await expect(
      setBotIdentity(ctx, setBotIdentitySchema.parse({ agent_id: AGENT_ID }), onIdentityChange)
    ).rejects.toThrow(/set_agent_identity is retired/);

    expect(onIdentityChange).not.toHaveBeenCalled();
  });

  it("names the replacements so a stale client knows what to do instead", async () => {
    const ctx = makeCtx();

    await expect(setBotIdentity(ctx, setBotIdentitySchema.parse({}), vi.fn())).rejects.toThrow(
      /claim_token[\s\S]*work_token[\s\S]*add_discussion_reply/
    );
  });

  it("never persists to mcp_agent_sessions (no DB access at all)", async () => {
    const ctx = makeCtx();

    await expect(setBotIdentity(ctx, setBotIdentitySchema.parse({}), vi.fn())).rejects.toThrow();
    expect(ctx.supabase.from).not.toHaveBeenCalled();
  });
});
