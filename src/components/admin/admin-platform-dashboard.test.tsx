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

vi.mock("@/actions/admin-platform", () => ({
  getPlatformModelDefaultsForAdmin: () => mockGetForAdmin(),
  updatePlatformModelDefaults: (input: unknown) => mockUpdate(input),
}));

vi.mock("@/hooks/use-platform-model-defaults", () => ({
  setPlatformModelDefaultsCache: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AdminPlatformDashboard } from "./admin-platform-dashboard";
import { SEED_PLATFORM_MODEL_DEFAULTS } from "@/lib/platform-model-defaults";
import { toast } from "sonner";

afterEach(cleanup);

const SEEDED_AUDIT = {
  value: SEED_PLATFORM_MODEL_DEFAULTS,
  updatedBy: { id: "u1", full_name: "Nick Ball" },
  updatedAt: "2026-07-20T00:00:00Z",
  isSeed: false,
};

describe("AdminPlatformDashboard", () => {
  it("renders the denied state for a non-super-admin and never fetches", () => {
    render(<AdminPlatformDashboard isSuperAdmin={false} />);

    expect(screen.getByText("Super-admin access required")).toBeInTheDocument();
    expect(mockGetForAdmin).not.toHaveBeenCalled();
  });

  it("shows a loading skeleton, then the fetched frontier default and audit line", async () => {
    mockGetForAdmin.mockResolvedValue(SEEDED_AUDIT);

    render(<AdminPlatformDashboard isSuperAdmin />);

    await waitFor(() => expect(screen.getByText(/Last changed by/)).toBeInTheDocument());
    expect(screen.getByText("Nick Ball")).toBeInTheDocument();
    expect(screen.getByText(/Save enables when you change a value/)).toBeInTheDocument();
  });

  it("shows the 'using code defaults' note and disables Cancel when nothing has been saved yet", async () => {
    mockGetForAdmin.mockResolvedValue({
      value: SEED_PLATFORM_MODEL_DEFAULTS,
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

  it("'Reset to seed' stages the seed values locally (dirty, Save enabled) without saving", async () => {
    const live = {
      value: {
        defaults: { frontier: "fable", standard: "sonnet", cheap: "haiku" },
        fallback: SEED_PLATFORM_MODEL_DEFAULTS.fallback,
      },
      updatedBy: { id: "u1", full_name: "Nick Ball" },
      updatedAt: "2026-07-20T00:00:00Z",
      isSeed: false,
    };
    mockGetForAdmin.mockResolvedValue(live);

    render(<AdminPlatformDashboard isSuperAdmin />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Reset to seed" }));

    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("gates Save behind the novel-family confirm checkbox, then saves once confirmed", async () => {
    // Load with a novel platform default already in place (frontier: "opus-5.5")
    // so the field renders as a free-text Input with no Select interaction needed.
    mockGetForAdmin.mockResolvedValue({
      value: {
        defaults: { frontier: "opus-5.5", standard: "sonnet", cheap: "haiku" },
        fallback: SEED_PLATFORM_MODEL_DEFAULTS.fallback,
      },
      updatedBy: null,
      updatedAt: null,
      isSeed: false,
    });

    render(<AdminPlatformDashboard isSuperAdmin />);

    const input = await screen.findByLabelText(/Frontier —/);
    expect(input).toHaveValue("opus-5.5");

    // Change to a different novel value -> dirty AND still novel.
    fireEvent.change(input, { target: { value: "opus-5.6" } });

    expect(screen.getByText(/isn't a known model alias/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/Confirm the checkbox above to enable Save/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();

    mockUpdate.mockResolvedValue({
      defaults: { frontier: "opus-5.6", standard: "sonnet", cheap: "haiku" },
      fallback: SEED_PLATFORM_MODEL_DEFAULTS.fallback,
    });
    mockGetForAdmin.mockResolvedValue({
      value: { defaults: { frontier: "opus-5.6", standard: "sonnet", cheap: "haiku" }, fallback: SEED_PLATFORM_MODEL_DEFAULTS.fallback },
      updatedBy: { id: "u1", full_name: "Nick Ball" },
      updatedAt: "2026-07-25T00:00:00Z",
      isSeed: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      defaults: expect.objectContaining({ frontier: "opus-5.6" }),
    })));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("shows a retryable error toast and keeps staged values when the save action throws", async () => {
    mockGetForAdmin.mockResolvedValue({
      value: { defaults: { frontier: "fable", standard: "sonnet", cheap: "haiku" }, fallback: SEED_PLATFORM_MODEL_DEFAULTS.fallback },
      updatedBy: null,
      updatedAt: null,
      isSeed: false,
    });

    render(<AdminPlatformDashboard isSuperAdmin />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset to seed" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Reset to seed" }));
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();

    mockUpdate.mockRejectedValueOnce(new Error("Super admin access required"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Super admin access required"));
    // Staged (seed) values are retained — Save is still enabled for a retry.
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });
});
