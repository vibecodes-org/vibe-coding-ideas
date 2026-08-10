// Session entry chooser component tests (card cbe60db5, Option A) — render
// each section from a plain `ChooserSections` fixture (deriveChooserSections
// itself is covered by chooser-data.test.ts) and prove the click contract:
// Start new / Reconnect / Open board & reconnect / Resume's inline confirm.

import { afterEach } from "vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TerminalSessionChooser } from "./terminal-session-chooser";
import type { ChooserSections } from "@/lib/terminal/chooser-data";

afterEach(cleanup);

const EMPTY: ChooserSections = { liveHere: [], liveElsewhere: [], recent: [] };

function sections(overrides: Partial<ChooserSections>): ChooserSections {
  return { ...EMPTY, ...overrides };
}

describe("TerminalSessionChooser", () => {
  it("renders the Start new session button and fires onStartNew", () => {
    const onStartNew = vi.fn();
    render(
      <TerminalSessionChooser
        sections={EMPTY}
        onReconnectHere={vi.fn()}
        onOpenBoardAndReconnect={vi.fn()}
        onResume={vi.fn()}
        onStartNew={onStartNew}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /start new session/i }));
    expect(onStartNew).toHaveBeenCalledOnce();
  });

  it("shows the task-scoped Start label when a pendingTask is supplied", () => {
    render(
      <TerminalSessionChooser
        sections={EMPTY}
        pendingTask={{ taskId: "t1", taskTitle: "Fix login bug" }}
        onReconnectHere={vi.fn()}
        onOpenBoardAndReconnect={vi.fn()}
        onResume={vi.fn()}
        onStartNew={vi.fn()}
      />,
    );
    expect(screen.getByText(/Start new session for this task — Fix login bug/)).toBeInTheDocument();
  });

  it("renders a 'Running now — this board' row and fires onReconnectHere", () => {
    const onReconnectHere = vi.fn();
    const row = {
      sid: "sid-here",
      ideaId: "idea-1",
      ideaTitle: "VibeCodes",
      taskId: null,
      taskTitle: null,
      machineLabel: "Nick's MacBook",
      cwd: "~/projects/vibecodes",
      createdAt: new Date().toISOString(),
      wasOpenInThisTab: false,
    };
    render(
      <TerminalSessionChooser
        sections={sections({ liveHere: [row] })}
        onReconnectHere={onReconnectHere}
        onOpenBoardAndReconnect={vi.fn()}
        onResume={vi.fn()}
        onStartNew={vi.fn()}
      />,
    );
    expect(screen.getByText("Running now — this board")).toBeInTheDocument();
    expect(screen.getByText(/If this session is open somewhere else/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onReconnectHere).toHaveBeenCalledWith(row);
  });

  it("renders a 'Running now — other boards' row and fires onOpenBoardAndReconnect", () => {
    const onOpenBoardAndReconnect = vi.fn();
    const row = {
      sid: "sid-elsewhere",
      ideaId: "idea-2",
      ideaTitle: "Helper Tools",
      taskId: null,
      taskTitle: null,
      machineLabel: null,
      cwd: "~/projects/helper",
      createdAt: new Date().toISOString(),
      wasOpenInThisTab: false,
    };
    render(
      <TerminalSessionChooser
        sections={sections({ liveElsewhere: [row] })}
        onReconnectHere={vi.fn()}
        onOpenBoardAndReconnect={onOpenBoardAndReconnect}
        onResume={vi.fn()}
        onStartNew={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open board & reconnect/ }));
    expect(onOpenBoardAndReconnect).toHaveBeenCalledWith(row);
  });

  it("badges a 'was open in this tab' row", () => {
    const row = {
      sid: "sid-here",
      ideaId: "idea-1",
      ideaTitle: "VibeCodes",
      taskId: null,
      taskTitle: null,
      machineLabel: null,
      cwd: "~/projects/vibecodes",
      createdAt: new Date().toISOString(),
      wasOpenInThisTab: true,
    };
    render(
      <TerminalSessionChooser
        sections={sections({ liveHere: [row] })}
        onReconnectHere={vi.fn()}
        onOpenBoardAndReconnect={vi.fn()}
        onResume={vi.fn()}
        onStartNew={vi.fn()}
      />,
    );
    expect(screen.getByText("was open in this tab")).toBeInTheDocument();
  });

  it("shows the task dedupe badge + Reconnect-first when a live session matches pendingTask", () => {
    const onReconnectHere = vi.fn();
    const row = {
      sid: "sid-task",
      ideaId: "idea-1",
      ideaTitle: "VibeCodes",
      taskId: "t1",
      taskTitle: "Fix login bug",
      machineLabel: null,
      cwd: "~/projects/vibecodes",
      createdAt: new Date().toISOString(),
      wasOpenInThisTab: false,
    };
    render(
      <TerminalSessionChooser
        sections={sections({ liveHere: [row] })}
        pendingTask={{ taskId: "t1", taskTitle: "Fix login bug" }}
        onReconnectHere={onReconnectHere}
        onOpenBoardAndReconnect={vi.fn()}
        onResume={vi.fn()}
        onStartNew={vi.fn()}
      />,
    );
    expect(screen.getByText("already running for this task")).toBeInTheDocument();
    // Two Reconnect buttons render (dedupe banner + the row itself) — click the first.
    const reconnectButtons = screen.getAllByRole("button", { name: "Reconnect" });
    fireEvent.click(reconnectButtons[0]);
    expect(onReconnectHere).toHaveBeenCalledWith(row);
  });

  it("Recent row: clicking Resume opens the inline confirm, not the launch itself", () => {
    const onResume = vi.fn();
    const row = {
      sid: "sid-recent",
      ideaId: "idea-1",
      ideaTitle: "VibeCodes",
      taskId: null,
      taskTitle: null,
      cwd: "~/projects/vibecodes",
      machineLabel: "Nick's MacBook",
      endedAt: new Date().toISOString(),
    };
    render(
      <TerminalSessionChooser
        sections={sections({ recent: [row] })}
        onReconnectHere={vi.fn()}
        onOpenBoardAndReconnect={vi.fn()}
        onResume={onResume}
        onStartNew={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onResume).not.toHaveBeenCalled(); // confirm first, no launch yet
    expect(screen.getByText(/This starts a/)).toBeInTheDocument();
    expect(screen.getByText(/recorded as Nick's MacBook/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/This starts a/)).not.toBeInTheDocument();
  });

  it("Recent row: confirming Resume calls onResume with the row", () => {
    const onResume = vi.fn();
    const row = {
      sid: "sid-recent",
      ideaId: "idea-1",
      ideaTitle: "VibeCodes",
      taskId: null,
      taskTitle: null,
      cwd: "~/projects/vibecodes",
      machineLabel: null,
      endedAt: new Date().toISOString(),
    };
    render(
      <TerminalSessionChooser
        sections={sections({ recent: [row] })}
        onReconnectHere={vi.fn()}
        onOpenBoardAndReconnect={vi.fn()}
        onResume={onResume}
        onStartNew={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByText(/The conversation lives on the machine that ran it/)).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole("button", { name: "Resume" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(onResume).toHaveBeenCalledWith(row);
  });

  it("disables every action while busy", () => {
    const row = {
      sid: "sid-here",
      ideaId: "idea-1",
      ideaTitle: "VibeCodes",
      taskId: null,
      taskTitle: null,
      machineLabel: null,
      cwd: "~/projects/vibecodes",
      createdAt: new Date().toISOString(),
      wasOpenInThisTab: false,
    };
    render(
      <TerminalSessionChooser
        sections={sections({ liveHere: [row] })}
        busy
        onReconnectHere={vi.fn()}
        onOpenBoardAndReconnect={vi.fn()}
        onResume={vi.fn()}
        onStartNew={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /start new session/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeDisabled();
  });
});
