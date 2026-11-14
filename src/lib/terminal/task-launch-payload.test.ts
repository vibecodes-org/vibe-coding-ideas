import { describe, expect, it } from "vitest";
import {
  buildCompactPromptEssentials,
  resolveAppUrl,
  resolveDefaultLaunchState,
  resolveEffectiveLaunchTarget,
  resolveLaunchCwd,
} from "@/lib/launch-claude-code";
import { buildTaskBrowserLaunchPayload, withLaunchAgent } from "./task-launch-payload";

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

// Card 89f64254 (14 Nov 2026): a board launch built for Codex waited in the
// dock, the picker there was switched to Claude Code, and "Start new session"
// changed only the agent. Claude Code started with Codex's instructions
// (codex mcp add, AGENTS.md, "pass agent: codex").
describe("withLaunchAgent", () => {
  const boardArgs = {
    appUrl: resolveAppUrl(),
    ideaId: "idea-1",
    ideaTitle: "My board",
    mode: "existing" as const,
    repoUrl: null,
    existingPath: "/Users/me/projects/my-board",
    includeIsolationAdvisory: false,
    guideBootstrap: true,
  };
  const textOf = (e: ReturnType<typeof buildCompactPromptEssentials> | undefined) => `${e?.head}${e?.tail}`;

  it("rewrites a Codex launch's instructions for Claude Code when the picker is switched to Claude", () => {
    const pending = {
      essentials: buildCompactPromptEssentials({ ...boardArgs, agent: "codex" }),
      cwd: "/Users/me/projects/my-board",
      agent: "codex" as const,
    };
    const out = withLaunchAgent(pending, "claude");
    expect(out.agent).toBe("claude");
    expect(out.cwd).toBe(pending.cwd);
    expect(out.essentials).toEqual(buildCompactPromptEssentials({ ...boardArgs, agent: "claude" }));
    expect(textOf(out.essentials)).not.toMatch(/codex/i);
    expect(textOf(out.essentials)).not.toContain("AGENTS.md");
    expect(out.essentials?.guideStep).toBeUndefined();
    expect(out.essentials?.packed).toBeUndefined();
  });

  it("rewrites a Claude launch's instructions for Codex when the picker is switched to Codex", () => {
    const pending = { essentials: buildCompactPromptEssentials({ ...boardArgs, agent: "claude" }), agent: "claude" as const };
    const out = withLaunchAgent(pending, "codex");
    expect(out.agent).toBe("codex");
    expect(out.essentials).toEqual(buildCompactPromptEssentials({ ...boardArgs, agent: "codex" }));
    expect(textOf(out.essentials)).toContain("codex mcp add vibecodes");
    expect(textOf(out.essentials)).not.toContain("claude mcp add -s local");
  });

  it("treats a launch with no agent as Claude Code", () => {
    const pending = { essentials: buildCompactPromptEssentials(boardArgs) };
    expect(withLaunchAgent(pending, "claude").essentials).toBe(pending.essentials);
    expect(textOf(withLaunchAgent(pending, "codex").essentials)).toContain("codex mcp add vibecodes");
  });

  it("keeps a card launch's task step when the agent is switched", () => {
    const pending = buildTaskBrowserLaunchPayload({ ...base, agent: "codex" });
    const out = withLaunchAgent(pending, "claude");
    expect(out.taskId).toBe("task-1");
    expect(out.essentials?.work).toContain("task_id task-1");
    expect(textOf(out.essentials)).not.toMatch(/codex/i);
  });

  it("leaves the instructions alone when the agent is unchanged", () => {
    const pending = buildTaskBrowserLaunchPayload({ ...base, agent: "codex" });
    expect(withLaunchAgent(pending, "codex")).toEqual(pending);
    expect(withLaunchAgent(pending, "codex").essentials).toBe(pending.essentials);
  });

  it("never sends the other agent's instructions when they can't be rewritten (not made by the shared builder)", () => {
    // A copy is not the object the builder handed out, so there is nothing to rebuild it from.
    const copied = { ...buildCompactPromptEssentials({ ...boardArgs, agent: "codex" }) };
    const pending = { essentials: copied, cwd: "/x", agent: "codex" as const };
    expect(withLaunchAgent(pending, "claude")).toEqual({ essentials: undefined, cwd: "/x", agent: "claude" });
    // Unchanged agent: the instructions are already right and stay.
    expect(withLaunchAgent(pending, "codex").essentials).toBe(copied);
  });

  it("carries only the agent when nothing is waiting, or the launch has no instructions (a resume)", () => {
    expect(withLaunchAgent(null, "codex")).toEqual({ agent: "codex" });
    expect(withLaunchAgent({ cwd: "/x", resumeId: "abc" }, "claude")).toEqual({ cwd: "/x", resumeId: "abc", agent: "claude" });
  });
});
