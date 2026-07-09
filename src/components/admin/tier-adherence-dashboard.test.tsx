import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { TierAdherenceStepRow, TierAdherenceSummaryRow } from "@/actions/admin-tier-adherence";

// Mock the server action so we control loading/error/populated states directly
// (this component fetches its own data specifically to get real loading/error
// states, distinct from the rest of /admin's page-level SSR fetch — see the
// component's doc comment).
const getTierAdherenceReport = vi.fn();
vi.mock("@/actions/admin-tier-adherence", () => ({
  getTierAdherenceReport: (...args: unknown[]) => getTierAdherenceReport(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { TierAdherenceDashboard } from "./tier-adherence-dashboard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function stepRow(overrides: Partial<TierAdherenceStepRow> = {}): TierAdherenceStepRow {
  return {
    step_id: "step-1",
    task_id: "task-1",
    task_title: "Ship the thing",
    step_title: "Design review",
    run_id: "run-1",
    idea_id: "idea-1",
    tier: "frontier",
    executed_model: "fable",
    tier_honored: true,
    status: "completed",
    claimed_by: "user-1",
    bot_name: "Compass",
    completed_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

const emptySummary: TierAdherenceSummaryRow[] = [];

describe("TierAdherenceDashboard", () => {
  it("shows a loading skeleton while the report is in flight", () => {
    getTierAdherenceReport.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = render(<TierAdherenceDashboard />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it("shows the empty state — 'No tiered steps completed yet' — when there are no rows", async () => {
    getTierAdherenceReport.mockResolvedValue({ summary: emptySummary, steps: [] });
    render(<TierAdherenceDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/No tiered steps completed yet/i)).toBeInTheDocument();
    });
  });

  it("shows an error state with a retry option when the fetch rejects", async () => {
    getTierAdherenceReport.mockRejectedValue(new Error("boom"));
    render(<TierAdherenceDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load tier adherence data/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders honored/not-honored/not-reported stat counts from the populated rows", async () => {
    getTierAdherenceReport.mockResolvedValue({
      summary: emptySummary,
      steps: [
        stepRow({ step_id: "s1", tier_honored: true }),
        stepRow({ step_id: "s2", tier_honored: false, executed_model: "sonnet" }),
        stepRow({ step_id: "s3", tier_honored: null, executed_model: null }),
      ],
    });
    render(<TierAdherenceDashboard />);

    // All three stat cards read "1 of 3" (Honored / Not honored / Not reported).
    await waitFor(() => {
      expect(screen.getAllByText("1 of 3")).toHaveLength(3);
    });
    expect(screen.getByText(/Self-reported by the orchestrator/i)).toBeInTheDocument();
  });
});
