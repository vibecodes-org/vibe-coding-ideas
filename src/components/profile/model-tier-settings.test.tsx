import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
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
  updateTerminalPreferences: vi.fn(),
  updateAgentAwareModelTierMap: vi.fn(),
  updateTerminalModel: vi.fn(),
  updateTerminalCodexModel: vi.fn(),
  updateTerminalAutoAccept: vi.fn(),
}));

import { updateTerminalPreferences } from "@/actions/profile";

vi.mock("@/hooks/use-viewer-model-tier-map", () => ({
  setViewerAgentAwareModelTierMapCache: vi.fn(),
}));

vi.mock("@/hooks/use-viewer-terminal-model", () => ({
  setViewerTerminalModelCache: vi.fn(),
}));

vi.mock("@/hooks/use-viewer-terminal-auto-accept", () => ({
  setViewerTerminalAutoAcceptCache: vi.fn(),
}));

vi.mock("@/hooks/use-viewer-terminal-effort", () => ({
  setViewerTerminalEffortCache: vi.fn(),
}));

vi.mock("@/hooks/use-viewer-terminal-auto-compact", () => ({
  setViewerTerminalAutoCompactCache: vi.fn(),
}));

const mockUsePlatformAutoCompact = vi.fn((agent: string): number | null | undefined => {
  void agent;
  return null;
});
vi.mock("@/hooks/use-platform-terminal-auto-compact-default", () => ({
  usePlatformTerminalAutoCompactDefault: (agent: string) => mockUsePlatformAutoCompact(agent),
}));

const mockUsePlatformTerminalEffortDefault = vi.fn((): string | null | undefined => null);
vi.mock("@/hooks/use-platform-terminal-effort-default", () => ({
  usePlatformTerminalEffortDefault: () => mockUsePlatformTerminalEffortDefault(),
}));

vi.mock("@/hooks/use-viewer-terminal-remote-control", () => ({
  setViewerTerminalRemoteControlCache: vi.fn(),
}));

const mockUsePlatformAgentAwareModelDefaults = vi.fn();
vi.mock("@/hooks/use-platform-model-defaults", () => ({
  usePlatformAgentAwareModelDefaults: () => mockUsePlatformAgentAwareModelDefaults(),
}));

const mockUsePlatformTerminalModelDefault = vi.fn();
vi.mock("@/hooks/use-platform-terminal-model-default", () => ({
  usePlatformTerminalModelDefault: () => mockUsePlatformTerminalModelDefault(),
}));

const mockUsePlatformTerminalCodexModelDefault = vi.fn(
  (): { model: string; effort: "low" | "medium" | "high" } | null => null
);
vi.mock("@/hooks/use-platform-terminal-codex-model-default", () => ({
  usePlatformTerminalCodexModelDefault: () => mockUsePlatformTerminalCodexModelDefault(),
}));

import { ModelTierSettings } from "./model-tier-settings";
import { setViewerTerminalRemoteControlCache } from "@/hooks/use-viewer-terminal-remote-control";
import { REMOTE_CONTROL_HELP_OFF, REMOTE_CONTROL_HELP_ON } from "@/lib/terminal/remote-control-mode";
import { MACHINE_DEFAULT_TERMINAL_MODEL } from "@/lib/terminal/model-resolution";

afterEach(cleanup);

const DEFAULT_AGENT_AWARE_DEFAULTS = {
  defaults: {
    frontier: { claude: { model: "opus", effort: "high" }, codex: { model: "gpt-5.1-codex", effort: "high" } },
    standard: { claude: { model: "sonnet", effort: "medium" }, codex: { model: "gpt-5.1-codex-mini", effort: "medium" } },
    cheap: { claude: { model: "haiku", effort: "low" }, codex: { model: "gpt-5.1-codex-mini", effort: "low" } },
  },
  fallback: { claude: {}, codex: {} },
};

function renderDialog(props: Partial<ComponentProps<typeof ModelTierSettings>> = {}) {
  return render(
    <ModelTierSettings
      agentAwareMap={{}}
      terminalModel={null}
      terminalAutoAccept={false}
      open
      onOpenChange={() => {}}
      {...props}
    />
  );
}

