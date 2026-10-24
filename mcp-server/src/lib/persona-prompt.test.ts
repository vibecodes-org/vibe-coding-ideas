import { describe, it, expect } from "vitest";
import { composePersonaPrompt } from "./persona-prompt";

const BOT = "00000000-0000-4000-a000-000000000070";
const PERSONA = "## Goal\nShip it.";
const SKILLS = [
  { name: "api-design-review", content: "  Check REST contracts first.\n" },
  { name: "a11y-audit", content: "Run a WCAG 2.2 AA pass." },
];

describe("composePersonaPrompt", () => {
  it("appends each skill's stored text to the persona, in order, trimmed", () => {
    const { prompt, skills } = composePersonaPrompt(BOT, { system_prompt: PERSONA, tool_access: "full" }, SKILLS);
    expect(prompt).toBe(
      `${PERSONA}\n\n## Skills\nThese are your reference skills. Apply the ones relevant to this step.\n\n` +
        `### api-design-review\nCheck REST contracts first.\n\n### a11y-audit\nRun a WCAG 2.2 AA pass.`,
    );
    expect(skills.sent).toEqual(["api-design-review", "a11y-audit"]);
  });

  it("is the persona alone for an agent without skills (no Tools note for Full access)", () => {
    expect(composePersonaPrompt(BOT, { system_prompt: PERSONA, tool_access: "full" }, []).prompt).toBe(PERSONA);
  });

  it("sends the skills alone when the agent has no persona text", () => {
    const { prompt } = composePersonaPrompt(BOT, { system_prompt: null, tool_access: "full" }, SKILLS);
    expect(prompt.startsWith("## Skills\n")).toBe(true);
  });

  it("names the skills over the size limit instead of dropping them", () => {
    const big = "x".repeat(40_001);
    const { prompt, skills } = composePersonaPrompt(
      BOT,
      { system_prompt: PERSONA, tool_access: "full" },
      [SKILLS[0], { name: "huge", content: big }, { name: "after-huge", content: "short" }],
    );
    expect(prompt).toContain("### api-design-review");
    expect(prompt).not.toContain("xxxx");
    expect(prompt).not.toContain("### after-huge");
    expect(prompt).toContain("Not included here (over the size limit): huge, after-huge.");
    expect(prompt).toContain(`get_agent_skill_content (agent_id "${BOT}")`);
    expect(skills.sent).toEqual(["api-design-review"]);
  });

  it("names skills beyond the 50-skill cap", () => {
    const many = Array.from({ length: 52 }, (_, i) => ({ name: `skill-${i + 1}`, content: `body ${i + 1}` }));
    const { prompt, skills } = composePersonaPrompt(BOT, { system_prompt: PERSONA, tool_access: "full" }, many);
    expect(prompt).toContain("### skill-50\nbody 50");
    expect(prompt).not.toContain("### skill-51");
    expect(prompt).toContain("Not included here (over the size limit): skill-51, skill-52.");
    expect(skills.sent).toHaveLength(50);
  });

  it("puts the read-only Tools note at the end of the persona, before the Skills section", () => {
    const { prompt } = composePersonaPrompt(BOT, { system_prompt: PERSONA, tool_access: "read_only" }, SKILLS);
    const personaPart = prompt.split("\n\n## Skills\n")[0];
    expect(personaPart.startsWith(PERSONA)).toBe(true);
    expect(personaPart).toContain("## Tools\nYou're read-only: don't create, edit or delete files");
    expect(personaPart.endsWith("Say what should change instead.")).toBe(true);
    expect(prompt).toContain("### api-design-review");
  });
});
