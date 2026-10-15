import { describe, it, expect } from "vitest";
import {
  agentPersonaBody,
  disallowedToolsFor,
  normalizeToolAccess,
  toolAccessFromFrontmatter,
  toolAccessSection,
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
  it("adds nothing for full access, so existing fingerprints are unchanged", () => {
    expect(toolAccessSection("full")).toBe("");
    expect(agentPersonaBody("Persona.", "full")).toBe("Persona.");
    expect(agentPersonaBody("Persona.", null)).toBe("Persona.");
  });

  it("appends the Tools note for a read-only agent", () => {
    const body = agentPersonaBody("Persona.", "read_only");
    expect(body.startsWith("Persona.\n\n## Tools\n")).toBe(true);
    expect(body).toContain("don't create, edit or delete files");
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
