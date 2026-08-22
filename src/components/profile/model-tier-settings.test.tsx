import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";

// Radix primitives use ResizeObserver/scrollIntoView, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverStub;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Element.prototype as any).scrollIntoView = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Element.prototype as any).hasPointerCapture = vi.fn();

vi.mock("@/actions/profile", () => ({
  updateModelTierMap: vi.fn(),
  updateTerminalModel: vi.fn(),
}));

vi.mock("@/hooks/use-viewer-model-tier-map", () => ({
  setViewerModelTierMapCache: vi.fn(),
}));

vi.mock("@/hooks/use-viewer-terminal-model", () => ({
  setViewerTerminalModelCache: vi.fn(),
}));

const mockUsePlatformModelDefaults = vi.fn();
vi.mock("@/hooks/use-platform-model-defaults", () => ({
  usePlatformModelDefaults: () => mockUsePlatformModelDefaults(),
}));

const mockUsePlatformTerminalModelDefault = vi.fn();
vi.mock("@/hooks/use-platform-terminal-model-default", () => ({
  usePlatformTerminalModelDefault: () => mockUsePlatformTerminalModelDefault(),
}));

import { ModelTierSettings } from "./model-tier-settings";
import { MACHINE_DEFAULT_TERMINAL_MODEL } from "@/lib/terminal/model-resolution";

afterEach(cleanup);

function renderDialog(props: Partial<ComponentProps<typeof ModelTierSettings>> = {}) {
  return render(
    <ModelTierSettings map={null} terminalModel={null} open onOpenChange={() => {}} {...props} />
  );
}

describe("ModelTierSettings — workflow tiers (existing behaviour, unchanged)", () => {
  it("shows the LIVE platform default (e.g. Opus) as the frontier placeholder, not a hard-coded label", () => {
    mockUsePlatformModelDefaults.mockReturnValue({
      defaults: { frontier: "opus", standard: "sonnet", cheap: "haiku" },
      fallback: {},
    });
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);

    renderDialog();

    expect(screen.getByText("Opus (default)")).toBeInTheDocument();
  });

  it("reflects a super-admin-changed live default (e.g. frontier -> Fable) with no code change", () => {
    mockUsePlatformModelDefaults.mockReturnValue({
      defaults: { frontier: "fable", standard: "sonnet", cheap: "haiku" },
      fallback: {},
    });
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);

    renderDialog();

    expect(screen.getByText("Fable (default)")).toBeInTheDocument();
    expect(screen.queryByText("Opus (default)")).not.toBeInTheDocument();
  });

  it("shows the tier's own value, not the platform default, once the user has an override", () => {
    mockUsePlatformModelDefaults.mockReturnValue({
      defaults: { frontier: "opus", standard: "sonnet", cheap: "haiku" },
      fallback: {},
    });
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);

    renderDialog({ map: { frontier: "haiku" } });

    // The trigger renders the option label ("Haiku"), not "<default> (default)".
    expect(screen.queryByText("Opus (default)")).not.toBeInTheDocument();
  });
});

describe("ModelTierSettings — Terminal sessions group (task c4ca2d95)", () => {
  beforeEach(() => {
    mockUsePlatformModelDefaults.mockReturnValue({
      defaults: { frontier: "opus", standard: "sonnet", cheap: "haiku" },
      fallback: {},
    });
  });

  it("shows 'your machine decides' when no platform default is set (binding: no seed)", () => {
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);
    renderDialog({ terminalModel: null });

    expect(screen.getByText(/Platform default \(your machine decides\)/)).toBeInTheDocument();
  });

  it("names the live platform default value when one is set", () => {
    mockUsePlatformTerminalModelDefault.mockReturnValue("opus");
    renderDialog({ terminalModel: null });

    expect(screen.getByText(/Platform default \(Opus\)/)).toBeInTheDocument();
  });

  it("shows 'My machine's default' when the user has opted out", () => {
    mockUsePlatformTerminalModelDefault.mockReturnValue("opus");
    renderDialog({ terminalModel: MACHINE_DEFAULT_TERMINAL_MODEL });

    expect(screen.getByText("My machine's default")).toBeInTheDocument();
  });

  it("shows the user's own known-alias override", () => {
    mockUsePlatformTerminalModelDefault.mockReturnValue("opus");
    renderDialog({ terminalModel: "sonnet" });

    expect(screen.getByText("Sonnet")).toBeInTheDocument();
  });

  it("renders a custom override as a free-text input, not the Select", () => {
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);
    renderDialog({ terminalModel: "claude-opus-5-20260101" });

    expect(screen.getByDisplayValue("claude-opus-5-20260101")).toBeInTheDocument();
  });

  it("blocks Save with role=alert on a structurally invalid custom value (AC-12)", () => {
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);
    // Stored value is already a custom (non-alias) string, so the field opens
    // straight into custom-input mode; typing a space then makes it invalid.
    renderDialog({ terminalModel: "opus5" });

    const input = screen.getByDisplayValue("opus5");
    fireEvent.change(input, { target: { value: "opus 5!" } });

    expect(screen.getByRole("alert")).toHaveTextContent(/space/i);
    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it("shows a non-blocking amber advisory for a structurally valid but unknown custom value", () => {
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);
    renderDialog({ terminalModel: "claude-opus-5-20260101" });

    expect(screen.getByText(/Not a known family alias/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
