import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSessionAgents, type SessionAgentInput } from "./session-agents";
import {
  AGENT_FILE_MAX_BYTES,
  AGENT_FILE_NAME_PATTERN,
  SYNC_MARKER,
  agentFileFingerprint,
  agentFileSyncCommand,
  parseAgentFile,
  renderAgentFile,
} from "./session-agent-files";

const ATLAS = {
  id: "37e8ffb2-3f88-49e5-9ab4-a516c1088f77",
  name: "Atlas",
  role: "Full Stack Engineer",
  system_prompt: "## Goal\nShip it.\n\n---\nNot a frontmatter fence: \"quoted\" and 'single' and: colons.",
};
const LENS = {
  id: "87e09eb1-0c3e-4f96-9ddc-986fc10a58fd",
  name: "Lens",
  role: "Code Reviewer",
  system_prompt: "## Goal\nReview it.",
  tool_access: "read_only" as const,
};

function input(bot: SessionAgentInput["bot"], over: Partial<SessionAgentInput> = {}): SessionAgentInput {
  return { bot, tier: "frontier", model: "opus", effort: "high", skills: [], ...over };
}

const AGENTS = buildSessionAgents([input(ATLAS), input(LENS, { tier: "standard", model: "sonnet", effort: "medium" })])!;

describe("renderAgentFile / parseAgentFile", () => {
  it("round-trips every definition buildSessionAgents produces", () => {
    for (const [name, def] of Object.entries(AGENTS)) {
      expect(parseAgentFile(renderAgentFile(name, def))).toEqual({ name, def, synced: false });
      expect(parseAgentFile(renderAgentFile(name, def, { synced: true }))).toEqual({ name, def, synced: true });
    }
  });

  it("keeps the prompt byte-for-byte as the body, ending in exactly one newline", () => {
    const [name, def] = Object.entries(AGENTS)[0];
    const file = renderAgentFile(name, def);
    expect(file.endsWith(`${def.prompt}\n`)).toBe(true);
    expect(file.endsWith("\n\n")).toBe(false);
    expect(renderAgentFile(name, { ...def, prompt: `${def.prompt}\n\n\n` }).endsWith(`${def.prompt}\n`)).toBe(true);
  });

  it("marks a synced file at the start of the description and keeps the tag last", () => {
    const [name, def] = Object.entries(AGENTS)[0];
    const parsed = parseAgentFile(renderAgentFile(name, def, { synced: true }));
    expect(parsed.synced).toBe(true);
    const raw = /^description: (.*)$/m.exec(renderAgentFile(name, def, { synced: true }))![1];
    const description = JSON.parse(raw) as string;
    expect(description.startsWith(`${SYNC_MARKER} `)).toBe(true);
    expect(description.endsWith(def.description.slice(def.description.lastIndexOf("[vc ")))).toBe(true);
  });

  it("carries disallowedTools for a read-only agent and omits the field for full access", () => {
    const lens = Object.entries(AGENTS).find(([n]) => n.startsWith("vc-lens"))!;
    const atlas = Object.entries(AGENTS).find(([n]) => n.startsWith("vc-atlas"))!;
    expect(renderAgentFile(...lens)).toContain("disallowedTools: Edit, Write, NotebookEdit");
    expect(renderAgentFile(...atlas)).not.toContain("disallowedTools");
  });

  it("omits model and effort on an Auto step", () => {
    const auto = buildSessionAgents([input(ATLAS, { tier: null, model: null, effort: null })])!;
    const [name, def] = Object.entries(auto)[0];
    const file = renderAgentFile(name, def);
    expect(file).not.toMatch(/^model:/m);
    expect(file).not.toMatch(/^effort:/m);
    expect(parseAgentFile(file)).toEqual({ name, def, synced: false });
  });

  it("rejects a name that isn't a safe vc- filename", () => {
    const def = Object.values(AGENTS)[0];
    expect(() => renderAgentFile("../evil", def)).toThrow();
    expect(() => renderAgentFile("vc-UPPER", def)).toThrow();
  });

  it("every generated name is a valid filename", () => {
    for (const name of Object.keys(AGENTS)) expect(`${name}.md`).toMatch(AGENT_FILE_NAME_PATTERN);
  });
});

describe("agentFileFingerprint", () => {
  it("ignores trailing whitespace on lines and trailing newlines, nothing else", () => {
    const base = "a\nb c\n\nd";
    const fp = agentFileFingerprint(base);
    expect(agentFileFingerprint("a  \nb c\t\r\n\nd\n\n\n")).toBe(fp);
    expect(agentFileFingerprint("a\nb  c\n\nd")).not.toBe(fp);
    expect(agentFileFingerprint(" a\nb c\n\nd")).not.toBe(fp);
    expect(agentFileFingerprint("a\nb c\nd")).not.toBe(fp);
  });
});

