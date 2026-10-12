import { describe, it, expect } from "vitest";
import { buildSkillsSection, personaWithSkills, SKILLS_SECTION_MAX_CHARS } from "./skills-section";

const BOT = "37e8ffb2-3f88-49e5-9ab4-a516c1088f77";

describe("buildSkillsSection", () => {
  it("is empty for an agent without skills", () => {
    expect(buildSkillsSection(BOT, [])).toEqual({ text: "", sent: [], omitted: [] });
  });

  it("puts a header, then each skill under its name in the given order, content trimmed", () => {
    const section = buildSkillsSection(BOT, [
      { name: "first", content: "\n  One.\n\n" },
      { name: "second", content: "Two." },
    ]);
    expect(section.text).toBe(
      "## Skills\nThese are your reference skills. Apply the ones relevant to this step.\n\n" +
        "### first\nOne.\n\n### second\nTwo.",
    );
    expect(section.sent).toEqual(["first", "second"]);
    expect(section.omitted).toEqual([]);
  });

  it("keeps a skill's text exactly as stored, internal whitespace included", () => {
    const content = "# Heading\n\n```ts\nconst a  =  1;\n```\n\n- item";
    expect(buildSkillsSection(BOT, [{ name: "code", content }]).text).toContain(`### code\n${content}`);
  });

  it("sends exactly as much as fits the limit", () => {
    const skills = [
      { name: "a", content: "x".repeat(10) },
      { name: "b", content: "y".repeat(10) },
    ];
    expect(buildSkillsSection(BOT, skills, 20).sent).toEqual(["a", "b"]);
    const tight = buildSkillsSection(BOT, skills, 19);
    expect(tight.sent).toEqual(["a"]);
    expect(tight.omitted).toEqual(["b"]);
  });

  it("stops at the first skill that doesn't fit, so what's sent is a prefix of the order", () => {
    const section = buildSkillsSection(
      BOT,
      [
        { name: "a", content: "x".repeat(10) },
        { name: "big", content: "y".repeat(50) },
        { name: "small", content: "z" },
      ],
      20,
    );
    expect(section.sent).toEqual(["a"]);
    expect(section.omitted).toEqual(["big", "small"]);
    expect(section.text).not.toContain("yyyy");
    expect(section.text).not.toContain("### small");
  });

  it("sends at most maxSkills in full and names the rest", () => {
    const skills = ["a", "b", "c"].map((name) => ({ name, content: name }));
    const section = buildSkillsSection(BOT, skills, SKILLS_SECTION_MAX_CHARS, 2);
    expect(section.sent).toEqual(["a", "b"]);
    expect(section.omitted).toEqual(["c"]);
    expect(section.text).toContain("Not included here (over the size limit): c.");
  });

  it("caps at 50 skills by default", () => {
    const skills = Array.from({ length: 51 }, (_, i) => ({ name: `s${i}`, content: "x" }));
    const section = buildSkillsSection(BOT, skills);
    expect(section.sent).toHaveLength(50);
    expect(section.omitted).toEqual(["s50"]);
  });

  it("names the omitted skills with a fetch instruction for those only", () => {
    const { text } = buildSkillsSection(
      BOT,
      [
        { name: "a", content: "ok" },
        { name: "big", content: "y".repeat(50) },
      ],
      10,
    );
    expect(text).toContain(`Not included here (over the size limit): big. Load them with get_agent_skill_content (agent_id "${BOT}")`);
    expect(text).not.toContain("(over the size limit): a");
  });

  it("can send none when even the first skill is over the limit", () => {
    const section = buildSkillsSection(BOT, [{ name: "big", content: "y".repeat(50) }], 10);
    expect(section.sent).toEqual([]);
    expect(section.omitted).toEqual(["big"]);
    expect(section.text).toContain("Not included here");
  });

  it("defaults to a limit well above today's largest agent (about 9,500 characters)", () => {
    expect(SKILLS_SECTION_MAX_CHARS).toBe(40_000);
    expect(buildSkillsSection(BOT, [{ name: "a", content: "x".repeat(9_500) }]).omitted).toEqual([]);
  });
});

describe("personaWithSkills", () => {
  it("returns the persona untouched when there is no skills text", () => {
    expect(personaWithSkills("## Goal\nShip it.\n", "")).toBe("## Goal\nShip it.\n");
  });

  it("appends the skills after a blank line", () => {
    expect(personaWithSkills("Persona.", "## Skills\nx")).toBe("Persona.\n\n## Skills\nx");
  });

  it("uses the skills alone when there is no persona text", () => {
    expect(personaWithSkills("", "## Skills\nx")).toBe("## Skills\nx");
    expect(personaWithSkills("  \n", "## Skills\nx")).toBe("## Skills\nx");
  });
});
