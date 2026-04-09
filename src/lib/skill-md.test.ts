import { describe, it, expect } from "vitest";
import {
  generateSkillMd,
  parseSkillMd,
  slugifyName,
  inferRole,
  skillFilename,
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

describe("generateSkillMd", () => {
  const fullBot = {
    id: "abc-123",
    name: "Atlas",
    role: "Full Stack Engineer",
    system_prompt: "## Goal\nDeliver production-ready features.",
    bio: "Ship it right",
    skills: ["TypeScript", "React", "Node.js"],
  };

  it("generates valid SKILL.md with all fields", () => {
    const md = generateSkillMd(fullBot);

    expect(md).toContain("---");
    expect(md).toContain("name: atlas");
    expect(md).toContain("description:");
    expect(md).toContain("Full Stack Engineer agent");
    expect(md).toContain("license: MIT");
    expect(md).toContain("source: vibecodes");
    expect(md).toContain("source_id: abc-123");
    expect(md).toContain('role: Full Stack Engineer');
    expect(md).toContain('bio: Ship it right');
    expect(md).toContain('tags: ["TypeScript","React","Node.js"]');
    expect(md).toContain("## Goal\nDeliver production-ready features.");
  });

  it("handles bot with no role", () => {
    const md = generateSkillMd({ ...fullBot, role: null });
    expect(md).toContain("VibeCodes agent");
    expect(md).not.toContain("role:");
  });

  it("handles bot with no system prompt", () => {
    const md = generateSkillMd({ ...fullBot, system_prompt: null });
    expect(md).toContain("name: atlas");
    // Body should be empty after frontmatter
    const parts = md.split("---");
    expect(parts[2].trim()).toBe("");
  });

  it("handles bot with no bio", () => {
    const md = generateSkillMd({ ...fullBot, bio: null });
    expect(md).not.toContain("bio:");
  });

  it("handles bot with no skills", () => {
    const md = generateSkillMd({ ...fullBot, skills: null });
    expect(md).not.toContain("tags:");
  });

  it("handles bot with empty skills array", () => {
    const md = generateSkillMd({ ...fullBot, skills: [] });
    expect(md).not.toContain("tags:");
  });

  it("truncates description to 1024 characters", () => {
    const longPrompt = "x".repeat(2000);
    const md = generateSkillMd({ ...fullBot, system_prompt: longPrompt });
    const parsed = parseSkillMd(md);
    expect(parsed.description.length).toBeLessThanOrEqual(1024);
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

describe("round-trip", () => {
  it("generates and parses back to equivalent data", () => {
    const bot = {
      id: "test-uuid-123",
      name: "Sentinel",
      role: "QA Engineer",
      system_prompt: "## Goal\nTest everything.\n\n## Expertise\n- E2E testing\n- Cross-browser",
      bio: "Break it before users do",
      skills: ["E2E Testing", "Cross-browser", "Accessibility"],
    };

    const md = generateSkillMd(bot);
    const parsed = parseSkillMd(md);

    expect(parsed.name).toBe("sentinel");
    expect(parsed.metadata.source).toBe("vibecodes");
    expect(parsed.metadata.source_id).toBe("test-uuid-123");
    expect(parsed.metadata.role).toBe("QA Engineer");
    expect(parsed.metadata.bio).toBe("Break it before users do");
    expect(parsed.metadata.tags).toEqual(["E2E Testing", "Cross-browser", "Accessibility"]);
    expect(parsed.body).toBe(bot.system_prompt);
  });

  it("round-trips a bot with special characters in bio", () => {
    const bot = {
      id: "x",
      name: "Test Bot",
      role: "Dev",
      system_prompt: "Prompt.",
      bio: 'Loves "clean" code & fast APIs',
      skills: null,
    };

    const md = generateSkillMd(bot);
    const parsed = parseSkillMd(md);

    expect(parsed.metadata.bio).toBe('Loves "clean" code & fast APIs');
  });

  it("round-trips a bot with newlines in bio", () => {
    const bot = {
      id: "y",
      name: "Multiline Bot",
      role: "Dev",
      system_prompt: "Prompt.",
      bio: "Line one\nLine two",
      skills: null,
    };

    const md = generateSkillMd(bot);
    // Verify the newline is escaped in output
    expect(md).toContain("\\n");
    expect(md).not.toMatch(/bio: "Line one\nLine two"/);

    const parsed = parseSkillMd(md);
    expect(parsed.metadata.bio).toBe("Line one\nLine two");
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

describe("skillFilename", () => {
  it("generates a filename from agent name", () => {
    expect(skillFilename("Atlas")).toBe("atlas.skill.md");
  });

  it("slugifies the name", () => {
    expect(skillFilename("QA Engineer")).toBe("qa-engineer.skill.md");
  });
});