// The command is run for real, in throwaway directories (never this repo's
// .claude/agents, never the real ~/.claude).
describe("agentFileSyncCommand", () => {
  const [NAME, DEF] = Object.entries(AGENTS)[0];
  const FILE = renderAgentFile(NAME, DEF, { synced: true });
  const SHA = agentFileFingerprint(FILE);
  const cmd = (over: Partial<Parameters<typeof agentFileSyncCommand>[0]> = {}) =>
    agentFileSyncCommand({ name: NAME, content: FILE, sha256: SHA, settleSeconds: 0, ...over });

  function sandbox() {
    const root = mkdtempSync(join(tmpdir(), "agent-sync-"));
    const repo = join(root, "repo");
    const home = join(root, "home");
    mkdirSync(repo);
    mkdirSync(home);
    return { root, repo, home };
  }
  function run(command: string, cwd: string, home: string, env: Record<string, string> = {}) {
    const clean = { PATH: process.env.PATH ?? "", HOME: home, NODE_ENV: "test" as const, ...env };
    return spawnSync("bash", ["-c", command], { cwd, encoding: "utf8", env: clean });
  }
  const last = (out: string) => out.trim().split("\n").pop();

  it("is valid bash and contains no network tool", () => {
    expect(spawnSync("bash", ["-n"], { input: cmd(), encoding: "utf8" }).status).toBe(0);
    expect(cmd()).not.toMatch(/curl|wget|http/i);
  });

  it("rejects an unsafe name or a bad fingerprint", () => {
    expect(() => cmd({ name: "../evil" })).toThrow();
    expect(() => cmd({ sha256: "nope" })).toThrow();
  });

  it("writes the file byte-for-byte into an existing project folder and says READY", () => {
    const { root, repo, home } = sandbox();
    try {
      execFileSync("git", ["init", "-q", repo]);
      mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
      const r = run(cmd(), repo, home);
      expect(r.status).toBe(0);
      expect(last(r.stdout)).toBe("READY");
      expect(readFileSync(join(repo, ".claude", "agents", `${NAME}.md`), "utf8")).toBe(FILE);
      expect(readdirSync(join(repo, ".claude", "agents")).filter((f) => f.startsWith(`.${NAME}`))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("adds a .gitignore in the project folder, so git stays clean apart from it", () => {
    const { root, repo, home } = sandbox();
    try {
      execFileSync("git", ["init", "-q", repo]);
      mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
      run(cmd(), repo, home);
      expect(readFileSync(join(repo, ".claude", "agents", ".gitignore"), "utf8")).toBe("vc-*.md\n");
      const status = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: repo, encoding: "utf8" });
      expect(status).not.toContain(".md");
      expect(status).toContain(".claude/agents/.gitignore");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes no .gitignore when the repo's own rules already ignore the file", () => {
    const { root, repo, home } = sandbox();
    try {
      execFileSync("git", ["init", "-q", repo]);
      writeFileSync(join(repo, ".gitignore"), ".claude/agents/vc-*.md\n");
      mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
      run(cmd(), repo, home);
      expect(existsSync(join(repo, ".claude", "agents", ".gitignore"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("appends the pattern to an existing agents .gitignore that lacks it, and never twice", () => {
    const { root, repo, home } = sandbox();
    try {
      execFileSync("git", ["init", "-q", repo]);
      mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
      writeFileSync(join(repo, ".claude", "agents", ".gitignore"), "other.md\n");
      run(cmd(), repo, home);
      run(cmd(), repo, home);
      expect(readFileSync(join(repo, ".claude", "agents", ".gitignore"), "utf8")).toBe("other.md\nvc-*.md\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to the user-level folder, honouring CLAUDE_CONFIG_DIR, and leaves git alone", () => {
    const { root, repo, home } = sandbox();
    try {
      execFileSync("git", ["init", "-q", repo]);
      const cfg = join(root, "cfg");
      mkdirSync(join(cfg, "agents"), { recursive: true });
      const r = run(cmd(), repo, home, { CLAUDE_CONFIG_DIR: cfg });
      expect(last(r.stdout)).toBe("READY");
      expect(readFileSync(join(cfg, "agents", `${NAME}.md`), "utf8")).toBe(FILE);
      expect(existsSync(join(repo, ".claude"))).toBe(false);

      mkdirSync(join(home, ".claude", "agents"), { recursive: true });
      const r2 = run(cmd(), repo, home);
      expect(last(r2.stdout)).toBe("READY");
      expect(existsSync(join(home, ".claude", "agents", `${NAME}.md`))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers the project folder over the user folder", () => {
    const { root, repo, home } = sandbox();
    try {
      mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
      mkdirSync(join(home, ".claude", "agents"), { recursive: true });
      run(cmd(), repo, home);
      expect(existsSync(join(repo, ".claude", "agents", `${NAME}.md`))).toBe(true);
      expect(existsSync(join(home, ".claude", "agents", `${NAME}.md`))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("with neither folder, creates the project one with its .gitignore and says NEW_FOLDER", () => {
    const { root, repo, home } = sandbox();
    try {
      execFileSync("git", ["init", "-q", repo]);
      const r = run(cmd(), repo, home);
      expect(r.status).toBe(0);
      expect(last(r.stdout)).toBe("NEW_FOLDER");
      expect(readFileSync(join(repo, ".claude", "agents", `${NAME}.md`), "utf8")).toBe(FILE);
      expect(readFileSync(join(repo, ".claude", "agents", ".gitignore"), "utf8")).toBe("vc-*.md\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("deletes the file and exits 3 with MISMATCH when the content was altered", () => {
    const { root, repo, home } = sandbox();
    try {
      mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
      const r = run(cmd({ content: FILE.replace("Ship", "Skip") }), repo, home);
      expect(r.status).toBe(3);
      expect(last(r.stdout)).toMatch(/^MISMATCH/);
      expect(readdirSync(join(repo, ".claude", "agents"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still verifies after whitespace drift (JS and shell fingerprints agree)", () => {
    const { root, repo, home } = sandbox();
    try {
      mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
      const drifted = FILE.split("\n").map((l, i) => (i % 2 ? `${l}  ` : `${l}\t`)).join("\n") + "\n\n";
      const r = run(cmd({ content: drifted }), repo, home);
      expect(last(r.stdout)).toBe("READY");
      expect(r.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("carries hostile content untouched: expansions, heredoc-looking lines, backticks, non-ASCII", () => {
    const { root, repo, home } = sandbox();
    try {
      mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
      const hostile = {
        ...DEF,
        prompt: [
          "$(touch pwned) `touch pwned2` ${HOME} \\n 'q' \"dq\"",
          "EOF",
          "VC_AGENT_000000000000",
          "naïve — café ✓",
          "line with trailing spaces   ",
        ].join("\n"),
      };
      const file = renderAgentFile(NAME, hostile, { synced: true });
      const r = run(cmd({ content: file, sha256: agentFileFingerprint(file) }), repo, home);
      expect(last(r.stdout)).toBe("READY");
      expect(readFileSync(join(repo, ".claude", "agents", `${NAME}.md`), "utf8")).toBe(file);
      expect(existsSync(join(repo, "pwned"))).toBe(false);
      expect(existsSync(join(repo, "pwned2"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never lets file content end the heredoc early", () => {
    const first = cmd();
    const delimiter = /<<'(VC_AGENT_[0-9A-F]+)'/.exec(first)![1];
    const tricky = renderAgentFile(NAME, { ...DEF, prompt: `x\n${delimiter}\ny` });
    const c = agentFileSyncCommand({ name: NAME, content: tricky, sha256: agentFileFingerprint(tricky), settleSeconds: 0 });
    expect(c).toContain(tricky);
    expect(c.split("\n").filter((l) => /^VC_AGENT_[0-9A-F]+$/.test(l)).length).toBeLessThanOrEqual(2);
  });

  it("replaces an older copy of the same agent", () => {
    const { root, repo, home } = sandbox();
    try {
      mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
      writeFileSync(join(repo, ".claude", "agents", `${NAME}.md`), "old");
      writeFileSync(join(repo, ".claude", "agents", "mine.md"), "keep");
      run(cmd(), repo, home);
      expect(readFileSync(join(repo, ".claude", "agents", `${NAME}.md`), "utf8")).toBe(FILE);
      expect(readFileSync(join(repo, ".claude", "agents", "mine.md"), "utf8")).toBe("keep");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pauses for the settle time before READY", () => {
    const { root, repo, home } = sandbox();
    try {
      mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
      const t0 = Date.now();
      run(cmd({ settleSeconds: 1 }), repo, home);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(950);
      expect(cmd()).toContain("sleep 0");
      expect(agentFileSyncCommand({ name: NAME, content: FILE, sha256: SHA })).toContain("sleep 5");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a full-size agent far under the argument limit", () => {
    expect(AGENT_FILE_MAX_BYTES + 5_000).toBeLessThan(128 * 1024);
  });
});
