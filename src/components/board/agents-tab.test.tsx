import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { cappedSupabase } from "@/test/capped-supabase";
import type { IdeaAgentWithDetails } from "@/types";

const BOT = "bot-1";
const rows = {
  // 1,045 assigned cards and 2,163 workflow steps for one agent: past the 1,000-row cap
  board_tasks: Array.from({ length: 1045 }, (_, i) => ({ id: `t${i}`, idea_id: "idea-1", assignee_id: BOT })),
  task_workflow_steps: Array.from({ length: 2163 }, (_, i) => ({
    id: `s${i}`,
    idea_id: "idea-1",
    bot_id: BOT,
    status: i < 1500 ? "completed" : "pending",
  })),
  workflow_templates: [],
};
const { client } = cappedSupabase(rows);

vi.mock("@/lib/supabase/client", () => ({ createClient: () => client }));
vi.mock("@/actions/idea-agents", () => ({
  allocateAllAgents: vi.fn(),
  removeIdeaAgent: vi.fn(),
  getRoleCoverage: vi.fn().mockResolvedValue([]),
  setManualRoleMatch: vi.fn(),
  clearManualRoleMatch: vi.fn(),
}));

import { AgentsTab } from "./agents-tab";

describe("AgentsTab stats on a board past 1,000 rows", () => {
  it("counts every assigned card and every workflow step, not the first 1,000", async () => {
    const agent = {
      id: "ia-1",
      bot_id: BOT,
      added_by: "u1",
      bot: { id: BOT, name: "Atlas", role: "Engineer", avatar_url: null, owner: { id: "u1", full_name: "Nick" } },
    } as unknown as IdeaAgentWithDetails;

    render(
      <AgentsTab
        ideaId="idea-1"
        ideaAgentDetails={[agent]}
        userBotProfiles={[]}
        currentUserId="u1"
        isAuthor
        isTeamMember
        isReadOnly={false}
      />
    );

    expect(await screen.findByText("1045")).toBeInTheDocument(); // tasks
    expect(screen.getByText("1500")).toBeInTheDocument(); // done
    expect(screen.getByText("663")).toBeInTheDocument(); // pending
  });
});

describe("AgentsTab explainer note", () => {
  const agent = {
    id: "ia-1",
    bot_id: BOT,
    added_by: "u1",
    bot: { id: BOT, name: "Atlas", role: "Engineer", avatar_url: null, owner: { id: "u1", full_name: "Nick" } },
  } as unknown as IdeaAgentWithDetails;
  const props = {
    ideaId: "idea-1",
    userBotProfiles: [],
    currentUserId: "u1",
    isAuthor: true,
    isTeamMember: true,
    isReadOnly: false,
  };

  it("shows the note when the board has agents", async () => {
    localStorage.clear();
    render(<AgentsTab {...props} ideaAgentDetails={[agent]} />);
    expect(await screen.findByText("matched automatically")).toBeInTheDocument();
  });

  it("does not show the note in the empty state", async () => {
    localStorage.clear();
    render(<AgentsTab {...props} ideaAgentDetails={[]} />);
    await Promise.resolve();
    expect(screen.queryByText("matched automatically")).not.toBeInTheDocument();
  });
});
