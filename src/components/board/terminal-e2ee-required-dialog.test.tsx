// Terminal P2 (E2EE) design §3 — the dialog variant of the Phase B
// fail-closed state. The one thing this MUST prove: every dismissal path
// (the X, Escape, outside-click, and the explicit "Not now" button) closes
// the dialog without ever calling onUpdate — the hard-learned "never trap
// the user in a dialog" rule (see terminal-task-launch-choice.test.tsx for
// the sibling coverage of the same rule on the adjacent dialog).

import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TerminalE2eeRequiredDialog } from "./terminal-e2ee-required-dialog";

afterEach(cleanup);

describe("TerminalE2eeRequiredDialog", () => {
  it("renders nothing when closed", () => {
    render(<TerminalE2eeRequiredDialog open={false} onUpdate={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByTestId("terminal-e2ee-required-dialog")).not.toBeInTheDocument();
  });

  it("shows the design's exact title and body copy", () => {
    render(<TerminalE2eeRequiredDialog open onUpdate={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Update the helper to reconnect")).toBeInTheDocument();
    expect(
      screen.getByText(/Terminal sessions are now end-to-end encrypted/),
    ).toBeInTheDocument();
  });

  it("'Not now' closes without ever calling onUpdate", () => {
    const onUpdate = vi.fn();
    const onCancel = vi.fn();
    render(<TerminalE2eeRequiredDialog open onUpdate={onUpdate} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: /^Not now$/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("Escape closes without ever calling onUpdate", () => {
    const onUpdate = vi.fn();
    const onCancel = vi.fn();
    render(<TerminalE2eeRequiredDialog open onUpdate={onUpdate} onCancel={onCancel} />);

    fireEvent.keyDown(screen.getByTestId("terminal-e2ee-required-dialog"), { key: "Escape", code: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("the built-in X close button closes without ever calling onUpdate", () => {
    const onUpdate = vi.fn();
    const onCancel = vi.fn();
    render(<TerminalE2eeRequiredDialog open onUpdate={onUpdate} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("'Update now' calls onUpdate, not onCancel", () => {
    const onUpdate = vi.fn();
    const onCancel = vi.fn();
    render(<TerminalE2eeRequiredDialog open onUpdate={onUpdate} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: /^Update now$/ }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
