import { describe, it, expect } from "vitest";
import {
  buildPromptContextParts,
  buildAutoRuleMappings,
  type PromptContext,
} from "./ai-prompt-helpers";

describe("buildPromptContextParts", () => {
  const baseCtx: PromptContext = {
    prompt: "Generate tasks for this project",
    ideaTitle: "My App",
    ideaDescription: "A todo app",
    existingColumns: [],
    existingLabels: [],
    autoRuleMappings: [],
  };

  it("includes prompt, idea title and description", () => {
    const parts = buildPromptContextParts(baseCtx);
    const joined = parts.join("\n\n");
    expect(joined).toContain("Generate tasks for this project");
    expect(joined).toContain("**Idea Title:** My App");
    expect(joined).toContain("A todo app");
  });

  it("includes existing columns when provided", () => {
    const parts = buildPromptContextParts({
      ...baseCtx,
      existingColumns: ["Backlog", "In Progress", "Done"],
    });
    const joined = parts.join("\n\n");
    expect(joined).toContain("**Existing Board Columns:** Backlog, In Progress, Done");
  });

  it("omits columns section when empty", () => {
    const parts = buildPromptContextParts(baseCtx);
    const joined = parts.join("\n\n");
    expect(joined).not.toContain("Existing Board Columns");
  });

  it("includes existing labels when provided", () => {
    const parts = buildPromptContextParts({
      ...baseCtx,
      existingLabels: ["Feature", "Bug", "Infrastructure"],
    });
    const joined = parts.join("\n\n");
    expect(joined).toContain("**Existing Board Labels:** Feature, Bug, Infrastructure");
    expect(joined).toContain("Use these exact label names");
  });

  it("omits labels section when empty", () => {
    const parts = buildPromptContextParts(baseCtx);
    const joined = parts.join("\n\n");
    expect(joined).not.toContain("Existing Board Labels");
  });

  it("includes auto-rule mappings with template descriptions", () => {
    const parts = buildPromptContextParts({
      ...baseCtx,
      existingLabels: ["Feature", "Bug"],
      autoRuleMappings: [
        { labelName: "Feature", templateName: "Feature Development", templateDescription: "Full dev lifecycle" },
        { labelName: "Bug", templateName: "Bug Fix", templateDescription: null },
      ],
    });
    const joined = parts.join("\n\n");
    expect(joined).toContain("**Workflow Auto-Rules:**");
    expect(joined).toContain('Label "Feature" → applies workflow "Feature Development" (Full dev lifecycle)');
    expect(joined).toContain('Label "Bug" → applies workflow "Bug Fix"');
    expect(joined).not.toContain("Bug Fix ("); // no description for Bug
    expect(joined).toContain("Classify each task");
  });

  it("uses first auto-rule label in example when no 'feature' label exists", () => {
    const parts = buildPromptContextParts({
      ...baseCtx,
      existingLabels: ["Spike", "Hotfix"],
      autoRuleMappings: [
        { labelName: "Spike", templateName: "Research", templateDescription: null },
      ],
    });
    const joined = parts.join("\n\n");
    expect(joined).toContain('should be labelled "Spike"');
  });

  it("omits auto-rules section when no mappings exist", () => {
    const parts = buildPromptContextParts(baseCtx);
    const joined = parts.join("\n\n");
    expect(joined).not.toContain("Workflow Auto-Rules");
  });

  it("includes agent context when provided", () => {
    const parts = buildPromptContextParts({
      ...baseCtx,
      agentRole: "QA Engineer",
      agentSkills: ["testing", "automation"],
      agentBio: "Expert in quality assurance",
    });
    const joined = parts.join("\n\n");
    expect(joined).toContain("**Agent Role:** QA Engineer");
    expect(joined).toContain("**Agent Skills:** testing, automation");
    expect(joined).toContain("**Agent Bio:** Expert in quality assurance");
  });

  it("omits agent section when no agent info provided", () => {
    const parts = buildPromptContextParts(baseCtx);
    const joined = parts.join("\n\n");
    expect(joined).not.toContain("Agent Role");
  });
});

describe("buildAutoRuleMappings", () => {
  it("maps labels to templates correctly", () => {
    const labels = [
      { id: "l1", name: "Feature" },
      { id: "l2", name: "Bug" },
    ];
    const autoRules = [
      { label_id: "l1", template: { name: "Feature Dev", description: "Full lifecycle" } },
      { label_id: "l2", template: { name: "Bug Fix", description: null } },
    ];

    const result = buildAutoRuleMappings(labels, autoRules);
    expect(result).toEqual([
      { labelName: "Feature", templateName: "Feature Dev", templateDescription: "Full lifecycle" },
      { labelName: "Bug", templateName: "Bug Fix", templateDescription: null },
    ]);
  });

  it("filters out rules with missing labels", () => {
    const labels = [{ id: "l1", name: "Feature" }];
    const autoRules = [
      { label_id: "l1", template: { name: "Feature Dev", description: null } },
      { label_id: "l999", template: { name: "Unknown", description: null } },
    ];

    const result = buildAutoRuleMappings(labels, autoRules);
    expect(result).toHaveLength(1);
    expect(result[0].labelName).toBe("Feature");
  });

  it("filters out rules with null templates", () => {
    const labels = [{ id: "l1", name: "Feature" }];
    const autoRules = [{ label_id: "l1", template: null }];

    const result = buildAutoRuleMappings(labels, autoRules);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty inputs", () => {
    expect(buildAutoRuleMappings([], [])).toEqual([]);
  });
});
