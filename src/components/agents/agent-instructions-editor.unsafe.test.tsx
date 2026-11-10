import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/agent-instructions", async (orig) => ({
  ...(await orig<typeof import("@/lib/agent-instructions")>()),
  verifyConversion: vi.fn(() => ({ ok: false, reason: "1 word(s) lost in conversion" })),
}));

import { AgentInstructionsEditor } from "./agent-instructions-editor";

const LEGACY = "## Goal\nReview every change.\n\n## Constraints\nNever approve unread diffs.";

// Card 5d8274fe, fix 3: an old-layout agent that fails the "nothing lost"
// checks opens in "Write it yourself", untouched.
describe("AgentInstructionsEditor with an old layout that fails the checks", () => {
  it("opens in Write it yourself and emits nothing", () => {
    const onChange = vi.fn();
    render(<AgentInstructionsEditor value={LEGACY} onChange={onChange} role="Code Reviewer" />);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Write it yourself" })).toHaveAttribute("aria-selected", "true");
  });
});
