import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModelTierBadge } from "./model-tier-select";
import { TooltipProvider } from "@/components/ui/tooltip";

// Radix primitives use ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverStub;

// The dishonored state wraps the badge in a Radix Tooltip, which requires a
// TooltipProvider ancestor (present app-wide via src/app/layout.tsx).
function renderBadge(props: Parameters<typeof ModelTierBadge>[0]) {
  return render(
    <TooltipProvider>
      <ModelTierBadge {...props} />
    </TooltipProvider>
  );
}

// P2c (design §03) — ModelTierBadge's exception-only row indicator: honored
// and unknown must render identically to today (silence is the default);
// only tier_honored === false changes anything on the row.
describe("ModelTierBadge", () => {
  it("renders nothing when there is no tier (Auto)", () => {
    const { container } = renderBadge({ tier: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("honored (tier_honored=true) renders the plain tier badge — no suffix", () => {
    renderBadge({ tier: "frontier", executedModel: "fable", tierHonored: true });
    expect(screen.getByText("Frontier")).toBeInTheDocument();
    expect(screen.queryByText(/ran on/i)).not.toBeInTheDocument();
  });

  it("unknown (tier_honored=null/undefined) renders identically to honored — no suffix", () => {
    renderBadge({ tier: "frontier", executedModel: null, tierHonored: null });
    expect(screen.getByText("Frontier")).toBeInTheDocument();
    expect(screen.queryByText(/ran on/i)).not.toBeInTheDocument();

    // Also true when the props are simply omitted (existing call sites pre-P2c).
    renderBadge({ tier: "standard" });
    expect(screen.getAllByText("Standard").length).toBeGreaterThan(0);
  });

  it("dishonored (tier_honored=false) adds the amber 'ran on <Model>' suffix and an aria-label stating the mismatch", () => {
    renderBadge({ tier: "frontier", executedModel: "sonnet", tierHonored: false });
    expect(screen.getByText("Frontier")).toBeInTheDocument();
    expect(screen.getByText(/ran on sonnet/i)).toBeInTheDocument();

    const badge = screen.getByLabelText(/Model tier Frontier — not honored: orchestrator reported Sonnet/i);
    expect(badge).toBeInTheDocument();
  });

  it("dishonored with no reported executed model falls back to 'Unknown' rather than crashing", () => {
    renderBadge({ tier: "frontier", executedModel: null, tierHonored: false });
    expect(screen.getByText(/ran on unknown/i)).toBeInTheDocument();
  });
});
