import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { AgentInstructionsEditor } from "./agent-instructions-editor";

const LEGACY =
  "## Goal\nReview every change. Catch bugs early.\n\n## Expertise\n- Rank feedback by severity.\n\n" +
  "## Constraints\nNever approve unread diffs.\n\n## Approach\nRead the PR first.";
const NEW_LAYOUT = "You plan changes.\n\n## Your job\n1. Read the card.\n\n## What not to do\nDon't write code.";
const NEITHER = "First paragraph.\n\nSecond paragraph, no headings at all.";

describe("AgentInstructionsEditor", () => {
  it("opens an old-layout agent already converted: notice, boxes, amber leftover, and emits the new layout", () => {
    const onChange = vi.fn();
    render(<AgentInstructionsEditor value={LEGACY} onChange={onChange} role="Code Reviewer" />);

    expect(screen.getByRole("status")).toHaveTextContent("old layout");
    expect(screen.getByLabelText("What it does, in one line")).toHaveValue("Review every change.");
    expect(screen.getByLabelText("Its job")).toHaveValue("Catch bugs early.\n\nRead the PR first.");
    expect(screen.getByLabelText("What it must not do")).toHaveValue("Never approve unread diffs.");
    expect(screen.getByLabelText(/Notes from the old format/)).toHaveValue("- Rank feedback by severity.");
    expect(screen.getByText(/Not set yet/)).toBeInTheDocument();

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as string;
    expect(emitted).toContain("## Your job");
    expect(emitted).toContain("## What not to do");
    expect(emitted).toContain("## Notes from the old format\n- Rank feedback by severity.");
    expect(emitted).not.toContain("## Goal");
  });

  it("clearing the leftover box removes the notes from the saved text", () => {
    const onChange = vi.fn();
    render(<AgentInstructionsEditor value={LEGACY} onChange={onChange} role="Code Reviewer" />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).not.toContain("Notes from the old format");
    expect(screen.queryByLabelText(/Notes from the old format/)).not.toBeInTheDocument();
  });

  it("emits nothing on mount for a new-layout value, so opening never changes the agent", () => {
    const onChange = vi.fn();
    render(<AgentInstructionsEditor value={NEW_LAYOUT} onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Its job")).toHaveValue("1. Read the card.");
    expect(screen.getByLabelText("What it hands back")).toHaveValue("");
  });

  it("emits the regenerated text when a box is edited", () => {
    const onChange = vi.fn();
    render(<AgentInstructionsEditor value={NEW_LAYOUT} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("What it hands back"), { target: { value: "A plan." } });

    expect(onChange).toHaveBeenLastCalledWith(
      "You plan changes.\n\n## Your job\n1. Read the card.\n\n## What to hand back\nA plan.\n\n## What not to do\nDon't write code.",
    );
  });

  it("opens text that fits neither layout in 'Write it yourself', untouched", () => {
    const onChange = vi.fn();
    render(<AgentInstructionsEditor value={NEITHER} onChange={onChange} />);

    expect(screen.getByLabelText("Instructions text")).toHaveValue(NEITHER);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("switching to Guided keeps every character of unparseable text, all in 'Its job'", () => {
    function Harness() {
      const [value, setValue] = useState(NEITHER);
      return <AgentInstructionsEditor value={value} onChange={setValue} />;
    }
    render(<Harness />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Guided" }), { button: 0 });
    fireEvent.click(screen.getByRole("tab", { name: "Guided" }));

    expect(screen.getByLabelText("Its job")).toHaveValue(NEITHER);
    expect(screen.getByLabelText("What it does, in one line")).toHaveValue("");
  });

  it("opens an empty value in Guided with empty boxes and emits nothing", () => {
    const onChange = vi.fn();
    render(<AgentInstructionsEditor value="" onChange={onChange} />);

    expect(screen.getByLabelText("Its job")).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows no Goal, Expertise, Constraints or Approach labels", () => {
    render(<AgentInstructionsEditor value="" onChange={() => {}} />);
    for (const old of ["Goal", "Expertise", "Constraints", "Approach"]) {
      expect(screen.queryByText(old)).not.toBeInTheDocument();
    }
  });
});
