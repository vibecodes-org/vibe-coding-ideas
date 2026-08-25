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
  updateTerminalAutoAccept: vi.fn(),
}));

vi.mock("@/hooks/use-viewer-model-tier-map", () => ({
  setViewerModelTierMapCache: vi.fn(),
}));

vi.mock("@/hooks/use-viewer-terminal-model", () => ({
  setViewerTerminalModelCache: vi.fn(),
}));

vi.mock("@/hooks/use-viewer-terminal-auto-accept", () => ({
  setViewerTerminalAutoAcceptCache: vi.fn(),
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
    <ModelTierSettings
      map={null}
      terminalModel={null}
      terminalAutoAccept={false}
      open
      onOpenChange={() => {}}
      {...props}
    />
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

describe("ModelTierSettings — auto-accept toggle (task d3de150c)", () => {
  beforeEach(() => {
    mockUsePlatformModelDefaults.mockReturnValue({
      defaults: { frontier: "opus", standard: "sonnet", cheap: "haiku" },
      fallback: {},
    });
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);
  });

  it("renders as a switch (role=switch), never a select or text input", () => {
    renderDialog();
    const toggle = screen.getByRole("switch", { name: "Start in auto mode" });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("defaults to off, with the fresh-launches-only help text", () => {
    renderDialog({ terminalAutoAccept: false });
    expect(screen.getByRole("switch", { name: "Start in auto mode" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByText(/Applies to fresh sessions only/)).toBeInTheDocument();
  });

  it("reflects an on preference and shows the amber consequence copy", () => {
    renderDialog({ terminalAutoAccept: true });
    expect(screen.getByRole("switch", { name: "Start in auto mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText(/without confirming each one/)).toBeInTheDocument();
  });

  it("clicking the switch stages the change and enables Save", () => {
    renderDialog({ terminalAutoAccept: false });
    const toggle = screen.getByRole("switch", { name: "Start in auto mode" });
    const saveButton = screen.getByRole("button", { name: /Save/ });
    expect(saveButton).toBeDisabled();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(saveButton).not.toBeDisabled();
  });

  it("Cancel/reopen never leaks a staged-but-unsaved toggle back in (uncontrolled trigger, real open/close cycle)", () => {
    // Uncontrolled mode renders the DialogTrigger — clicking it (and Escape
    // to close) both route through the component's own handleOpenChange,
    // which is where re-staging from the persisted prop happens (matches
    // how the Terminal starting model field's own staged state behaves).
    render(<ModelTierSettings map={null} terminalModel={null} terminalAutoAccept={false} />);

    fireEvent.click(screen.getByRole("button", { name: /Model Tiers/ }));
    const toggle = screen.getByRole("switch", { name: "Start in auto mode" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(toggle, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: /Model Tiers/ }));
    expect(screen.getByRole("switch", { name: "Start in auto mode" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});
