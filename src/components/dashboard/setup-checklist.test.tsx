import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// Control desktop vs mobile deterministically.
const mediaMatches = vi.fn(() => true);
vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: () => mediaMatches(),
}));

// Capture the launch hook so we can assert the primary CTA wires to it.
const launch = vi.fn();
const copyCommand = vi.fn().mockResolvedValue(undefined);
const useLaunchClaudeCode = vi.fn((..._args: unknown[]) => ({ launch, copyCommand }));
vi.mock("@/lib/use-launch-claude-code", () => ({
  useLaunchClaudeCode: (args: unknown) => useLaunchClaudeCode(args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { SetupChecklist } from "./setup-checklist";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mediaMatches.mockReturnValue(true); // desktop by default
  try {
    localStorage.clear();
  } catch {
    /* noop */
  }
});

const baseProps = {
  hasIdea: true,
  hasBoardWithTasks: true,
  hasMcpConnection: false,
  hasTaskMoved: false,
  firstIdea: { id: "idea-1", title: "My Idea", github_url: null },
};

describe("SetupChecklist — Connect step is Launch-first (Slice B)", () => {
  it("renders 'Launch Claude Code' as the primary Connect CTA on desktop", () => {
    render(<SetupChecklist {...baseProps} />);
    expect(
      screen.getByRole("button", { name: /Launch Claude Code/i })
    ).not.toBeNull();
  });

  it("builds the launch hook from the user's primary idea", () => {
    render(<SetupChecklist {...baseProps} />);
    expect(useLaunchClaudeCode).toHaveBeenCalledWith(
      expect.objectContaining({ ideaId: "idea-1", ideaTitle: "My Idea" })
    );
  });

  it("clicking Launch fires the deep link", () => {
    render(<SetupChecklist {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Launch Claude Code/i }));
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("demotes the manual `claude mcp add` command into a Manual popover", () => {
    render(<SetupChecklist {...baseProps} />);
    // Not shown until the disclosure opens.
    expect(screen.queryByText(/claude mcp add -s user/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Manual$/i }));
    expect(screen.getByText(/claude mcp add -s user/i)).not.toBeNull();
    // The kept-at-user-scope note is present.
    expect(
      screen.getByText(/connects VibeCodes for all your projects/i)
    ).not.toBeNull();
  });

  it("on mobile shows a desktop-only note instead of Launch", () => {
    mediaMatches.mockReturnValue(false); // mobile
    render(<SetupChecklist {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: /Launch Claude Code/i })
    ).toBeNull();
    expect(screen.getByText(/Desktop only/i)).not.toBeNull();
  });

  it("brand-new user (no idea): Connect + Generate-board steps are gated, so 'Create idea' shows exactly once", () => {
    render(
      <SetupChecklist
        hasIdea={false}
        hasBoardWithTasks={false}
        hasMcpConnection={false}
        hasTaskMoved={false}
        firstIdea={null}
      />
    );
    // Launch needs an idea, so no Launch button yet.
    expect(
      screen.queryByRole("button", { name: /Launch Claude Code/i })
    ).toBeNull();
    // Only the "Create an idea" step shows a CTA — the gated Generate-board and
    // Connect steps render no button, so "Create idea" appears exactly ONCE
    // (the bug was three identical "Create idea" buttons).
    expect(screen.getAllByText(/Create idea/i)).toHaveLength(1);
  });
});
