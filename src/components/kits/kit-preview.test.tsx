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

  it("renders abbreviated agent role chips inline", () => {
    render(<KitPreview kit={makeKit()} />);
    expect(screen.getByText("Full Stack")).toBeDefined();
    expect(screen.getByText("UX")).toBeDefined();
    expect(screen.getByText("QA")).toBeDefined();
    expect(screen.getByText("Team")).toBeDefined();
  });

  it("hides agent section when no roles", () => {
    render(<KitPreview kit={makeKit({ agent_roles: [] })} />);
    expect(screen.queryByText("Team")).toBeNull();
  });

  // --- Workflows ---

  it("renders workflow tags with names and step counts", () => {
    render(<KitPreview kit={makeKit()} />);
    expect(screen.getByText("Web Application Feature")).toBeDefined();
    expect(screen.getByText("Bug Fix")).toBeDefined();
    expect(screen.getByText("(5)")).toBeDefined();
    expect(screen.getByText("(4)")).toBeDefined();
  });

  it("all workflows collapsed by default — no step chains visible", () => {
    render(<KitPreview kit={makeKit()} />);
    expect(screen.queryByText("UX Review")).toBeNull();
    expect(screen.queryByText("Triage")).toBeNull();
    // Trigger labels should not be visible either
    expect(screen.queryByText("Triggered by:")).toBeNull();
  });

  it("clicking a workflow tag expands its step chain and trigger labels", () => {
    render(<KitPreview kit={makeKit()} />);
    fireEvent.click(screen.getByText("Web Application Feature"));
    expect(screen.getByText("UX Review")).toBeDefined();
    expect(screen.getByText("Deploy")).toBeDefined();
    expect(screen.getByText("Triggered by:")).toBeDefined();
  });

  it("clicking an expanded workflow tag collapses it", () => {
    render(<KitPreview kit={makeKit()} />);
    fireEvent.click(screen.getByText("Web Application Feature"));
    expect(screen.getByText("UX Review")).toBeDefined();
    fireEvent.click(screen.getByText("Web Application Feature"));
    expect(screen.queryByText("UX Review")).toBeNull();
  });

  it("clicking a different workflow tag collapses the previous one", () => {
    render(<KitPreview kit={makeKit()} />);
    fireEvent.click(screen.getByText("Web Application Feature"));
    expect(screen.getByText("UX Review")).toBeDefined();
    fireEvent.click(screen.getByText("Bug Fix"));
    expect(screen.getByText("Triage")).toBeDefined();
    expect(screen.queryByText("Deploy")).toBeNull();
  });

  it("highlights approval gate steps with lock icon when expanded", () => {
    const { container } = render(<KitPreview kit={makeKit()} />);
    fireEvent.click(screen.getByText("Web Application Feature"));
    const lockIcons = container.querySelectorAll("svg.lucide-lock");
    // At least 1 in the step chain + 1 in the key
    expect(lockIcons.length).toBeGreaterThanOrEqual(2);
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
