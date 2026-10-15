import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { McpContext } from "../context";
import { syncBoardAgents } from "./agent-sync";
import { verifyAgentFilesToken } from "../../../src/lib/agent-files-token";

const HUMAN = "00000000-0000-4000-a000-000000000001";
const BOT = "00000000-0000-4000-a000-000000000002";
const IDEA = "00000000-0000-4000-a000-0000000000aa";

function ctx(opts: { member: boolean; ownerUserId?: string }): McpContext {
  const chain = (data: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) c[m] = vi.fn(() => c);
    c.maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }));
    return c;
  };
  return {
    supabase: {
      from: (table: string) => chain(table === "ideas" && opts.member ? { id: IDEA } : null),
    } as unknown as McpContext["supabase"],
    userId: opts.ownerUserId ? BOT : HUMAN,
    ownerUserId: opts.ownerUserId,
  };
}

beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vibecodes.example/");
});
afterEach(() => vi.unstubAllEnvs());

describe("sync_board_agents", () => {
  it("returns a command whose url carries a five-minute token for the human and the idea", async () => {
    const res = await syncBoardAgents(ctx({ member: true }), { idea_id: IDEA });
    const url = /'(https:\/\/vibecodes\.example\/api\/terminal\/agent-files\?t=[^']+)'/.exec(res.command)![1];
    const token = new URL(url).searchParams.get("t")!;
    expect(verifyAgentFilesToken(token, "test-secret")).toEqual({ ok: true, sub: HUMAN, idea: IDEA });
    const secondsLeft = Math.round((Date.parse(res.expires_at) - Date.now()) / 1000);
    expect(secondsLeft).toBeGreaterThan(280);
    expect(secondsLeft).toBeLessThanOrEqual(300);
  });

  it("binds the token to the real human, not the bot identity", async () => {
    const res = await syncBoardAgents(ctx({ member: true, ownerUserId: HUMAN }), { idea_id: IDEA });
    const token = new URL(/'([^']+agent-files[^']+)'/.exec(res.command)![1]).searchParams.get("t")!;
    expect(verifyAgentFilesToken(token, "test-secret")).toMatchObject({ sub: HUMAN });
  });

  it("tells the session to run it once, keep the files out of view and carry on if it fails", async () => {
    const { instruction } = await syncBoardAgents(ctx({ member: true }), { idea_id: IDEA });
    expect(instruction).toMatch(/once/);
    expect(instruction).toMatch(/project folder/);
    expect(instruction).toMatch(/never (print|show|edit|commit)/i);
    expect(instruction).toMatch(/fails/);
    expect(instruction).toMatch(/general/);
  });

  it("refuses someone who isn't on the board", async () => {
    await expect(syncBoardAgents(ctx({ member: false }), { idea_id: IDEA })).rejects.toThrow(/team/i);
  });

  it("explains that the local stdio server can't do this", async () => {
    vi.stubEnv("TERMINAL_SESSION_SECRET", "");
    await expect(syncBoardAgents(ctx({ member: true }), { idea_id: IDEA })).rejects.toThrow(/remote|connector|stdio/i);
  });

  it("falls back to the production url when the app url is blank", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "  ");
    const res = await syncBoardAgents(ctx({ member: true }), { idea_id: IDEA });
    expect(res.command).toContain("https://vibecodes.co.uk/api/terminal/agent-files?t=");
  });
});
