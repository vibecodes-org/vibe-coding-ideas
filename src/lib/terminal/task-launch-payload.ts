import {
  buildCompactPromptEssentials,
  resolveAppUrl,
  resolveDefaultLaunchState,
  resolveEffectiveLaunchTarget,
  resolveLaunchCwd,
  type RecordedProjectPath,
} from "@/lib/launch-claude-code";
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
