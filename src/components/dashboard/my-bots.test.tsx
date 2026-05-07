import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ children, href, onClick, ...rest }: { children: React.ReactNode; href: string; onClick?: (e: React.MouseEvent) => void }) => (
    <a href={href} onClick={onClick} {...rest}>{children}</a>
  ),
}));

vi.mock("@/components/dashboard/bot-activity-dialog", () => ({
  BotActivityDialog: () => null,
}));

import { MyBots } from "./my-bots";
import type { DashboardBot } from "@/types";
import type { AgentStatus } from "@/lib/agent-status";

const baseBot = (overrides: Partial<DashboardBot> = {}): DashboardBot => ({
  id: "bot-1",
  owner_user_id: "user-1",
  name: "Atlas",
  role: "Full Stack Engineer",
  is_active: true,
  is_bot: true,
  is_admin: false,
  is_super_admin: false,
  full_name: "Atlas",
  avatar_url: null,
  bio: null,
  default_system_prompt: null,
  active_bot_id: null,
  default_board_columns: null,
  onboarding_completed_at: null,
  is_default_template: false,
  source_template_id: null,
  visibility: "private",
  github_handle: null,
  twitter_handle: null,
  website_url: null,
  agent_skills: null,
  custom_capabilities: null,
  email: null,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  bot_role: null,
  currentTask: null,
  lastActivity: null,
  isActiveMcpBot: false,
  currentStatus: { type: "none" },
  ...overrides,
});

const stepBase = {
  stepId: "step-1",
  stepTitle: "UX Design",
  taskId: "task-1",
  taskTitle: "My Agents panel redesign",
  ideaId: "idea-1",
  ideaTitle: "VibeCodes",
  fraction: { completed: 2, total: 6 },
} as const;

describe("MyBots — workflow-aware status line", () => {
  it("renders 'No current task' for status none", () => {
    render(<MyBots bots={[baseBot({ currentStatus: { type: "none" } })]} />);
    expect(screen.getByText("No current task")).toBeInTheDocument();
  });

  it("renders the assigned-task fallback row", () => {
    const status: AgentStatus = {
      type: "assigned",
      taskId: "task-fallback",
      taskTitle: "Migrate staging Supabase project",
      ideaId: "idea-1",
      ideaTitle: "VibeCodes",
      columnTitle: "In Progress",
    };
    render(<MyBots bots={[baseBot({ currentStatus: status })]} />);
    expect(screen.getByText("Migrate staging Supabase project")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/ideas/idea-1/board?taskId=task-fallback");
  });

  it("renders 'Active' pill with step + task and deep-link including stepId", () => {
    const status: AgentStatus = { type: "active", ...stepBase, startedAt: "2026-05-07T11:55:00Z" };
    render(<MyBots bots={[baseBot({ currentStatus: status })]} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("2/6")).toBeInTheDocument();
    expect(screen.getByText("UX Design")).toBeInTheDocument();
    expect(screen.getByText("My Agents panel redesign")).toBeInTheDocument();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/ideas/idea-1/board?taskId=task-1&stepId=step-1");
  });

  it("renders 'Needs approval' for awaiting_approval", () => {
    const status: AgentStatus = { type: "approval", ...stepBase, submittedAt: "2026-05-07T10:00:00Z" };
    render(<MyBots bots={[baseBot({ currentStatus: status })]} />);
    expect(screen.getByText("Needs approval")).toBeInTheDocument();
    expect(screen.getByText("UX Design")).toBeInTheDocument();
  });

  it("renders 'Failed' pill for failed status", () => {
    const status: AgentStatus = { type: "failed", ...stepBase, failedAt: "2026-05-07T11:00:00Z" };
    render(<MyBots bots={[baseBot({ currentStatus: status })]} />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders 'Stale · Xh' pill with hour count", () => {
    const status: AgentStatus = { type: "stale", ...stepBase, startedAt: "2026-05-07T07:00:00Z", ageHours: 5 };
    render(<MyBots bots={[baseBot({ currentStatus: status })]} />);
    expect(screen.getByText(/Stale · 5h/)).toBeInTheDocument();
  });

  it("renders 'Up next' pill for pending claim", () => {
    const status: AgentStatus = { type: "pending", ...stepBase };
    render(<MyBots bots={[baseBot({ currentStatus: status })]} />);
    expect(screen.getByText("Up next")).toBeInTheDocument();
  });

  it("preserves the MCP Active badge alongside workflow status", () => {
    const status: AgentStatus = { type: "active", ...stepBase, startedAt: "2026-05-07T11:55:00Z" };
    render(
      <MyBots
        bots={[baseBot({ currentStatus: status, isActiveMcpBot: true })]}
      />
    );
    expect(screen.getByText("MCP Active")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders the empty-state CTA when there are no bots at all", () => {
    render(<MyBots bots={[]} />);
    expect(screen.getByText(/Create your first agent/i)).toBeInTheDocument();
  });
});
