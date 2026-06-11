import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const mediaMatches = vi.fn(() => true);
vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: () => mediaMatches(),
}));

const launch = vi.fn();
const copyCommand = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/use-launch-claude-code", () => ({
  useLaunchClaudeCode: () => ({ launch, copyCommand }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { McpConnectionBanner } from "./mcp-connection-banner";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mediaMatches.mockReturnValue(true); // desktop
  try {
    sessionStorage.clear();
  } catch {
    /* noop */
  }
});

describe("McpConnectionBanner — Launch-first when an idea is provided (Slice B)", () => {
  it("full variant leads with Launch Claude Code on desktop, keeps manual command as fallback", () => {
    render(
      <McpConnectionBanner
        agentCount={2}
        taskCount={5}
        ideaId="idea-1"
        ideaTitle="Idea One"
      />
    );
    expect(
      screen.getByRole("button", { name: /Launch Claude Code/i })
    ).not.toBeNull();
    // Manual command preserved at -s user scope.
    expect(screen.getByText(/claude mcp add -s user/i)).not.toBeNull();
    // The note clarifying the manual command's scope.
    expect(
      screen.getByText(/connects VibeCodes for all your projects/i)
    ).not.toBeNull();
  });

  it("clicking Launch fires the deep link", () => {
    render(
      <McpConnectionBanner
        agentCount={1}
        taskCount={1}
        ideaId="idea-1"
        ideaTitle="Idea One"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Launch Claude Code/i }));
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("compact variant leads with a Launch link when an idea is provided", () => {
    render(
      <McpConnectionBanner
        agentCount={1}
        taskCount={1}
        compact
        ideaId="idea-1"
        ideaTitle="Idea One"
      />
    );
    expect(
      screen.getByRole("button", { name: /Launch Claude Code/i })
    ).not.toBeNull();
  });

  it("falls back to copy-only (no Launch) on mobile", () => {
    mediaMatches.mockReturnValue(false);
    render(
      <McpConnectionBanner
        agentCount={1}
        taskCount={1}
        ideaId="idea-1"
        ideaTitle="Idea One"
      />
    );
    expect(
      screen.queryByRole("button", { name: /Launch Claude Code/i })
    ).toBeNull();
    expect(screen.getByText(/claude mcp add -s user/i)).not.toBeNull();
  });

  it("falls back to manual command when no idea is provided (dashboard)", () => {
    render(<McpConnectionBanner agentCount={0} taskCount={3} />);
    expect(
      screen.queryByRole("button", { name: /Launch Claude Code/i })
    ).toBeNull();
    expect(screen.getByText(/claude mcp add -s user/i)).not.toBeNull();
  });
});
