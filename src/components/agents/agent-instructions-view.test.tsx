import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentInstructionsView, ReadOnlyBadge } from "./agent-instructions-view";

describe("AgentInstructionsView", () => {
  it("shows the four parts for a new-layout agent", () => {
    render(
      <AgentInstructionsView
        systemPrompt={"You plan.\n\n## Your job\nRead.\n\n## What to hand back\nA plan.\n\n## What not to do\nNo code."}
      />,
    );
    expect(screen.getByRole("heading", { name: /Instructions/ })).toBeInTheDocument();
    expect(screen.getByText(/In one line/)).toBeInTheDocument();
    expect(screen.getByText(/Its job/)).toBeInTheDocument();
    expect(screen.getByText(/Hands back/)).toBeInTheDocument();
    expect(screen.getByText(/Must not do/)).toBeInTheDocument();
    expect(screen.getByText("A plan.")).toBeInTheDocument();
  });

  it("labels any leftover old Expertise as such", () => {
    render(<AgentInstructionsView systemPrompt={"Line.\n\n## Your job\nWork.\n\n## Notes from the old format\n- old"} />);
    expect(screen.getByText(/Notes from the old format/)).toBeInTheDocument();
    expect(screen.getByText("- old")).toBeInTheDocument();
  });

  it("reads an old-layout agent that was never converted into the same parts", () => {
    render(<AgentInstructionsView systemPrompt={"## Goal\nShip it. Fast.\n\n## Constraints\nNo shortcuts."} />);
    expect(screen.queryByText(/Goal/)).not.toBeInTheDocument();
    expect(screen.getByText("No shortcuts.")).toBeInTheDocument();
  });

  it("keeps a plain block for text that fits neither layout", () => {
    const text = "Paragraph one.\n\nParagraph two.";
    const { container } = render(<AgentInstructionsView systemPrompt={text} />);
    expect(container.textContent).toContain("Paragraph two.");
    expect(screen.queryByText(/Its job/)).not.toBeInTheDocument();
  });

  it("renders nothing for an empty prompt", () => {
    const { container } = render(<AgentInstructionsView systemPrompt={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ReadOnlyBadge", () => {
  it("shows only for read-only agents", () => {
    const { rerender } = render(<ReadOnlyBadge toolAccess="read_only" />);
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    rerender(<ReadOnlyBadge toolAccess="full" />);
    expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
    rerender(<ReadOnlyBadge toolAccess={undefined} />);
    expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
  });
});
