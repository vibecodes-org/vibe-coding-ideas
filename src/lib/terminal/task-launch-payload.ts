import {
  buildCompactPromptEssentials,
  essentialsForAgent,
  resolveAppUrl,
  resolveDefaultLaunchState,
  resolveEffectiveLaunchTarget,
  resolveLaunchCwd,
  type RecordedProjectPath,
} from "@/lib/launch-claude-code";
import { logger } from "@/lib/logger";
import type { BrowserLaunchPayload } from "@/lib/terminal/launch-mode";
import type { LaunchAgent } from "@/lib/terminal/agent-launch";

export interface TaskBrowserLaunchInput {
  ideaId: string;
  ideaTitle: string;
  ideaGithubUrl: string | null;
  /** Folders already merged with any manual pin. */
  recordedPaths: RecordedProjectPath[];
  machineNames: string[];
  taskId: string;
  taskTitle: string;
  agent: LaunchAgent;
}

/**
 * The browser-terminal launch for one card, built the same way the card's
 * "Launch in browser terminal" menu item builds it. Pure, so the menu item and
 * the offer strip's "Start in a new tab" cannot drift apart.
 */
export function buildTaskBrowserLaunchPayload(input: TaskBrowserLaunchInput): BrowserLaunchPayload {
  const target = resolveEffectiveLaunchTarget({
    hasRepo: !!input.ideaGithubUrl,
    recordedPaths: input.recordedPaths,
    machineNames: input.machineNames,
  });
  const state = resolveDefaultLaunchState(input.ideaId, input.ideaTitle, input.ideaGithubUrl, target);
  const newProject = state.mode === "new" ? { newProjectPath: state.path } : undefined;
  const existingPath = state.mode === "existing" && state.path.trim() ? state.path.trim() : undefined;
  const essentials = buildCompactPromptEssentials({
    appUrl: resolveAppUrl(),
    ideaId: input.ideaId,
    ideaTitle: input.ideaTitle,
    mode: state.mode,
    repoUrl: input.ideaGithubUrl,
    newProject,
    existingPath,
    taskId: input.taskId,
    includeIsolationAdvisory: false,
    agent: input.agent,
    guideBootstrap: true,
  });
  return {
    essentials,
    cwd: resolveLaunchCwd(state, target.cwd),
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    agent: input.agent,
  };
}

/**
 * A launch waiting in the dock, with the agent the user finally picked there.
 * The start-up instructions are rebuilt for that agent when it differs from
 * the one the launch was built for, so the agent that starts never gets the
 * other agent's instructions (card 89f64254). A launch with no instructions
 * (nothing waiting, or a resume) just carries the agent.
 */
export function withLaunchAgent(payload: BrowserLaunchPayload | null, agent: LaunchAgent): BrowserLaunchPayload {
  if (!payload?.essentials) return { ...payload, agent };
  const rebuilt = essentialsForAgent(payload.essentials, agent);
  if (rebuilt) return { ...payload, essentials: rebuilt, agent };
  // Instructions that can't be rebuilt (not made by the shared builder).
  // Unchanged agent: they are already right. Changed agent: send none rather
  // than the other agent's, so the terminal writes the board's own for `agent`.
  if ((payload.agent ?? "claude") === agent) return { ...payload, agent };
  logger.warn("Launch agent changed but its instructions could not be rebuilt; using the board's default instructions", {
    from: payload.agent ?? "claude",
    to: agent,
    hasTask: !!payload.taskId,
  });
  return { ...payload, essentials: undefined, agent };
}
