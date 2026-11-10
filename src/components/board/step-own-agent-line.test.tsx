import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import { StepOwnAgentLine } from "./step-detail-dialog";
import type { TaskWorkflowStep } from "@/types";

const step = (over: Partial<TaskWorkflowStep>) =>
  ({ ran_in_own_agent: null, attested_agent_type: null, executed_model: "sonnet", ...over }) as TaskWorkflowStep;

describe("StepOwnAgentLine (approved mock, card 24936814)", () => {
  it("shows nothing for steps finished before the feature", () => {
    const { container } = render(<StepOwnAgentLine step={step({})} agentName="Sentinel" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("confirmed: green, names the agent, says Claude Code reported it", () => {
    const { container } = render(<StepOwnAgentLine step={step({ ran_in_own_agent: "confirmed" })} agentName="Sentinel" />);
    expect(screen.getByLabelText("Own agent: confirmed, ran as Sentinel")).toBeInTheDocument();
    expect(screen.getByText("Reported by Claude Code, not by the agent.")).toBeInTheDocument();
    expect(container.firstElementChild!.className).toContain("border-emerald-500/30");
  });

  it("other_agent: amber, a general helper vs another board agent", () => {
    const a = render(
      <StepOwnAgentLine step={step({ ran_in_own_agent: "other_agent", attested_agent_type: "general-purpose" })} agentName="Sentinel" />,
    );
    expect(screen.getByText("· ran in a general helper, not Sentinel")).toBeInTheDocument();
    expect(a.container.firstElementChild!.className).toContain("border-amber-500/30");
    a.unmount();
    render(
      <StepOwnAgentLine step={step({ ran_in_own_agent: "other_agent", attested_agent_type: "vc-lens-87e09eb1" })} agentName="Sentinel" />,
    );
    expect(screen.getByText("· ran in another board agent, not Sentinel")).toBeInTheDocument();
  });

  it("not_confirmed: amber with the main-session wording", () => {
    const { container } = render(<StepOwnAgentLine step={step({ ran_in_own_agent: "not_confirmed" })} agentName="Sentinel" />);
    expect(screen.getByText("Own agent: not confirmed")).toBeInTheDocument();
    expect(screen.getByText("· may have been done in the main session")).toBeInTheDocument();
    expect(container.firstElementChild!.className).toContain("border-amber-500/30");
  });

  it("cant_confirm on Codex: grey dashed with the Codex tag, never amber", () => {
    const { container } = render(
      <StepOwnAgentLine step={step({ ran_in_own_agent: "cant_confirm", executed_model: "gpt-5.5" })} agentName="Sentinel" />,
    );
    expect(screen.getByText("Own agent: can't confirm")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(container.firstElementChild!.className).toContain("border-dashed");
    expect(container.firstElementChild!.className).not.toContain("amber");
  });

  it("cant_confirm on Claude (no board agent named): no Codex tag", () => {
    render(<StepOwnAgentLine step={step({ ran_in_own_agent: "cant_confirm" })} agentName={null} />);
    expect(screen.queryByText("Codex")).toBeNull();
    expect(screen.getByText(/wasn't sent to its own board agent/)).toBeInTheDocument();
  });
});
