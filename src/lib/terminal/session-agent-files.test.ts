import { describe, it, expect } from "vitest";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSessionAgents, type SessionAgentInput } from "./session-agents";
import {
  AGENT_FILE_MAX_BYTES,
  AGENT_FILE_NAME_PATTERN,
  SYNC_MARKER,
  agentFileFingerprint,
  agentFilesSyncCommand,
  type AgentSyncOptions,
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

const QUICK: AgentSyncOptions = { skipAtimeProbe: true, noAtimeFirstSeconds: 0, noAtimeSecondSeconds: 0 };

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
describe("agentFilesSyncCommand (one file; folder, verification and .gitignore rules)", () => {
  const [NAME, DEF] = Object.entries(AGENTS)[0];
  const FILE = renderAgentFile(NAME, DEF, { synced: true });
  const SHA = agentFileFingerprint(FILE);
  // These tests are about what is written and where, not the load wait, so
  // they take the no-atime branch with zero waits (it ends in READY at once).
  const cmd = (over: { name?: string; content?: string; sha256?: string; confirm?: AgentSyncOptions } = {}) =>
    agentFilesSyncCommand({
      files: [{ name: over.name ?? NAME, content: over.content ?? FILE, sha256: over.sha256 ?? SHA }],
      confirm: over.confirm ?? QUICK,
    });

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

  it("sets the cleanup trap before the first temp file is made", () => {
    const c = cmd();
    expect(c.indexOf("trap 'rm -f")).toBeGreaterThan(-1);
    expect(c.indexOf("trap 'rm -f")).toBeLessThan(c.indexOf("mktemp"));
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

  it("keeps the last line intact when the agents .gitignore has no trailing newline", () => {
    const { root, repo, home } = sandbox();
    try {
      execFileSync("git", ["init", "-q", repo]);
      mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
      writeFileSync(join(repo, ".claude", "agents", ".gitignore"), "other.md");
      const r = run(cmd(), repo, home);
      expect(last(r.stdout)).toBe("READY");
      expect(readFileSync(join(repo, ".claude", "agents", ".gitignore"), "utf8")).toBe("other.md\nvc-*.md\n");
      expect(
        spawnSync("git", ["check-ignore", "-q", `.claude/agents/${NAME}.md`], { cwd: repo }).status,
      ).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("warns when the file still isn't ignored after the .gitignore was written", () => {
    const { root, repo, home } = sandbox();
    try {
      execFileSync("git", ["init", "-q", repo]);
      mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
      writeFileSync(join(repo, ".claude", "agents", ".gitignore"), "vc-*.md\n!vc-*.md\n");
      const r = run(cmd(), repo, home);
      expect(r.stdout).toMatch(/WARNING: .*not git-ignored/);
      expect(last(r.stdout)).toBe("READY");
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
    const c = cmd({ content: tricky, sha256: agentFileFingerprint(tricky) });
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

  it("keeps a full-size agent far under the argument limit", () => {
    expect(AGENT_FILE_MAX_BYTES + 5_000).toBeLessThan(128 * 1024);
  });
});

// macOS has no sha256sum (shasum instead) and its default shell is zsh, which
// doesn't word-split an unquoted variable. Run the real command both ways.
describe("agentFilesSyncCommand on a machine without sha256sum, and under zsh", () => {
  const [NAME, DEF] = Object.entries(AGENTS)[0];
  const FILE = renderAgentFile(NAME, DEF, { synced: true });
  const SHA = agentFileFingerprint(FILE);
  const command = agentFilesSyncCommand({ files: [{ name: NAME, content: FILE, sha256: SHA }], confirm: QUICK });
  const which = (bin: string) => {
    const r = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const hasShasum = which("shasum") !== null;
  const zshPath = which("zsh");

  function setup() {
    const root = mkdtempSync(join(tmpdir(), "agent-sync-sh-"));
    const repo = join(root, "repo");
    mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
    return { root, repo };
  }

  it.skipIf(!hasShasum)("verifies with shasum when sha256sum is not on PATH", () => {
    const { root, repo } = setup();
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      for (const tool of ["bash", "sed", "cut", "mktemp", "cat", "rm", "mv", "grep", "tail", "tr", "sleep", "git", "shasum", "perl", "env", "dirname"]) {
        const p = which(tool);
        if (p) symlinkSync(p, join(bin, tool));
      }
      const env = { PATH: bin, HOME: root, NODE_ENV: "test" as const };
      expect(spawnSync("bash", ["-c", "command -v sha256sum"], { env, encoding: "utf8" }).status).not.toBe(0);
      const r = spawnSync(join(bin, "bash"), ["-c", command], { cwd: repo, env, encoding: "utf8" });
      expect(r.stdout.trim().split("\n").pop()).toBe("READY");
      expect(r.status).toBe(0);
      expect(readFileSync(join(repo, ".claude", "agents", `${NAME}.md`), "utf8")).toBe(FILE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!zshPath)("runs under zsh (the macOS default shell) and verifies", () => {
    const { root, repo } = setup();
    try {
      const r = spawnSync(zshPath as string, ["-c", command], {
        cwd: repo,
        env: { PATH: process.env.PATH ?? "", HOME: root, NODE_ENV: "test" as const },
        encoding: "utf8",
      });
      expect(r.stdout.trim().split("\n").pop()).toBe("READY");
      expect(r.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// Card 0b5656a5. Claude Code's agent watcher polls (every 30 s once the
// session is idle) and can miss a file written just before it switches, so a
// fixed sleep can't tell "loaded" from "not yet". The command waits for Claude
// Code to READ every file (the file's access time moves), re-touches once to
// recover a file the watcher missed, and says NOT_LOADED if nothing reads it.
// Here a stand-in reader plays Claude Code.
describe("agentFilesSyncCommand waits until Claude Code has read every file", () => {
  const entries = Object.entries(AGENTS);
  const FILES = entries.map(([name, def]) => {
    const content = renderAgentFile(name, def, { synced: true });
    return { name, content, sha256: agentFileFingerprint(content), tag: /\[vc [^\]]+\]$/.exec(def.description)?.[0] };
  });
  const SHORT: AgentSyncOptions = { firstWaitSeconds: 1, laterWaitSeconds: 1, retouchRounds: 2, afterReadSeconds: 0 };

  // Does this temp filesystem move atime on read? (noatime mounts don't.)
  const atimeWorks = (() => {
    const d = mkdtempSync(join(tmpdir(), "agent-sync-atime-"));
    try {
      const f = join(d, "f");
      writeFileSync(f, "x");
      utimesSync(f, new Date("2000-01-01T00:00:00Z"), new Date("2000-01-01T00:00:00Z"));
      readFileSync(f);
      return statSync(f).atimeMs > Date.parse("2001-01-01T00:00:00Z");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  })();

  function sandbox() {
    const root = mkdtempSync(join(tmpdir(), "agent-sync-load-"));
    const repo = join(root, "repo");
    mkdirSync(join(repo, ".claude", "agents"), { recursive: true });
    return { root, repo, agents: join(repo, ".claude", "agents") };
  }
  function runAsync(command: string, cwd: string, home: string, shell = "bash") {
    return new Promise<{ status: number | null; stdout: string; ms: number }>((resolve) => {
      const t0 = Date.now();
      const child = spawn(shell, ["-c", command], {
        cwd,
        env: { PATH: process.env.PATH ?? "", HOME: home, NODE_ENV: "test" as const },
      });
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.on("close", (status) => resolve({ status, stdout, ms: Date.now() - t0 }));
    });
  }
  const lastLine = (out: string) => out.trim().split("\n").pop();
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const command = (over: Partial<Parameters<typeof agentFilesSyncCommand>[0]> = {}) =>
    agentFilesSyncCommand({ files: FILES, confirm: SHORT, ...over });

  it("is valid bash with no network tool and no command held in a variable (zsh-safe)", () => {
    const c = command();
    expect(spawnSync("bash", ["-n"], { input: c, encoding: "utf8" }).status).toBe(0);
    expect(c).not.toMatch(/curl|wget|http/i);
    expect(c).not.toMatch(/\|\s*\$\w/);
    expect(c).not.toMatch(/\b(status|path)=/);
  });

  it("rejects no files, a duplicate name, an unsafe name or a bad fingerprint", () => {
    expect(() => agentFilesSyncCommand({ files: [] })).toThrow();
    expect(() => agentFilesSyncCommand({ files: [FILES[0], FILES[0]] })).toThrow(/duplicate/i);
    expect(() => agentFilesSyncCommand({ files: [{ ...FILES[0], name: "../evil" }] })).toThrow();
    expect(() => agentFilesSyncCommand({ files: [{ ...FILES[0], sha256: "nope" }] })).toThrow();
  });

  it.skipIf(!atimeWorks)("READY only after every saved file has been read", async () => {
    const { root, repo } = sandbox();
    try {
      // Nobody reads the files, so nothing may claim they are loaded.
      const r = await runAsync(command(), repo, root);
      expect(lastLine(r.stdout)).toBe("NOT_LOADED");
      expect(r.stdout).not.toContain("READY");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!atimeWorks)("is still NOT_LOADED when only some of the files were read", async () => {
    const { root, repo, agents } = sandbox();
    try {
      const running = runAsync(command(), repo, root);
      await wait(300);
      readFileSync(join(agents, `${FILES[0].name}.md`));
      const r = await running;
      expect(lastLine(r.stdout)).toBe("NOT_LOADED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!atimeWorks)("says READY once a reader has read all the files, and not before it did", async () => {
    const { root, repo, agents } = sandbox();
    try {
      const t0 = Date.now();
      const running = runAsync(command({ confirm: { ...SHORT, firstWaitSeconds: 10, laterWaitSeconds: 10 } }), repo, root);
      await wait(1200);
      const readAt = Date.now() - t0;
      for (const f of FILES) readFileSync(join(agents, `${f.name}.md`));
      const r = await running;
      expect(lastLine(r.stdout)).toBe("READY");
      expect(r.status).toBe(0);
      expect(r.ms).toBeGreaterThanOrEqual(readAt - 50);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!atimeWorks)("re-touches the files so a file the watcher missed is read the second time", async () => {
    const { root, repo, agents } = sandbox();
    try {
      // A reader like Claude Code's watcher after an idle switch: it ignores
      // files that were there when it started and reads only a changed one.
      const running = runAsync(command({ confirm: { ...SHORT, firstWaitSeconds: 1, laterWaitSeconds: 5 } }), repo, root);
      await wait(400);
      const seen = new Map(FILES.map((f) => [f.name, statSync(join(agents, `${f.name}.md`)).mtimeMs]));
      const reader = setInterval(() => {
        for (const f of FILES) {
          const p = join(agents, `${f.name}.md`);
          if (statSync(p).mtimeMs !== seen.get(f.name)) readFileSync(p);
        }
      }, 100);
      const r = await running;
      clearInterval(reader);
      expect(lastLine(r.stdout)).toBe("READY");
      expect(r.ms).toBeGreaterThanOrEqual(900);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("without atime support it waits a fixed time, re-touches halfway, then says READY", async () => {
    const { root, repo, agents } = sandbox();
    try {
      const c = command({ confirm: { skipAtimeProbe: true, noAtimeFirstSeconds: 1, noAtimeSecondSeconds: 1 } });
      const running = runAsync(c, repo, root);
      await wait(400);
      const before = statSync(join(agents, `${FILES[0].name}.md`)).mtimeMs;
      const r = await running;
      expect(lastLine(r.stdout)).toBe("READY");
      expect(r.ms).toBeGreaterThanOrEqual(1900);
      expect(statSync(join(agents, `${FILES[0].name}.md`)).mtimeMs).toBeGreaterThan(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes every file byte-for-byte, names each with its tag, and leaves no temp files", async () => {
    const { root, repo, agents } = sandbox();
    try {
      const r = await runAsync(command({ confirm: QUICK }), repo, root);
      expect(r.status).toBe(0);
      for (const f of FILES) {
        expect(readFileSync(join(agents, `${f.name}.md`), "utf8")).toBe(f.content);
        expect(r.stdout).toContain(f.name);
        expect(r.stdout).toContain(f.tag!);
      }
      expect(readdirSync(agents).filter((n) => n.startsWith("."))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lands nothing and exits 3 with MISMATCH when any one file was altered", async () => {
    const { root, repo, agents } = sandbox();
    try {
      const altered = [FILES[0], { ...FILES[1], content: FILES[1].content.replace("Review", "Skip") }];
      const r = await runAsync(command({ files: altered, confirm: QUICK }), repo, root);
      expect(r.status).toBe(3);
      expect(lastLine(r.stdout)).toMatch(/^MISMATCH/);
      expect(readdirSync(agents)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates the folder, saves all files and says NEW_FOLDER without waiting", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent-sync-new-"));
    const repo = join(root, "repo");
    mkdirSync(repo);
    try {
      execFileSync("git", ["init", "-q", repo]);
      const r = await runAsync(command(), repo, root);
      expect(lastLine(r.stdout)).toBe("NEW_FOLDER");
      expect(r.ms).toBeLessThan(900);
      for (const f of FILES) expect(existsSync(join(repo, ".claude", "agents", `${f.name}.md`))).toBe(true);
      expect(readFileSync(join(repo, ".claude", "agents", ".gitignore"), "utf8")).toBe("vc-*.md\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps git clean for every saved file", async () => {
    const { root, repo } = sandbox();
    try {
      execFileSync("git", ["init", "-q", repo]);
      await runAsync(command({ confirm: QUICK }), repo, root);
      const status = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: repo, encoding: "utf8" });
      expect(status).not.toMatch(/vc-.*\.md/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  const zshPath = (() => {
    const r = spawnSync("sh", ["-c", "command -v zsh"], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
  })();

  it.skipIf(!zshPath || !atimeWorks)("runs under zsh with sha256sum hidden, and still waits for the reads", async () => {
    const { root, repo, agents } = sandbox();
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      for (const tool of ["sed", "cut", "mktemp", "cat", "rm", "mv", "grep", "tail", "tr", "sleep", "git", "shasum", "perl", "env", "dirname", "touch", "stat", "printf"]) {
        const p = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" });
        if (p.status === 0 && p.stdout.trim().startsWith("/")) symlinkSync(p.stdout.trim(), join(bin, tool));
      }
      const hasShasum = existsSync(join(bin, "shasum"));
      const child = spawn(zshPath as string, ["-c", command({ confirm: { ...SHORT, firstWaitSeconds: 10 } })], {
        cwd: repo,
        env: { PATH: hasShasum ? bin : process.env.PATH ?? "", HOME: root, NODE_ENV: "test" as const },
      });
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d));
      const done = new Promise<void>((resolve) => child.on("close", () => resolve()));
      await wait(800);
      for (const f of FILES) readFileSync(join(agents, `${f.name}.md`));
      await done;
      expect(lastLine(stdout)).toBe("READY");
      for (const f of FILES) expect(readFileSync(join(agents, `${f.name}.md`), "utf8")).toBe(f.content);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
