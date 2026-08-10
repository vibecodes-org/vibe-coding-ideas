// Session entry chooser component tests (card cbe60db5, Option A) — render
// each section from a plain `ChooserSections` fixture (deriveChooserSections
// itself is covered by chooser-data.test.ts) and prove the click contract:
// Start new / Reconnect / Open board & reconnect / Resume's inline confirm.

import { afterEach } from "vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TerminalSessionChooser } from "./terminal-session-chooser";
import type { ChooserSections } from "@/lib/terminal/chooser-data";
import { MINIMUM_RECOMMENDED_HELPER_VERSION } from "@/lib/terminal/helper-version";
import type { HelperStatus } from "@/lib/terminal/helper-row";

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
    expect(screen.getByText(/Starts a new terminal that picks up your last conversation in/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Starts a new terminal/)).not.toBeInTheDocument();
  });

  it("Recent row: confirming Resume calls onResume with the row, and never shows the removed machine-warning line", () => {
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
    expect(screen.queryByText(/The conversation lives on the machine that ran it/)).not.toBeInTheDocument();
    const confirmButtons = screen.getAllByRole("button", { name: "Resume" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(onResume).toHaveBeenCalledWith(row);
  });

  function liveRow(sid: string) {
    return {
      sid,
      ideaId: "idea-1",
      ideaTitle: "VibeCodes",
      taskId: null,
      taskTitle: null,
      machineLabel: null,
      cwd: "~/projects/vibecodes",
      createdAt: new Date().toISOString(),
      wasOpenInThisTab: false,
    };
  }

  const recentRow = {
    sid: "sid-recent",
    ideaId: "idea-1",
    ideaTitle: "VibeCodes",
    taskId: null,
    taskTitle: null,
    cwd: "~/projects/vibecodes",
    machineLabel: null,
    endedAt: new Date().toISOString(),
  };

  it("Recent row: hides the limit line when comfortably under the session cap", () => {
    render(
      <TerminalSessionChooser
        sections={sections({ recent: [recentRow], liveHere: [liveRow("live-1")] })}
        cap={5}
        onReconnectHere={vi.fn()}
        onOpenBoardAndReconnect={vi.fn()}
        onResume={vi.fn()}
        onStartNew={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.queryByText(/You're using/)).not.toBeInTheDocument();
  });

  it("Recent row: shows the limit line when near the session cap", () => {
    render(
      <TerminalSessionChooser
        sections={sections({
          recent: [recentRow],
          liveHere: [liveRow("live-1"), liveRow("live-2")],
          liveElsewhere: [liveRow("live-3"), liveRow("live-4")],
        })}
        cap={5}
        onReconnectHere={vi.fn()}
        onOpenBoardAndReconnect={vi.fn()}
        onResume={vi.fn()}
        onStartNew={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByText("You're using 4 of your 5 terminals.")).toBeInTheDocument();
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

  describe("helper-update nudge (card cbe60db5, rework 3)", () => {
    // The dock owns the actual `/api/terminal/helper/status` fetch and hands
    // the chooser its result as a prop (see terminal-dock.tsx) — this
    // component only renders off that prop, so these tests supply it
    // directly rather than mocking fetch.
    function helperStatus(overrides: Partial<HelperStatus> = {}): HelperStatus {
      return {
        connected: true,
        version: null,
        machineLabel: null,
        alwaysOn: false,
        stoppedUnexpectedly: false,
        lastEventAt: null,
        ...overrides,
      };
    }

    function renderChooser(status: HelperStatus | null) {
      return render(
        <TerminalSessionChooser
          sections={EMPTY}
          onReconnectHere={vi.fn()}
          onOpenBoardAndReconnect={vi.fn()}
          onResume={vi.fn()}
          onStartNew={vi.fn()}
          helperStatus={status}
        />,
      );
    }

    it("shows the nudge, above the sections, when the last-known helper is older than the minimum", () => {
      renderChooser(helperStatus({ version: "0.3.0" }));
      expect(screen.getByText(/A newer terminal helper is available/)).toBeInTheDocument();
      const link = screen.getByRole("link", { name: "Download" });
      expect(link).toHaveAttribute("href", "/download/terminal-helper");
    });

    it("hides the nudge when the last-known helper is already current", () => {
      renderChooser(helperStatus({ version: MINIMUM_RECOMMENDED_HELPER_VERSION }));
      expect(screen.queryByText(/A newer terminal helper is available/)).not.toBeInTheDocument();
    });

    it("hides the nudge when the last-known helper is newer than the minimum", () => {
      renderChooser(helperStatus({ version: "9.9.9" }));
      expect(screen.queryByText(/A newer terminal helper is available/)).not.toBeInTheDocument();
    });

    it("hides the nudge when no helper version has ever been recorded (fresh account)", () => {
      renderChooser(helperStatus({ version: null }));
      expect(screen.queryByText(/A newer terminal helper is available/)).not.toBeInTheDocument();
    });

    it("hides the nudge, silently, while the status is still loading or the fetch failed", () => {
      renderChooser(null);
      expect(screen.queryByText(/A newer terminal helper is available/)).not.toBeInTheDocument();
      // The chooser itself never errors out — its own content still renders.
      expect(screen.getByRole("button", { name: /start new session/i })).toBeInTheDocument();
    });

    it("dismissing the nudge (X) hides it", () => {
      renderChooser(helperStatus({ version: "0.1.0" }));
      expect(screen.getByText(/A newer terminal helper is available/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Dismiss helper update notice" }));
      expect(screen.queryByText(/A newer terminal helper is available/)).not.toBeInTheDocument();
    });
  });
});
