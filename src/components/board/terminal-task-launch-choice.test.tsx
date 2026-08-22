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
    displayName: null,
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
    displayName: null,
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
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("terminal-task-launch-choice")).not.toBeInTheDocument();
  });

  it("can be cancelled — Cancel and Escape both back out without launching (Nick, 2026-08-19)", () => {
    const onCancel = vi.fn();
    const onStartFresh = vi.fn();
    const onReconnect = vi.fn();
    const { rerender } = render(
      <TerminalTaskLaunchChoice
        open
        taskTitle="Fix login bug"
        match={LIVE_HERE_MATCH}
        onReconnect={onReconnect}
        onStartFresh={onStartFresh}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    // Backing out must never be mistaken for either real action.
    expect(onStartFresh).not.toHaveBeenCalled();
    expect(onReconnect).not.toHaveBeenCalled();

    rerender(
      <TerminalTaskLaunchChoice
        open
        taskTitle="Fix login bug"
        match={LIVE_HERE_MATCH}
        onReconnect={onReconnect}
        onStartFresh={onStartFresh}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("terminal-task-launch-choice"), { key: "Escape", code: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("renders the model line when supplied (task c4ca2d95)", () => {
    render(
      <TerminalTaskLaunchChoice
        open
        taskTitle="Fix login bug"
        match={LIVE_HERE_MATCH}
        onReconnect={vi.fn()}
        onStartFresh={vi.fn()}
        onCancel={vi.fn()}
        modelLine="Starts on Sonnet · your setting."
      />,
    );
    expect(screen.getByText("Starts on Sonnet · your setting.")).toBeInTheDocument();
  });

  it("omits the model line entirely when not supplied", () => {
    render(
      <TerminalTaskLaunchChoice
        open
        taskTitle="Fix login bug"
        match={LIVE_HERE_MATCH}
        onReconnect={vi.fn()}
        onStartFresh={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Starts on/)).not.toBeInTheDocument();
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
        onCancel={vi.fn()}
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
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/recent session/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  // Defence in depth only. As of card 79a0046c (2026-08-19)
  // `findTaskSessionMatch` no longer returns an unresumable ended row at all,
  // so the dock can't route one here — a task launch in that state mints
  // straight away instead of showing a dialog whose only button is the mint.
  // The guard stays because this component takes a `match` prop from anyone:
  // given one, hiding an action that cannot work still beats offering it.
  it("a recent match with no recorded cwd hides Resume, keeps Start fresh anyway", () => {
    const onReconnect = vi.fn();
    const noCwdMatch: TaskSessionMatch = {
      kind: "recent",
      row: { ...RECENT_MATCH.row, cwd: null },
    };
    render(
      <TerminalTaskLaunchChoice
        open
        taskTitle="Fix login bug"
        match={noCwdMatch}
        onReconnect={onReconnect}
        onStartFresh={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(screen.getByText(/no folder was recorded/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start fresh anyway/i })).toBeInTheDocument();
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
        onCancel={vi.fn()}
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
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /start fresh anyway/i })).toBeDisabled();
  });
});
