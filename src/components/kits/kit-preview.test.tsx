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

function expandPreview() {
  const toggleBtn = screen.getByText("Show details").closest("button")!;
  fireEvent.click(toggleBtn);
}

describe("KitPreview", () => {
  it("returns null for Custom kit", () => {
    const { container } = render(
      <KitPreview kit={makeKit({ name: "Custom" })} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("has aria-live attribute for accessibility", () => {
    const { container } = render(<KitPreview kit={makeKit()} />);
    expect(container.querySelector("[aria-live='polite']")).toBeDefined();
  });

  // --- Summary bar (collapsed) ---

  it("summary bar shows workflow and trigger counts with mappings", () => {
    render(<KitPreview kit={makeKit()} />);
    expect(screen.getByText(/2 workflows/)).toBeDefined();
    expect(screen.getByText(/3 triggers/)).toBeDefined();
  });

  it("summary bar shows old counts when no mappings", () => {
    render(<KitPreview kit={makeKit({ workflow_mappings: [] })} />);
    expect(screen.getByText(/5-step workflow/)).toBeDefined();
    expect(screen.getByText(/1 trigger/)).toBeDefined();
  });

  // --- Compact mode ---

  it("renders compact mode with workflow and trigger counts when mappings exist", () => {
    render(<KitPreview kit={makeKit()} compact />);
    expect(screen.getByText(/3 agents/)).toBeDefined();
    expect(screen.getByText(/2 workflows/)).toBeDefined();
    expect(screen.getByText(/3 labels/)).toBeDefined();
    expect(screen.getByText(/3 triggers/)).toBeDefined();
  });

  it("renders compact mode with old counts when no mappings", () => {
    render(
      <KitPreview kit={makeKit({ workflow_mappings: [] })} compact />
    );
    expect(screen.getByText(/3 agents/)).toBeDefined();
    expect(screen.getByText(/5-step workflow/)).toBeDefined();
    expect(screen.getByText(/3 labels/)).toBeDefined();
    expect(screen.getByText(/1 trigger/)).toBeDefined();
  });

  it("compact mode does not show individual role names", () => {
    render(<KitPreview kit={makeKit()} compact />);
    expect(screen.queryByText("Full Stack Engineer")).toBeNull();
  });

  // --- Expanded mode with mappings ---

  it("renders tabbed workflow templates when expanded with mappings", () => {
    render(<KitPreview kit={makeKit()} />);
    expandPreview();
    // Tab buttons for unique templates
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(2); // Web Application Feature + Bug Fix
  });

  it("shows primary template steps by default when expanded", () => {
    render(<KitPreview kit={makeKit()} />);
    expandPreview();
    expect(screen.getByText(/1\. UX Review/)).toBeDefined();
    expect(screen.getByText(/2\. Implementation/)).toBeDefined();
  });

  it("switches template steps when clicking a different tab", () => {
    render(<KitPreview kit={makeKit()} />);
    expandPreview();
    // Click "Bug Fix" tab
    const bugFixTab = screen.getByRole("tab", { name: /Bug Fix/ });
    fireEvent.click(bugFixTab);
    expect(screen.getByText(/1\. Triage/)).toBeDefined();
    expect(screen.getByText(/2\. Fix/)).toBeDefined();
  });

  it("shows 'Triggered by' labels under active tab", () => {
    render(<KitPreview kit={makeKit()} />);
    expandPreview();
    expect(screen.getByText("Triggered by:")).toBeDefined();
  });

  it("shows workflow trigger summary count when expanded with mappings", () => {
    render(<KitPreview kit={makeKit()} />);
    expandPreview();
    expect(screen.getByText(/3 of 3 labels have workflow triggers/)).toBeDefined();
  });

  it("renders agent roles when expanded", () => {
    render(<KitPreview kit={makeKit()} />);
    expandPreview();
    expect(screen.getByText("Full Stack Engineer")).toBeDefined();
    expect(screen.getByText("UX Designer")).toBeDefined();
    expect(screen.getByText("QA Engineer")).toBeDefined();
  });

  it("renders label presets when expanded", () => {
    render(<KitPreview kit={makeKit()} />);
    expandPreview();
    // Bug appears in both labels section and as a tab trigger label
    expect(screen.getAllByText("Bug").length).toBeGreaterThanOrEqual(1);
  });

  // --- Expanded mode without mappings (fallback) ---

  it("falls back to single step chain when no mappings", () => {
    render(<KitPreview kit={makeKit({ workflow_mappings: [] })} />);
    expandPreview();
    expect(screen.getByText(/Workflow Template \(5 steps\)/)).toBeDefined();
    expect(screen.getByText(/1\. UX Review/)).toBeDefined();
  });

  it("shows old-style trigger when no mappings", () => {
    render(<KitPreview kit={makeKit({ workflow_mappings: [] })} />);
    expandPreview();
    expect(screen.getByText(/Workflow Trigger/)).toBeDefined();
    expect(screen.getByText(/Web Application workflow/)).toBeDefined();
  });

  // --- Edge cases ---

  it("hides agent section when no roles", () => {
    render(<KitPreview kit={makeKit({ agent_roles: [] })} />);
    expandPreview();
    expect(screen.queryByText(/Agent Team/)).toBeNull();
  });

  it("hides workflow section when no steps and no mappings", () => {
    render(<KitPreview kit={makeKit({ workflow_steps: [], workflow_mappings: [] })} />);
    expandPreview();
    expect(screen.queryByText(/Workflow Template/)).toBeNull();
  });

  it("hides label section when no presets", () => {
    render(<KitPreview kit={makeKit({ label_presets: [] })} />);
    expandPreview();
    expect(screen.queryByText(/Board Labels/)).toBeNull();
  });

  it("highlights approval gate steps with lock icon when expanded", () => {
    const { container } = render(<KitPreview kit={makeKit()} />);
    expandPreview();
    const lockIcons = container.querySelectorAll("svg.lucide-lock");
    expect(lockIcons.length).toBeGreaterThanOrEqual(1);
  });
});
