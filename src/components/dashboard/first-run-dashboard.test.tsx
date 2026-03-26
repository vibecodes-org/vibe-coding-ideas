import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FirstRunDashboard, type FirstRunDashboardProps } from "./first-run-dashboard";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock dashboard-mode-switch
vi.mock("./dashboard-mode-switch", () => ({
  useSwitchToStandard: () => vi.fn(),
}));

// Mock agent-colors
vi.mock("@/lib/agent-colors", () => ({
  getRoleColor: () => ({ avatarBg: "bg-gray-500", avatarText: "text-white" }),
}));

const baseProps: FirstRunDashboardProps = {
  userName: "Test User",
  hasMcpConnection: false,
  ideasCount: 1,
  firstIdea: { id: "idea-1", title: "My Project" },
  activeBoards: [],
  maxBoardTaskCount: 0,
  workflowCount: 1,
  boardPreview: [],
  botProfiles: [],
  hasTaskInProgress: false,
  agentCount: 6,
  taskCount: 0,
};

describe("FirstRunDashboard", () => {
  it("shows 'Generate Board with AI' CTA when no tasks exist", () => {
    render(<FirstRunDashboard {...baseProps} />);

    expect(screen.getByText("No board tasks yet")).toBeInTheDocument();
    expect(screen.getByText("Generate Board with AI")).toBeInTheDocument();
  });

  it("links Generate Board CTA to the board page", () => {
    render(<FirstRunDashboard {...baseProps} />);

    const link = screen.getByText("Generate Board with AI").closest("a");
    expect(link).toHaveAttribute("href", "/ideas/idea-1/board");
  });

  it("shows board preview when tasks exist", () => {
    render(
      <FirstRunDashboard
        {...baseProps}
        maxBoardTaskCount={5}
        boardPreview={[
          { columnTitle: "Backlog", tasks: ["Task 1", "Task 2"], count: 3 },
        ]}
      />
    );

    expect(screen.queryByText("No board tasks yet")).not.toBeInTheDocument();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("Task 1")).toBeInTheDocument();
  });

  it("shows task count badge when maxBoardTaskCount > 0", () => {
    render(
      <FirstRunDashboard
        {...baseProps}
        maxBoardTaskCount={8}
        boardPreview={[
          { columnTitle: "To Do", tasks: ["Task 1"], count: 8 },
        ]}
      />
    );

    expect(screen.getByText("8 tasks")).toBeInTheDocument();
  });

  it("does not show task count badge when maxBoardTaskCount is 0", () => {
    render(<FirstRunDashboard {...baseProps} />);

    expect(screen.queryByText(/\d+ tasks/)).not.toBeInTheDocument();
  });

  it("shows agent and workflow badges regardless of task count", () => {
    render(<FirstRunDashboard {...baseProps} />);

    expect(screen.getByText("6 agents")).toBeInTheDocument();
    expect(screen.getByText("1 workflow")).toBeInTheDocument();
  });

  it("marks Board step as incomplete in progress bar when no tasks", () => {
    render(<FirstRunDashboard {...baseProps} />);

    // Progress should be 2/5 (Account + Idea done, Board not done)
    expect(screen.getByText("2 of 5 complete")).toBeInTheDocument();
  });

  it("marks Board step as complete when tasks exist", () => {
    render(
      <FirstRunDashboard
        {...baseProps}
        maxBoardTaskCount={5}
        boardPreview={[
          { columnTitle: "To Do", tasks: ["Task 1"], count: 5 },
        ]}
      />
    );

    // Progress should be 3/5 (Account + Idea + Board done)
    expect(screen.getByText("3 of 5 complete")).toBeInTheDocument();
  });
});
