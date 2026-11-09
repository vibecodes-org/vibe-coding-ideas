import { describe, it, expect } from "vitest";
import {
  agentPersonaBody,
  disallowedToolsFor,
  normalizeToolAccess,
  toolAccessFromFrontmatter,
  toolAccessSection,
  WAITING_NOTE_TEXT,
} from "./agent-tool-access";

describe("normalizeToolAccess", () => {
  it("keeps read_only and turns everything else into full", () => {
    expect(normalizeToolAccess("read_only")).toBe("read_only");
    expect(normalizeToolAccess("full")).toBe("full");
    expect(normalizeToolAccess(undefined)).toBe("full");
    expect(normalizeToolAccess("admin")).toBe("full");
  });
});

describe("toolAccessSection / agentPersonaBody", () => {
  it("adds no Tools note for full access", () => {
    expect(toolAccessSection("full")).toBe("");
  });

  it("gives a Codex helper exactly its stored prompt when access is full", () => {
    expect(agentPersonaBody("Persona.", "full", "codex")).toBe("Persona.");
    expect(agentPersonaBody("Persona.", null, "codex")).toBe("Persona.");
  });

  it("appends the Waiting note for a Claude helper, and Claude is the default", () => {
    const body = agentPersonaBody("Persona.", "full", "claude");
    expect(body).toBe(`Persona.\n\n${WAITING_NOTE_TEXT}`);
    expect(agentPersonaBody("Persona.", null)).toBe(body);
    expect(body).toContain("## Waiting on slow work");
    // every rule survives wording changes
    expect(body).toContain("never let more than 4 minutes pass");
    expect(body).toContain("240000 ms");
    // one log per step, in the command and in the check loop; never a shared name
    expect(body).not.toContain("/tmp/vc-wait.log");
    expect(body.split("/tmp/vc-wait-<step8>.log").length - 1).toBe(3);
    expect(body).toContain("first 8 characters of your step id");
    expect(body).toContain("run_in_background");
    expect(body).toContain("never with `--watch` or `gh run watch`");
    expect(body).toContain("more than 30 minutes");
  });

  it("appends the Tools note for a read-only agent, then the Waiting note for Claude", () => {
    const body = agentPersonaBody("Persona.", "read_only");
    expect(body.startsWith("Persona.\n\n## Tools\n")).toBe(true);
    expect(body).toContain("don't create, edit or delete files");
    expect(body.indexOf("## Tools")).toBeLessThan(body.indexOf("## Waiting on slow work"));
    const codex = agentPersonaBody("Persona.", "read_only", "codex");
    expect(codex).not.toContain("## Waiting on slow work");
    expect(codex).toContain("## Tools");
  });
});

describe("disallowedToolsFor", () => {
  it("is null for full access and the file-writing tools for read-only", () => {
    expect(disallowedToolsFor("full")).toBeNull();
    expect(disallowedToolsFor("read_only")).toEqual(["Edit", "Write", "NotebookEdit"]);
  });
});

describe("toolAccessFromFrontmatter", () => {
  it("lets an explicit metadata value win", () => {
    expect(
      toolAccessFromFrontmatter({ metadataToolAccess: "full", disallowedTools: "Edit, Write" }),
    ).toBe("full");
    expect(toolAccessFromFrontmatter({ metadataToolAccess: "read_only" })).toBe("read_only");
  });

  it("reads a deny list naming Edit or Write as read-only", () => {
    expect(toolAccessFromFrontmatter({ disallowedTools: "Edit, Write" })).toBe("read_only");
    expect(toolAccessFromFrontmatter({ disallowedTools: ["write"] })).toBe("read_only");
    expect(toolAccessFromFrontmatter({ disallowedTools: "WebFetch" })).toBe("full");
  });

  it("reads an allowlist with no file-writing tool as read-only", () => {
    expect(toolAccessFromFrontmatter({ tools: "Read, Grep, Glob, Bash" })).toBe("read_only");
    expect(toolAccessFromFrontmatter({ tools: ["Read", "Edit"] })).toBe("full");
    expect(toolAccessFromFrontmatter({ tools: "Read, MultiEdit" })).toBe("full");
  });

  it("is full when nothing is set", () => {
    expect(toolAccessFromFrontmatter({})).toBe("full");
    expect(toolAccessFromFrontmatter({ tools: "" })).toBe("full");
  });
});
