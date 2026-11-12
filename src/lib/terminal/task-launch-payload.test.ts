import { describe, expect, it } from "vitest";
import {
  buildCompactPromptEssentials,
  resolveAppUrl,
  resolveDefaultLaunchState,
  resolveEffectiveLaunchTarget,
  resolveLaunchCwd,
} from "@/lib/launch-claude-code";
import { buildTaskBrowserLaunchPayload } from "./task-launch-payload";

const base = {
  ideaId: "idea-1",
  ideaTitle: "My board",
  ideaGithubUrl: "https://github.com/o/r",
  recordedPaths: [],
  machineNames: [] as string[],
  taskId: "task-1",
  taskTitle: "Next card",
};

describe("buildTaskBrowserLaunchPayload", () => {
  it.each(["claude", "codex"] as const)("matches the card menu's launch for %s", (agent) => {
    // The card menu's original steps, written out longhand.
    const target = resolveEffectiveLaunchTarget({ hasRepo: true, recordedPaths: [], machineNames: [] });
    const state = resolveDefaultLaunchState("idea-1", "My board", base.ideaGithubUrl, target);
    const essentials = buildCompactPromptEssentials({
      appUrl: resolveAppUrl(),
      ideaId: "idea-1",
      ideaTitle: "My board",
      mode: state.mode,
      repoUrl: base.ideaGithubUrl,
      newProject: state.mode === "new" ? { newProjectPath: state.path } : undefined,
      existingPath: state.mode === "existing" && state.path.trim() ? state.path.trim() : undefined,
      taskId: "task-1",
      includeIsolationAdvisory: false,
      agent,
      guideBootstrap: true,
    });
    expect(buildTaskBrowserLaunchPayload({ ...base, agent })).toEqual({
      essentials,
      cwd: resolveLaunchCwd(state, target.cwd),
      taskId: "task-1",
      taskTitle: "Next card",
      agent,
    });
  });

  it("carries the card and agent it was given", () => {
    const p = buildTaskBrowserLaunchPayload({ ...base, agent: "codex" });
    expect(p.taskId).toBe("task-1");
    expect(p.agent).toBe("codex");
  });
});
