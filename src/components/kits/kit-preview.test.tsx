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

  it("renders kit name in header", () => {
    render(<KitPreview kit={makeKit()} />);
    expect(screen.getByText("Web Application")).toBeDefined();
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

  it("renders all 7 Game kit roles with their mapped short labels", () => {
    render(
      <KitPreview
        kit={makeKit({
          agent_roles: [
            { role: "Producer / Scope Guard", name_suggestion: "Anchor" },
            { role: "Gameplay Programmer", name_suggestion: "Tempo" },
            { role: "Enemy AI Engineer", name_suggestion: "Prowl" },
            { role: "Level / Environment Designer", name_suggestion: "Vista" },
            { role: "Technical Artist", name_suggestion: "Prism" },
            { role: "Audio Designer", name_suggestion: "Echo" },
            { role: "QA / Playtester", name_suggestion: "Sentinel" },
          ],
        })}
      />
    );
    expect(screen.getByText("Producer")).toBeDefined();
    expect(screen.getByText("Gameplay")).toBeDefined();
    expect(screen.getByText("Enemy AI")).toBeDefined();
    expect(screen.getByText("Levels")).toBeDefined();
    expect(screen.getByText("Tech Art")).toBeDefined();
    expect(screen.getByText("Audio")).toBeDefined();
    expect(screen.getByText("Playtest")).toBeDefined();
    // Full role strings should not leak through — they were mapped, not fallen back
    expect(screen.queryByText("Level / Environment Designer")).toBeNull();
  });

  it("wraps the team row and lays out a 7-role / 10-label Game kit", () => {
    const gameMappings: WorkflowMapping[] = [
      { label_name: "Gameplay", template_name: "Game Feature / Mechanic", template_step_count: 6, template_steps: [{ title: "Mechanic brief" }], is_primary: true },
      { label_name: "Enemy AI", template_name: "Enemy AI Behaviour", template_step_count: 6, template_steps: [{ title: "Mechanic brief" }], is_primary: false },
      { label_name: "UI/HUD", template_name: "Game Feature / Mechanic", template_step_count: 6, template_steps: [{ title: "Mechanic brief" }], is_primary: false },
      { label_name: "Level/Content", template_name: "Level / Content", template_step_count: 6, template_steps: [{ title: "Content brief" }], is_primary: false },
      { label_name: "Art/Assets", template_name: "Level / Content", template_step_count: 6, template_steps: [{ title: "Content brief" }], is_primary: false },
      { label_name: "Audio", template_name: "Level / Content", template_step_count: 6, template_steps: [{ title: "Content brief" }], is_primary: false },
      { label_name: "Bug", template_name: "Game Bug Fix", template_step_count: 4, template_steps: [{ title: "Reproduce" }], is_primary: false },
      { label_name: "Performance", template_name: "Game Bug Fix", template_step_count: 4, template_steps: [{ title: "Reproduce" }], is_primary: false },
      { label_name: "Milestone", template_name: "Milestone Gate", template_step_count: 4, template_steps: [{ title: "Build checklist" }], is_primary: false },
      { label_name: "Spike", template_name: "Game Technical Spike", template_step_count: 3, template_steps: [{ title: "Question" }], is_primary: false },
    ];
    const { container } = render(
      <KitPreview
        kit={makeKit({
          name: "Game",
          icon: "🎮",
          agent_roles: [
            { role: "Producer / Scope Guard", name_suggestion: "Anchor" },
            { role: "Gameplay Programmer", name_suggestion: "Tempo" },
            { role: "Enemy AI Engineer", name_suggestion: "Prowl" },
            { role: "Level / Environment Designer", name_suggestion: "Vista" },
            { role: "Technical Artist", name_suggestion: "Prism" },
            { role: "Audio Designer", name_suggestion: "Echo" },
            { role: "QA / Playtester", name_suggestion: "Sentinel" },
          ],
          label_presets: [
            { name: "Gameplay", color: "violet" },
            { name: "Enemy AI", color: "rose" },
            { name: "UI/HUD", color: "blue" },
            { name: "Level/Content", color: "emerald" },
            { name: "Art/Assets", color: "pink" },
            { name: "Audio", color: "cyan" },
            { name: "Bug", color: "red" },
            { name: "Performance", color: "amber" },
            { name: "Milestone", color: "orange" },
            { name: "Spike", color: "lime" },
          ],
          workflow_mappings: gameMappings,
        })}
      />
    );
    // Team row must wrap for 7 chips to fit at narrow widths
    const teamRow = screen.getByText("Team").closest("div");
    expect(teamRow?.className).toContain("flex-wrap");
    // Primary (Gameplay -> Game Feature / Mechanic) sorts first; all 5 distinct templates render
    expect(screen.getByText("Game Feature / Mechanic")).toBeDefined();
    expect(screen.getByText("Enemy AI Behaviour")).toBeDefined();
    expect(screen.getByText("Level / Content")).toBeDefined();
    expect(screen.getByText("Game Bug Fix")).toBeDefined();
    expect(screen.getByText("Game Technical Spike")).toBeDefined();
    expect(container).toBeDefined();
  });

  it("renders the Copywriter / Content role with its mapped short label", () => {
    render(
      <KitPreview
        kit={makeKit({
          agent_roles: [{ role: "Copywriter / Content", name_suggestion: "Quill" }],
        })}
      />
    );
    // ROLE_META entry maps "Copywriter / Content" -> short "Copy"
    expect(screen.getByText("Copy")).toBeDefined();
    // Falls back to the full role string only when unmapped — confirm it does NOT here
    expect(screen.queryByText("Copywriter / Content")).toBeNull();
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

  // --- No connector arrow (Option D: promote & recede) ---

  it("renders no connector arrow (it mispointed at the wrong row)", () => {
    const { container } = render(<KitPreview kit={makeKit()} />);
    expect(container.querySelector("[class*='rotate-45']")).toBeNull();
  });

  it("echoes the selected kit's name in the header, without repeating the description", () => {
    const kit = makeKit();
    render(<KitPreview kit={kit} />);
    // The name ties the panel to the chosen card; the description is already on
    // the card you just picked, so it's intentionally not repeated here.
    expect(screen.getByText(kit.name)).toBeDefined();
    expect(screen.queryByText(kit.description!)).toBeNull();
  });
});
