import { describe, it, expect } from "vitest";
import { resolveAgentLaunch, normalizeAgent } from "./agent-launch";

const MINTED = "11111111-2222-3333-4444-555555555555";
const RESUME_ID = "99999999-8888-7777-6666-555555555555";

describe("normalizeAgent", () => {
  it("recognises exactly the literal 'codex'", () => {
    expect(normalizeAgent("codex")).toBe("codex");
  });

  it("falls back to 'claude' for absent/unknown/garbage values (FR-1 default)", () => {
    for (const v of [undefined, null, "", "claude", "chatgpt", "Codex", "codex "]) {
      expect(normalizeAgent(v)).toBe("claude");
    }
  });
});

// ── Claude behaviour is unchanged (byte-for-byte mirrors resume-cmd.js) ────

describe("resolveAgentLaunch — claude (unchanged behaviour)", () => {
  it("a brand-new session mints an id and spawns `claude --session-id <id>`", () => {
    const result = resolveAgentLaunch({ mintId: () => MINTED });
    expect(result).toEqual({ cmd: `claude --session-id ${MINTED}`, conv: MINTED });
  });

  it("a resumeId spawns `claude --resume <id>` and announces that same id", () => {
    const result = resolveAgentLaunch({ resumeId: RESUME_ID, mintId: () => MINTED });
    expect(result).toEqual({ cmd: `claude --resume ${RESUME_ID}`, conv: RESUME_ID });
  });

  it("the legacy resume flag spawns `claude --continue` and announces nothing", () => {
    const result = resolveAgentLaunch({ resume: true, mintId: () => MINTED });
    expect(result).toEqual({ cmd: "claude --continue", conv: null });
  });

  it("model/permissionMode/worktree still append together on a fresh Claude mint", () => {
    const result = resolveAgentLaunch({
      model: "opus",
      permissionMode: "auto",
      worktree: true,
      mintId: () => MINTED,
    });
    expect(result.cmd).toBe(
      `claude --session-id ${MINTED} --model opus --permission-mode auto --worktree ${MINTED}`,
    );
  });

  it("an explicit --cmd override wins over everything and never mints", () => {
    let minted = false;
    const result = resolveAgentLaunch({
      agent: "codex", // even set — explicitCmd still wins first
      explicitCmd: "bash",
      resumeId: RESUME_ID,
      resume: true,
      mintId: () => {
        minted = true;
        return MINTED;
      },
    });
    expect(result).toEqual({ cmd: "bash", conv: null });
    expect(minted).toBe(false);
  });
});

// ── Codex (AC-3) ────────────────────────────────────────────────────────────

describe("resolveAgentLaunch — codex (AC-3)", () => {
  it("a fresh codex launch spawns exactly `codex`, conv null, and never mints", () => {
    let minted = false;
    const result = resolveAgentLaunch({
      agent: "codex",
      mintId: () => {
        minted = true;
        return MINTED;
      },
    });
    expect(result).toEqual({ cmd: "codex", conv: null });
    expect(minted).toBe(false); // Codex has no pre-assignable session id (§2.2)
  });

  it("the legacy resume flag spawns `codex resume --last`, conv null", () => {
    const result = resolveAgentLaunch({ agent: "codex", resume: true, mintId: () => MINTED });
    expect(result).toEqual({ cmd: "codex resume --last", conv: null });
  });

  it("a resumeId spawns `codex resume <id>` and announces that same id", () => {
    const result = resolveAgentLaunch({ agent: "codex", resumeId: RESUME_ID, mintId: () => MINTED });
    expect(result).toEqual({ cmd: `codex resume ${RESUME_ID}`, conv: RESUME_ID });
  });

  it("resumeId wins over the legacy resume flag when both are somehow set, same as Claude", () => {
    const result = resolveAgentLaunch({
      agent: "codex",
      resumeId: RESUME_ID,
      resume: true,
      mintId: () => MINTED,
    });
    expect(result.cmd).toBe(`codex resume ${RESUME_ID}`);
  });

  it("NEVER emits --model, --permission-mode, --session-id or --worktree, no matter what is passed in (AC-3)", () => {
    const result = resolveAgentLaunch({
      agent: "codex",
      model: "claude-x",
      permissionMode: "auto",
      worktree: true,
      mintId: () => MINTED,
    });
    expect(result.cmd).toBe("codex");
    expect(result.cmd).not.toContain("--model");
    expect(result.cmd).not.toContain("--permission-mode");
    expect(result.cmd).not.toContain("--session-id");
    expect(result.cmd).not.toContain("--worktree");
    expect(result.conv).toBeNull();
  });

  it("Claude-only flags are also never emitted on codex resume/resumeId branches", () => {
    const resumed = resolveAgentLaunch({
      agent: "codex",
      resumeId: RESUME_ID,
      model: "claude-x",
      permissionMode: "auto",
      worktree: true,
      mintId: () => MINTED,
    });
    expect(resumed.cmd).toBe(`codex resume ${RESUME_ID}`);

    const legacy = resolveAgentLaunch({
      agent: "codex",
      resume: true,
      model: "claude-x",
      permissionMode: "auto",
      worktree: true,
      mintId: () => MINTED,
    });
    expect(legacy.cmd).toBe("codex resume --last");
  });

  it("an explicit --cmd override still wins for codex too", () => {
    const result = resolveAgentLaunch({ agent: "codex", explicitCmd: "bash", mintId: () => MINTED });
    expect(result).toEqual({ cmd: "bash", conv: null });
  });
});
