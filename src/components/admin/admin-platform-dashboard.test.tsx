import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

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
const mockGetCodexTerminalForAdmin = vi.fn();
const mockUpdateCodexTerminal = vi.fn();

vi.mock("@/actions/admin-platform", () => ({
  getAgentAwarePlatformModelDefaultsForAdmin: () => mockGetForAdmin(),
  updateAgentAwarePlatformModelDefaults: (input: unknown) => mockUpdate(input),
  getPlatformTerminalModelDefaultForAdmin: () => mockGetTerminalForAdmin(),
  updatePlatformTerminalModelDefault: (model: string | null) => mockUpdateTerminal(model),
  getPlatformTerminalEffortDefaultForAdmin: () => mockGetEffortForAdmin(),
  updatePlatformTerminalEffortDefault: (effort: string | null) => mockUpdateEffort(effort),
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
vi.mock("@/hooks/use-platform-terminal-codex-model-default", () => ({
  setPlatformTerminalCodexModelDefaultCache: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AdminPlatformDashboard, AdminTerminalCodexModelCard, AdminTerminalEffortCard, AdminTerminalModelCard } from "./admin-platform-dashboard";
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
      screen.getByText(/Frontier → Opus \(high\) on Claude · gpt-6-astra \(high\) on Codex/)
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

describe("AdminTerminalModelCard (task c4ca2d95 — binding: no seed)", () => {
  it("renders the denied state for a non-super-admin and never fetches", () => {
    render(<AdminTerminalModelCard isSuperAdmin={false} />);

    expect(screen.getByText("Super-admin access required")).toBeInTheDocument();
    expect(mockGetTerminalForAdmin).not.toHaveBeenCalled();
  });

  it("shows 'nothing saved yet' (no seed pill) when no platform default has ever been set", async () => {
    mockGetTerminalForAdmin.mockResolvedValue({ value: null, updatedBy: null, updatedAt: null });

    render(<AdminTerminalModelCard isSuperAdmin />);

    await waitFor(() => expect(screen.getByText(/Using the code default \(no model\) — nothing saved yet/)).toBeInTheDocument());
    expect(screen.getByText(/No platform default \(nothing passed\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    // Clear is disabled too — there is nothing to clear.
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("shows the fetched value and audit line when a platform default is set", async () => {
    mockGetTerminalForAdmin.mockResolvedValue({
      value: "opus",
      updatedBy: { id: "u1", full_name: "Nick Ball" },
      updatedAt: "2026-07-20T00:00:00Z",
    });

    render(<AdminTerminalModelCard isSuperAdmin />);

    await waitFor(() => expect(screen.getByText(/Last changed by/)).toBeInTheDocument());
    expect(screen.getByText("Nick Ball")).toBeInTheDocument();
    expect(screen.getByText("Opus")).toBeInTheDocument();
  });

  it("shows an error state with a Retry button when the fetch fails", async () => {
    mockGetTerminalForAdmin.mockRejectedValueOnce(new Error("boom"));

    render(<AdminTerminalModelCard isSuperAdmin />);

    await waitFor(() => expect(screen.getByText(/Failed to load the terminal starting model/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("'Clear' stages 'no platform default' locally (dirty, Save enabled) without saving", async () => {
    mockGetTerminalForAdmin.mockResolvedValue({
      value: "opus",
      updatedBy: { id: "u1", full_name: "Nick Ball" },
      updatedAt: "2026-07-20T00:00:00Z",
    });

    render(<AdminTerminalModelCard isSuperAdmin />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    expect(mockUpdateTerminal).not.toHaveBeenCalled();
  });

  it("blocks Save with role=alert on a structurally invalid custom value (AC-12), before any novel-value gate", async () => {
    mockGetTerminalForAdmin.mockResolvedValue({
      value: "opus-5.5",
      updatedBy: null,
      updatedAt: null,
    });

    render(<AdminTerminalModelCard isSuperAdmin />);
    const input = await screen.findByLabelText("Starting model");
    expect(input).toHaveValue("opus-5.5");

    fireEvent.change(input, { target: { value: "opus 5!" } });

    expect(screen.getByRole("alert")).toHaveTextContent(/space/i);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/Fix the model name to enable Save/)).toBeInTheDocument();
  });

  it("gates Save behind the novel-value confirm checkbox, then saves once confirmed", async () => {
    mockGetTerminalForAdmin.mockResolvedValue({ value: "opus-5.5", updatedBy: null, updatedAt: null });

    render(<AdminTerminalModelCard isSuperAdmin />);
    const input = await screen.findByLabelText("Starting model");
    expect(input).toHaveValue("opus-5.5");

    fireEvent.change(input, { target: { value: "opus-5.6" } });

    expect(screen.getByText(/isn't a known model alias/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/Confirm the checkbox above to enable Save/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();

    mockUpdateTerminal.mockResolvedValue("opus-5.6");
    mockGetTerminalForAdmin.mockResolvedValue({
      value: "opus-5.6",
      updatedBy: { id: "u1", full_name: "Nick Ball" },
      updatedAt: "2026-07-25T00:00:00Z",
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockUpdateTerminal).toHaveBeenCalledWith("opus-5.6"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Opus-5.6")));
  });

  it("saves a Clear (null) as clearing back to unset, with distinct toast copy", async () => {
    mockGetTerminalForAdmin.mockResolvedValue({
      value: "opus",
      updatedBy: { id: "u1", full_name: "Nick Ball" },
      updatedAt: "2026-07-20T00:00:00Z",
    });

    render(<AdminTerminalModelCard isSuperAdmin />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear" })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    mockUpdateTerminal.mockResolvedValue(null);
    mockGetTerminalForAdmin.mockResolvedValue({ value: null, updatedBy: null, updatedAt: null });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockUpdateTerminal).toHaveBeenCalledWith(null));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("cleared"))
    );
  });

  it("shows a retryable error toast and keeps staged values when the save action throws", async () => {
    mockGetTerminalForAdmin.mockResolvedValue({ value: "opus", updatedBy: null, updatedAt: null });

    render(<AdminTerminalModelCard isSuperAdmin />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear" })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();

    mockUpdateTerminal.mockRejectedValueOnce(new Error("Super admin access required"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Super admin access required"));
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });
});

describe("AdminTerminalEffortCard (task 18a37612 — no seed)", () => {
  const strip = () => screen.getByRole("group", { name: "Claude starting effort, site default" });

  it("renders the denied state for a non-super-admin and never fetches", () => {
    mockGetEffortForAdmin.mockClear();
    render(<AdminTerminalEffortCard isSuperAdmin={false} />);
    expect(screen.getByText("Super-admin access required")).toBeInTheDocument();
    expect(mockGetEffortForAdmin).not.toHaveBeenCalled();
  });

  it("shows a skeleton while loading (heading not yet shown)", () => {
    mockGetEffortForAdmin.mockReturnValue(new Promise(() => {}));
    render(<AdminTerminalEffortCard isSuperAdmin />);
    expect(screen.queryByText("Claude terminal starting effort")).not.toBeInTheDocument();
  });

  it("with nothing saved: five levels, none pressed, the no-default audit line, Save and Clear disabled", async () => {
    mockGetEffortForAdmin.mockResolvedValue({ value: null, updatedBy: null, updatedAt: null });
    render(<AdminTerminalEffortCard isSuperAdmin />);
    await waitFor(() => expect(screen.getByText(/No site default: Claude Code decides/)).toBeInTheDocument());
    const buttons = Array.from(strip().querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Low", "Medium", "High", "X-High", "Max"]);
    expect(buttons.every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("shows the saved level and who changed it", async () => {
    mockGetEffortForAdmin.mockResolvedValue({
      value: "high",
      updatedBy: { id: "u1", full_name: "Nick Ball" },
      updatedAt: "2026-10-14T00:00:00Z",
    });
    render(<AdminTerminalEffortCard isSuperAdmin />);
    await waitFor(() => expect(screen.getByText(/Last changed by/)).toBeInTheDocument());
    expect(screen.getByText("Nick Ball")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "High" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows an error state with Retry when the fetch fails", async () => {
    mockGetEffortForAdmin.mockRejectedValueOnce(new Error("boom"));
    render(<AdminTerminalEffortCard isSuperAdmin />);
    await waitFor(() => expect(screen.getByText(/Failed to load the terminal starting effort/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("pick High -> Save calls the action with 'high', refreshes the cache and toasts", async () => {
    mockGetEffortForAdmin
      .mockResolvedValueOnce({ value: null, updatedBy: null, updatedAt: null })
      .mockResolvedValue({ value: "high", updatedBy: { id: "u1", full_name: "Nick Ball" }, updatedAt: "2026-10-14T00:00:00Z" });
    mockUpdateEffort.mockResolvedValue("high");
    vi.mocked(toast.success).mockClear();
    render(<AdminTerminalEffortCard isSuperAdmin />);
    await waitFor(() => expect(screen.getByRole("button", { name: "High" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdateEffort).toHaveBeenCalledWith("high"));
    await waitFor(() => expect(mockSetEffortCache).toHaveBeenCalledWith("high"));
    expect(toast.success).toHaveBeenCalledWith(
      "Terminal starting effort saved · sessions now start at High unless a user picks their own"
    );
  });

  it("Clear -> Save calls the action with null and toasts the cleared copy", async () => {
    mockGetEffortForAdmin
      .mockResolvedValueOnce({ value: "xhigh", updatedBy: null, updatedAt: null })
      .mockResolvedValue({ value: null, updatedBy: null, updatedAt: null });
    mockUpdateEffort.mockClear();
    mockUpdateEffort.mockResolvedValue(null);
    vi.mocked(toast.success).mockClear();
    render(<AdminTerminalEffortCard isSuperAdmin />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Clear" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(mockUpdateEffort).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdateEffort).toHaveBeenCalledWith(null));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Terminal starting effort cleared · Claude Code decides unless a user picks their own"
      )
    );
  });

  it("keeps the staged value and toasts the error when Save fails", async () => {
    mockGetEffortForAdmin.mockResolvedValue({ value: null, updatedBy: null, updatedAt: null });
    mockUpdateEffort.mockRejectedValue(new Error("Choose a valid Claude effort"));
    vi.mocked(toast.error).mockClear();
    render(<AdminTerminalEffortCard isSuperAdmin />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Max" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Choose a valid Claude effort"));
    expect(screen.getByRole("button", { name: "Max" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("AdminTerminalCodexModelCard", () => {
  it("renders and saves the independent platform model and effort pair", async () => {
    mockGetCodexTerminalForAdmin.mockResolvedValue({
      value: { model: "gpt-5.6-sol", effort: "medium" },
      updatedBy: { id: "u1", full_name: "Nick Ball" },
      updatedAt: "2026-09-10T00:00:00Z",
    });
    mockUpdateCodexTerminal.mockResolvedValue({ model: "gpt-5.6-sol", effort: "high" });
    render(<AdminTerminalCodexModelCard isSuperAdmin />);

    await screen.findByText("Codex terminal starting model");
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockUpdateCodexTerminal).toHaveBeenCalledWith({ model: "gpt-5.6-sol", effort: "high" }));
  });
});
