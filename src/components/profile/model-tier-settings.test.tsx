import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

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
}));

vi.mock("@/hooks/use-viewer-model-tier-map", () => ({
  setViewerModelTierMapCache: vi.fn(),
}));

const mockUsePlatformModelDefaults = vi.fn();
vi.mock("@/hooks/use-platform-model-defaults", () => ({
  usePlatformModelDefaults: () => mockUsePlatformModelDefaults(),
}));

import { ModelTierSettings } from "./model-tier-settings";

afterEach(cleanup);

describe("ModelTierSettings", () => {
  it("shows the LIVE platform default (e.g. Opus) as the frontier placeholder, not a hard-coded label", () => {
    mockUsePlatformModelDefaults.mockReturnValue({
      defaults: { frontier: "opus", standard: "sonnet", cheap: "haiku" },
      fallback: {},
    });

    render(<ModelTierSettings map={null} open onOpenChange={() => {}} />);

    expect(screen.getByText("Opus (default)")).toBeInTheDocument();
  });

  it("reflects a super-admin-changed live default (e.g. frontier -> Fable) with no code change", () => {
    mockUsePlatformModelDefaults.mockReturnValue({
      defaults: { frontier: "fable", standard: "sonnet", cheap: "haiku" },
      fallback: {},
    });

    render(<ModelTierSettings map={null} open onOpenChange={() => {}} />);

    expect(screen.getByText("Fable (default)")).toBeInTheDocument();
    expect(screen.queryByText("Opus (default)")).not.toBeInTheDocument();
  });

  it("shows the tier's own value, not the platform default, once the user has an override", () => {
    mockUsePlatformModelDefaults.mockReturnValue({
      defaults: { frontier: "opus", standard: "sonnet", cheap: "haiku" },
      fallback: {},
    });

    render(<ModelTierSettings map={{ frontier: "haiku" }} open onOpenChange={() => {}} />);

    // The trigger renders the option label ("Haiku"), not "<default> (default)".
    expect(screen.queryByText("Opus (default)")).not.toBeInTheDocument();
  });
});
