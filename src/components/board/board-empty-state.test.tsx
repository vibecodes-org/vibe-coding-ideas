import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const switchBoardTab = vi.fn();
vi.mock("@/lib/board-tab-nav", () => ({
  switchBoardTab: (...args: unknown[]) => switchBoardTab(...args),
}));

import { BoardEmptyStateContent } from "./board-empty-state";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function setup(overrides: Partial<React.ComponentProps<typeof BoardEmptyStateContent>> = {}) {
  const onApplyKit = vi.fn();
  const props: React.ComponentProps<typeof BoardEmptyStateContent> = {
    canUseAi: true,
    hasByokKey: false,
    starterCredits: 3,
    onAiGenerate: vi.fn(),
    onDismiss: vi.fn(),
    onApplyKit,
    hasAgents: false,
    hasWorkflows: false,
    hasKit: false,
    ...overrides,
  };
  render(<BoardEmptyStateContent {...props} />);
  return { onApplyKit, props };
}

const kitTile = () =>
  screen.queryByRole("button", {
    name: /Apply a Kit — set up agents, workflows, labels and triggers/i,
  });

describe("BoardEmptyStateContent — Apply a Kit tile visibility (AC-1 / AC-6)", () => {
  it("shows the kit tile when no agents, no workflows, and no kit", () => {
    setup();
    expect(kitTile()).not.toBeNull();
  });

  it("hides the kit tile when the idea already has agents", () => {
    setup({ hasAgents: true });
    expect(kitTile()).toBeNull();
  });

  it("hides the kit tile when the idea already has workflows", () => {
    setup({ hasWorkflows: true });
    expect(kitTile()).toBeNull();
  });

  it("hides the kit tile when a kit has already been applied", () => {
    setup({ hasKit: true });
    expect(kitTile()).toBeNull();
  });

  it("hides the kit tile when no onApplyKit handler is provided", () => {
    setup({ onApplyKit: undefined });
    expect(kitTile()).toBeNull();
  });

  it("calls onApplyKit when the tile is clicked", () => {
    const { onApplyKit } = setup();
    fireEvent.click(kitTile()!);
    expect(onApplyKit).toHaveBeenCalledTimes(1);
  });
});

describe("BoardEmptyStateContent — agents/workflows tiles use the tab-switch helper (AC-9)", () => {
  it("switches to the agents tab via the helper, not a dead Link", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Add AI Agents/i }));
    expect(switchBoardTab).toHaveBeenCalledWith("agents");
  });

  it("switches to the workflows tab via the helper", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Set Up Workflows/i }));
    expect(switchBoardTab).toHaveBeenCalledWith("workflows");
  });
});
