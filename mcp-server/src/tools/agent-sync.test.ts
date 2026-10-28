import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpContext } from "../context";
import { syncBoardAgents, syncBoardAgentsContent, agentSyncScriptPath, SYNC_MAX_RESULT_SIZE_CHARS } from "./agent-sync";
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

const tables: Record<string, { data: unknown; list?: unknown }> = {};
const LENS = {
  id: "87e09eb1-0c3e-4f96-9ddc-986fc10a58fd",
  name: "Lens",
  role: "Code Reviewer",
  system_prompt: "## Goal\nReview it.",
  tool_access: "read_only" as const,
};

function ctx(opts: { ownerUserId?: string } = {}): McpContext {
  const chain = (table: string) => {
    const data = tables[table]?.data ?? null;
    const list = tables[table]?.list ?? data;
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "not", "order", "limit", "range"]) c[m] = vi.fn(() => c);
    c.maybeSingle = vi.fn(() => Promise.resolve({ data, error: null }));
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ data: list, error: null }).then(resolve, reject);
    return c;
  };
  return {
    supabase: { from: (table: string) => chain(table) } as unknown as McpContext["supabase"],
    userId: opts.ownerUserId ? BOT : HUMAN,
    ownerUserId: opts.ownerUserId,
  };
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.ideas = { data: { id: IDEA } };
  tables.task_workflow_steps = { data: { bot_id: ATLAS.id, model_tier: "frontier", run_id: "run-1" }, list: [] };
  tables.bot_profiles = { data: [ATLAS] };
  tables.agent_skills = { data: [] };
  tables.users = { data: { model_tier_map: null } };
  tables.platform_settings = { data: null };
});

