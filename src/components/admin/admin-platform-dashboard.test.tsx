import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

// Radix primitives (Select/Checkbox) use APIs jsdom lacks.
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Element.prototype as any).setPointerCapture = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Element.prototype as any).releasePointerCapture = vi.fn();

const mockGetForAdmin = vi.fn();
const mockUpdate = vi.fn();
const mockGetTerminalForAdmin = vi.fn();
const mockUpdateTerminal = vi.fn();
const mockGetEffortForAdmin = vi.fn();
const mockUpdateEffort = vi.fn();
const mockGetAutoCompactForAdmin = vi.fn();
const mockUpdateAutoCompact = vi.fn();
const mockSetAutoCompactCache = vi.fn();
const mockGetCodexTerminalForAdmin = vi.fn();
const mockUpdateCodexTerminal = vi.fn();

vi.mock("@/actions/admin-platform", () => ({
  getAgentAwarePlatformModelDefaultsForAdmin: () => mockGetForAdmin(),
  updateAgentAwarePlatformModelDefaults: (input: unknown) => mockUpdate(input),
  getPlatformTerminalModelDefaultForAdmin: () => mockGetTerminalForAdmin(),
  updatePlatformTerminalModelDefault: (model: string | null) => mockUpdateTerminal(model),
  getPlatformTerminalEffortDefaultForAdmin: () => mockGetEffortForAdmin(),
  updatePlatformTerminalEffortDefault: (effort: string | null) => mockUpdateEffort(effort),
  getPlatformTerminalAutoCompactDefaultForAdmin: (agent: string) => mockGetAutoCompactForAdmin(agent),
  updatePlatformTerminalAutoCompactDefault: (agent: string, w: number | null) => mockUpdateAutoCompact(agent, w),
  getPlatformTerminalCodexModelDefaultForAdmin: () => mockGetCodexTerminalForAdmin(),
  updatePlatformTerminalCodexModelDefault: (pair: unknown) => mockUpdateCodexTerminal(pair),
}));

vi.mock("@/hooks/use-platform-model-defaults", () => ({
  setPlatformAgentAwareModelDefaultsCache: vi.fn(),
}));

