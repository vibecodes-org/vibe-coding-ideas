import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const row = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: row.current, error: null });
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: () => {} };
  return { createClient: () => ({ from: () => chain, channel: () => channel }) };
});
vi.mock("@/actions/workflow-suggestions", () => ({
  keepWorkflowSuggestion: vi.fn(),
  replaceWorkflowSuggestion: vi.fn(),
  removeWorkflowSuggestion: vi.fn(),
}));
vi.mock("@/actions/workflow-templates", () => ({
  listWorkflowTemplates: vi.fn(() =>
    Promise.resolve([{ id: "t1", name: "Bug Fix", steps: [] }]),
  ),
}));

import { WorkflowSuggestionPanel } from "./workflow-suggestion-panel";

function suggestion(source: string) {
  return {
    id: "s1",
    task_id: "task",
    idea_id: "idea",
    suggested_template_id: "t1",
    recommended_template_id: null,
    source,
    reason: "Fits a bug.",
    adjudication_started_at: null,
    status: "suggested",
  };
}

describe("WorkflowSuggestionPanel", () => {
  it("shows the agent wording for an agent suggestion with no label", async () => {
    row.current = suggestion("agent");
    render(<WorkflowSuggestionPanel taskId="task" ideaId="idea" />);
    expect(await screen.findByText("An agent suggested a workflow")).toBeTruthy();
    expect(screen.getByText("Agent")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Bug Fix")).toBeTruthy());
    expect(screen.getByText(/This card has no workflow/)).toBeTruthy();
    expect(screen.getByText(/the next agent works on it without one/)).toBeTruthy();
    expect(screen.queryByText(/Your label suggests/)).toBeNull();
  });

  it("keeps the label wording for a rules suggestion", async () => {
    row.current = suggestion("heuristic");
    render(<WorkflowSuggestionPanel taskId="task" ideaId="idea" />);
    expect(await screen.findByText("Suggested workflow looks mismatched")).toBeTruthy();
    expect(screen.getByText("Rules")).toBeTruthy();
    expect(screen.queryByText("An agent suggested a workflow")).toBeNull();
  });
});
