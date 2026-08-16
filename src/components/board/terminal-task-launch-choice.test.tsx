// Task-launch-skip-chooser (Nick's explicit product decision, 2026-08-16) —
// the minimal task-scoped choice's own render contract: label wording per
// match kind (live vs. recent) and the two click callbacks. The dock's
// integration (when this renders instead of the full chooser, dedupe
// keying) is covered by terminal-dock.test.tsx.

import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TerminalTaskLaunchChoice } from "./terminal-task-launch-choice";
import type { TaskSessionMatch } from "@/lib/terminal/chooser-data";

afterEach(cleanup);

const LIVE_HERE_MATCH: TaskSessionMatch = {
  kind: "live-here",
  row: {
    sid: "sid-live-here",
    ideaId: "idea-1",
    ideaTitle: "VibeCodes",
    taskId: "task-1",
    taskTitle: "Fix login bug",
    machineLabel: "Nick's MacBook",
    cwd: "~/projects/vibecodes",
    createdAt: new Date().toISOString(),
    wasOpenInThisTab: false,
  },
};

const RECENT_MATCH: TaskSessionMatch = {
  kind: "recent",
  row: {
    sid: "sid-recent",
    ideaId: "idea-1",
    ideaTitle: "VibeCodes",
    taskId: "task-1",
    taskTitle: "Fix login bug",
    cwd: "~/projects/vibecodes",
    machineLabel: null,
    claudeSessionId: null,
    endedAt: new Date().toISOString(),
  },
};

describe("TerminalTaskLaunchChoice", () => {
  it("renders nothing when closed", () => {
    render(
      <TerminalTaskLaunchChoice
        open={false}
        taskTitle="Fix login bug"
        match={LIVE_HERE_MATCH}
        onReconnect={vi.fn()}
        onStartFresh={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("terminal-task-launch-choice")).not.toBeInTheDocument();
  });

  it("labels a live match 'Reconnect' and fires onReconnect", () => {
    const onReconnect = vi.fn();
    render(
      <TerminalTaskLaunchChoice
        open
        taskTitle="Fix login bug"
        match={LIVE_HERE_MATCH}
        onReconnect={onReconnect}
        onStartFresh={vi.fn()}
      />,
    );
    expect(screen.getByText(/already has a terminal running/i)).toBeInTheDocument();
    expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it("labels a recent match 'Resume' and fires onReconnect", () => {
    const onReconnect = vi.fn();
    render(
      <TerminalTaskLaunchChoice
        open
        taskTitle="Fix login bug"
        match={RECENT_MATCH}
        onReconnect={onReconnect}
        onStartFresh={vi.fn()}
      />,
    );
    expect(screen.getByText(/recent session/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it("fires onStartFresh from the escape hatch, independent of match kind", () => {
    const onStartFresh = vi.fn();
    render(
      <TerminalTaskLaunchChoice
        open
        taskTitle="Fix login bug"
        match={LIVE_HERE_MATCH}
        onReconnect={vi.fn()}
        onStartFresh={onStartFresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start fresh anyway/i }));
    expect(onStartFresh).toHaveBeenCalledOnce();
  });

  it("disables both actions while busy", () => {
    render(
      <TerminalTaskLaunchChoice
        open
        busy
        taskTitle="Fix login bug"
        match={LIVE_HERE_MATCH}
        onReconnect={vi.fn()}
        onStartFresh={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /start fresh anyway/i })).toBeDisabled();
  });
});