describe("sync_board_agents", () => {
  it("returns the claimed step's agent with the name and tag the claim hint names", async () => {
    const res = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    if (res.status !== "ok") throw new Error("expected ok");
    const hint = sessionAgentClaimHint({ bot: ATLAS, tier: "frontier", model: "opus", effort: "medium" });
    expect(res.agents[0].name).toBe(hint.name);
    expect(res.agents[0].tag).toBe(hint.tag);
    expect(res.agents[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.agents[0].bytes).toBeGreaterThan(100);
  });

  it("also saves the rest of the run's agents, claimed one first, each with the tag its own claim names", async () => {
    tables.bot_profiles = { data: [ATLAS, LENS] };
    tables.task_workflow_steps = {
      data: { bot_id: ATLAS.id, model_tier: "frontier", run_id: "run-1" },
      list: [
        { id: "s2", bot_id: LENS.id, model_tier: "standard", step_order: 2 },
        { id: "s3", bot_id: ATLAS.id, model_tier: "frontier", step_order: 3 },
      ],
    };
    const res = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.agents.map((a) => a.name)).toEqual(["vc-atlas-37e8ffb2-frontier", "vc-lens-87e09eb1-standard"]);
    const lens = sessionAgentClaimHint({ bot: LENS, tier: "standard", model: "sonnet", effort: "medium" });
    expect(res.agents[1].tag).toBe(lens.tag);
    expect(res.omitted_agents).toBe(0);
    for (const a of res.agents) expect(res.command).toContain(a.name);
    expect(syncBoardAgentsContent(res).content).toHaveLength(2);
    expect(Object.keys(JSON.parse(syncBoardAgentsContent(res).content[0].text))).toEqual(["status", "script_path", "run_command", "fallback_script_path", "fallback_run_command", "agents", "omitted_agents", "instruction"]);
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
    expect(Object.keys(summary)).toEqual(["status", "script_path", "run_command", "fallback_script_path", "fallback_run_command", "agents", "omitted_agents", "instruction"]);
    expect(summary.agents[0]).toMatchObject({ name: "vc-atlas-37e8ffb2-frontier", bytes: expect.any(Number) });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(content[1].text).toBe(res.command);
    expect(content[1].text.startsWith("(\n")).toBe(true);
  });

  it("tells the session to run it in the background, end the turn and spawn on the wake", async () => {
    const { instruction } = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    expect(instruction).toMatch(/run_in_background/);
    expect(instruction).toMatch(/end your turn/);
    expect(instruction).toMatch(/wakes you/);
    for (const word of ["READY", "NEW_FOLDER", "MISMATCH", "NOT_LOADED"]) expect(instruction).toContain(word);
    expect(instruction).toMatch(/foreground/);
    expect(instruction).toMatch(/Never print/);
    expect(instruction).toMatch(/sync again this session/);
  });

  // Card db4c7f7b: every outcome that leaves the named agent unloaded points at
  // the same-persona agent first, then at telling the user, never a quiet fallback.
  it("never offers a silent general-purpose fallback on any failure outcome", async () => {
    const { instruction } = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    expect(instruction).not.toMatch(/use the general-purpose steps/);
    for (const outcome of ["NEW_FOLDER", "MISMATCH", "NOT_LOADED"]) {
      const at = instruction.indexOf(`${outcome}:`);
      expect(at, outcome).toBeGreaterThan(-1);
      expect(instruction.slice(at, at + 400), outcome).toContain("NO-LOAD steps");
    }
    expect(instruction).toContain("declining it");
    expect(instruction).toMatch(/NO-LOAD steps: the board-named agent is never optional/);
    expect(instruction).toMatch(/another tier or effort suffix/);
    expect(instruction).toMatch(/STOP: tell the user plainly/);
    expect(instruction).toMatch(/explicitly say yes/);
  });

  // Card db4c7f7b (E): a long multi-line command was refused by a session's
  // command-safety check. The install now goes through the file-write tool and
  // one short line. These fail on the old text, which had no script_path.
  it("hands back a script path and a one-line run command, and tells the session to write the script with its file-write tool", async () => {
    const res = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.script_path).toMatch(/^~\/\.claude\/vibecodes\/agent-sync-[0-9a-f]{8}\.sh$/);
    expect(res.run_command).toBe(`sh ${res.script_path}`);
    expect(res.run_command.length).toBeLessThan(80);
    expect(res.run_command).not.toContain("\n");
    expect(res.instruction).toMatch(/file-write tool/);
    expect(res.instruction).toContain("`script_path`");
    expect(res.instruction).toContain("`run_command`");
    expect(res.instruction).toMatch(/Only if you have no file-write tool, run the SECOND block itself/);
    // Same files give the same path; different files a different one.
    const again = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    if (again.status !== "ok") throw new Error("expected ok");
    expect(again.script_path).toBe(res.script_path);
    expect(agentSyncScriptPath(["a"])).not.toBe(agentSyncScriptPath(["b"]));
    
    // The reply summary carries both fields; the script itself stays the raw second block.
    const summary = JSON.parse(syncBoardAgentsContent(res).content[0].text);
    expect(summary.run_command).toBe(res.run_command);
  });

  it("keys the NO-LOAD alternative on the claim's persona hash, never names alone", async () => {
    const { instruction } = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    expect(instruction).toContain("same `[vc <hash> ` as this step's claim");
    expect(instruction).toContain("`[vc skills-names-only` does not count");
    expect(instruction).toContain("subagent_type its name");
  });

  it("an out-of-date launch copy stops with the restart message, and a script that already exists is just run", async () => {
    const res = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    expect(res.instruction).toContain("Restart or Resume the session to load the current version");
    expect(res.instruction).toContain("If `script_path` already exists it is this same script");
    expect(res.instruction).toContain("don't overwrite or read it, just run `run_command`");
    expect(res.instruction).toContain("`fallback_script_path`");
    expect(res.instruction).toContain("first write `.claude/vibecodes/.gitignore` containing the single line `*`");
    expect(res.instruction).toContain("the script deletes itself");
    expect(res.instruction).toContain("this exact name with a different model or effort word");
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.fallback_script_path).toBe(res.script_path.replace("~/.claude/vibecodes/", ".claude/vibecodes/"));
    expect(res.fallback_run_command).toBe(`sh ${res.fallback_script_path}`);
  });

  it("tells the session every listed agent is loaded after READY, even if its listing shows an older tag", async () => {
    const { instruction } = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    expect(instruction).toMatch(/READY: every agent in `agents` is loaded/);
    expect(instruction).toMatch(/without syncing again/);
    expect(instruction).toMatch(/names the same tag/);
    expect(instruction).toMatch(/older description or tag/);
    expect(instruction).toMatch(/not offered at all or its listed description starts with "Saved by sync_board_agents\."/);
    expect(instruction).toMatch(/offered without that marker is a copy the session was launched with/);
    expect(instruction).toMatch(/once more \(at most 2 syncs per step\)/);
    expect(instruction).not.toMatch(/at most once per session/);
  });

  it("returns a command that writes a file whose fingerprint and persona are right", async () => {
    const res = await syncBoardAgents(ctx(), { idea_id: IDEA, step_id: STEP });
    if (res.status !== "ok") throw new Error("expected ok");
    const dir = mkdtempSync(join(tmpdir(), "agent-sync-tool-"));
    try {
      mkdirSync(join(dir, ".claude", "agents"), { recursive: true });
      // Play Claude Code: read the files shortly after they land.
      const child = spawn("bash", ["-c", res.command], { cwd: dir, env: { PATH: process.env.PATH ?? "", HOME: dir, NODE_ENV: "test" as const } });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      const closed = new Promise<void>((resolve) => child.on("close", () => resolve()));
      await new Promise((r) => setTimeout(r, 700));
      for (const a of res.agents) readFileSync(join(dir, ".claude", "agents", `${a.name}.md`));
      await closed;
      const r = { stdout: out };
      expect(r.stdout.trim().split("\n").pop()).toBe("READY");
      expect(r.stdout).toContain(res.agents[0].name);
      const written = readFileSync(join(dir, ".claude", "agents", `${res.agents[0].name}.md`), "utf8");
      expect(agentFileFingerprint(written)).toBe(res.agents[0].sha256);
      const parsed = parseAgentFile(written);
      expect(parsed.synced).toBe(true);
      expect(parsed.def.prompt).toContain("$(not run) `nor this`");
      expect(parsed.def.description.endsWith(res.agents[0].tag)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

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
    // Too large is a VibeCodes fault (live agents are ~5k chars): stop and report, no stand-in.
    expect(res.instruction).toContain("This is a VibeCodes fault");
    expect(res.instruction).toContain("report it");
    expect(res.instruction).toContain("NO-LOAD steps");
  });

  it("declares a result size limit above the largest possible agent file", () => {
    expect(SYNC_MAX_RESULT_SIZE_CHARS).toBeGreaterThan(AGENT_FILE_MAX_BYTES + 5_000);
    expect(SYNC_MAX_RESULT_SIZE_CHARS).toBeLessThanOrEqual(500_000);
  });
});
