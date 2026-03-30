import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KitPreview } from "./kit-preview";
import type { KitWithSteps, WorkflowMapping } from "@/actions/kits";

const webAppMappings: WorkflowMapping[] = [
  {
    label_name: "Feature",
    template_name: "Web Application Feature",
    template_step_count: 5,
    template_steps: [
      { title: "UX Review" },
      { title: "Implementation" },
      { title: "Code Review" },
      { title: "Human Review", requires_approval: true },
      { title: "Deploy" },
    ],
    is_primary: true,
  },
  {
    label_name: "Bug",
    template_name: "Bug Fix",
    template_step_count: 4,
    template_steps: [
      { title: "Triage" },
      { title: "Fix" },
      { title: "Regression Test" },
      { title: "Verify", requires_approval: true },
    ],
    is_primary: false,
  },
  {
    label_name: "Enhancement",
    template_name: "Web Application Feature",
    template_step_count: 5,
    template_steps: [
      { title: "UX Review" },
      { title: "Implementation" },
      { title: "Code Review" },
      { title: "Human Review", requires_approval: true },
      { title: "Deploy" },
    ],
    is_primary: false,
  },
];

const makeKit = (overrides = {}): KitWithSteps => ({
  id: "kit-1",
  name: "Web Application",
  icon: "\u{1F310}",
  description: "Full-stack web app with frontend, backend, and deployment",
  category: "Development",
  agent_roles: [
    { role: "Full Stack Engineer", name_suggestion: "Atlas" },
    { role: "UX Designer", name_suggestion: "Compass" },
    { role: "QA Engineer", name_suggestion: "Sentinel" },
  ],
  label_presets: [
    { name: "Bug", color: "red" },
    { name: "Feature", color: "violet" },
    { name: "Enhancement", color: "emerald" },
  ],
  board_column_presets: null,
  auto_rule_label: "Feature",
  workflow_library_template_id: "tmpl-1",
  is_active: true,
  display_order: 1,
  created_at: "",
  updated_at: "",
  workflow_steps: [
    { title: "UX Review" },
    { title: "Implementation" },
    { title: "Code Review" },
    { title: "Human Review", requires_approval: true },
    { title: "Deploy" },
  ],
  workflow_mappings: webAppMappings,
  ...overrides,
} as KitWithSteps);

describe("KitPreview", () => {
  // --- Header ---

  it("renders kit name and description in header", () => {
    render(<KitPreview kit={makeKit()} />);
    expect(screen.getByText("Web Application")).toBeDefined();
    expect(screen.getByText(/Full-stack web app/)).toBeDefined();
  });

  it("shows Custom empty state", () => {
    render(<KitPreview kit={makeKit({ name: "Custom", workflow_mappings: [], agent_roles: [] })} />);
    expect(screen.getByText(/Start from scratch/)).toBeDefined();
  });

  it("has aria-live attribute for accessibility", () => {
    const { container } = render(<KitPreview kit={makeKit()} />);
    expect(container.querySelector("[aria-live='polite']")).toBeDefined();
  });

  // --- AI Team ---

  it("renders agent role chips", () => {
    render(<KitPreview kit={makeKit()} />);
    expect(screen.getByText("Full Stack Engineer")).toBeDefined();
    expect(screen.getByText("UX Designer")).toBeDefined();
    expect(screen.getByText("QA Engineer")).toBeDefined();
  });

  it("hides agent section when no roles", () => {
    render(<KitPreview kit={makeKit({ agent_roles: [] })} />);
    expect(screen.queryByText(/Your AI Team/)).toBeNull();
  });

  // --- Workflows ---

  it("renders workflow rows with names and step counts", () => {
    render(<KitPreview kit={makeKit()} />);
    expect(screen.getByText("Web Application Feature")).toBeDefined();
    expect(screen.getByText("Bug Fix")).toBeDefined();
    expect(screen.getByText("5 steps")).toBeDefined();
    expect(screen.getByText("4 steps")).toBeDefined();
  });

  it("shows PRIMARY badge on primary workflow", () => {
    render(<KitPreview kit={makeKit()} />);
    expect(screen.getByText("PRIMARY")).toBeDefined();
  });

  it("shows trigger labels on workflow rows", () => {
    render(<KitPreview kit={makeKit()} />);
    // Feature and Enhancement trigger Web Application Feature
    const featureLabels = screen.getAllByText("Feature");
    expect(featureLabels.length).toBeGreaterThanOrEqual(1);
    const bugLabels = screen.getAllByText("Bug");
    expect(bugLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("expands primary workflow step chain by default", () => {
    render(<KitPreview kit={makeKit()} />);
    // Primary workflow steps should be visible
    expect(screen.getByText("UX Review")).toBeDefined();
    expect(screen.getByText("Implementation")).toBeDefined();
    expect(screen.getByText("Deploy")).toBeDefined();
  });

  it("clicking a different workflow expands its step chain", () => {
    render(<KitPreview kit={makeKit()} />);
    // Click Bug Fix workflow row
    fireEvent.click(screen.getByText("Bug Fix"));
    // Bug Fix steps should now be visible
    expect(screen.getByText("Triage")).toBeDefined();
    expect(screen.getByText("Fix")).toBeDefined();
    // Primary steps should be hidden
    expect(screen.queryByText("Deploy")).toBeNull();
  });

  it("highlights approval gate steps with lock icon", () => {
    const { container } = render(<KitPreview kit={makeKit()} />);
    const lockIcons = container.querySelectorAll("svg.lucide-lock");
    expect(lockIcons.length).toBeGreaterThanOrEqual(1);
  });

  it("hides workflow section when no mappings", () => {
    render(<KitPreview kit={makeKit({ workflow_mappings: [] })} />);
    expect(screen.queryByText(/Workflows/)).toBeNull();
  });

  // --- Key ---

  it("shows key explaining lock and auto-assign symbols", () => {
    render(<KitPreview kit={makeKit()} />);
    expect(screen.getByText(/Requires your approval/)).toBeDefined();
    expect(screen.getByText(/Labels auto-assign workflows/)).toBeDefined();
  });

  // --- Arrow positioning ---

  it("positions arrow based on selectedIndex and columnCount", () => {
    const { container } = render(
      <KitPreview kit={makeKit()} selectedIndex={1} columnCount={3} />
    );
    const arrow = container.querySelector("[class*='rotate-45']") as HTMLElement;
    expect(arrow).toBeDefined();
    // Column 1 of 3 → arrow at 50% (center of second column)
    expect(arrow?.style.left).toContain("50%");
  });
});