vi.mock("@/hooks/use-platform-terminal-model-default", () => ({
  setPlatformTerminalModelDefaultCache: vi.fn(),
}));
const mockSetEffortCache = vi.fn();
vi.mock("@/hooks/use-platform-terminal-effort-default", () => ({
  setPlatformTerminalEffortDefaultCache: (v: string | null) => mockSetEffortCache(v),
}));
vi.mock("@/hooks/use-platform-terminal-auto-compact-default", () => ({
  setPlatformTerminalAutoCompactDefaultCache: (a: string, v: number | null) => mockSetAutoCompactCache(a, v),
}));
vi.mock("@/hooks/use-platform-terminal-codex-model-default", () => ({
  setPlatformTerminalCodexModelDefaultCache: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AdminPlatformDashboard, AdminClaudeTerminalCard, AdminCodexTerminalCard } from "./admin-platform-dashboard";
import { SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS } from "@/lib/platform-model-defaults";
import { toast } from "sonner";

afterEach(cleanup);

const SEEDED_AUDIT = {
  value: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS,
  updatedBy: { id: "u1", full_name: "Nick Ball" },
  updatedAt: "2026-07-20T00:00:00Z",
  isSeed: false,
};

describe("AdminPlatformDashboard (agent-aware, Codex model-tier task FR-7)", () => {
  it("renders the denied state for a non-super-admin and never fetches", () => {
    render(<AdminPlatformDashboard isSuperAdmin={false} />);

    expect(screen.getByText("Super-admin access required")).toBeInTheDocument();
    expect(mockGetForAdmin).not.toHaveBeenCalled();
  });

  it("shows a loading skeleton, then the fetched frontier default (both agents) and audit line", async () => {
    mockGetForAdmin.mockResolvedValue(SEEDED_AUDIT);

    render(<AdminPlatformDashboard isSuperAdmin />);

    await waitFor(() => expect(screen.getByText(/Last changed by/)).toBeInTheDocument());
    expect(screen.getByText("Nick Ball")).toBeInTheDocument();
    expect(screen.getByText(/Save enables when you change a value/)).toBeInTheDocument();
    // The resolution line names both agents' seeded model.
    expect(
      screen.getByText(/Frontier → Opus \(medium\) on Claude · gpt-6-astra \(high\) on Codex/)
    ).toBeInTheDocument();
  });

  it("shows the 'using code defaults' note and disables Cancel when nothing has been saved yet", async () => {
    mockGetForAdmin.mockResolvedValue({
      value: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS,
      updatedBy: null,
      updatedAt: null,
      isSeed: true,
    });

    render(<AdminPlatformDashboard isSuperAdmin />);

    await waitFor(() => expect(screen.getByText(/Using code defaults/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("shows an error state with a Retry button when the fetch fails", async () => {
    mockGetForAdmin.mockRejectedValueOnce(new Error("boom"));

    render(<AdminPlatformDashboard isSuperAdmin />);

    await waitFor(() => expect(screen.getByText(/Failed to load platform model defaults/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("'Reset to seed (both agents)' stages the seed values locally (dirty, Save enabled) without saving", async () => {
    const live = {
      value: {
        ...SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS,
        defaults: {
          ...SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults,
          frontier: {
            ...SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.frontier,
            claude: { model: "fable", effort: "high" },
          },
        },
      },
      updatedBy: { id: "u1", full_name: "Nick Ball" },
      updatedAt: "2026-07-20T00:00:00Z",
      isSeed: false,
    };
    mockGetForAdmin.mockResolvedValue(live);

    render(<AdminPlatformDashboard isSuperAdmin />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Reset to seed (both agents)" }));

    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("gates Save behind the novel-value confirm checkbox, then saves once confirmed", async () => {
    // Load with a novel Codex default already in place (cheap: "gpt-5.1-nano-preview")
    // so the field renders as a free-text Input with no Select interaction needed.
    mockGetForAdmin.mockResolvedValue({
      value: {
        ...SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS,
        defaults: {
          ...SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults,
          cheap: {
            ...SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.cheap,
            codex: { model: "gpt-5.1-nano-preview", effort: "low" },
          },
        },
      },
      updatedBy: null,
      updatedAt: null,
      isSeed: false,
    });

    render(<AdminPlatformDashboard isSuperAdmin />);

    const input = await screen.findByDisplayValue("gpt-5.1-nano-preview");

    // Change to a different novel value -> dirty AND still novel.
    fireEvent.change(input, { target: { value: "gpt-5.1-nano-preview-2" } });

    expect(screen.getByText(/isn't a known model/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/Confirm the checkbox above to enable Save/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();

    const saved = {
      ...SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS,
      defaults: {
        ...SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults,
        cheap: {
          ...SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.cheap,
          codex: { model: "gpt-5.1-nano-preview-2", effort: "low" },
        },
      },
    };
    mockUpdate.mockResolvedValue(saved);
    mockGetForAdmin.mockResolvedValue({
      value: saved,
      updatedBy: { id: "u1", full_name: "Nick Ball" },
      updatedAt: "2026-07-25T00:00:00Z",
      isSeed: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          defaults: expect.objectContaining({
            cheap: expect.objectContaining({ codex: { model: "gpt-5.1-nano-preview-2", effort: "low" } }),
          }),
        })
      )
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("shows a retryable error toast and keeps staged values when the save action throws", async () => {
    mockGetForAdmin.mockResolvedValue({
      value: {
        ...SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS,
        defaults: {
          ...SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults,
          frontier: {
            ...SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.frontier,
            claude: { model: "fable", effort: "high" },
          },
        },
      },
      updatedBy: null,
      updatedAt: null,
      isSeed: false,
    });

    render(<AdminPlatformDashboard isSuperAdmin />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset to seed (both agents)" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Reset to seed (both agents)" }));
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();

    mockUpdate.mockRejectedValueOnce(new Error("Super admin access required"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Super admin access required"));
    // Staged (seed) values are retained — Save is still enabled for a retry.
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });
});

const NICK = { id: "u1", full_name: "Nick Ball" };
const audit = <T,>(value: T, updatedAt: string | null = "2026-07-20T00:00:00Z") => ({
  value,
  updatedBy: value === null ? null : NICK,
  updatedAt: value === null ? null : updatedAt,
});

function resetTerminalMocks() {
  for (const m of [
    mockGetTerminalForAdmin,
    mockUpdateTerminal,
    mockGetEffortForAdmin,
    mockUpdateEffort,
    mockGetAutoCompactForAdmin,
    mockUpdateAutoCompact,
    mockSetAutoCompactCache,
    mockSetEffortCache,
    mockGetCodexTerminalForAdmin,
    mockUpdateCodexTerminal,
  ]) {
    m.mockReset();
  }
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
}

describe("AdminClaudeTerminalCard (task fae2ce4f)", () => {
  const effortStrip = () => screen.getByRole("group", { name: "Claude starting effort, site default" });
  const memoryStrip = () => screen.getByRole("group", { name: "Claude memory limit, site default" });

  beforeEach(() => {
    resetTerminalMocks();
    mockGetTerminalForAdmin.mockResolvedValue(audit("opus"));
    mockGetEffortForAdmin.mockResolvedValue(audit("medium"));
    mockGetAutoCompactForAdmin.mockResolvedValue(audit(300_000));
  });

  it("renders the denied state for a non-super-admin and never fetches", () => {
    render(<AdminClaudeTerminalCard isSuperAdmin={false} />);
    expect(screen.getByText("Super-admin access required")).toBeInTheDocument();
    expect(mockGetTerminalForAdmin).not.toHaveBeenCalled();
    expect(mockGetEffortForAdmin).not.toHaveBeenCalled();
  });

  it("shows one card with the three rows, each with its own audit line, and no Clear button", async () => {
    render(<AdminClaudeTerminalCard isSuperAdmin />);
    await screen.findByText("Claude Code terminal sessions");
    expect(screen.getByText("Starting model")).toBeInTheDocument();
    expect(screen.getByText("Starting effort")).toBeInTheDocument();
    expect(screen.getByText("Memory limit")).toBeInTheDocument();
    expect(screen.getAllByText(/Last changed by/)).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    expect(within(effortStrip()).getByRole("button", { name: "Medium" })).toHaveAttribute("aria-pressed", "true");
    expect(within(memoryStrip()).getByRole("button", { name: "300k" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/Save enables when you change a value/)).toBeInTheDocument();
  });

  it("every control leads with 'Not set' and says so in the row's audit line when nothing is saved", async () => {
    mockGetTerminalForAdmin.mockResolvedValue(audit(null));
    mockGetEffortForAdmin.mockResolvedValue(audit(null));
    mockGetAutoCompactForAdmin.mockResolvedValue(audit(null));
    render(<AdminClaudeTerminalCard isSuperAdmin />);
    await screen.findByText("Claude Code terminal sessions");
    expect(screen.getByText(/Not set — each user's machine decides/)).toBeInTheDocument();
    expect(within(effortStrip()).getByRole("button", { name: /Not set/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(memoryStrip()).getByRole("button", { name: /Not set/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Not set: each user's machine decides which model to start on/)).toBeInTheDocument();
    expect(screen.getByText(/Not set: Claude Code decides \(today's behaviour\)/)).toBeInTheDocument();
    expect(screen.getByText(/Not set: Claude Code decides \(about 967,000 tokens\)/)).toBeInTheDocument();
  });

  it("shows one error box with Retry when any read fails", async () => {
    mockGetEffortForAdmin.mockRejectedValueOnce(new Error("boom"));
    render(<AdminClaudeTerminalCard isSuperAdmin />);
    await screen.findByText("Failed to load the Claude Code terminal settings.");
    mockGetEffortForAdmin.mockResolvedValue(audit("medium"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Claude Code terminal sessions");
  });

  it("changing only the effort writes only the effort key", async () => {
    render(<AdminClaudeTerminalCard isSuperAdmin />);
    await screen.findByText("Claude Code terminal sessions");
    fireEvent.click(within(effortStrip()).getByRole("button", { name: "High" }));
    mockUpdateEffort.mockResolvedValue("high");
    mockGetEffortForAdmin.mockResolvedValue(audit("high", "2026-10-27T00:00:00Z"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdateEffort).toHaveBeenCalledWith("high"));
    expect(mockUpdateTerminal).not.toHaveBeenCalled();
    expect(mockUpdateAutoCompact).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Claude Code site defaults saved · effort High")
    );
    expect(mockSetEffortCache).toHaveBeenCalledWith("high");
  });

  it("'Not set' on a strip clears that one key, and the toast says what changed", async () => {
    render(<AdminClaudeTerminalCard isSuperAdmin />);
    await screen.findByText("Claude Code terminal sessions");
    fireEvent.click(within(memoryStrip()).getByRole("button", { name: /Not set/ }));
    fireEvent.click(within(effortStrip()).getByRole("button", { name: "Max" }));
    mockUpdateAutoCompact.mockResolvedValue(null);
    mockGetAutoCompactForAdmin.mockResolvedValue(audit(null));
    mockUpdateEffort.mockResolvedValue("max");
    mockGetEffortForAdmin.mockResolvedValue(audit("max"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdateAutoCompact).toHaveBeenCalledWith("claude", null));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Claude Code site defaults saved · effort Max, memory limit not set")
    );
    expect(mockUpdateTerminal).not.toHaveBeenCalled();
    expect(mockSetAutoCompactCache).toHaveBeenCalledWith("claude", null);
  });

  it("Cancel restores every row of the card", async () => {
    render(<AdminClaudeTerminalCard isSuperAdmin />);
    await screen.findByText("Claude Code terminal sessions");
    fireEvent.click(within(effortStrip()).getByRole("button", { name: "Low" }));
    fireEvent.click(within(memoryStrip()).getByRole("button", { name: "500k" }));
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(within(effortStrip()).getByRole("button", { name: "Medium" })).toHaveAttribute("aria-pressed", "true");
    expect(within(memoryStrip()).getByRole("button", { name: "300k" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a failing row keeps its staged value, the other row is saved, and one toast names the failure", async () => {
    render(<AdminClaudeTerminalCard isSuperAdmin />);
    await screen.findByText("Claude Code terminal sessions");
    fireEvent.click(within(effortStrip()).getByRole("button", { name: "High" }));
    fireEvent.click(within(memoryStrip()).getByRole("button", { name: "400k" }));
    mockUpdateEffort.mockRejectedValue(new Error("Failed to save the terminal starting effort — try again"));
    mockUpdateAutoCompact.mockResolvedValue(400_000);
    mockGetAutoCompactForAdmin.mockResolvedValue(audit(400_000));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't save the starting effort — Failed to save the terminal starting effort — try again"
      )
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(within(effortStrip()).getByRole("button", { name: "High" })).toHaveAttribute("aria-pressed", "true");
    // The memory row saved: it is now the persisted value, so only effort is still dirty.
    expect(within(memoryStrip()).getByRole("button", { name: "400k" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    mockUpdateEffort.mockClear();
    mockUpdateAutoCompact.mockClear();
    mockUpdateEffort.mockResolvedValue("high");
    mockGetEffortForAdmin.mockResolvedValue(audit("high"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdateEffort).toHaveBeenCalledWith("high"));
    expect(mockUpdateAutoCompact).not.toHaveBeenCalled();
  });

  it("blocks Save on a structurally invalid custom model name, with the hint and an alert", async () => {
    mockGetTerminalForAdmin.mockResolvedValue(audit("opus-5.5"));
    render(<AdminClaudeTerminalCard isSuperAdmin />);
    const input = await screen.findByLabelText("Starting model");
    expect(input).toHaveValue("opus-5.5");
    fireEvent.change(input, { target: { value: "opus 5!" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/space/i);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/Fix the model name to enable Save/)).toBeInTheDocument();
  });

  it("gates Save behind the novel-model tick box, then saves the model only", async () => {
    mockGetTerminalForAdmin.mockResolvedValue(audit("opus-5.5"));
    render(<AdminClaudeTerminalCard isSuperAdmin />);
    const input = await screen.findByLabelText("Starting model");
    fireEvent.change(input, { target: { value: "opus-5.6" } });
    expect(screen.getByText(/isn't a known model alias/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/Confirm the checkbox above to enable Save/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    mockUpdateTerminal.mockResolvedValue("opus-5.6");
    mockGetTerminalForAdmin.mockResolvedValue(audit("opus-5.6", "2026-07-25T00:00:00Z"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdateTerminal).toHaveBeenCalledWith("opus-5.6"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("model Opus-5.6")));
    expect(mockUpdateEffort).not.toHaveBeenCalled();
  });
});

describe("AdminCodexTerminalCard (task fae2ce4f)", () => {
  const effortStrip = () => screen.getByRole("group", { name: "Codex starting effort, site default" });
  const memoryStrip = () => screen.getByRole("group", { name: "Codex memory limit, site default" });

  beforeEach(() => {
    resetTerminalMocks();
    mockGetCodexTerminalForAdmin.mockResolvedValue(audit({ model: "gpt-5.6-sol", effort: "medium" }));
    mockGetAutoCompactForAdmin.mockResolvedValue(audit(null));
  });

  it("renders the denied state for a non-super-admin and never fetches", () => {
    render(<AdminCodexTerminalCard isSuperAdmin={false} />);
    expect(screen.getByText("Super-admin access required")).toBeInTheDocument();
    expect(mockGetCodexTerminalForAdmin).not.toHaveBeenCalled();
  });

  it("shows the three rows, the pair note, and no Clear button", async () => {
    render(<AdminCodexTerminalCard isSuperAdmin />);
    await screen.findByText("Codex terminal sessions");
    expect(screen.getByText("Starting model")).toBeInTheDocument();
    expect(screen.getByText("Starting effort")).toBeInTheDocument();
    expect(screen.getByText("Memory limit")).toBeInTheDocument();
    expect(screen.getByText("Saved together with the model.")).toBeInTheDocument();
    expect(screen.getByText(/Not set: Codex decides \(about 245,000 tokens/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    expect(within(effortStrip()).getByRole("button", { name: "Medium" })).toHaveAttribute("aria-pressed", "true");
    // With a model set, the 'Not set' segment is disabled.
    expect(within(effortStrip()).getByRole("button", { name: /Not set/ })).toBeDisabled();
  });

  it("with no model the effort strip is 'Not set' and its levels are disabled", async () => {
    mockGetCodexTerminalForAdmin.mockResolvedValue(audit(null));
    render(<AdminCodexTerminalCard isSuperAdmin />);
    await screen.findByText("Codex terminal sessions");
    expect(screen.getByText(/Not set: using the Standard tier's Codex model/)).toBeInTheDocument();
    expect(screen.getByText("Saved together with the model: pick a model to choose an effort.")).toBeInTheDocument();
    const notSet = within(effortStrip()).getByRole("button", { name: /Not set/ });
    expect(notSet).toHaveAttribute("aria-pressed", "true");
    expect(notSet).not.toBeDisabled();
    expect(within(effortStrip()).getByRole("button", { name: "High" })).toBeDisabled();
  });

  it("changing only the effort saves the pair and nothing else", async () => {
    render(<AdminCodexTerminalCard isSuperAdmin />);
    await screen.findByText("Codex terminal sessions");
    fireEvent.click(within(effortStrip()).getByRole("button", { name: "High" }));
    mockUpdateCodexTerminal.mockResolvedValue({ model: "gpt-5.6-sol", effort: "high" });
    mockGetCodexTerminalForAdmin.mockResolvedValue(audit({ model: "gpt-5.6-sol", effort: "high" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdateCodexTerminal).toHaveBeenCalledWith({ model: "gpt-5.6-sol", effort: "high" }));
    expect(mockUpdateAutoCompact).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Codex site defaults saved · model gpt-5.6-sol, effort High")
    );
  });

  it("changing only the memory limit writes only the memory key", async () => {
    render(<AdminCodexTerminalCard isSuperAdmin />);
    await screen.findByText("Codex terminal sessions");
    fireEvent.click(within(memoryStrip()).getByRole("button", { name: "150k" }));
    mockUpdateAutoCompact.mockResolvedValue(150_000);
    mockGetAutoCompactForAdmin.mockResolvedValue(audit(150_000));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdateAutoCompact).toHaveBeenCalledWith("codex", 150_000));
    expect(mockUpdateCodexTerminal).not.toHaveBeenCalled();
    expect(mockSetAutoCompactCache).toHaveBeenCalledWith("codex", 150_000);
  });

  it("a failing pair write is named in one error toast and keeps its staged value", async () => {
    render(<AdminCodexTerminalCard isSuperAdmin />);
    await screen.findByText("Codex terminal sessions");
    fireEvent.click(within(effortStrip()).getByRole("button", { name: "Low" }));
    mockUpdateCodexTerminal.mockRejectedValue("nope");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't save the starting model and effort — try again")
    );
    expect(within(effortStrip()).getByRole("button", { name: "Low" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Cancel restores every row", async () => {
    render(<AdminCodexTerminalCard isSuperAdmin />);
    await screen.findByText("Codex terminal sessions");
    fireEvent.click(within(effortStrip()).getByRole("button", { name: "Low" }));
    fireEvent.click(within(memoryStrip()).getByRole("button", { name: "100k" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(within(effortStrip()).getByRole("button", { name: "Medium" })).toHaveAttribute("aria-pressed", "true");
    expect(within(memoryStrip()).getByRole("button", { name: /Not set/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows one error box with Retry when a read fails", async () => {
    mockGetAutoCompactForAdmin.mockRejectedValueOnce(new Error("boom"));
    render(<AdminCodexTerminalCard isSuperAdmin />);
    await screen.findByText("Failed to load the Codex terminal settings.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
