import { describe, it, expect } from "vitest";
import {
  DEFAULT_ENHANCE_PROMPT,
  ENHANCE_SYSTEM_PROMPT,
  NEW_IDEA_SYSTEM_PROMPT,
  buildEnhanceSystemPrompt,
  buildEnhanceUserPrompt,
  buildKitContext,
  buildNewIdeaSystemPrompt,
} from "./enhance-prompts";

describe("DEFAULT_ENHANCE_PROMPT", () => {
  it("matches the literal previously inlined in enhance-dialog-shell.tsx", () => {
    expect(DEFAULT_ENHANCE_PROMPT).toBe(
      "Improve this idea description. Add more detail, user stories, technical scope, and a clear product vision. Keep the original intent and key points, but make it more comprehensive and well-structured."
    );
  });
});

describe("buildEnhanceSystemPrompt", () => {
  it("returns the base prompt with no options", () => {
    expect(buildEnhanceSystemPrompt()).toBe(ENHANCE_SYSTEM_PROMPT);
  });

  it("returns the base prompt when kitContext is omitted", () => {
    expect(buildEnhanceSystemPrompt({})).toBe(ENHANCE_SYSTEM_PROMPT);
  });

  it("appends the kit-context suffix verbatim (parity with the pre-extraction route)", () => {
    const kitContext =
      "\nThis is a **SaaS Starter** project — tailor the description to concerns specific to saas starter projects (e.g. architecture, deployment, tooling, and workflows).";

    expect(buildEnhanceSystemPrompt({ kitContext })).toBe(
      `${ENHANCE_SYSTEM_PROMPT}${kitContext}`
    );
  });
});

describe("buildEnhanceUserPrompt", () => {
  it("assembles prompt + title + description with no attachment block (byte parity)", () => {
    const result = buildEnhanceUserPrompt({
      prompt: "Make it better",
      title: "My idea",
      description: "desc",
    });

    expect(result).toBe(
      "Make it better\n\n---\n\n**Idea Title:** My idea\n\n**Current Description:**\ndesc"
    );
  });

  it("appends a supplied attachment block exactly", () => {
    const attachmentBlock = "\n\n---\n**Attached Files:**\n\n## notes.md\ncontent";
    const result = buildEnhanceUserPrompt({
      prompt: "Make it better",
      title: "My idea",
      description: "desc",
      attachmentBlock,
    });

    expect(result).toBe(
      `Make it better\n\n---\n\n**Idea Title:** My idea\n\n**Current Description:**\ndesc${attachmentBlock}`
    );
  });

  it("treats an empty-string attachment block as byte-identical to omitting it", () => {
    const withEmpty = buildEnhanceUserPrompt({
      prompt: "p",
      title: "t",
      description: "d",
      attachmentBlock: "",
    });
    const omitted = buildEnhanceUserPrompt({ prompt: "p", title: "t", description: "d" });

    expect(withEmpty).toBe(omitted);
  });
});

describe("prompt parity — reproduces the exact strings the app used pre-refactor", () => {
  it("matches src/actions/ai.ts's enhanceIdeaWithContext default-branch assembly", () => {
    // Pre-refactor literal: `${prompt}\n\n---\n\n**Idea Title:** ${idea.title}\n\n**Current Description:**\n${idea.description}`
    const prompt = "Improve this idea description.";
    const title = "Offline recipe box";
    const description = "Save recipes offline.";
    const expected = `${prompt}\n\n---\n\n**Idea Title:** ${title}\n\n**Current Description:**\n${description}`;

    expect(buildEnhanceUserPrompt({ prompt, title, description })).toBe(expected);
  });

  it("matches src/app/api/ai/enhance/route.ts's kit-aware system prompt assembly", () => {
    const kitType = "Chrome Extension";
    const kitContext = `\nThis is a **${kitType}** project — tailor the description to concerns specific to ${kitType.toLowerCase()} projects (e.g. architecture, deployment, tooling, and workflows).`;
    const expected = `You are an expert product manager and technical writer helping to enhance idea descriptions on a project management platform.${kitContext}`;

    expect(buildEnhanceSystemPrompt({ kitContext })).toBe(expected);
  });
});

describe("buildKitContext", () => {
  it("returns an empty string when kitType is omitted", () => {
    expect(buildKitContext()).toBe("");
    expect(buildKitContext(undefined)).toBe("");
  });

  it("matches the pre-extraction literal in enhance-create/route.ts (lines 44-46)", () => {
    const kitType = "SaaS Starter";
    const expected = `\nThis is a **${kitType}** project — tailor the description to concerns specific to ${kitType.toLowerCase()} projects (e.g. architecture, deployment, tooling, and workflows).`;

    expect(buildKitContext(kitType)).toBe(expected);
  });
});

describe("buildNewIdeaSystemPrompt", () => {
  it("returns NEW_IDEA_SYSTEM_PROMPT with no options", () => {
    expect(buildNewIdeaSystemPrompt()).toBe(NEW_IDEA_SYSTEM_PROMPT);
  });

  it("returns the base prompt when kitContext/personaPrompt are omitted", () => {
    expect(buildNewIdeaSystemPrompt({})).toBe(NEW_IDEA_SYSTEM_PROMPT);
  });

  it("appends kitContext to the base prompt when no persona is given", () => {
    const kitContext = buildKitContext("Chrome Extension");
    expect(buildNewIdeaSystemPrompt({ kitContext })).toBe(
      `${NEW_IDEA_SYSTEM_PROMPT}${kitContext}`
    );
  });

  it("uses the persona variant + kit context when personaPrompt is supplied", () => {
    const personaPrompt = "You are Ada, a meticulous senior PM.";
    const kitContext = buildKitContext("Next.js SaaS");
    const result = buildNewIdeaSystemPrompt({ kitContext, personaPrompt });

    expect(result).toBe(
      `${personaPrompt}\n\nYou are helping to enhance a new project idea description on a project management platform.${kitContext}`
    );
  });

  it("treats a null personaPrompt the same as omitted (falls back to base prompt)", () => {
    expect(buildNewIdeaSystemPrompt({ personaPrompt: null })).toBe(
      NEW_IDEA_SYSTEM_PROMPT
    );
  });

  describe("parity — reproduces the exact pre-refactor literal in enhance-create/route.ts (lines 48-50)", () => {
    it("no-persona branch", () => {
      const kitType = "Mobile App";
      const kitContext = kitType
        ? `\nThis is a **${kitType}** project — tailor the description to concerns specific to ${kitType.toLowerCase()} projects (e.g. architecture, deployment, tooling, and workflows).`
        : "";
      const expected = `You are an expert product manager and technical writer helping to enhance a new project idea description on a project management platform.${kitContext}`;

      expect(buildNewIdeaSystemPrompt({ kitContext: buildKitContext(kitType) })).toBe(
        expected
      );
    });

    it("persona branch", () => {
      const personaPrompt = "You are Rex, a blunt staff engineer.";
      const kitType = "API Service";
      const kitContext = `\nThis is a **${kitType}** project — tailor the description to concerns specific to ${kitType.toLowerCase()} projects (e.g. architecture, deployment, tooling, and workflows).`;
      const expected = `${personaPrompt}\n\nYou are helping to enhance a new project idea description on a project management platform.${kitContext}`;

      expect(
        buildNewIdeaSystemPrompt({ kitContext: buildKitContext(kitType), personaPrompt })
      ).toBe(expected);
    });
  });
});
