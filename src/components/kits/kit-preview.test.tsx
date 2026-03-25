import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KitPreview } from "./kit-preview";
import type { KitWithSteps } from "@/actions/kits";

const makeKit = (overrides = {}): KitWithSteps => ({
  id: "kit-1",
  name: "Web Application",
  icon: "🌐",
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
  ...overrides,
} as KitWithSteps);

describe("KitPreview", () => {
  it("renders agent roles with emoji icons", () => {
    render(<KitPreview kit={makeKit()} />);
    expect(screen.getByText("Full Stack Engineer")).toBeDefined();
    expect(screen.getByText("UX Designer")).toBeDefined();
    expect(screen.getByText("QA Engineer")).toBeDefined();
    // Check for emoji icons
    expect(screen.getByText("🔨")).toBeDefined();
    expect(screen.getByText("🎨")).toBeDefined();
    expect(screen.getByText("🔍")).toBeDefined();
  });

  it("renders workflow template steps with arrows", () => {
    render(<KitPreview kit={makeKit()} />);
    expect(screen.getByText(/1\. UX Review/)).toBeDefined();
    expect(screen.getByText(/2\. Implementation/)).toBeDefined();
    expect(screen.getByText(/4\. Human Review/)).toBeDefined();
    expect(screen.getByText(/5\. Deploy/)).toBeDefined();
  });

  it("renders label presets with correct names", () => {
    render(<KitPreview kit={makeKit()} />);
    expect(screen.getByText("Bug")).toBeDefined();
    // "Feature" appears in both labels and workflow trigger
    expect(screen.getAllByText("Feature").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Enhancement")).toBeDefined();
  });

  it("renders workflow trigger explanation", () => {
    render(<KitPreview kit={makeKit()} />);
    expect(screen.getByText(/workflow trigger/i)).toBeDefined();
    expect(screen.getByText(/Web Application workflow/)).toBeDefined();
  });

  it("returns null for Custom kit", () => {
    const { container } = render(
      <KitPreview kit={makeKit({ name: "Custom" })} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders compact mode with summary counts including workflow steps", () => {
    render(<KitPreview kit={makeKit()} compact />);
    expect(screen.getByText(/3 agents/)).toBeDefined();
    expect(screen.getByText(/5-step workflow/)).toBeDefined();
    expect(screen.getByText(/3 labels/)).toBeDefined();
    expect(screen.getByText(/1 workflow trigger/)).toBeDefined();
  });

  it("compact mode does not show individual role names", () => {
    render(<KitPreview kit={makeKit()} compact />);
    expect(screen.queryByText("Full Stack Engineer")).toBeNull();
  });

  it("hides agent section when no roles", () => {
    render(
      <KitPreview kit={makeKit({ agent_roles: [] })} />
    );
    expect(screen.queryByText(/Agent Team/)).toBeNull();
  });

  it("hides workflow section when no steps", () => {
    render(
      <KitPreview kit={makeKit({ workflow_steps: [] })} />
    );
    expect(screen.queryByText(/Workflow Template/)).toBeNull();
  });

  it("hides label section when no presets", () => {
    render(
      <KitPreview kit={makeKit({ label_presets: [] })} />
    );
    expect(screen.queryByText(/Board Labels/)).toBeNull();
  });

  it("hides workflow trigger section when no auto_rule_label", () => {
    render(
      <KitPreview kit={makeKit({ auto_rule_label: null })} />
    );
    expect(screen.queryByText(/Workflow Trigger/)).toBeNull();
  });

  it("has aria-live attribute for accessibility", () => {
    const { container } = render(<KitPreview kit={makeKit()} />);
    expect(container.querySelector("[aria-live='polite']")).toBeDefined();
  });

  it("highlights approval gate steps with lock icon", () => {
    const { container } = render(<KitPreview kit={makeKit()} />);
    // The approval step should have a Lock icon (rendered as SVG)
    const lockIcons = container.querySelectorAll("svg.lucide-lock");
    expect(lockIcons.length).toBe(1);
  });
});
