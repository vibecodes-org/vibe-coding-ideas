import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectTypeSelector } from "./project-type-selector";
import type { KitWithSteps } from "@/actions/kits";

const { mockCapture } = vi.hoisted(() => ({ mockCapture: vi.fn() }));
vi.mock("posthog-js/react", () => ({ usePostHog: () => ({ capture: mockCapture }) }));

const mockKits: KitWithSteps[] = [
  {
    id: "kit-web",
    name: "Web Application",
    icon: "🌐",
    description: "Full-stack web app",
    category: "Development",
    agent_roles: [{ role: "Full Stack Engineer" }, { role: "UX Designer" }],
    label_presets: [],
    board_column_presets: null,
    auto_rule_label: "Feature",
    workflow_library_template_id: "tmpl-1",
    is_active: true,
    display_order: 1,
    created_at: "",
    updated_at: "",
    workflow_mappings: [],
    workflow_steps: [
      { title: "UX Review" },
      { title: "Implementation" },
      { title: "Testing" },
      { title: "Human Review", requires_approval: true },
    ],
  } as KitWithSteps,
  {
    id: "kit-custom",
    name: "Custom",
    icon: "✨",
    description: "Start from scratch",
    category: null,
    agent_roles: [],
    label_presets: [],
    board_column_presets: null,
    auto_rule_label: null,
    workflow_library_template_id: null,
    is_active: true,
    display_order: 99,
    created_at: "",
    updated_at: "",
    workflow_mappings: [],
    workflow_steps: [],
  } as KitWithSteps,
  {
    id: "kit-mobile",
    name: "Mobile App",
    icon: "📱",
    description: "Mobile application",
    category: "Development",
    agent_roles: [{ role: "Full Stack Engineer" }, { role: "QA Engineer" }, { role: "UX Designer" }],
    label_presets: [],
    board_column_presets: null,
    auto_rule_label: "Feature",
    workflow_library_template_id: "tmpl-2",
    is_active: true,
    display_order: 2,
    created_at: "",
    updated_at: "",
    workflow_mappings: [],
    workflow_steps: [
      { title: "Design" },
      { title: "Build" },
    ],
  } as KitWithSteps,
];

describe("ProjectTypeSelector", () => {
  it("renders all kit cards", () => {
    render(
      <ProjectTypeSelector kits={mockKits} selectedKitId={null} onSelect={() => {}} />
    );
    expect(screen.getByText("Web Application")).toBeDefined();
    expect(screen.getByText("Mobile App")).toBeDefined();
    expect(screen.getByText("Custom")).toBeDefined();
  });

  it("Custom card is always rendered last", () => {
    const { container } = render(
      <ProjectTypeSelector kits={mockKits} selectedKitId={null} onSelect={() => {}} />
    );
    const buttons = container.querySelectorAll("[role='radio']");
    const lastButton = buttons[buttons.length - 1];
    expect(lastButton.textContent).toContain("Custom");
  });

  it("does not render workflow/agent count pills (removed for a cleaner, shorter grid)", () => {
    render(
      <ProjectTypeSelector kits={mockKits} selectedKitId={null} onSelect={() => {}} />
    );
    expect(screen.queryByText("1 workflow")).toBeNull();
    expect(screen.queryByText("2 agents")).toBeNull();
    expect(screen.queryByText("3 agents")).toBeNull();
    // Custom keeps its "Your choice" indicator.
    expect(screen.getByText("Your choice")).toBeDefined();
  });

  it("renders each kit's description on the card (recognition over recall)", () => {
    render(
      <ProjectTypeSelector kits={mockKits} selectedKitId={null} onSelect={() => {}} />
    );
    // Description is on the card itself, not hidden until after selecting.
    expect(screen.getByText("Full-stack web app")).toBeDefined();
    expect(screen.getByText("Mobile application")).toBeDefined();
    expect(screen.getByText("Start from scratch")).toBeDefined();
  });

  it("calls onSelect with kit id when clicked", () => {
    const onSelect = vi.fn();
    render(
      <ProjectTypeSelector kits={mockKits} selectedKitId={null} onSelect={onSelect} />
    );
    fireEvent.click(screen.getByText("Web Application"));
    expect(onSelect).toHaveBeenCalledWith("kit-web");
  });

  it("calls onSelect with null when clicking already-selected card (deselect)", () => {
    const onSelect = vi.fn();
    render(
      <ProjectTypeSelector kits={mockKits} selectedKitId="kit-web" onSelect={onSelect} />
    );
    fireEvent.click(screen.getByText("Web Application"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("marks selected card with aria-checked", () => {
    const { container } = render(
      <ProjectTypeSelector kits={mockKits} selectedKitId="kit-web" onSelect={() => {}} />
    );
    const selected = container.querySelector("[aria-checked='true']");
    expect(selected?.textContent).toContain("Web Application");
  });

  it("uses radiogroup role for accessibility", () => {
    const { container } = render(
      <ProjectTypeSelector kits={mockKits} selectedKitId={null} onSelect={() => {}} />
    );
    expect(container.querySelector("[role='radiogroup']")).toBeDefined();
  });

  it("fires kit_selected with the surface when a surface is provided", () => {
    mockCapture.mockClear();
    render(
      <ProjectTypeSelector kits={mockKits} selectedKitId={null} onSelect={() => {}} surface="onboarding" />
    );
    fireEvent.click(screen.getByText("Web Application"));
    expect(mockCapture).toHaveBeenCalledWith(
      "kit_selected",
      expect.objectContaining({ surface: "onboarding", kit: "Web Application", is_custom: false })
    );
  });

  it("flags is_custom when the Custom card is picked", () => {
    mockCapture.mockClear();
    render(
      <ProjectTypeSelector kits={mockKits} selectedKitId={null} onSelect={() => {}} surface="onboarding" />
    );
    fireEvent.click(screen.getByText("Custom"));
    expect(mockCapture).toHaveBeenCalledWith(
      "kit_selected",
      expect.objectContaining({ kit: "Custom", is_custom: true })
    );
  });

  it("stays silent (no kit_selected) when no surface is provided", () => {
    mockCapture.mockClear();
    render(
      <ProjectTypeSelector kits={mockKits} selectedKitId={null} onSelect={() => {}} />
    );
    fireEvent.click(screen.getByText("Web Application"));
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
