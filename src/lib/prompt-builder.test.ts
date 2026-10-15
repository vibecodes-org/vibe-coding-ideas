import { describe, it, expect } from "vitest";
import {
  parsePromptToFields,
  isStructuredPrompt,
} from "./prompt-builder";

describe("parsePromptToFields", () => {
  it("parses a fully structured prompt", () => {
    const prompt =
      "You are a Developer. Ship clean code\n\n" +
      "You must not: Skip tests\n\n" +
      "Your approach: Write tests first";
    const result = parsePromptToFields(prompt);
    expect(result).toEqual({
      goal: "Ship clean code",
      constraints: "Skip tests",
      approach: "Write tests first",
    });
  });

  it("parses prompt with only constraints", () => {
    const prompt =
      "You are a QA Tester. Find bugs\n\nYou must not: Approve untested code";
    const result = parsePromptToFields(prompt);
    expect(result).toEqual({
      goal: "Find bugs",
      constraints: "Approve untested code",
      approach: "",
    });
  });

  it("parses prompt with only approach", () => {
    const prompt =
      "You are a DevOps. Keep systems reliable\n\nYour approach: Automate everything";
    const result = parsePromptToFields(prompt);
    expect(result).toEqual({
      goal: "Keep systems reliable",
      constraints: "",
      approach: "Automate everything",
    });
  });

  it("returns null for non-structured prompt", () => {
    const prompt =
      "You are a senior developer. Focus on clean code and testing.";
    expect(parsePromptToFields(prompt)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parsePromptToFields("")).toBeNull();
  });

  it("returns null for null-ish input", () => {
    expect(parsePromptToFields("")).toBeNull();
  });

  it("handles prompt with 'an' article in role", () => {
    const prompt =
      "You are an Automated Tester. Write tests\n\nYou must not: Skip coverage";
    const result = parsePromptToFields(prompt);
    expect(result).toEqual({
      goal: "Write tests",
      constraints: "Skip coverage",
      approach: "",
    });
  });
});

describe("parsePromptToFields — markdown headers", () => {
  it("parses ## Goal / ## Constraints / ## Approach format", () => {
    const prompt =
      "## Goal\nBuild robust APIs and server logic.\n\n" +
      "## Constraints\nNever expose internal errors to clients.\n\n" +
      "## Approach\nDesign schemas before writing code.";
    const result = parsePromptToFields(prompt);
    expect(result).toEqual({
      goal: "Build robust APIs and server logic.",
      constraints: "Never expose internal errors to clients.",
      approach: "Design schemas before writing code.",
    });
  });

  it("parses with only two markdown sections", () => {
    const prompt =
      "## Goal\nShip clean code.\n\n## Approach\nWrite tests first.";
    const result = parsePromptToFields(prompt);
    expect(result).toEqual({
      goal: "Ship clean code.",
      constraints: "",
      approach: "Write tests first.",
    });
  });

  it("returns null with only one markdown section", () => {
    const prompt = "## Goal\nJust a goal, nothing else.";
    expect(parsePromptToFields(prompt)).toBeNull();
  });

  it("handles sections in non-standard order", () => {
    const prompt =
      "## Approach\nAutomate everything.\n\n" +
      "## Goal\nKeep systems reliable.\n\n" +
      "## Constraints\nDon't skip monitoring.";
    const result = parsePromptToFields(prompt);
    expect(result).toEqual({
      goal: "Keep systems reliable.",
      constraints: "Don't skip monitoring.",
      approach: "Automate everything.",
    });
  });
});

describe("parsePromptToFields — expertise (inline)", () => {
  it("parses prompt with expertise marker", () => {
    const prompt =
      "You are a Developer. Ship clean code\n\n" +
      "Domain expertise: SOLID principles. N+1 detection.\n\n" +
      "You must not: Skip tests\n\n" +
      "Your approach: Write tests first";
    const result = parsePromptToFields(prompt);
    expect(result).toEqual({
      goal: "Ship clean code",
      expertise: "SOLID principles. N+1 detection.",
      constraints: "Skip tests",
      approach: "Write tests first",
    });
  });

  it("parses prompt without expertise — returns undefined expertise", () => {
    const prompt =
      "You are a Developer. Ship code\n\nYou must not: Skip tests\n\nYour approach: Write tests";
    const result = parsePromptToFields(prompt);
    expect(result?.expertise).toBeUndefined();
  });

});

describe("parsePromptToFields — expertise (markdown)", () => {
  it("parses ## Expertise section", () => {
    const prompt =
      "## Goal\nShip clean code.\n\n" +
      "## Expertise\nSOLID principles. N+1 detection.\n\n" +
      "## Constraints\nSkip tests.\n\n" +
      "## Approach\nWrite tests first.";
    const result = parsePromptToFields(prompt);
    expect(result).toEqual({
      goal: "Ship clean code.",
      expertise: "SOLID principles. N+1 detection.",
      constraints: "Skip tests.",
      approach: "Write tests first.",
    });
  });

  it("parses markdown without ## Expertise — returns undefined", () => {
    const prompt =
      "## Goal\nShip code.\n\n## Constraints\nSkip tests.\n\n## Approach\nWrite tests.";
    const result = parsePromptToFields(prompt);
    expect(result?.expertise).toBeUndefined();
  });

  it("counts ## Expertise toward the 2-header minimum", () => {
    const prompt =
      "## Goal\nShip code.\n\n## Expertise\nSOLID principles.";
    const result = parsePromptToFields(prompt);
    expect(result).toEqual({
      goal: "Ship code.",
      expertise: "SOLID principles.",
      constraints: "",
      approach: "",
    });
  });
});

describe("isStructuredPrompt", () => {
  it("returns true for structured prompt", () => {
    expect(
      isStructuredPrompt(
        "You are a Dev. Code\n\nYou must not: Skip tests\n\nYour approach: TDD"
      )
    ).toBe(true);
  });

  it("returns false for freeform prompt", () => {
    expect(
      isStructuredPrompt("You are a developer. Write clean code.")
    ).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isStructuredPrompt("")).toBe(false);
  });
});

describe("parsePromptToFields — converter options", () => {
  it("keeps text before the first markdown heading as the start of the goal", () => {
    const result = parsePromptToFields("Intro line.\n\n## Goal\nDo it.\n\n## Approach\nWell.", { role: null });
    expect(result?.goal).toBe("Intro line.\n\nDo it.");
  });

  it("drops the preamble when no options are given (display behaviour)", () => {
    const result = parsePromptToFields("Intro line.\n\n## Goal\nDo it.\n\n## Approach\nWell.");
    expect(result?.goal).toBe("Do it.");
  });

  it("strips the 'You are a X.' opening only when X is the agent's role", () => {
    const text = "You are a Developer. Ship code\n\nYou must not: Skip tests";
    expect(parsePromptToFields(text, { role: "Developer" })?.goal).toBe("Ship code");
    expect(parsePromptToFields(text, { role: "QA" })?.goal).toBe("You are a Developer. Ship code");
    expect(parsePromptToFields(text, { role: null })?.goal).toBe("You are a Developer. Ship code");
  });
});
