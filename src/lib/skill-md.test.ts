import { describe, it, expect } from "vitest";
import {
  parseSkillMd,
  slugifyName,
  inferRole,
} from "./skill-md";
import type { ParsedSkill } from "./skill-md";

describe("slugifyName", () => {
  it("converts spaces and uppercase to lowercase hyphens", () => {
    expect(slugifyName("QA Engineer")).toBe("qa-engineer");
  });

  it("removes special characters", () => {
    expect(slugifyName("Full-Stack Dev (v2)")).toBe("full-stack-dev-v2");
  });

  it("collapses multiple hyphens", () => {
    expect(slugifyName("  Hello   World  ")).toBe("hello-world");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugifyName("--test--")).toBe("test");
  });

  it("truncates to 64 characters", () => {
    const long = "a".repeat(100);
    expect(slugifyName(long).length).toBe(64);
  });

  it("handles empty string", () => {
    expect(slugifyName("")).toBe("");
  });
});

describe("parseSkillMd", () => {
  it("parses a complete SKILL.md", () => {
    const md = [
      "---",
      "name: atlas",
      'description: "Full Stack Engineer agent — Deliver features"',
      "license: MIT",
      "metadata:",
      "  source: vibecodes",
      "  source_id: abc-123",
      "  role: Full Stack Engineer",
      '  bio: "Ship it right"',
      '  tags: ["TypeScript","React"]',
      "---",
      "",
      "## Goal",
      "Deliver production-ready features.",
    ].join("\n");

    const result = parseSkillMd(md);

    expect(result.name).toBe("atlas");
    expect(result.description).toBe("Full Stack Engineer agent — Deliver features");
    expect(result.license).toBe("MIT");
    expect(result.metadata.source).toBe("vibecodes");
    expect(result.metadata.source_id).toBe("abc-123");
    expect(result.metadata.role).toBe("Full Stack Engineer");
    expect(result.metadata.bio).toBe("Ship it right");
    expect(result.metadata.tags).toEqual(["TypeScript", "React"]);
    expect(result.body).toBe("## Goal\nDeliver production-ready features.");
  });

  it("handles content without frontmatter", () => {
    const result = parseSkillMd("# My Agent\nDo things.");
    expect(result.name).toBe("my-agent");
    expect(result.body).toBe("# My Agent\nDo things.");
    expect(result.metadata).toEqual({});
  });

  it("throws on unclosed frontmatter", () => {
    expect(() => parseSkillMd("---\nname: test\nno closing")).toThrow(
      "missing closing ---"
    );
  });

  it("handles empty body", () => {
    const md = "---\nname: empty\ndescription: An empty skill\n---\n";
    const result = parseSkillMd(md);
    expect(result.name).toBe("empty");
    expect(result.body).toBe("");
  });

  it("handles minimal frontmatter with no metadata block", () => {
    const md = "---\nname: basic\ndescription: Basic skill\n---\nDo stuff.";
    const result = parseSkillMd(md);
    expect(result.name).toBe("basic");
    expect(result.description).toBe("Basic skill");
    expect(result.metadata).toEqual({});
    expect(result.body).toBe("Do stuff.");
  });

  it("defaults name to 'imported-skill' when missing", () => {
    const md = "---\ndescription: No name\n---\nBody.";
    const result = parseSkillMd(md);
    expect(result.name).toBe("imported-skill");
  });

  it("preserves extra metadata keys", () => {
    const md = "---\nname: test\nmetadata:\n  custom_key: custom_value\n---\nBody.";
    const result = parseSkillMd(md);
    expect(result.metadata.custom_key).toBe("custom_value");
  });

  it("parses tags from comma-separated string", () => {
    const md = "---\nname: test\nmetadata:\n  tags: TypeScript, React, Node.js\n---\n";
    const result = parseSkillMd(md);
    expect(result.metadata.tags).toEqual(["TypeScript", "React", "Node.js"]);
  });
});

describe("inferRole", () => {
  it("returns role from metadata", () => {
    const skill: ParsedSkill = {
      name: "test",
      description: "Some agent — does stuff",
      metadata: { role: "QA Engineer" },
      body: "",
    };
    expect(inferRole(skill)).toBe("QA Engineer");
  });

  it("infers role from description pattern", () => {
    const skill: ParsedSkill = {
      name: "test",
      description: "Full Stack Engineer agent — builds things",
      metadata: {},
      body: "",
    };
    expect(inferRole(skill)).toBe("Full Stack Engineer");
  });

  it("returns null when no role can be inferred", () => {
    const skill: ParsedSkill = {
      name: "test",
      description: "Does things",
      metadata: {},
      body: "",
    };
    expect(inferRole(skill)).toBeNull();
  });
});

describe("parseSkillMd tool settings (task 472d5672)", () => {
  it("exposes the raw top-level tools and disallowedTools lines", () => {
    const parsed = parseSkillMd("---\nname: lens\ndescription: d\ntools: Read, Grep\ndisallowedTools: Edit, Write\n---\nBody.");
    expect(parsed.tools).toBe("Read, Grep");
    expect(parsed.disallowedTools).toBe("Edit, Write");
  });

  it("leaves them undefined when the file doesn't say", () => {
    const parsed = parseSkillMd("---\nname: lens\ndescription: d\n---\nBody.");
    expect(parsed.tools).toBeUndefined();
    expect(parsed.disallowedTools).toBeUndefined();
  });

  it("keeps metadata.tool_access among the metadata keys", () => {
    const parsed = parseSkillMd("---\nname: lens\ndescription: d\nmetadata:\n  tool_access: read_only\n---\nBody.");
    expect(parsed.metadata.tool_access).toBe("read_only");
  });
});
