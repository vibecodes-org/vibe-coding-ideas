import { describe, it, expect } from "vitest";
import {
  computeIdeaHealth,
  type IdeaHealthInput,
  type HealthStatus,
} from "./idea-health";

// Helper to build input with defaults (fully set up)
function makeInput(overrides: Partial<IdeaHealthInput> = {}): IdeaHealthInput {
  return {
    taskCount: 10,
    allocatedAgentCount: 5,
    ownedAgentCount: 5,
    workflowTemplateCount: 3,
    autoRuleCount: 3,
    labelCount: 4,
    unmatchedRoleCount: 0,
    hasKit: true,
    ...overrides,
  };
}

describe("computeIdeaHealth", () => {
  // ========================================
  // 11 User Paths from the audit
  // ========================================

  describe("Path coverage", () => {
    it("Path 1: Onboarding + kit — complete", () => {
      const result = computeIdeaHealth(makeInput());
      expect(result.status).toBe("complete");
      expect(result.score).toBe(100);
      expect(result.missing).toHaveLength(0);
      expect(result.showKitShortcut).toBe(false);
    });

    it("Path 2: Onboarding + no kit — tasks but nothing else", () => {
      const result = computeIdeaHealth(
        makeInput({
          taskCount: 8,
          allocatedAgentCount: 0,
          ownedAgentCount: 0,
          workflowTemplateCount: 0,
          autoRuleCount: 0,
          labelCount: 0,
          unmatchedRoleCount: 0,
          hasKit: false,
        })
      );
      expect(result.status).toBe("partial");
      expect(result.missing.some((g) => g.type === "no-agents")).toBe(true);
      expect(result.missing.some((g) => g.type === "no-workflows")).toBe(true);
      expect(result.showKitShortcut).toBe(true);
    });

    it("Path 3: /ideas/new + kit — agents/workflows but no tasks", () => {
      const result = computeIdeaHealth(makeInput({ taskCount: 0 }));
      expect(result.status).toBe("complete");
      expect(result.missing).toHaveLength(0);
    });

    it("Path 4: /ideas/new + no kit — blank slate", () => {
      const result = computeIdeaHealth(
        makeInput({
          taskCount: 0,
          allocatedAgentCount: 0,
          ownedAgentCount: 0,
          workflowTemplateCount: 0,
          autoRuleCount: 0,
          labelCount: 0,
          unmatchedRoleCount: 0,
          hasKit: false,
        })
      );
      expect(result.status).toBe("empty");
      expect(result.showKitShortcut).toBe(true);
    });

    it("Path 5: MCP create_idea — bare idea", () => {
      const result = computeIdeaHealth(
        makeInput({
          taskCount: 0,
          allocatedAgentCount: 0,
          ownedAgentCount: 0,
          workflowTemplateCount: 0,
          autoRuleCount: 0,
          labelCount: 0,
          unmatchedRoleCount: 0,
          hasKit: false,
        })
      );
      expect(result.status).toBe("empty");
    });

    it("Path 6: Post-creation kit apply — works well", () => {
      const result = computeIdeaHealth(makeInput({ taskCount: 5 }));
      expect(result.status).toBe("complete");
      expect(result.score).toBe(100);
    });

    it("Path 7: Featured team clone — agents owned but not allocated", () => {
      const result = computeIdeaHealth(
        makeInput({
          ownedAgentCount: 5,
          allocatedAgentCount: 0,
          workflowTemplateCount: 0,
          autoRuleCount: 0,
          labelCount: 0,
          hasKit: false,
        })
      );
      expect(result.missing[0].type).toBe("agents-not-allocated");
      expect(result.missing[0].severity).toBe("critical");
    });

    it("Path 8: Manual agent creation — same as Path 7", () => {
      const result = computeIdeaHealth(
        makeInput({
          ownedAgentCount: 1,
          allocatedAgentCount: 0,
          workflowTemplateCount: 0,
          autoRuleCount: 0,
          hasKit: false,
        })
      );
      expect(result.missing[0].type).toBe("agents-not-allocated");
    });

    it("Path 9: Community agent clone — same as Path 7", () => {
      const result = computeIdeaHealth(
        makeInput({
          ownedAgentCount: 1,
          allocatedAgentCount: 0,
          workflowTemplateCount: 0,
          autoRuleCount: 0,
          hasKit: false,
        })
      );
      expect(result.missing[0].type).toBe("agents-not-allocated");
    });

    it("Path 10: Agents allocated, no workflows", () => {
      const result = computeIdeaHealth(
        makeInput({
          workflowTemplateCount: 0,
          autoRuleCount: 0,
        })
      );
      expect(result.missing[0].type).toBe("no-workflows");
    });

    it("Path 11: Workflows but no agents allocated", () => {
      const result = computeIdeaHealth(
        makeInput({
          ownedAgentCount: 0,
          allocatedAgentCount: 0,
        })
      );
      expect(result.missing[0].type).toBe("no-agents");
      expect(result.missing[0].severity).toBe("critical");
    });
  });

  // ========================================
  // Gap detection
  // ========================================

  describe("Gap detection", () => {
    it("detects no-agents when ownedAgentCount is 0", () => {
      const result = computeIdeaHealth(
        makeInput({ ownedAgentCount: 0, allocatedAgentCount: 0 })
      );
      expect(result.missing.some((g) => g.type === "no-agents")).toBe(true);
      // Should NOT also show agents-not-allocated
      expect(
        result.missing.some((g) => g.type === "agents-not-allocated")
      ).toBe(false);
    });

    it("detects agents-not-allocated when owned > 0 but allocated = 0", () => {
      const result = computeIdeaHealth(
        makeInput({ ownedAgentCount: 3, allocatedAgentCount: 0 })
      );
      expect(
        result.missing.some((g) => g.type === "agents-not-allocated")
      ).toBe(true);
      expect(result.missing.some((g) => g.type === "no-agents")).toBe(false);
    });

    it("detects no-workflows as critical when tasks exist", () => {
      const result = computeIdeaHealth(
        makeInput({ workflowTemplateCount: 0, autoRuleCount: 0, taskCount: 5 })
      );
      const gap = result.missing.find((g) => g.type === "no-workflows");
      expect(gap?.severity).toBe("critical");
    });

    it("detects no-workflows as warning when no tasks", () => {
      const result = computeIdeaHealth(
        makeInput({ workflowTemplateCount: 0, autoRuleCount: 0, taskCount: 0 })
      );
      const gap = result.missing.find((g) => g.type === "no-workflows");
      expect(gap?.severity).toBe("warning");
    });

    it("detects no-auto-rules when templates exist but rules don't", () => {
      const result = computeIdeaHealth(
        makeInput({ workflowTemplateCount: 2, autoRuleCount: 0 })
      );
      expect(result.missing.some((g) => g.type === "no-auto-rules")).toBe(true);
    });

    it("does NOT detect no-auto-rules when no templates", () => {
      const result = computeIdeaHealth(
        makeInput({ workflowTemplateCount: 0, autoRuleCount: 0 })
      );
      expect(result.missing.some((g) => g.type === "no-auto-rules")).toBe(
        false
      );
    });

    it("detects unmatched-roles", () => {
      const result = computeIdeaHealth(makeInput({ unmatchedRoleCount: 3 }));
      expect(result.missing.some((g) => g.type === "unmatched-roles")).toBe(
        true
      );
    });

    it("detects no-labels when tasks exist but no labels", () => {
      const result = computeIdeaHealth(
        makeInput({ labelCount: 0, taskCount: 5 })
      );
      expect(result.missing.some((g) => g.type === "no-labels")).toBe(true);
    });

    it("does NOT detect no-labels when no tasks", () => {
      const result = computeIdeaHealth(
        makeInput({ labelCount: 0, taskCount: 0 })
      );
      expect(result.missing.some((g) => g.type === "no-labels")).toBe(false);
    });
  });

  // ========================================
  // Status logic
  // ========================================

  describe("Status", () => {
    it("returns empty when nothing exists", () => {
      const result = computeIdeaHealth(
        makeInput({
          taskCount: 0,
          allocatedAgentCount: 0,
          ownedAgentCount: 0,
          workflowTemplateCount: 0,
          autoRuleCount: 0,
          labelCount: 0,
          unmatchedRoleCount: 0,
          hasKit: false,
        })
      );
      expect(result.status).toBe("empty");
    });

    it("returns complete when no gaps", () => {
      const result = computeIdeaHealth(makeInput());
      expect(result.status).toBe("complete");
    });

    it("returns ready when only info gaps remain", () => {
      // Only gap: no labels (info severity)
      const result = computeIdeaHealth(makeInput({ labelCount: 0 }));
      expect(result.status).toBe("ready");
    });

    it("returns partial for anything else", () => {
      const result = computeIdeaHealth(
        makeInput({ workflowTemplateCount: 0, autoRuleCount: 0 })
      );
      expect(result.status).toBe("partial");
    });
  });

  // ========================================
  // Kit shortcut
  // ========================================

  describe("Kit shortcut", () => {
    it("shows when no kit and 2+ gaps", () => {
      const result = computeIdeaHealth(
        makeInput({
          hasKit: false,
          ownedAgentCount: 0,
          allocatedAgentCount: 0,
          workflowTemplateCount: 0,
          autoRuleCount: 0,
        })
      );
      expect(result.showKitShortcut).toBe(true);
    });

    it("does NOT show when kit applied", () => {
      const result = computeIdeaHealth(
        makeInput({
          hasKit: true,
          workflowTemplateCount: 0,
          autoRuleCount: 0,
        })
      );
      expect(result.showKitShortcut).toBe(false);
    });

    it("does NOT show when only 1 gap", () => {
      const result = computeIdeaHealth(
        makeInput({ hasKit: false, unmatchedRoleCount: 2 })
      );
      expect(result.missing).toHaveLength(1);
      expect(result.showKitShortcut).toBe(false);
    });
  });

  // ========================================
  // Score
  // ========================================

  describe("Score", () => {
    it("returns 100 when everything present", () => {
      expect(computeIdeaHealth(makeInput()).score).toBe(100);
    });

    it("returns 0 when nothing present", () => {
      expect(
        computeIdeaHealth(
          makeInput({
            taskCount: 0,
            ownedAgentCount: 0,
            allocatedAgentCount: 0,
            workflowTemplateCount: 0,
            autoRuleCount: 0,
            labelCount: 0,
            unmatchedRoleCount: 0,
          })
        ).score
      ).toBe(0);
    });

    it("gives matchedRoles weight only when workflows exist and all matched", () => {
      // Has workflows, no unmatched → gets matchedRoles weight
      const withMatch = computeIdeaHealth(
        makeInput({ unmatchedRoleCount: 0 })
      );
      // Has workflows, some unmatched → no matchedRoles weight
      const withUnmatched = computeIdeaHealth(
        makeInput({ unmatchedRoleCount: 2 })
      );
      expect(withMatch.score - withUnmatched.score).toBe(10);
    });

    it("does NOT give matchedRoles weight when no workflows", () => {
      const result = computeIdeaHealth(
        makeInput({
          workflowTemplateCount: 0,
          autoRuleCount: 0,
          unmatchedRoleCount: 0,
        })
      );
      // Should not get the 10-point matchedRoles bonus or the 20-point workflows or 15-point auto-rules
      expect(result.score).toBe(100 - 20 - 15 - 10);
    });
  });

  // ========================================
  // Pure function contract
  // ========================================

  describe("Purity", () => {
    it("returns the same output for the same input", () => {
      const input = makeInput({ taskCount: 3, ownedAgentCount: 2 });
      const a = computeIdeaHealth(input);
      const b = computeIdeaHealth(input);
      expect(a).toEqual(b);
    });

    it("does not mutate the input", () => {
      const input = makeInput();
      const frozen = JSON.parse(JSON.stringify(input));
      computeIdeaHealth(input);
      expect(input).toEqual(frozen);
    });
  });
});
