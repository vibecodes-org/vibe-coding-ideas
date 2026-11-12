import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS } from "@/lib/platform-model-defaults";
import type { WorkflowTemplateStep } from "@/types/database";

// Same stand-ins as template-step-dialog.test.tsx, except the role picker:
// this file uses the REAL RoleCombobox.
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
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TemplateStepDialog } from "./template-step-dialog";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverStub;
Element.prototype.scrollIntoView = () => {};

const STEP: WorkflowTemplateStep = {
  title: "Build",
  description: "Line one",
  role: "Developer",
  requires_approval: true,
  deliverables: ["Code"],
  model_tier: "frontier",
  effort: "high",
};

describe("TemplateStepDialog as a view-only member (real role picker)", () => {
  function setup() {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <TemplateStepDialog
        open
        onOpenChange={onOpenChange}
        step={STEP}
        index={0}
        templateName="Feature"
        isReadOnly
        poolRoles={[]}
        userRoles={[]}
        onSave={onSave}
      />
    );
    return { onSave, onOpenChange };
  }

  it("every field is disabled, including the role picker, tier, effort and switch", () => {
    setup();
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByLabelText("Description")).toBeDisabled();
    expect(screen.getByPlaceholderText("e.g. developer, designer")).toBeDisabled();
    const [tier, effort] = screen.getAllByRole("combobox").filter((c) => c.tagName === "BUTTON");
    expect(tier).toBeDisabled();
    expect(effort).toBeDisabled();
    expect(screen.getByLabelText("Expected Deliverables")).toBeDisabled();
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("has no Save button, reads Close, and Close closes", () => {
    const { onOpenChange } = setup();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
