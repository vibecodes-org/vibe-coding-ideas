import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PromptBuilder } from "./prompt-builder";
import { generatePromptFromFields, parsePromptToFields } from "@/lib/prompt-builder";

// A structured prompt that parsePromptToFields can parse into builder mode
const STRUCTURED_PROMPT =
  "You are a Developer. Ship clean code\n\n" +
  "You must not: Skip tests\n\n" +
  "Your approach: Write tests first.";

describe("PromptBuilder", () => {
  it("does not call onChange on initial mount with a structured prompt", async () => {
    const onChange = vi.fn();

    render(
      <PromptBuilder
        role="Developer"
        value={STRUCTURED_PROMPT}
        onChange={onChange}
      />
    );

    // Wait a tick for useEffect to run
    await waitFor(() => {
      expect(screen.getByText("System Prompt")).toBeInTheDocument();
    });

    // onChange should NOT have been called — the initial mount should be skipped
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange when a builder field is edited after mount", async () => {
    const onChange = vi.fn();

    render(
      <PromptBuilder
        role="Developer"
        value={STRUCTURED_PROMPT}
        onChange={onChange}
      />
    );

    // Wait for initial mount to complete
    await waitFor(() => {
      expect(screen.getByText("System Prompt")).toBeInTheDocument();
    });

    // Edit the goal field
    const goalTextarea = screen.getByPlaceholderText("e.g. Ship clean, tested code");
    fireEvent.change(goalTextarea, { target: { value: "Build amazing features" } });

    // Now onChange SHOULD be called with the regenerated prompt
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall).toContain("Build amazing features");
  });

  it("starts in raw mode for non-structured prompts and does not call onChange", async () => {
    const onChange = vi.fn();
    const rawPrompt = "Just a plain text prompt with no structure.";

    render(
      <PromptBuilder
        role="Developer"
        value={rawPrompt}
        onChange={onChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("System Prompt")).toBeInTheDocument();
    });

    // In raw mode, the useEffect skips entirely (mode !== "builder")
    expect(onChange).not.toHaveBeenCalled();
  });
});
