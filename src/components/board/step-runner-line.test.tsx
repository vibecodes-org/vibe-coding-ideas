import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepRunnerLine } from "./step-runner-line";

const planner = { botId: "b1", name: "Planner", role: "Planner" };

describe("StepRunnerLine", () => {
  it("names the agent, links to its page and lists its skills", () => {
    render(<StepRunnerLine runner={planner} skillNames={["checking-pages-in-a-browser"]} coverageKnown />);
    expect(screen.getByText("Runs here:")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Planner" }).getAttribute("href")).toBe("/agents/b1");
    expect(screen.getByText("checking-pages-in-a-browser")).toBeTruthy();
  });

  it("says 'no skills' for an agent without any", () => {
    render(<StepRunnerLine runner={{ botId: "b2", name: "Atlas", role: "Full Stack Engineer" }} skillNames={[]} coverageKnown />);
    expect(screen.getByText("no skills")).toBeTruthy();
  });

  it("shows no skills part at all while the skills are not known yet", () => {
    render(<StepRunnerLine runner={planner} coverageKnown />);
    expect(screen.getByRole("link", { name: "Planner" })).toBeTruthy();
    expect(screen.queryByText("no skills")).toBeNull();
  });

  it("warns when no agent matches the role", () => {
    render(<StepRunnerLine runner={null} coverageKnown />);
    expect(screen.getByText("No agent on this board yet")).toBeTruthy();
  });

  it("renders nothing when coverage isn't known", () => {
    const { container } = render(<StepRunnerLine runner={null} coverageKnown={false} />);
    expect(container.innerHTML).toBe("");
  });
});
