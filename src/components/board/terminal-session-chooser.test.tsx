// Session entry chooser component tests (card cbe60db5, Option A) — render
// each section from a plain `ChooserSections` fixture (deriveChooserSections
// itself is covered by chooser-data.test.ts) and prove the click contract:
// Start new / Reconnect / Open board & reconnect / Resume's inline confirm.

import { afterEach, beforeEach } from "vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { TerminalSessionChooser } from "./terminal-session-chooser";
import type { ChooserSections } from "@/lib/terminal/chooser-data";
import { MINIMUM_RECOMMENDED_HELPER_VERSION } from "@/lib/terminal/helper-version";
import type { HelperStatus } from "@/lib/terminal/helper-row";
import { TERMINAL_HELPER_DOWNLOAD_URL } from "@/lib/terminal/platform";

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
      displayName: null,
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
      displayName: null,
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
      displayName: null,
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
      displayName: null,
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
      claudeSessionId: null,
      endedAt: new Date().toISOString(),
      displayName: null,
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
    expect(
      screen.getByText(/Starts a new terminal that picks up the most recent conversation in/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Starts a new terminal/)).not.toBeInTheDocument();
  });

  // Card cbe60db5 follow-up (Nick's field report, 2026-08-17): a null-cwd
  // Recent row used to render here with Resume omitted and a "Can't resume —
  // no folder recorded" note (bug 9fb9fced's fix, still true of the
  // underlying ChooserSections — see chooser-data.test.ts). Nick's explicit
  // ask this time: those rows are dead entries with nothing to click and
  // shouldn't appear in the human-visible list AT ALL — only the Resume
  // affordance was ever the problem, and now the whole row is gone from what
  // renders. The data itself is untouched (proven separately in
  // chooser-data.test.ts and entry-decision.test.ts) — this is purely about
  // what this component puts on screen.
  it("Recent row with no recorded cwd: the row itself is not rendered at all", () => {
    const onResume = vi.fn();
    const row = {
      sid: "sid-recent-no-cwd",
      ideaId: "idea-1",
      ideaTitle: "VibeCodes",
      taskId: null,
      taskTitle: null,
      cwd: null,
      machineLabel: "Nick's MacBook",
      claudeSessionId: null,
      endedAt: new Date().toISOString(),
      displayName: null,
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
    expect(screen.queryByText(/no recorded folder/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Can.t resume/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    // No cwd-having rows either → the whole section is gone, header included.
    expect(screen.queryByText("Recent — ended in the last 48h")).not.toBeInTheDocument();
  });

  it("Recent list: excludes a no-cwd row while still including one that DOES have a folder", () => {
    const noCwdRow = {
      sid: "sid-no-cwd",
      ideaId: "idea-1",
      ideaTitle: "VibeCodes",
      taskId: null,
      taskTitle: null,
      cwd: null,
      machineLabel: null,
      claudeSessionId: null,
      endedAt: new Date().toISOString(),
      displayName: null,
    };
    const withCwdRow = {
      sid: "sid-with-cwd",
      ideaId: "idea-1",
      ideaTitle: "VibeCodes",
      taskId: null,
      taskTitle: null,
      cwd: "~/projects/vibecodes",
      machineLabel: null,
      claudeSessionId: null,
      endedAt: new Date().toISOString(),
      displayName: null,
    };
    render(
      <TerminalSessionChooser
        sections={sections({ recent: [noCwdRow, withCwdRow] })}
        onReconnectHere={vi.fn()}
        onOpenBoardAndReconnect={vi.fn()}
        onResume={vi.fn()}
        onStartNew={vi.fn()}
      />,
    );
    // Section renders (at least one visible row) and shows only the
    // cwd-having one.
    expect(screen.getByText("Recent — ended in the last 48h")).toBeInTheDocument();
    expect(screen.getByText(/~\/projects\/vibecodes/)).toBeInTheDocument();
    expect(screen.queryByText(/no recorded folder/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Resume" })).toHaveLength(1);
  });

  // The section header's show/hide must key off the FILTERED count, not the
  // raw `sections.recent.length` — a Recent section made up entirely of
  // no-folder rows has nothing left to show, so the header disappears too,
  // not just the (already-empty) row list beneath it.
  it("Recent section header is hidden when every recent row is no-cwd, even though sections.recent is non-empty", () => {
    const row = {
      sid: "sid-no-cwd",
      ideaId: "idea-1",
      ideaTitle: "VibeCodes",
      taskId: null,
      taskTitle: null,
      cwd: null,
      machineLabel: null,
      claudeSessionId: null,
      endedAt: new Date().toISOString(),
      displayName: null,
    };
    render(
      <TerminalSessionChooser
        sections={sections({ recent: [row] })}
        onReconnectHere={vi.fn()}
        onOpenBoardAndReconnect={vi.fn()}
        onResume={vi.fn()}
        onStartNew={vi.fn()}
      />,
    );
    expect(screen.queryByText("Recent — ended in the last 48h")).not.toBeInTheDocument();
  });

  it("Recent row with a tracked claudeSessionId: the confirm copy promises the EXACT conversation (rework 5)", () => {
    const onResume = vi.fn();
    const row = {
      sid: "sid-recent-exact",
      ideaId: "idea-1",
      ideaTitle: "VibeCodes",
      taskId: null,
      taskTitle: null,
      cwd: "~/projects/vibecodes",
      machineLabel: null,
      claudeSessionId: "99999999-8888-7777-6666-555555555555",
      endedAt: new Date().toISOString(),
      displayName: null,
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
    expect(screen.getByText(/Continues this exact conversation in/)).toBeInTheDocument();
    expect(screen.queryByText(/most recent conversation/)).not.toBeInTheDocument();
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
      claudeSessionId: null,
      endedAt: new Date().toISOString(),
      displayName: null,
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
      displayName: null,
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
    claudeSessionId: null,
    endedAt: new Date().toISOString(),
    displayName: null,
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
      displayName: null,
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
      // Regression (Nick's binding decision — "both buttons need to stop the
      // old version first"): this used to be a bare `<a href>` straight to
      // the download, no quiesce. It's now the same clickable button as the
      // My sessions panel's, driving the shared quiesce flow — see the
      // "helper update flow" describe block below.
      expect(screen.getByRole("button", { name: "Update now" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Update now" })).not.toBeInTheDocument();
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

  describe("helper update flow — 'Update now' quiesces before downloading (Nick's binding decision)", () => {
    // QA found the session chooser's "Update now" was a bare `<a href>`
    // straight to the download — no quiesce — while the My sessions panel's
    // version safely ended live sessions, sent `quiesce`, and waited for the
    // old helper to disconnect first. These prove the chooser now drives
    // the SAME shared flow (src/lib/terminal/use-helper-update-flow.ts),
    // including the "quiesce times out but the download still proceeds"
    // edge case.
    function helperStatus(overrides: Partial<HelperStatus> = {}): HelperStatus {
      return {
        connected: true,
        version: "0.1.0", // old enough that the nudge (and its button) render
        machineLabel: null,
        alwaysOn: false,
        stoppedUnexpectedly: false,
        lastEventAt: null,
        ...overrides,
      };
    }

    let assignSpy: ReturnType<typeof vi.fn>;
    let originalLocation: Location;
    let fetchMock: ReturnType<typeof vi.fn>;
    let statusQueue: Array<{ connected: boolean }>;

    beforeEach(() => {
      vi.useFakeTimers();
      originalLocation = window.location;
      assignSpy = vi.fn();
      // jsdom's `window.location.assign` isn't spy-able directly — swap in a
      // plain object carrying the real Location's properties plus a
      // spy-able `assign` (same idiom as launch-claude-code-button.test.tsx).
      Object.defineProperty(window, "location", {
        value: Object.assign(Object.create(Object.getPrototypeOf(originalLocation) as object), originalLocation, {
          assign: assignSpy,
        }),
        configurable: true,
        writable: true,
      });
      statusQueue = [];
      fetchMock = vi.fn((url: string) => {
        if (url === "/api/terminal/helper/status") {
          const next = statusQueue.shift() ?? { connected: true };
          return Promise.resolve({ ok: true, json: async () => next } as Response);
        }
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      });
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      Object.defineProperty(window, "location", { value: originalLocation, configurable: true, writable: true });
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("no live sessions: Update now skips the confirm, quiesces straight away (no end-all call), then downloads", async () => {
      statusQueue = [{ connected: false }];
      render(
        <TerminalSessionChooser
          sections={EMPTY}
          onReconnectHere={vi.fn()}
          onOpenBoardAndReconnect={vi.fn()}
          onResume={vi.fn()}
          onStartNew={vi.fn()}
          helperStatus={helperStatus()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Update now" }));
      expect(screen.queryByText("Update the helper?")).not.toBeInTheDocument(); // no sessions -> no confirm

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/terminal/helper/command",
        expect.objectContaining({ body: JSON.stringify({ cmd: "quiesce" }) }),
      );
      expect(fetchMock).not.toHaveBeenCalledWith("/api/terminal/session/end", expect.anything());
      expect(assignSpy).toHaveBeenCalledWith(TERMINAL_HELPER_DOWNLOAD_URL);
    });

    it("live sessions: Update now confirms first, ends every session, then quiesces and downloads", async () => {
      statusQueue = [{ connected: false }];
      render(
        <TerminalSessionChooser
          sections={sections({ liveHere: [liveRow("live-1")], liveElsewhere: [liveRow("live-2")] })}
          onReconnectHere={vi.fn()}
          onOpenBoardAndReconnect={vi.fn()}
          onResume={vi.fn()}
          onStartNew={vi.fn()}
          helperStatus={helperStatus()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Update now" }));
      expect(screen.getByText("Update the helper?")).toBeInTheDocument();
      expect(screen.getByText(/Your 2 running sessions will end first/)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled(); // nothing happens until confirmed

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "End sessions & update" }));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/terminal/session/end",
        expect.objectContaining({ body: JSON.stringify({ all: true }) }),
      );
      expect(assignSpy).toHaveBeenCalledWith(TERMINAL_HELPER_DOWNLOAD_URL);
    });

    it("quiesce-timeout: the poll never settles, but the chooser still downloads regardless — identical to the My sessions panel", async () => {
      // statusQueue stays empty -> every poll reports still-connected.
      const onHelperUpdateSettled = vi.fn();
      render(
        <TerminalSessionChooser
          sections={EMPTY}
          onReconnectHere={vi.fn()}
          onOpenBoardAndReconnect={vi.fn()}
          onResume={vi.fn()}
          onStartNew={vi.fn()}
          helperStatus={helperStatus()}
          onHelperUpdateSettled={onHelperUpdateSettled}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Update now" }));
      for (let i = 0; i < 25 && assignSpy.mock.calls.length === 0; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(500);
        });
      }

      expect(assignSpy).toHaveBeenCalledWith(TERMINAL_HELPER_DOWNLOAD_URL);
      expect(screen.getByText(/The helper is taking a moment to close/)).toBeInTheDocument();
      expect(onHelperUpdateSettled).toHaveBeenCalledOnce();
    });
  });

  describe("rename (card 3bf262ac)", () => {
    it("hides the pencil on every row when no onRenameSession is supplied", () => {
      render(
        <TerminalSessionChooser
          sections={sections({ liveHere: [liveRow("live-1")], recent: [recentRow] })}
          onReconnectHere={vi.fn()}
          onOpenBoardAndReconnect={vi.fn()}
          onResume={vi.fn()}
          onStartNew={vi.fn()}
        />,
      );
      expect(screen.queryByRole("button", { name: /rename session/i })).not.toBeInTheDocument();
    });

    it("a LIVE row: renaming calls onRenameSession(sid, next) and shows the new name instantly (this component's own optimistic layer)", async () => {
      const onRenameSession = vi.fn().mockResolvedValue({ ok: true, displayName: "Auth spike" });
      render(
        <TerminalSessionChooser
          sections={sections({ liveHere: [liveRow("live-1")] })}
          onReconnectHere={vi.fn()}
          onOpenBoardAndReconnect={vi.fn()}
          onResume={vi.fn()}
          onStartNew={vi.fn()}
          onRenameSession={onRenameSession}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
      const input = screen.getByRole("textbox", { name: "Session name" });
      fireEvent.change(input, { target: { value: "Auth spike" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(screen.getByText("Auth spike")).toBeInTheDocument();
      expect(onRenameSession).toHaveBeenCalledWith("live-1", "Auth spike");
      await act(async () => {
        await Promise.resolve();
      });
    });

    // The headline case (Requirements §2's PATCH-gap fix, AC 2): renaming
    // matters MOST on an ended/Recent row — this is the exact row Nick
    // couldn't identify, and the old PATCH route would have silently
    // no-op'd this write.
    it("a RECENT (ended) row: renaming works exactly the same way as a live row", async () => {
      const onRenameSession = vi.fn().mockResolvedValue({ ok: true, displayName: "Stripe webhook spike" });
      render(
        <TerminalSessionChooser
          sections={sections({ recent: [recentRow] })}
          onReconnectHere={vi.fn()}
          onOpenBoardAndReconnect={vi.fn()}
          onResume={vi.fn()}
          onStartNew={vi.fn()}
          onRenameSession={onRenameSession}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
      const input = screen.getByRole("textbox", { name: "Session name" });
      fireEvent.change(input, { target: { value: "Stripe webhook spike" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(screen.getByText("Stripe webhook spike")).toBeInTheDocument();
      expect(onRenameSession).toHaveBeenCalledWith(recentRow.sid, "Stripe webhook spike");
      await act(async () => {
        await Promise.resolve();
      });
    });

    it("reverts the optimistic name when the persist call fails", async () => {
      const onRenameSession = vi.fn().mockResolvedValue({ ok: false });
      render(
        <TerminalSessionChooser
          sections={sections({ recent: [recentRow] })}
          onReconnectHere={vi.fn()}
          onOpenBoardAndReconnect={vi.fn()}
          onResume={vi.fn()}
          onStartNew={vi.fn()}
          onRenameSession={onRenameSession}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
      const input = screen.getByRole("textbox", { name: "Session name" });
      fireEvent.change(input, { target: { value: "Stripe webhook spike" } });
      fireEvent.keyDown(input, { key: "Enter" });
      // Optimistic apply is synchronous — visible before the (failing) persist settles.
      expect(screen.getByText("Stripe webhook spike")).toBeInTheDocument();

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.queryByText("Stripe webhook spike")).not.toBeInTheDocument();
      // Reverted to the fallback (recentRow has no displayName/taskTitle):
      // "<idea title> · <sid4>" — same shape `resolveSessionName` produces.
      expect(screen.getByText("VibeCodes · sid-")).toBeInTheDocument();
    });

    it("Resume hides on a Recent row while it is being renamed", () => {
      render(
        <TerminalSessionChooser
          sections={sections({ recent: [recentRow] })}
          onReconnectHere={vi.fn()}
          onOpenBoardAndReconnect={vi.fn()}
          onResume={vi.fn()}
          onStartNew={vi.fn()}
          onRenameSession={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
      expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    });
  });
});
