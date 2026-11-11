import { describe, it, expect } from "vitest";
import { shouldShowNoWorkflowBadge } from "./no-workflow-mark";

const base = {
  workflowStepTotal: 0,
  hasSuggestion: false,
  isArchived: false,
  columnIsDone: false,
  isWiring: false,
};

describe("shouldShowNoWorkflowBadge", () => {
  it("shows when nothing is attached, suggested, archived, done or wiring", () => {
    expect(shouldShowNoWorkflowBadge(base)).toBe(true);
  });
  it.each([
    ["has workflow steps", { workflowStepTotal: 3 }],
    ["has an open suggestion", { hasSuggestion: true }],
    ["is archived", { isArchived: true }],
    ["is in a Done column", { columnIsDone: true }],
    ["is still wiring a label workflow", { isWiring: true }],
  ])("hides when the card %s", (_name, override) => {
    expect(shouldShowNoWorkflowBadge({ ...base, ...override })).toBe(false);
  });
});
