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
