import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpContext } from "../context";
import { syncBoardAgents, syncBoardAgentsContent, SYNC_MAX_RESULT_SIZE_CHARS } from "./agent-sync";
import { agentFileFingerprint, parseAgentFile, AGENT_FILE_MAX_BYTES } from "../../../src/lib/terminal/session-agent-files";
import { sessionAgentClaimHint } from "../../../src/lib/terminal/session-agents";

const HUMAN = "00000000-0000-4000-a000-000000000001";
const BOT = "00000000-0000-4000-a000-000000000002";
const IDEA = "00000000-0000-4000-a000-0000000000aa";
const STEP = "00000000-0000-4000-a000-0000000000bb";
const ATLAS = {
  id: "37e8ffb2-3f88-49e5-9ab4-a516c1088f77",
  name: "Atlas",
  role: "Full Stack Engineer",
  system_prompt: "## Goal\nShip it.\n\n$(not run) `nor this`",
  tool_access: "full" as const,
};

const tables: Record<string, { data: unknown }> = {};

function ctx(opts: { ownerUserId?: string } = {}): McpContext {
  const chain = (data: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "not", "order", "limit", "range"]) c[m] = vi.fn(() => c);
    c.maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }));
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve, reject);
    return c;
  };
  return {
    supabase: { from: (table: string) => chain(tables[table]?.data ?? null) } as unknown as McpContext["supabase"],
    userId: opts.ownerUserId ? BOT : HUMAN,
    ownerUserId: opts.ownerUserId,
  };
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.ideas = { data: { id: IDEA } };
  tables.task_workflow_steps = { data: { bot_id: ATLAS.id, model_tier: "frontier" } };
  tables.bot_profiles = { data: [ATLAS] };
  tables.agent_skills = { data: [] };
  tables.users = { data: { model_tier_map: null } };
  tables.platform_settings = { data: null };
});

describe("sync_board_agents", () => {
  it("returns the claimed step's agent with the name and tag the claim hint names", async () => {
    const res = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    if (res.status !== "ok") throw new Error("expected ok");
    const hint = sessionAgentClaimHint({ bot: ATLAS, tier: "frontier", model: "opus", effort: "high" });
    expect(res.agent.name).toBe(hint.name);
    expect(res.agent.tag).toBe(hint.tag);
    expect(res.agent.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.agent.bytes).toBeGreaterThan(100);
  });

  it("needs no network and no secret: the command has no download tool", async () => {
    const res = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.command).not.toMatch(/curl|wget|http/i);
  });

  it("works for the local stdio identity (no signing secret anywhere)", async () => {
    const saved = process.env.TERMINAL_SESSION_SECRET;
    delete process.env.TERMINAL_SESSION_SECRET;
    try {
      const res = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
      expect(res.status).toBe("ok");
    } finally {
      if (saved !== undefined) process.env.TERMINAL_SESSION_SECRET = saved;
    }
  });

  it("puts the summary in one text block and the command raw in a second", async () => {
    const res = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    const { content } = syncBoardAgentsContent(res);
    expect(content).toHaveLength(2);
    const summary = JSON.parse(content[0].text);
    expect(Object.keys(summary)).toEqual(["status", "agent", "instruction"]);
    expect(summary.agent).toMatchObject({ name: "vc-atlas-37e8ffb2-frontier", bytes: expect.any(Number) });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(content[1].text).toBe(res.command);
    expect(content[1].text.startsWith("(\n")).toBe(true);
  });

  it("tells the session to run it in the background, end the turn and spawn on the wake", async () => {
    const { instruction } = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    expect(instruction).toMatch(/run_in_background/);
    expect(instruction).toMatch(/end your turn/);
    expect(instruction).toMatch(/wakes you/);
    for (const word of ["READY", "NEW_FOLDER", "MISMATCH"]) expect(instruction).toContain(word);
    expect(instruction).toMatch(/general-purpose/);
    expect(instruction).toMatch(/foreground/);
    expect(instruction).toMatch(/Never print/);
    expect(instruction).toMatch(/sync again this session/);
  });

  it("returns a command that writes a file whose fingerprint and persona are right", async () => {
    const res = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    if (res.status !== "ok") throw new Error("expected ok");
    const dir = mkdtempSync(join(tmpdir(), "agent-sync-tool-"));
    try {
      mkdirSync(join(dir, ".claude", "agents"), { recursive: true });
      const fast = res.command.replace("sleep 5", "sleep 0");
      const r = spawnSync("bash", ["-c", fast], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: dir, NODE_ENV: "test" as const } });
      expect(r.stdout.trim().split("\n").pop()).toBe("READY");
      const written = readFileSync(join(dir, ".claude", "agents", `${res.agent.name}.md`), "utf8");
      expect(agentFileFingerprint(written)).toBe(res.agent.sha256);
      const parsed = parseAgentFile(written);
      expect(parsed.synced).toBe(true);
      expect(parsed.def.prompt).toContain("$(not run) `nor this`");
      expect(parsed.def.description.endsWith(res.agent.tag)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("binds the membership check to the real human, not the bot identity", async () => {
    tables.ideas = { data: null };
    await expect(syncBoardAgents(ctx({ ownerUserId: HUMAN }), { idea_id: IDEA, step_id: STEP })).rejects.toThrow(/team/i);
  });

  it("refuses someone who isn't on the board", async () => {
    tables.ideas = { data: null };
    await expect(syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP })).rejects.toThrow(/team/i);
  });

  it("explains when the step has no agent to sync", async () => {
    tables.task_workflow_steps = { data: null };
    await expect(syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP })).rejects.toThrow(/nothing to sync/);
  });

  it("answers too_large, with no command, for an agent over the size limit", async () => {
    tables.bot_profiles = { data: [{ ...ATLAS, system_prompt: "x".repeat(AGENT_FILE_MAX_BYTES + 10) }] };
    const res = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    expect(res.status).toBe("too_large");
    expect(res).not.toHaveProperty("command");
    expect(syncBoardAgentsContent(res).content).toHaveLength(1);
  });

  it("declares a result size limit above the largest possible agent file", () => {
    expect(SYNC_MAX_RESULT_SIZE_CHARS).toBeGreaterThan(AGENT_FILE_MAX_BYTES + 5_000);
    expect(SYNC_MAX_RESULT_SIZE_CHARS).toBeLessThanOrEqual(500_000);
  });
});
