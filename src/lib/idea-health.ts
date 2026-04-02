/**
 * Idea Health — computes setup completeness for any idea.
 *
 * Pure function, no side effects. Powers the Board Setup Banner (Layer 1)
 * and Dashboard Health Dots (Layer 3) from the approved design
 * (docs/idea-health-system.html).
 */

export type GapType =
  | "no-agents"
  | "agents-not-allocated"
  | "no-workflows"
  | "no-auto-rules"
  | "unmatched-roles"
  | "no-labels";

export type GapSeverity = "critical" | "warning" | "info";

export type HealthStatus = "empty" | "partial" | "ready" | "complete";

export interface IdeaHealthGap {
  type: GapType;
  severity: GapSeverity;
  title: string;
  description: string;
  action: { label: string; href: string };
}

export interface IdeaHealth {
  score: number;
  status: HealthStatus;
  missing: IdeaHealthGap[];
  showKitShortcut: boolean;
}

export interface IdeaHealthInput {
  taskCount: number;
  allocatedAgentCount: number;
  ownedAgentCount: number;
  workflowTemplateCount: number;
  autoRuleCount: number;
  labelCount: number;
  unmatchedRoleCount: number;
  hasKit: boolean;
}

// Score weights (must sum to 100)
const WEIGHTS = {
  tasks: 15,
  agentsOwned: 15,
  agentsAllocated: 20,
  workflows: 20,
  autoRules: 15,
  labels: 5,
  matchedRoles: 10,
} as const;

function computeScore(input: IdeaHealthInput): number {
  let score = 0;
  if (input.taskCount > 0) score += WEIGHTS.tasks;
  if (input.ownedAgentCount > 0) score += WEIGHTS.agentsOwned;
  if (input.allocatedAgentCount > 0) score += WEIGHTS.agentsAllocated;
  if (input.workflowTemplateCount > 0) score += WEIGHTS.workflows;
  if (input.autoRuleCount > 0) score += WEIGHTS.autoRules;
  if (input.labelCount > 0) score += WEIGHTS.labels;
  if (input.unmatchedRoleCount === 0 && input.workflowTemplateCount > 0) {
    score += WEIGHTS.matchedRoles;
  }
  return score;
}

function detectGaps(input: IdeaHealthInput): IdeaHealthGap[] {
  const gaps: IdeaHealthGap[] = [];

  // 1. No agents owned
  if (input.ownedAgentCount === 0) {
    gaps.push({
      type: "no-agents",
      severity: "critical",
      title: "Create or browse agents",
      description:
        "You don't have any AI agents yet. Create one or browse the community to get started.",
      action: { label: "Browse agents", href: "/agents" },
    });
  }
  // 2. Agents owned but none allocated
  else if (input.allocatedAgentCount === 0) {
    gaps.push({
      type: "agents-not-allocated",
      severity: "critical",
      title: "Add agents to this idea",
      description: `You have ${input.ownedAgentCount} agent${input.ownedAgentCount === 1 ? "" : "s"} but none are allocated to this idea. Add them so they can work on tasks.`,
      action: { label: "Add agents", href: "?tab=agents" },
    });
  }

  // 3. No workflow templates
  if (input.workflowTemplateCount === 0) {
    gaps.push({
      type: "no-workflows",
      severity: input.taskCount > 0 ? "critical" : "warning",
      title: "Set up workflows",
      description:
        input.allocatedAgentCount > 0
          ? `You have ${input.allocatedAgentCount} agent${input.allocatedAgentCount === 1 ? "" : "s"} ready. Add workflow templates so they know what to do when tasks are labeled.`
          : "Workflows let your agents work on tasks automatically. Import a template to get started.",
      action: { label: "Set up workflows", href: "?tab=workflows" },
    });
  }

  // 4. Templates but no auto-rules
  if (input.workflowTemplateCount > 0 && input.autoRuleCount === 0) {
    gaps.push({
      type: "no-auto-rules",
      severity: "warning",
      title: "Create workflow triggers",
      description:
        "Your workflow templates need triggers. Connect a label to a template so workflows start automatically when tasks are labeled.",
      action: { label: "Add triggers", href: "?tab=workflows" },
    });
  }

  // 5. Unmatched workflow roles
  if (input.unmatchedRoleCount > 0) {
    gaps.push({
      type: "unmatched-roles",
      severity: "warning",
      title: "Assign agents to workflow roles",
      description: `${input.unmatchedRoleCount} workflow role${input.unmatchedRoleCount === 1 ? " is" : "s are"} unmatched. Add agents with the right roles so steps can be executed.`,
      action: { label: "Manage agents", href: "?tab=agents" },
    });
  }

  // 6. No labels (with tasks)
  if (input.labelCount === 0 && input.taskCount > 0) {
    gaps.push({
      type: "no-labels",
      severity: "info",
      title: "Add labels to trigger workflows",
      description:
        "Labels connect tasks to workflows. Create labels and apply them to tasks to trigger automatic workflows.",
      action: { label: "Manage labels", href: "?tab=workflows" },
    });
  }

  return gaps;
}

function computeStatus(
  input: IdeaHealthInput,
  gaps: IdeaHealthGap[]
): HealthStatus {
  if (
    input.taskCount === 0 &&
    input.allocatedAgentCount === 0 &&
    input.workflowTemplateCount === 0
  ) {
    return "empty";
  }
  if (gaps.length === 0) return "complete";
  if (gaps.every((g) => g.severity === "info")) return "ready";
  return "partial";
}

export function computeIdeaHealth(input: IdeaHealthInput): IdeaHealth {
  const missing = detectGaps(input);
  const status = computeStatus(input, missing);
  const score = computeScore(input);
  const showKitShortcut = !input.hasKit && missing.length >= 2;

  return { score, status, missing, showKitShortcut };
}
