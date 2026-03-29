import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectTypeSelector } from "./project-type-selector";
import type { KitWithSteps } from "@/actions/kits";

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

  it("shows both workflow count and agent count pills for non-Custom kits", () => {
    render(
      <ProjectTypeSelector kits={mockKits} selectedKitId={null} onSelect={() => {}} />
    );
    expect(screen.getAllByText("1 workflow")).toHaveLength(2);
    expect(screen.getByText("2 agents")).toBeDefined();
    expect(screen.getByText("3 agents")).toBeDefined();
    expect(screen.getByText("Your choice")).toBeDefined();
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
});
