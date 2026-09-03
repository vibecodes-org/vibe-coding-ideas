import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  DropdownMenu,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";

// Radix DropdownMenu's Popper positioning uses ResizeObserver, which jsdom lacks
// (same stub used in task-edit-dialog.test.tsx for the Radix Checkbox case).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const mediaMatches = vi.fn(() => true);
vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: () => mediaMatches(),
}));

const mockCapture = vi.fn();
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture }),
}));

const mockIsBrowserLaunchAvailable = vi.fn(() => true);
const mockRequestBrowserLaunch = vi.fn();
vi.mock("@/lib/terminal/launch-mode", () => ({
  isBrowserLaunchAvailable: () => mockIsBrowserLaunchAvailable(),
  requestBrowserLaunch: (payload: unknown) => mockRequestBrowserLaunch(payload),
}));

vi.mock("@/lib/terminal/connection", () => ({
  isTerminalEnabled: () => true,
}));

// The launch-time re-read of the recorded folders (Nick, 3 Sep 2026 — see
// resolveFreshLaunch in the component). Resolves to null by default ("read
// failed, keep the snapshot"); individual tests override it.
const mockListRecordedProjectPaths = vi.fn(
  async (_ideaId: string): Promise<{ hostname: string; absolute_path: string }[] | null> => null
);
vi.mock("@/actions/launch-path", () => ({
  listRecordedProjectPaths: (ideaId: string) => mockListRecordedProjectPaths(ideaId),
  saveManualProjectPath: vi.fn(),
}));

import { LaunchClaudeCodeButton } from "./launch-claude-code-button";

/**
 * jsdom's `window.location.assign` isn't spy-able directly (its property
 * descriptor isn't configurable), so swap in a plain object with the real
 * Location's properties plus a spy-able `assign`, then restore the original.
 */
function stubLocationAssign() {
  const original = window.location;
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    value: Object.assign(Object.create(Object.getPrototypeOf(original) as object), original, { assign }),
    configurable: true,
    writable: true,
  });
  return {
    assign,
    restore: () => {
      Object.defineProperty(window, "location", {
        value: original,
        configurable: true,
        writable: true,
      });
    },
  };
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mediaMatches.mockReturnValue(true); // desktop
  mockIsBrowserLaunchAvailable.mockReturnValue(true);
});

/** Renders the task-menu-item variant inside a real, always-open DropdownMenu
 * (matching how task-card-menu.tsx hosts it), so the items land in the DOM via
 * Radix's portal. */
function renderMenuItem(overrides: { taskId?: string } = {}) {
  render(
    <DropdownMenu open onOpenChange={() => {}}>
      <DropdownMenuContent>
        <LaunchClaudeCodeButton
          variant="task-menu-item"
          ideaId="idea-1"
          ideaTitle="Idea One"
          ideaGithubUrl={null}
          taskId={overrides.taskId ?? "task-123"}
          taskTitle="Do the thing"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("LaunchClaudeCodeButton — task-menu-item variant (browser launch item)", () => {
  it("renders both items, terminal first, with the Beta pill on the browser item, when the flag is on (desktop)", () => {
    renderMenuItem();

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Launch in Claude Code");
    expect(items[1]).toHaveTextContent("Launch in browser terminal");
    expect(items[1]).toHaveTextContent("Beta");
  });

  it("clicking the browser item calls requestBrowserLaunch and does not navigate", async () => {
    const location = stubLocationAssign();

    renderMenuItem();
    fireEvent.click(screen.getByRole("menuitem", { name: /Launch in browser terminal/i }));

    await waitFor(() => expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1));
    expect(location.assign).not.toHaveBeenCalled();

    location.restore();
  });

  it("carries the task id in the browser-launch payload", async () => {
    renderMenuItem({ taskId: "task-abc-789" });
    fireEvent.click(screen.getByRole("menuitem", { name: /Launch in browser terminal/i }));

    await waitFor(() => expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1));
    const payload = mockRequestBrowserLaunch.mock.calls[0][0] as {
      essentials: { head: string; tail: string };
    };
    const promptText = `${payload.essentials.head}\n${payload.essentials.tail}`;
    expect(promptText).toContain("task-abc-789");
  });

  // Nick, 3 Sep 2026: the board page's recorded-folder list is a one-shot SSR
  // snapshot. A folder the agent recorded during the PREVIOUS session on this
  // page was invisible to the next launch until a reload, so that launch went
  // out as a "new project" (no cwd, mkdir prompt) — and the longer prompt
  // then cost it the task step. The click now re-reads the folders first.
  describe("launch-time re-read of the recorded folders", () => {
    it("re-reads the recorded folders on click and launches into a folder the page snapshot didn't have", async () => {
      mockListRecordedProjectPaths.mockResolvedValueOnce([
        { hostname: "Nicks-MacBook-Pro.local", absolute_path: "/Users/nickball/projects/favourites" },
      ]);
      renderMenuItem(); // no recordedProjectPaths prop at all — the stale-page shape
      fireEvent.click(screen.getByRole("menuitem", { name: /Launch in browser terminal/i }));

      await waitFor(() => expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1));
      expect(mockListRecordedProjectPaths).toHaveBeenCalledWith("idea-1");
      const payload = mockRequestBrowserLaunch.mock.calls[0][0] as {
        cwd?: string;
        essentials: { head: string; tail: string; directoryEcho?: string };
      };
      expect(payload.cwd).toBe("/Users/nickball/projects/favourites");
      // Existing-folder prompt, not the create-new one.
      expect(payload.essentials.head).not.toContain("mkdir");
      expect(payload.essentials.directoryEcho).toContain("/Users/nickball/projects/favourites");
    });

    it("falls back to the page snapshot when the re-read fails, and still launches", async () => {
      mockListRecordedProjectPaths.mockRejectedValueOnce(new Error("offline"));
      renderMenuItem();
      fireEvent.click(screen.getByRole("menuitem", { name: /Launch in browser terminal/i }));

      await waitFor(() => expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1));
      const payload = mockRequestBrowserLaunch.mock.calls[0][0] as { cwd?: string };
      expect(payload.cwd).toBeUndefined();
    });

    it("the terminal-window launch re-reads too, and carries the fresh folder as cwd", async () => {
      const location = stubLocationAssign();
      mockListRecordedProjectPaths.mockResolvedValueOnce([
        { hostname: "Nicks-MacBook-Pro.local", absolute_path: "/Users/nickball/projects/favourites" },
      ]);
      renderMenuItem();
      fireEvent.click(screen.getByRole("menuitem", { name: /^Launch in Claude Code/i }));

      await waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
      const link = location.assign.mock.calls[0][0] as string;
      expect(link).toContain(`cwd=${encodeURIComponent("/Users/nickball/projects/favourites")}`);
      location.restore();
    });
  });

  it("renders only the terminal item, with no Beta text, when the flag is off", () => {
    mockIsBrowserLaunchAvailable.mockReturnValue(false);
    renderMenuItem();

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Launch in Claude Code");
    expect(screen.queryByText("Beta")).toBeNull();
    expect(screen.queryByText(/Launch in browser terminal/i)).toBeNull();
  });

  it("terminal item's onSelect is unchanged: clicking it does not call requestBrowserLaunch", async () => {
    const location = stubLocationAssign();

    renderMenuItem();
    fireEvent.click(screen.getByRole("menuitem", { name: "Launch in Claude Code" }));

    await waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
    expect(mockRequestBrowserLaunch).not.toHaveBeenCalled();

    location.restore();
  });
});

