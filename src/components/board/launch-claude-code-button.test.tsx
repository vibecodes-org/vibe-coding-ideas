import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

  it("clicking the browser item calls requestBrowserLaunch and does not navigate", () => {
    const location = stubLocationAssign();

    renderMenuItem();
    fireEvent.click(screen.getByRole("menuitem", { name: /Launch in browser terminal/i }));

    expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1);
    expect(location.assign).not.toHaveBeenCalled();

    location.restore();
  });

  it("carries the task id in the browser-launch payload", () => {
    renderMenuItem({ taskId: "task-abc-789" });
    fireEvent.click(screen.getByRole("menuitem", { name: /Launch in browser terminal/i }));

    expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1);
    const payload = mockRequestBrowserLaunch.mock.calls[0][0] as {
      essentials: { head: string; tail: string };
    };
    const promptText = `${payload.essentials.head}\n${payload.essentials.tail}`;
    expect(promptText).toContain("task-abc-789");
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

  it("terminal item's onSelect is unchanged: clicking it does not call requestBrowserLaunch", () => {
    const location = stubLocationAssign();

    renderMenuItem();
    fireEvent.click(screen.getByRole("menuitem", { name: "Launch in Claude Code" }));

    expect(mockRequestBrowserLaunch).not.toHaveBeenCalled();
    expect(location.assign).toHaveBeenCalledTimes(1);

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

  it("terminal-window launch (claude-cli://) fires a link whose prompt contains the isolation note", () => {
    const location = stubLocationAssign();
    renderBoardButton({
      ideaGithubUrl: "https://github.com/acme/widgets",
      recordedProjectPaths,
    });

    fireEvent.click(screen.getByRole("button", { name: /Launch Claude Code/i }));

    expect(location.assign).toHaveBeenCalledTimes(1);
    const url = location.assign.mock.calls[0][0] as string;
    expect(decodeQ(url)).toContain("git worktree add");

    location.restore();
  });

  it("in-browser launch (vibecodes://) payload carries isolate:true but NO isolation note text (the dock fires the real --worktree flag instead)", () => {
    renderBoardButton({
      ideaGithubUrl: "https://github.com/acme/widgets",
      recordedProjectPaths,
    });

    const trigger = screen.getByRole("button", { name: "Launch options" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /In the browser/i }));

    expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1);
    const payload = mockRequestBrowserLaunch.mock.calls[0][0] as {
      essentials: { head: string; tail: string; isolate?: boolean };
    };
    expect(payload.essentials.isolate).toBe(true);
    const promptText = `${payload.essentials.head}\n${payload.essentials.tail}`;
    expect(promptText).not.toContain("git worktree add");
  });
});
