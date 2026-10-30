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

function Harness({ initial }: { initial: WorkflowTemplateStep[] }) {
  const [steps, setSteps] = useState(initial);
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
    const [tier, effort] = screen.getAllByRole("combobox");
    expect(tier).toHaveTextContent("Auto");
    expect(effort).toBeDisabled();
    expect(effort).toHaveTextContent("Tier's own");
  });
});

describe("StepEditor deliverables box", () => {
  function make(initial: WorkflowTemplateStep[]) {
    const seen: WorkflowTemplateStep[][] = [];
    function H() {
      const [steps, setSteps] = useState<WorkflowTemplateStep[]>(initial);
      seen.push(steps);
      return <StepEditor steps={steps} onChange={setSteps} />;
    }
    return { H, seen };
  }
  const base = { role: "Dev", requires_approval: false };

  it("renders an item that contains a comma without looping", () => {
    const { H } = make([{ ...base, title: "A", deliverables: ["Design doc, v2"] }]);
    render(<H />);
    expect(screen.getByDisplayValue("Design doc, v2").tagName).toBe("TEXTAREA");
  });

  it("typing reports the parsed list, splitting on new lines", () => {
    const { H, seen } = make([{ ...base, title: "A", deliverables: ["X", "Y"] }]);
    render(<H />);
    fireEvent.change(screen.getByDisplayValue("X, Y"), { target: { value: "X, Y\nZ" } });
    expect(seen[seen.length - 1][0].deliverables).toEqual(["X", "Y", "Z"]);
  });

  it("removing a step shows the right text in the remaining box", () => {
    const { H } = make([
      { ...base, title: "A", deliverables: ["one"] },
      { ...base, title: "B", deliverables: ["two"] },
    ]);
    render(<H />);
    fireEvent.click(screen.getAllByRole("button").find((b) => b.className.includes("hover:text-destructive"))!);
    expect(screen.getByDisplayValue("two")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("one")).toBeNull();
  });

  it("reordering steps moves the text with the step", () => {
    const { H } = make([
      { ...base, title: "A", deliverables: ["one"] },
      { ...base, title: "B", deliverables: ["two"] },
    ]);
    render(<H />);
    const down = screen.getAllByRole("button").filter((b) => b.className.includes("p-0.5"));
    fireEvent.click(down[1]); // step 1 move down
    const boxes = screen.getAllByPlaceholderText(/Deliverables/) as HTMLTextAreaElement[];
    expect(boxes.map((b) => b.value)).toEqual(["two", "one"]);
  });
});