/** Renders the "board" variant, which owns its own split-button + dropdown
 * (unlike task-menu-item, it isn't hosted inside an external DropdownMenu). */
function renderBoardButton(overrides: {
  ideaGithubUrl?: string | null;
  recordedProjectPaths?: import("@/lib/launch-claude-code").RecordedProjectPath[];
} = {}) {
  render(
    <LaunchClaudeCodeButton
      variant="board"
      ideaId="idea-1"
      ideaTitle="Idea One"
      ideaGithubUrl={overrides.ideaGithubUrl ?? null}
      recordedProjectPaths={overrides.recordedProjectPaths}
    />
  );
}

describe("LaunchClaudeCodeButton — board variant dropdown path line", () => {
  it("shows the recorded path for a repo-backed idea (fix: cwd is no longer dropped just because a repo is attached)", () => {
    renderBoardButton({
      ideaGithubUrl: "https://github.com/acme/widgets",
      recordedProjectPaths: [{ hostname: "nick-mbp", absolute_path: "/Users/nick/projects/widgets" }],
    });

    const trigger = screen.getByRole("button", { name: "Launch options" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);

    expect(screen.getByText("This machine — nick-mbp")).toBeInTheDocument();
    expect(screen.getByText("/Users/nick/projects/widgets")).toBeInTheDocument();
  });

  it("shows no path line for a repo-backed idea with no recorded path (first-launch/clone flow)", () => {
    renderBoardButton({ ideaGithubUrl: "https://github.com/acme/widgets" });

    const trigger = screen.getByRole("button", { name: "Launch options" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);

    expect(screen.queryByText(/This machine/)).toBeNull();
  });
});

// ── claude-cli:// isolation advisory wiring (board task 48eb844b) ──────────
//
// claude-cli:// (this button's terminal-window launch, via window.location.assign)
// is a third-party handler with no --worktree-flag plumbing, so the advisory
// note has to ride the prompt TEXT it fires. vibecodes:// (the "in the
// browser" item, via requestBrowserLaunch) already gets a REAL --worktree
// flag from the dock reading `essentials.isolate` — it must NOT also get the
// redundant text.
describe("LaunchClaudeCodeButton — isolation advisory only on the claude-cli:// destination", () => {
  const recordedProjectPaths = [
    { hostname: "nick-mbp", absolute_path: "/Users/nick/projects/widgets" },
  ];

  function decodeQ(url: string): string {
    const match = url.match(/[?&]q=([^&]*)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  it("terminal-window launch (claude-cli://) fires a link whose prompt contains the isolation note", async () => {
    const location = stubLocationAssign();
    renderBoardButton({
      ideaGithubUrl: "https://github.com/acme/widgets",
      recordedProjectPaths,
    });

    fireEvent.click(screen.getByRole("button", { name: /Launch Claude Code/i }));

    await waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
    const url = location.assign.mock.calls[0][0] as string;
    expect(decodeQ(url)).toContain("git worktree add");

    location.restore();
  });

  it("in-browser launch (vibecodes://) payload carries isolate:true but NO isolation note text (the dock fires the real --worktree flag instead)", async () => {
    renderBoardButton({
      ideaGithubUrl: "https://github.com/acme/widgets",
      recordedProjectPaths,
    });

    const trigger = screen.getByRole("button", { name: "Launch options" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /In the browser/i }));

    await waitFor(() => expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1));
    const payload = mockRequestBrowserLaunch.mock.calls[0][0] as {
      essentials: { head: string; tail: string; isolate?: boolean };
    };
    expect(payload.essentials.isolate).toBe(true);
    const promptText = `${payload.essentials.head}\n${payload.essentials.tail}`;
    expect(promptText).not.toContain("git worktree add");
  });
});
