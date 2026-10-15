// Claude terminal starting effort (task 18a37612). Pure helpers: the
// user -> site -> none resolution, the launch guard, labels and help copy.
// Framework-agnostic, same posture as remote-control-mode.ts.

import { isEffortForAgent, type ReasoningEffort } from "@/lib/platform-model-defaults";

/** A level on Claude Code's `--effort` ladder (low...max). */
export type ClaudeEffort = Extract<ReasoningEffort, "low" | "medium" | "high" | "xhigh" | "max">;

export const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
};

export function isClaudeEffort(value: unknown): value is ClaudeEffort {
  return isEffortForAgent("claude", value);
}

export type ClaudeEffortSource = "user" | "platform" | "none";

/**
 * The order is the user's own level, then the site default an admin set, then
 * nothing (Claude Code decides: today's behaviour). An invalid value on either
 * side counts as unset and is never mixed with the other.
 */
export function resolveTerminalClaudeEffort(input: {
  userValue?: unknown;
  platformValue?: unknown;
}): { effort: ClaudeEffort | undefined; source: ClaudeEffortSource } {
  if (isClaudeEffort(input.userValue)) return { effort: input.userValue, source: "user" };
  if (isClaudeEffort(input.platformValue)) return { effort: input.platformValue, source: "platform" };
  return { effort: undefined, source: "none" };
}

/** The effort a launch may carry: only for Claude, only a valid level. */
export function claudeEffortForLaunch({
  effort,
  agent,
}: {
  effort: unknown;
  agent: "claude" | "codex" | string | null | undefined;
}): ClaudeEffort | undefined {
  if (agent === "codex") return undefined;
  return isClaudeEffort(effort) ? effort : undefined;
}

/** Second line under the Default segment. null while the site default loads. */
export function claudeEffortDefaultSubLabel(platformValue: unknown): string | null {
  if (platformValue === undefined) return null;
  return isClaudeEffort(platformValue) ? `site: ${EFFORT_LABELS[platformValue]}` : "Claude's own";
}

/** The Default button's accessible name. */
export function claudeEffortDefaultAriaLabel(platformValue: unknown): string {
  return isClaudeEffort(platformValue)
    ? `Default, site setting ${EFFORT_LABELS[platformValue]}`
    : "Default, Claude Code decides";
}

const KEEP_TIER = "Workflow steps keep their own tier's effort.";
const TYPE_EFFORT = "Change it any time by typing /effort in the terminal.";

/** Help line under the Settings "Starting effort" strip. null level = Default. */
export function claudeEffortHelp({
  userValue,
  platformValue,
}: {
  userValue: unknown;
  platformValue: unknown;
}): string {
  if (isClaudeEffort(userValue)) {
    return `New and resumed Claude Code sessions start at ${EFFORT_LABELS[userValue]} (your setting). ${KEEP_TIER} ${TYPE_EFFORT}`;
  }
  if (isClaudeEffort(platformValue)) {
    return `Uses the site default: new and resumed Claude Code sessions start at ${EFFORT_LABELS[platformValue]}. ${KEEP_TIER} ${TYPE_EFFORT}`;
  }
  return `Claude Code decides: the level you last saved with /effort, otherwise the model's own (Medium on Opus 5.5). Applies to new and resumed sessions. ${KEEP_TIER}`;
}
