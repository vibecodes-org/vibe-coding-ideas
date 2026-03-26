import { describe, it, expect } from "vitest";
import { computeIsActivated } from "./dashboard-activation";

describe("computeIsActivated", () => {
  const base = {
    hasTasks: true,
    hasAgents: true,
    hasWorkflows: true,
    hasMcpConnection: false,
    hasUserActivity: true,
  };

  it("returns true when all conditions met (tasks + agents + user activity)", () => {
    expect(computeIsActivated(base)).toBe(true);
  });

  it("returns false when no tasks", () => {
    expect(computeIsActivated({ ...base, hasTasks: false })).toBe(false);
  });

  it("returns false when no advanced features", () => {
    expect(
      computeIsActivated({
        ...base,
        hasAgents: false,
        hasWorkflows: false,
        hasMcpConnection: false,
      })
    ).toBe(false);
  });

  it("returns false after onboarding with kit but no manual interaction", () => {
    // This is the core bug scenario: onboarding creates tasks, agents, workflows
    // but user hasn't manually interacted yet
    expect(
      computeIsActivated({
        hasTasks: true,
        hasAgents: true,
        hasWorkflows: true,
        hasMcpConnection: false,
        hasUserActivity: false,
      })
    ).toBe(false);
  });

  it("returns true when MCP connected (even without manual board activity)", () => {
    // MCP connection is a strong engagement signal — requires manual setup
    expect(
      computeIsActivated({
        hasTasks: true,
        hasAgents: true,
        hasWorkflows: false,
        hasMcpConnection: true,
        hasUserActivity: false,
      })
    ).toBe(true);
  });

  it("returns true with tasks + workflows + user activity (no agents)", () => {
    expect(
      computeIsActivated({
        hasTasks: true,
        hasAgents: false,
        hasWorkflows: true,
        hasMcpConnection: false,
        hasUserActivity: true,
      })
    ).toBe(true);
  });

  it("returns false with only tasks and user activity (no advanced features)", () => {
    expect(
      computeIsActivated({
        hasTasks: true,
        hasAgents: false,
        hasWorkflows: false,
        hasMcpConnection: false,
        hasUserActivity: true,
      })
    ).toBe(false);
  });
});
