import { describe, it, expect } from "vitest";

/**
 * Regression test for the "+ Add" button bug.
 *
 * Root cause: two Popover components sharing the same `addOpen` state
 * rendered simultaneously when ideaAgents was empty but unallocatedBots
 * existed, causing the popover to open and immediately close.
 *
 * Fix: the icon "+" button popover should only render when ideaAgents.length > 0
 * (i.e., the avatar stack is visible). The inline "+ Add" text button handles
 * the empty-agents case.
 *
 * These tests verify the render condition logic extracted from the component.
 */

// Mirrors the render conditions from idea-agents-section.tsx
function getVisibleControls(params: {
  ideaAgentsCount: number;
  isTeamMember: boolean;
  unallocatedBotsCount: number;
}) {
  const { ideaAgentsCount, isTeamMember, unallocatedBotsCount } = params;

  const showNudgeBanner =
    ideaAgentsCount === 0 && isTeamMember && unallocatedBotsCount === 0;
  const showInlineAddHint =
    ideaAgentsCount === 0 && isTeamMember && unallocatedBotsCount > 0;
  const showAvatarStack = ideaAgentsCount > 0;
  // This is the fixed condition — previously was missing ideaAgentsCount > 0
  const showIconAddButton =
    isTeamMember && ideaAgentsCount > 0 && unallocatedBotsCount > 0;

  return {
    showNudgeBanner,
    showInlineAddHint,
    showAvatarStack,
    showIconAddButton,
  };
}

describe("IdeaAgentsSection render conditions", () => {
  it("shows only inline + Add hint when no agents allocated but bots available", () => {
    const result = getVisibleControls({
      ideaAgentsCount: 0,
      isTeamMember: true,
      unallocatedBotsCount: 3,
    });

    expect(result.showInlineAddHint).toBe(true);
    expect(result.showIconAddButton).toBe(false);
    expect(result.showAvatarStack).toBe(false);
    expect(result.showNudgeBanner).toBe(false);
  });

  it("REGRESSION: does not show icon + button when no agents allocated (duplicate popover bug)", () => {
    // This was the bug — both inline hint popover AND icon button popover
    // rendered with shared state, causing the popover to immediately close
    const result = getVisibleControls({
      ideaAgentsCount: 0,
      isTeamMember: true,
      unallocatedBotsCount: 5,
    });

    expect(result.showInlineAddHint).toBe(true);
    expect(result.showIconAddButton).toBe(false);
  });

  it("shows icon + button alongside avatar stack when agents exist and more available", () => {
    const result = getVisibleControls({
      ideaAgentsCount: 3,
      isTeamMember: true,
      unallocatedBotsCount: 2,
    });

    expect(result.showAvatarStack).toBe(true);
    expect(result.showIconAddButton).toBe(true);
    expect(result.showInlineAddHint).toBe(false);
  });

  it("hides icon + button when all bots already allocated", () => {
    const result = getVisibleControls({
      ideaAgentsCount: 5,
      isTeamMember: true,
      unallocatedBotsCount: 0,
    });

    expect(result.showAvatarStack).toBe(true);
    expect(result.showIconAddButton).toBe(false);
  });

  it("shows nudge banner when no agents and no bots available", () => {
    const result = getVisibleControls({
      ideaAgentsCount: 0,
      isTeamMember: true,
      unallocatedBotsCount: 0,
    });

    expect(result.showNudgeBanner).toBe(true);
    expect(result.showInlineAddHint).toBe(false);
    expect(result.showIconAddButton).toBe(false);
  });

  it("hides all add controls for non-team members", () => {
    const result = getVisibleControls({
      ideaAgentsCount: 3,
      isTeamMember: false,
      unallocatedBotsCount: 2,
    });

    expect(result.showIconAddButton).toBe(false);
    expect(result.showInlineAddHint).toBe(false);
    expect(result.showNudgeBanner).toBe(false);
  });
});