describe("ModelTierSettings — agent-aware workflow tiers (Codex model-tier task, FR-7)", () => {
  beforeEach(() => {
    mockUsePlatformAgentAwareModelDefaults.mockReturnValue({ defaults: DEFAULT_AGENT_AWARE_DEFAULTS, isLoading: false });
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);
  });

  it("shows the LIVE platform default (e.g. Opus) as the Claude frontier placeholder, not a hard-coded label", () => {
    renderDialog();
    expect(screen.getByText("Opus (default)")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.1-codex (default)")).toBeInTheDocument();
  });

  it("reflects a super-admin-changed live default (e.g. frontier Claude -> Fable) with no code change", () => {
    mockUsePlatformAgentAwareModelDefaults.mockReturnValue({
      defaults: {
        ...DEFAULT_AGENT_AWARE_DEFAULTS,
        defaults: {
          ...DEFAULT_AGENT_AWARE_DEFAULTS.defaults,
          frontier: { ...DEFAULT_AGENT_AWARE_DEFAULTS.defaults.frontier, claude: { model: "fable", effort: "high" } },
        },
      },
      isLoading: false,
    });

    renderDialog();

    expect(screen.getByText("Fable (default)")).toBeInTheDocument();
    expect(screen.queryByText("Opus (default)")).not.toBeInTheDocument();
  });

  it("shows the tier's own override value, not the platform default, once the user has one", () => {
    renderDialog({ agentAwareMap: { frontier: { claude: { model: "haiku", effort: "high" } } } });

    // The trigger renders the option label ("Haiku"), not "<default> (default)".
    expect(screen.queryByText("Opus (default)")).not.toBeInTheDocument();
    expect(screen.getByText("Haiku")).toBeInTheDocument();
  });

  it("renders loading skeletons while the platform defaults haven't resolved yet", () => {
    mockUsePlatformAgentAwareModelDefaults.mockReturnValue({ defaults: DEFAULT_AGENT_AWARE_DEFAULTS, isLoading: true });
    renderDialog();

    // Dialog content renders in a portal, so query the whole document.
    expect(document.body.querySelector('[aria-label="Loading model tiers"]')).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it("AC-3: a model chosen with no effort blocks Save with a role=alert error naming the tier and agent", () => {
    // A Codex override with a model but no staged effort — the in-progress
    // AC-3 state (user picked a model, hasn't picked an effort yet).
    renderDialog({ agentAwareMap: { frontier: { codex: { model: "gpt-5.1-codex" } } } });

    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((el) => /Choose a reasoning effort for gpt-5.1-codex/.test(el.textContent ?? ""))).toBe(true);

    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).toBeDisabled();
    expect(screen.getByText(/Set Frontier's Codex effort to enable Save/)).toBeInTheDocument();
  });

  it("shows a fully-resolved tier's resolution line with both agents' model and effort", () => {
    renderDialog();
    expect(screen.getByText(/Frontier → Opus \(high\) on Claude · gpt-5\.1-codex \(high\) on Codex/)).toBeInTheDocument();
  });
});

describe("ModelTierSettings — Terminal sessions group (task c4ca2d95)", () => {
  beforeEach(() => {
    mockUsePlatformAgentAwareModelDefaults.mockReturnValue({ defaults: DEFAULT_AGENT_AWARE_DEFAULTS, isLoading: false });
    mockUsePlatformTerminalCodexModelDefault.mockReturnValue(null);
  });

  it("shows 'your machine decides' when no platform default is set (binding: no seed)", () => {
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);
    renderDialog({ terminalModel: null });

    expect(screen.getByText(/Platform default \(your machine decides\)/)).toBeInTheDocument();
  });

  it("shows the resolved organization Codex pair and its source", () => {
    mockUsePlatformTerminalCodexModelDefault.mockReturnValue({ model: "gpt-5.1-codex-mini", effort: "medium" });
    renderDialog();
    expect(screen.getByText(/Organization Codex terminal pair: gpt-5\.1-codex-mini \(medium\)/)).toBeInTheDocument();
  });

  it("shows the user's saved Codex pair as the resolved source", () => {
    renderDialog({ terminalCodexModel: "gpt-6-astra", terminalCodexEffort: "high" });
    expect(screen.getByText(/Your saved Codex pair: gpt-6-astra \(high\)/)).toBeInTheDocument();
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

    expect(screen.getAllByRole("alert").some((el) => /space/i.test(el.textContent ?? ""))).toBe(true);
    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it("shows a non-blocking amber advisory for a structurally valid but unknown custom value", () => {
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);
    renderDialog({ terminalModel: "claude-opus-5-20260101" });

    expect(screen.getByText(/Not a known family alias/)).toBeInTheDocument();
  });

  it("Reset to defaults clears the independent Codex pair before Save", async () => {
    vi.mocked(updateTerminalPreferences).mockClear();
    vi.mocked(updateTerminalPreferences).mockResolvedValue({
      agentAwareModelTierMap: null,
      terminalModel: null,
      terminalCodexModel: null,
      terminalCodexEffort: null,
      terminalEffort: null,
      terminalAutoCompact: null,
      terminalCodexAutoCompact: null,
      terminalAutoAccept: false,
      terminalRemoteControl: false,
    });
    renderDialog({ terminalCodexModel: "gpt-6-astra", terminalCodexEffort: "high" });

    fireEvent.click(screen.getByRole("button", { name: /Reset to defaults/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(updateTerminalPreferences).toHaveBeenCalledWith(expect.objectContaining({
      terminalCodexModel: null,
      terminalCodexEffort: null,
    })));
  });

  it("keeps the saved Codex pair when only a Claude tier changes", async () => {
    vi.mocked(updateTerminalPreferences).mockClear();
    vi.mocked(updateTerminalPreferences).mockResolvedValue({
      agentAwareModelTierMap: { frontier: { claude: { model: "sonnet", effort: "high" } } },
      terminalModel: null,
      terminalCodexModel: "gpt-6-astra",
      terminalCodexEffort: "high",
      terminalEffort: null,
      terminalAutoCompact: null,
      terminalCodexAutoCompact: null,
      terminalAutoAccept: false,
      terminalRemoteControl: false,
    });
    renderDialog({ terminalCodexModel: "gpt-6-astra", terminalCodexEffort: "high" });

    fireEvent.click(screen.getByRole("combobox", { name: "Claude model — frontier" }));
    fireEvent.click(screen.getByRole("option", { name: /Sonnet/ }));
    fireEvent.click(within(screen.getAllByRole("group", { name: "Claude reasoning effort" })[0]).getByRole("button", { name: "High" }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => expect(updateTerminalPreferences).toHaveBeenCalledWith(expect.objectContaining({
      terminalCodexModel: "gpt-6-astra",
      terminalCodexEffort: "high",
    })));
  });
});

describe("ModelTierSettings — auto-accept toggle (task d3de150c)", () => {
  beforeEach(() => {
    mockUsePlatformAgentAwareModelDefaults.mockReturnValue({ defaults: DEFAULT_AGENT_AWARE_DEFAULTS, isLoading: false });
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);
    mockUsePlatformTerminalCodexModelDefault.mockReturnValue(null);
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
    render(<ModelTierSettings agentAwareMap={{}} terminalModel={null} terminalAutoAccept={false} />);

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

describe("ModelTierSettings — Remote Control switch (task 5c8969cc)", () => {
  const LABEL = "Start with Remote Control on";
  beforeEach(() => {
    mockUsePlatformAgentAwareModelDefaults.mockReturnValue({ defaults: DEFAULT_AGENT_AWARE_DEFAULTS, isLoading: false });
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);
    mockUsePlatformTerminalCodexModelDefault.mockReturnValue(null);
    vi.mocked(updateTerminalPreferences).mockClear();
    vi.mocked(setViewerTerminalRemoteControlCache).mockClear();
  });

  it("renders role=switch 'Start with Remote Control on', off, after 'Start in auto mode', with the off help linked", () => {
    renderDialog();
    const auto = screen.getByRole("switch", { name: "Start in auto mode" });
    const rc = screen.getByRole("switch", { name: LABEL });
    expect(rc).toHaveAttribute("aria-checked", "false");
    expect(auto.compareDocumentPosition(rc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const help = document.getElementById(rc.getAttribute("aria-describedby") ?? "");
    expect(help).toHaveTextContent(REMOTE_CONTROL_HELP_OFF);
    expect(help).toHaveClass("text-muted-foreground");
  });

  it("an on preference -> aria-checked true, the on help, violet", () => {
    renderDialog({ terminalRemoteControl: true });
    const rc = screen.getByRole("switch", { name: LABEL });
    expect(rc).toHaveAttribute("aria-checked", "true");
    const help = document.getElementById("terminal-remote-control-help");
    expect(help).toHaveTextContent(REMOTE_CONTROL_HELP_ON);
    expect(help).toHaveClass("text-violet-600", "dark:text-violet-400");
  });

  it("clicking stages and enables Save; nothing is saved until Save", () => {
    renderDialog();
    const rc = screen.getByRole("switch", { name: LABEL });
    const save = screen.getByRole("button", { name: /^Save$/i });
    expect(save).toBeDisabled();
    fireEvent.click(rc);
    expect(rc).toHaveAttribute("aria-checked", "true");
    expect(save).not.toBeDisabled();
    expect(updateTerminalPreferences).not.toHaveBeenCalled();
  });

  it("Save sends terminalRemoteControl true and refreshes the cache", async () => {
    vi.mocked(updateTerminalPreferences).mockResolvedValue({
      agentAwareModelTierMap: null,
      terminalModel: null,
      terminalCodexModel: null,
      terminalCodexEffort: null,
      terminalEffort: null,
      terminalAutoCompact: null,
      terminalCodexAutoCompact: null,
      terminalAutoAccept: false,
      terminalRemoteControl: true,
    });
    renderDialog();
    fireEvent.click(screen.getByRole("switch", { name: LABEL }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() =>
      expect(updateTerminalPreferences).toHaveBeenCalledWith(expect.objectContaining({ terminalRemoteControl: true })),
    );
    await waitFor(() => expect(setViewerTerminalRemoteControlCache).toHaveBeenCalledWith(true));
  });

  it("Reset to defaults is enabled when only Remote Control is on, and turns it off", () => {
    renderDialog({ terminalRemoteControl: true });
    const reset = screen.getByRole("button", { name: /Reset to defaults/i });
    expect(reset).not.toBeDisabled();
    fireEvent.click(reset);
    expect(screen.getByRole("switch", { name: LABEL })).toHaveAttribute("aria-checked", "false");
  });

  it("Cancel/reopen discards the staged switch", () => {
    render(<ModelTierSettings agentAwareMap={{}} terminalModel={null} terminalAutoAccept={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Model Tiers/ }));
    const rc = screen.getByRole("switch", { name: LABEL });
    fireEvent.click(rc);
    expect(rc).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(rc, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /Model Tiers/ }));
    expect(screen.getByRole("switch", { name: LABEL })).toHaveAttribute("aria-checked", "false");
  });
});


describe("ModelTierSettings — Claude starting effort (task 18a37612)", () => {
  beforeEach(() => {
    mockUsePlatformAgentAwareModelDefaults.mockReturnValue({ defaults: DEFAULT_AGENT_AWARE_DEFAULTS, isLoading: false });
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);
    mockUsePlatformTerminalEffortDefault.mockReturnValue(null);
    vi.mocked(updateTerminalPreferences).mockClear();
  });

  const savedResult = {
    agentAwareModelTierMap: null,
    terminalModel: null,
    terminalCodexModel: null,
    terminalCodexEffort: null,
    terminalEffort: null,
    terminalAutoCompact: null,
    terminalCodexAutoCompact: null,
    terminalAutoAccept: false,
    terminalRemoteControl: false,
  };

  function effortGroup() {
    return screen.getByRole("group", { name: "Claude starting effort" });
  }

  it("renders the row with Default + six-level strip, Default pressed", () => {
    renderDialog();
    expect(screen.getByText("Starting effort")).toBeInTheDocument();
    const names = within(effortGroup()).getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["Default" + "Claude's own", "Low", "Medium", "High", "X-High", "Max"]);
    expect(within(effortGroup()).getByRole("button", { name: /^Default/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("Default says its fallback: site level when set, Claude's own when not, nothing while loading", () => {
    mockUsePlatformTerminalEffortDefault.mockReturnValue("high");
    const { unmount } = renderDialog();
    expect(within(effortGroup()).getByText("site: High")).toBeInTheDocument();
    expect(screen.getByText(/Uses the site default: new and resumed Claude Code sessions start at High/)).toBeInTheDocument();
    unmount();

    mockUsePlatformTerminalEffortDefault.mockReturnValue(null);
    const second = renderDialog();
    expect(within(effortGroup()).getByText("Claude's own")).toBeInTheDocument();
    expect(screen.getByText(/Claude Code decides: the level you last saved with \/effort/)).toBeInTheDocument();
    second.unmount();

    mockUsePlatformTerminalEffortDefault.mockReturnValue(undefined);
    renderDialog();
    expect(within(effortGroup()).queryByText("Claude's own")).not.toBeInTheDocument();
    expect(within(effortGroup()).queryByText(/site:/)).not.toBeInTheDocument();
  });

  it("picking X-High then Save sends terminalEffort: 'xhigh'", async () => {
    vi.mocked(updateTerminalPreferences).mockResolvedValue({ ...savedResult, terminalEffort: "xhigh" });
    renderDialog();
    fireEvent.click(within(effortGroup()).getByRole("button", { name: "X-High" }));
    expect(screen.getByText(/start at X-High \(your setting\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() =>
      expect(updateTerminalPreferences).toHaveBeenCalledWith(expect.objectContaining({ terminalEffort: "xhigh" }))
    );
  });

  it("picking Default after a level sends null", async () => {
    vi.mocked(updateTerminalPreferences).mockResolvedValue({ ...savedResult, terminalEffort: null });
    renderDialog({ terminalEffort: "high" });
    expect(within(effortGroup()).getByRole("button", { name: "High" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(effortGroup()).getByRole("button", { name: /^Default/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() =>
      expect(updateTerminalPreferences).toHaveBeenCalledWith(expect.objectContaining({ terminalEffort: null }))
    );
  });

  it("Reset to defaults clears a saved effort before Save", async () => {
    vi.mocked(updateTerminalPreferences).mockResolvedValue({ ...savedResult, terminalEffort: null });
    renderDialog({ terminalEffort: "max" });
    fireEvent.click(screen.getByRole("button", { name: /Reset to defaults/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() =>
      expect(updateTerminalPreferences).toHaveBeenCalledWith(expect.objectContaining({ terminalEffort: null }))
    );
  });
});


describe("ModelTierSettings — memory limits (task 5e654dd1)", () => {
  beforeEach(() => {
    mockUsePlatformAgentAwareModelDefaults.mockReturnValue({ defaults: DEFAULT_AGENT_AWARE_DEFAULTS, isLoading: false });
    mockUsePlatformTerminalModelDefault.mockReturnValue(null);
    mockUsePlatformTerminalCodexModelDefault.mockReturnValue(null);
    mockUsePlatformTerminalEffortDefault.mockReturnValue(null);
    mockUsePlatformAutoCompact.mockReset();
    mockUsePlatformAutoCompact.mockImplementation((agent: string) => (agent === "claude" ? 300_000 : null));
    vi.mocked(updateTerminalPreferences).mockClear();
  });

  const savedResult = {
    agentAwareModelTierMap: null,
    terminalModel: null,
    terminalCodexModel: null,
    terminalCodexEffort: null,
    terminalEffort: null,
    terminalAutoCompact: null,
    terminalCodexAutoCompact: null,
    terminalAutoAccept: false,
    terminalRemoteControl: false,
  };

  const claudeGroup = () => screen.getByRole("group", { name: "Claude memory limit" });
  const codexGroup = () => screen.getByRole("group", { name: "Codex memory limit" });

  it("renders both rows with the approved steps and a leading Default button", () => {
    renderDialog();
    expect(screen.getByText("Claude memory limit")).toBeInTheDocument();
    expect(screen.getByText("Codex memory limit")).toBeInTheDocument();
    const claude = within(claudeGroup()).getAllByRole("button").map((b) => b.textContent);
    expect(claude).toEqual(["Defaultsite: 300k", "200k", "300k", "400k", "500k", "1M"]);
    const codex = within(codexGroup()).getAllByRole("button").map((b) => b.textContent);
    expect(codex).toEqual(["DefaultCodex's own", "100k", "150k", "200k"]);
    expect(within(claudeGroup()).getByRole("button", { name: /^Default/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(codexGroup()).getByRole("button", { name: /^Default/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("sits under its agent's existing rows", () => {
    renderDialog();
    const order = (el: HTMLElement) => el;
    const effort = order(screen.getByRole("group", { name: "Claude starting effort" }));
    const limit = order(claudeGroup());
    const codexModel = screen.getByRole("combobox", { name: /Codex starting model/ });
    const codexLimit = codexGroup();
    expect(effort.compareDocumentPosition(limit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(limit.compareDocumentPosition(codexModel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(codexModel.compareDocumentPosition(codexLimit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the Default help lines, and the user's own wording after a pick", () => {
    renderDialog();
    expect(screen.getByText(/Uses the site default: new and resumed Claude Code sessions tidy up their memory when it reaches 300,000 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/Codex decides: about 245,000 tokens/)).toBeInTheDocument();
    fireEvent.click(within(claudeGroup()).getByRole("button", { name: "400k" }));
    expect(screen.getByText(/reaches 400,000 tokens \(your setting\)\. Board agents tidy up at 400,000 tokens/)).toBeInTheDocument();
    fireEvent.click(within(codexGroup()).getByRole("button", { name: "200k" }));
    expect(screen.getByText(/reaches 200,000 tokens \(your setting\)\. Takes effect from your next launch or resume/)).toBeInTheDocument();
  });

  it("picking both then Save writes both in the same call and refreshes the cache", async () => {
    vi.mocked(updateTerminalPreferences).mockResolvedValue({ ...savedResult, terminalAutoCompact: 400_000, terminalCodexAutoCompact: 150_000 });
    renderDialog();
    fireEvent.click(within(claudeGroup()).getByRole("button", { name: "400k" }));
    fireEvent.click(within(codexGroup()).getByRole("button", { name: "150k" }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() =>
      expect(updateTerminalPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ terminalAutoCompact: 400_000, terminalCodexAutoCompact: 150_000 })
      )
    );
    expect(updateTerminalPreferences).toHaveBeenCalledTimes(1);
  });

  it("Save stays disabled until a memory limit changes, then Default sends null", async () => {
    vi.mocked(updateTerminalPreferences).mockResolvedValue({ ...savedResult });
    renderDialog({ terminalAutoCompact: 500_000 });
    expect(screen.getByRole("button", { name: /^Save$/i })).toBeDisabled();
    expect(within(claudeGroup()).getByRole("button", { name: "500k" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(claudeGroup()).getByRole("button", { name: /^Default/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() =>
      expect(updateTerminalPreferences).toHaveBeenCalledWith(expect.objectContaining({ terminalAutoCompact: null }))
    );
  });

  it("Reset to defaults clears both saved limits before Save", async () => {
    vi.mocked(updateTerminalPreferences).mockResolvedValue({ ...savedResult });
    renderDialog({ terminalAutoCompact: 200_000, terminalCodexAutoCompact: 100_000 });
    fireEvent.click(screen.getByRole("button", { name: /Reset to defaults/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() =>
      expect(updateTerminalPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ terminalAutoCompact: null, terminalCodexAutoCompact: null })
      )
    );
  });

  it("Cancel/reopen discards a staged pick", () => {
    render(<ModelTierSettings agentAwareMap={{}} terminalModel={null} terminalAutoAccept={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Model Tiers/ }));
    fireEvent.click(within(claudeGroup()).getByRole("button", { name: "200k" }));
    expect(within(claudeGroup()).getByRole("button", { name: "200k" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(claudeGroup(), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /Model Tiers/ }));
    expect(within(claudeGroup()).getByRole("button", { name: "200k" })).toHaveAttribute("aria-pressed", "false");
  });

  it("hides the site sub-label while the site default is still loading", () => {
    mockUsePlatformAutoCompact.mockImplementation(() => undefined);
    renderDialog();
    expect(within(claudeGroup()).queryByText(/site:/)).not.toBeInTheDocument();
    expect(within(claudeGroup()).queryByText("Claude's own")).not.toBeInTheDocument();
  });
});
