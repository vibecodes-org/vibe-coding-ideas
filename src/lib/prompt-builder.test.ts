import { describe, it, expect } from "vitest";
import {
  generatePromptFromFields,
  parsePromptToFields,
  isStructuredPrompt,
  type StructuredPromptFields,
} from "./prompt-builder";

describe("generatePromptFromFields", () => {
  it("generates prompt with all fields", () => {
    const result = generatePromptFromFields("Developer", {
      goal: "Ship clean, tested code",
      constraints: "Never skip tests or ignore linting errors",
      approach: "Break tasks into small PRs. Write tests first.",
    });
    expect(result).toBe(
      "You are a Developer. Ship clean, tested code\n\n" +
        "You must not: Never skip tests or ignore linting errors\n\n" +
        "Your approach: Break tasks into small PRs. Write tests first."
    );
  });

  it("generates prompt with only goal", () => {
    const result = generatePromptFromFields("QA Tester", {
      goal: "Find edge cases and regressions",
      constraints: "",
      approach: "",
    });
    expect(result).toBe("You are a QA Tester. Find edge cases and regressions");
  });

  it("generates prompt with only constraints and approach", () => {
    const result = generatePromptFromFields("Support", {
      goal: "",
      constraints: "Never close tickets without user confirmation",
      approach: "Reproduce bugs before escalating",
    });
    expect(result).toBe(
      "You are a Support.\n\n" +
        "You must not: Never close tickets without user confirmation\n\n" +
        "Your approach: Reproduce bugs before escalating"
    );
  });

  it("generates prompt without role", () => {
    const result = generatePromptFromFields("", {
      goal: "Help the team succeed",
      constraints: "",
      approach: "Be proactive and communicative",
    });
    expect(result).toBe(
      "Help the team succeed\n\n" +
        "Your approach: Be proactive and communicative"
    );
  });

  it("returns empty string when all fields are empty", () => {
    const result = generatePromptFromFields("", {
      goal: "",
      constraints: "",
      approach: "",
    });
    expect(result).toBe("");
  });

  it("returns only role when fields are empty but role is set", () => {
    const result = generatePromptFromFields("DevOps", {
      goal: "",
      constraints: "",
      approach: "",
    });
    expect(result).toBe("You are a DevOps.");
  });

  it("trims whitespace from fields", () => {
    const result = generatePromptFromFields("  Developer  ", {
      goal: "  Ship code  ",
      constraints: "  Skip tests  ",
      approach: "  Write tests  ",
    });
    expect(result).toBe(
      "You are a Developer. Ship code\n\n" +
        "You must not: Skip tests\n\n" +
        "Your approach: Write tests"
    );
  });
});

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

  it("round-trips: generate then parse returns original fields", () => {
    const original: StructuredPromptFields = {
      goal: "Ship clean, tested, and well-documented code",
      constraints:
        "Skip tests, ignore linting errors, or make changes outside scope",
      approach:
        "Break tasks into small PRs. Follow project conventions. Write tests first.",
    };
    const prompt = generatePromptFromFields("Developer", original);
    const parsed = parsePromptToFields(prompt);
    expect(parsed).toEqual(original);
  });

  it("round-trips with only goal and approach", () => {
    const original: StructuredPromptFields = {
      goal: "Triage user issues quickly",
      constraints: "",
      approach: "Reproduce bugs before escalating",
    };
    const prompt = generatePromptFromFields("Support", original);
    const parsed = parsePromptToFields(prompt);
    expect(parsed).toEqual(original);
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
