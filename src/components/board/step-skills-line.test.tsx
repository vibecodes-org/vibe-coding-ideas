import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepSkillsLine } from "./step-skills-line";

describe("StepSkillsLine", () => {
  it("says how many skills the step gets and names them", () => {
    render(<StepSkillsLine names={["checking-pages-in-a-browser"]} />);
    expect(screen.getByText("Gets 1 skill with this step:")).toBeTruthy();
    expect(screen.getByText("checking-pages-in-a-browser")).toBeTruthy();
  });
  it("pluralises", () => {
    render(<StepSkillsLine names={["a", "b"]} />);
    expect(screen.getByText("Gets 2 skills with this step:")).toBeTruthy();
  });
  it("shows a quiet 'No skills' for an agent without any", () => {
    render(<StepSkillsLine names={[]} />);
    expect(screen.getByText("No skills")).toBeTruthy();
  });
});
