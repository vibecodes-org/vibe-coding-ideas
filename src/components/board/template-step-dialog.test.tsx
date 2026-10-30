import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  RoleCombobox: ({ value }: { value: string }) => <input aria-label="role" defaultValue={value} readOnly />,
  useRoleSuggestions: () => ({ poolRoles: [], userRoles: [] }),
}));


import { TemplateStepDialog } from "./template-step-dialog";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (m: string) => toastError(m) } }));

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
  description: "Line one\nLine two",
  role: "Dev",
  requires_approval: true,
  deliverables: ["Code", "Tests"],
  model_tier: "frontier",
  effort: "high",
};

function setup(over: Partial<React.ComponentProps<typeof TemplateStepDialog>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <TemplateStepDialog
      open
      onOpenChange={onOpenChange}
      step={STEP}
      index={1}
      templateName="Feature"
      onSave={onSave}
      {...over}
    />
  );
  return { onSave, onOpenChange };
}

describe("TemplateStepDialog", () => {
  it("opens with all seven values", () => {
    setup();
    expect(screen.getByLabelText("Title")).toHaveValue("Build");
    expect(screen.getByLabelText("Description")).toHaveValue("Line one\nLine two");
    expect(screen.getByLabelText("role")).toHaveValue("Dev");
    const [tier, effort] = screen.getAllByRole("combobox");
    expect(tier).toHaveTextContent(/Frontier/);
    expect(effort).toHaveTextContent(/High/);
    expect(screen.getByLabelText("Expected Deliverables")).toHaveValue("Code, Tests");
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("saves only the edited fields and parses deliverables on commas and lines", async () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Expected Deliverables"), {
      target: { value: "A, B\nC\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith({ ...STEP, deliverables: ["A", "B", "C"] });
  });

  it("drops effort when tier goes to Auto", async () => {
    const { onSave } = setup();
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    fireEvent.click(await screen.findByRole("option", { name: /Auto/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0];
    expect(saved.model_tier).toBeUndefined();
    expect(saved.effort).toBeUndefined();
  });

  it("disables Save with an empty title", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows a toast and stays open when save fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Nope"));
    const { onOpenChange } = setup({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Nope"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("read-only: fields disabled, no Save, Close button", () => {
    setup({ isReadOnly: true });
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByLabelText("Expected Deliverables")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Close" })[0]).toBeInTheDocument();
  });

  it("Enter in Description does not save", () => {
    const { onSave } = setup();
    fireEvent.keyDown(screen.getByLabelText("Description"), { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
  });
});
