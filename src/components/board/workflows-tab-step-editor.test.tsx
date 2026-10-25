import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS } from "@/lib/platform-model-defaults";
import type { WorkflowTemplateStep } from "@/types/database";

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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/ui/role-combobox", () => ({
  RoleCombobox: () => null,
  useRoleSuggestions: () => ({ poolRoles: [], userRoles: [] }),
}));

import { StepEditor } from "./workflows-tab";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverStub;
Element.prototype.scrollIntoView = () => {};

const seen: { steps: WorkflowTemplateStep[] } = { steps: [] };
function Harness({ initial }: { initial: WorkflowTemplateStep[] }) {
  const [steps, setSteps] = useState(initial);
  seen.steps = steps;
  return <StepEditor steps={steps} onChange={setSteps} />;
}

describe("StepEditor tier + effort", () => {
  it("choosing Auto on a step with its own effort clears both tier and effort", async () => {
    render(
      <Harness initial={[{ title: "Review", role: "Dev", requires_approval: false, model_tier: "frontier", effort: "high" }]} />
    );
    // The first combobox is the tier select.
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    fireEvent.click(await screen.findByRole("option", { name: /Auto/ }));
    expect(seen.steps[0].model_tier).toBeUndefined();
    expect(seen.steps[0].effort).toBeUndefined();
  });
});
