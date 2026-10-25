import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModelTierBadge, ModelTierSelect } from "./model-tier-select";
import { SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS } from "@/lib/platform-model-defaults";

// The select reads the viewer's tier map and the platform defaults through
// hooks that hit the network; give it the seed values instead.
vi.mock("@/hooks/use-viewer-model-tier-map", () => ({
  useViewerModelTierMap: () => null,
  useViewerAgentAwareModelTierMap: () => ({}),
}));
vi.mock("@/hooks/use-platform-model-defaults", () => ({
  usePlatformModelDefaults: () => ({
    defaults: { frontier: "opus", standard: "sonnet", cheap: "haiku" },
    fallback: {},
  }),
  usePlatformAgentAwareModelDefaults: () => ({
    defaults: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS,
    isLoading: false,
  }),
}));
import { TooltipProvider } from "@/components/ui/tooltip";

// Radix primitives use ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverStub;
// Radix Select scrolls the chosen option into view when it opens.
Element.prototype.scrollIntoView = () => {};

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

describe("ModelTierBadge - step effort", () => {
  it("shows the level next to the tier only when the step has its own", () => {
    renderBadge({ tier: "frontier", effort: "high" });
    expect(screen.getByText("Frontier · High")).toBeInTheDocument();
    expect(screen.getByLabelText("Model tier: Frontier · High")).toBeInTheDocument();
  });

  it("is exactly as before without a level, or with an invalid one", () => {
    renderBadge({ tier: "standard", effort: null });
    renderBadge({ tier: "cheap", effort: "bogus" });
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("Cheap")).toBeInTheDocument();
  });
});

describe("ModelTierSelect - Effort", () => {
  it("renders no Effort control unless a handler is given", () => {
    render(<ModelTierSelect value="frontier" onChange={() => {}} />);
    expect(screen.queryByText("Effort")).not.toBeInTheDocument();
  });

  it("shows Tier's own by default and the shared help line names the tier's levels", () => {
    render(<ModelTierSelect value="frontier" onChange={() => {}} effort={null} onEffortChange={() => {}} />);
    expect(screen.getByLabelText("Effort")).toHaveTextContent("Tier's own");
    expect(screen.getByText(/Frontier → Opus \(medium\) on Claude · gpt-6-astra \(high\) on Codex/)).toBeInTheDocument();
    expect(screen.queryByText(/set on this step/)).not.toBeInTheDocument();
  });

  it("shows the step's level and says it was set on the step", () => {
    render(<ModelTierSelect value="frontier" onChange={() => {}} effort="high" onEffortChange={() => {}} />);
    expect(screen.getByLabelText("Effort")).toHaveTextContent("High");
    expect(
      screen.getByText(/Frontier → Opus \(high, set on this step\) on Claude · gpt-6-astra \(high, set on this step\) on Codex/)
    ).toBeInTheDocument();
  });

  it("is disabled with Auto, and explains why", () => {
    render(<ModelTierSelect value={null} onChange={() => {}} effort="high" onEffortChange={() => {}} />);
    const trigger = screen.getByLabelText("Effort");
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent("Tier's own");
    expect(screen.getByText(/Pick a tier to set an effort/)).toBeInTheDocument();
  });

  it("picking a level reports it; picking Tier's own reports null", async () => {
    const onEffortChange = vi.fn();
    render(<ModelTierSelect value="frontier" onChange={() => {}} effort="high" onEffortChange={onEffortChange} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Effort" }));
    fireEvent.click(await screen.findByRole("option", { name: /X-High/ }));
    expect(onEffortChange).toHaveBeenLastCalledWith("xhigh");

    fireEvent.click(screen.getByRole("combobox", { name: "Effort" }));
    fireEvent.click(await screen.findByRole("option", { name: /Tier's own/ }));
    expect(onEffortChange).toHaveBeenLastCalledWith(null);
  });

  it("choosing Auto clears the level", async () => {
    const onChange = vi.fn();
    const onEffortChange = vi.fn();
    render(<ModelTierSelect value="frontier" onChange={onChange} effort="high" onEffortChange={onEffortChange} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Model tier" }));
    fireEvent.click(await screen.findByRole("option", { name: /Auto/ }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(onEffortChange).toHaveBeenCalledWith(null);
  });
});
