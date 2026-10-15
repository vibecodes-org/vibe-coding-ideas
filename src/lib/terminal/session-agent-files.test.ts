import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSessionAgents, type SessionAgentInput } from "./session-agents";
import {
  AGENT_FILE_NAME_PATTERN,
  buildAgentFilesTar,
  parseAgentFile,
  renderAgentFile,
  syncCommand,
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
      expect(parseAgentFile(renderAgentFile(name, def))).toEqual({ name, def });
    }
  });

  it("keeps the prompt byte-for-byte as the body", () => {
    const [name, def] = Object.entries(AGENTS)[0];
    const file = renderAgentFile(name, def);
    expect(file.endsWith(def.prompt)).toBe(true);
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
    expect(parseAgentFile(file)).toEqual({ name, def });
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

describe("buildAgentFilesTar", () => {
  it("is read back by the system tar as exactly the rendered files", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-tar-"));
    try {
      const tarPath = join(dir, "a.tar");
      writeFileSync(tarPath, buildAgentFilesTar(AGENTS));
      const out = join(dir, "out");
      execFileSync("mkdir", [out]);
      execFileSync("tar", ["-xf", tarPath, "-C", out]);
      expect(readdirSync(out).sort()).toEqual(Object.keys(AGENTS).map((n) => `${n}.md`).sort());
      for (const [name, def] of Object.entries(AGENTS)) {
        expect(readFileSync(join(out, `${name}.md`), "utf8")).toBe(renderAgentFile(name, def));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("holds only vc-*.md entries", () => {
    const listing = spawnSync("tar", ["-tf", "-"], { input: buildAgentFilesTar(AGENTS), encoding: "utf8" });
    const names = listing.stdout.split("\n").filter(Boolean);
    expect(names.length).toBe(Object.keys(AGENTS).length);
    for (const n of names) expect(n).toMatch(AGENT_FILE_NAME_PATTERN);
  });
});

describe("syncCommand", () => {
  const url = "https://vibecodes.co.uk/api/terminal/agent-files?t=abc.def_-";

  it("is valid bash", () => {
    const r = spawnSync("bash", ["-n"], { input: syncCommand(url), encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("single-quotes the url, escaping any quote in it", () => {
    expect(syncCommand("https://x/y'z")).toContain(`'https://x/y'\\''z'`);
  });

  it("names the network allowlist when the download fails", () => {
    expect(syncCommand(url)).toContain("vibecodes.co.uk");
    expect(syncCommand(url)).toContain("exit 1");
  });

  it("installs the files from a local server's tar, replaces stale ones, and ignores them in git", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-sync-"));
    try {
      writeFileSync(join(dir, "a.tar"), buildAgentFilesTar(AGENTS));
      execFileSync("git", ["init", "-q", dir]);
      execFileSync("mkdir", ["-p", join(dir, ".claude", "agents")]);
      writeFileSync(join(dir, ".claude", "agents", "vc-stale-00000000.md"), "old");
      writeFileSync(join(dir, ".claude", "agents", "mine.md"), "keep");
      // file:// stands in for the https download; curl treats both the same way.
      const r = spawnSync("bash", ["-c", syncCommand(`file://${join(dir, "a.tar")}`)], { cwd: dir, encoding: "utf8" });
      expect(r.status).toBe(0);
      const files = readdirSync(join(dir, ".claude", "agents")).sort();
      expect(files).toEqual([...Object.keys(AGENTS).map((n) => `${n}.md`), "mine.md"].sort());
      expect(r.stdout).toContain("Synced 2 board agents");
      const status = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: dir, encoding: "utf8" });
      expect(status).not.toContain("vc-");
      expect(status).toContain("mine.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits non-zero with the allowlist hint when the download fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-sync-"));
    try {
      const r = spawnSync("bash", ["-c", syncCommand(`file://${join(dir, "missing.tar")}`)], { cwd: dir, encoding: "utf8" });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("vibecodes.co.uk");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves existing files alone and says so on an empty answer", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-sync-"));
    try {
      writeFileSync(join(dir, "empty.tar"), "");
      const r = spawnSync("bash", ["-c", syncCommand(`file://${join(dir, "empty.tar")}`)], { cwd: dir, encoding: "utf8" });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("no agents to sync");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
