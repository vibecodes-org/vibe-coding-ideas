import { describe, it, expect } from "vitest";
import { parseSkillMd, inferRole } from "./skill-md";

const BOT_ID = "00000000-0000-4000-a000-000000000042";

describe("parseSkillMd metadata extraction", () => {
  it("reads role/source/source_id from a nested metadata block", () => {
    const parsed = parseSkillMd(
      [
        "---",
        "name: probe",
        "description: A probe agent",
        "metadata:",
        "  source: vibecodes",
        `  source_id: ${BOT_ID}`,
        "  role: QA Engineer",
        "---",
        "",
        "Body text.",
      ].join("\n")
    );

    expect(parsed.metadata.source).toBe("vibecodes");
    expect(parsed.metadata.source_id).toBe(BOT_ID);
    expect(parsed.metadata.role).toBe("QA Engineer");
    expect(parsed.body).toBe("Body text.");
  });

  it("falls back to top-level role/source/source_id when there is no metadata block", () => {
    const parsed = parseSkillMd(
      [
        "---",
        "name: probe",
        "description: A probe agent",
        "role: Test Probe",
        "source: vibecodes",
        `source_id: ${BOT_ID}`,
        "---",
        "",
        "Body text.",
      ].join("\n")
    );

    expect(parsed.metadata.source).toBe("vibecodes");
    expect(parsed.metadata.source_id).toBe(BOT_ID);
    expect(parsed.metadata.role).toBe("Test Probe");
    // Declared role must win over description-based inference.
    expect(inferRole(parsed)).toBe("Test Probe");
  });

  it("prefers the nested metadata block over top-level keys on conflict", () => {
    const parsed = parseSkillMd(
      [
        "---",
        "name: probe",
        "description: A probe agent",
        "role: Top Level Role",
        "source: external",
        "metadata:",
        "  role: Nested Role",
        "  source: vibecodes",
        "---",
        "",
        "Body.",
      ].join("\n")
    );

    expect(parsed.metadata.role).toBe("Nested Role");
    expect(parsed.metadata.source).toBe("vibecodes");
  });

  it("parses top-level tags from a JSON array or comma-separated string", () => {
    const fromArray = parseSkillMd(
      ['---', 'name: a', 'description: d', 'tags: ["one","two"]', '---', 'B'].join("\n")
    );
    expect(fromArray.metadata.tags).toEqual(["one", "two"]);

    const fromString = parseSkillMd(
      ["---", "name: a", "description: d", "tags: one, two", "---", "B"].join("\n")
    );
    expect(fromString.metadata.tags).toEqual(["one", "two"]);
  });
});
