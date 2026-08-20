// Coverage for the shared inline rename control (card 3bf262ac) — the pencil
// → editor contents-swap, Enter/Escape/blur behaviour, the clear-to-null
// case, the code-point counter/clamp, and the "no real change" no-op.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SessionRenameField } from "./terminal-session-rename";

afterEach(cleanup);

describe("SessionRenameField", () => {
  it("renders a pencil button at rest, with the resolved name as its accessible label", () => {
    render(<SessionRenameField resolvedName="Fix login redirect loop" onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Rename session: Fix login redirect loop" })).toBeInTheDocument();
  });

  it("opens the editor prefilled with the user's own name, selected", () => {
    render(<SessionRenameField resolvedName="Auth spike" userName="Auth spike" onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
    const input = screen.getByRole("textbox", { name: "Session name" }) as HTMLInputElement;
    expect(input.value).toBe("Auth spike");
  });

  it("opens the editor EMPTY (with the auto-name as placeholder) when there is no user name yet", () => {
    render(<SessionRenameField resolvedName="Vibe Coding Ideas · a3f9" userName={null} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
    const input = screen.getByRole("textbox", { name: "Session name" }) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Vibe Coding Ideas · a3f9");
  });

  it("Enter saves the trimmed value and closes the editor", () => {
    const onSave = vi.fn();
    render(<SessionRenameField resolvedName="Vibe Coding Ideas · a3f9" userName={null} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
    const input = screen.getByRole("textbox", { name: "Session name" });
    fireEvent.change(input, { target: { value: "  Stripe webhook spike  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("Stripe webhook spike");
    expect(screen.queryByRole("textbox", { name: "Session name" })).not.toBeInTheDocument();
  });

  it("the check button saves the same way as Enter", () => {
    const onSave = vi.fn();
    render(<SessionRenameField resolvedName="Vibe Coding Ideas · a3f9" userName={null} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(onSave).toHaveBeenCalledWith("Renamed");
  });

  it("blur saves — losing typed work on blur would be the worse failure", () => {
    const onSave = vi.fn();
    render(<SessionRenameField resolvedName="Vibe Coding Ideas · a3f9" userName={null} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
    const input = screen.getByRole("textbox", { name: "Session name" });
    fireEvent.change(input, { target: { value: "Renamed on blur" } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith("Renamed on blur");
  });

  it("Escape cancels — discards the draft, never calls onSave", () => {
    const onSave = vi.fn();
    render(<SessionRenameField resolvedName="Vibe Coding Ideas · a3f9" userName="Auth spike" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
    const input = screen.getByRole("textbox", { name: "Session name" });
    fireEvent.change(input, { target: { value: "something else entirely" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Session name" })).not.toBeInTheDocument();
    // Reopening shows the ORIGINAL user name, not the discarded draft.
    fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
    expect((screen.getByRole("textbox", { name: "Session name" }) as HTMLInputElement).value).toBe("Auth spike");
  });

  it("the cross button cancels the same way as Escape", () => {
    const onSave = vi.fn();
    render(<SessionRenameField resolvedName="Vibe Coding Ideas · a3f9" userName={null} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), { target: { value: "discard me" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clearing to blank and saving calls onSave with null — clears to the auto-name, never an empty string", () => {
    const onSave = vi.fn();
    render(<SessionRenameField resolvedName="Vibe Coding Ideas · a3f9" userName="Auth spike" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
    const input = screen.getByRole("textbox", { name: "Session name" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("a no-change save (same trimmed value) is a silent close — no onSave call", () => {
    const onSave = vi.fn();
    render(<SessionRenameField resolvedName="Auth spike" userName="Auth spike" onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
    const input = screen.getByRole("textbox", { name: "Session name" });
    fireEvent.change(input, { target: { value: "  Auth spike  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows a code-point counter once the draft reaches 80 characters, not before", () => {
    render(<SessionRenameField resolvedName="x" userName={null} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
    const input = screen.getByRole("textbox", { name: "Session name" });
    fireEvent.change(input, { target: { value: "a".repeat(79) } });
    expect(screen.queryByText(/\/100/)).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "a".repeat(80) } });
    expect(screen.getByText("80/100")).toBeInTheDocument();
  });

  it("clamps typed input to 100 CODE POINTS, not 100 UTF-16 units — emoji never desync client and server", () => {
    render(<SessionRenameField resolvedName="x" userName={null} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /rename session/i }));
    const input = screen.getByRole("textbox", { name: "Session name" }) as HTMLInputElement;
    // 150 rocket emoji: 300 UTF-16 units, 150 code points — must clamp to 100 code points (100 whole emoji).
    fireEvent.change(input, { target: { value: "🚀".repeat(150) } });
    expect([...input.value].length).toBe(100);
    expect(input.value).toBe("🚀".repeat(100));
  });
});
