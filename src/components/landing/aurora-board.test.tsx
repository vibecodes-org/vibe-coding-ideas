import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AuroraBoard } from "./aurora-board";

function headings(container: HTMLElement) {
  return Array.from(container.querySelectorAll("h4")).map((h) => h.textContent?.trim());
}

describe("AuroraBoard counts", () => {
  it("shows the real counts it is given", () => {
    const { container } = render(
      <AuroraBoard counts={{ todo: 12, inProgress: 3, verify: 7, done: 172 }} />
    );
    expect(headings(container)).toEqual(["To Do 12", "In Progress 3", "Verify 7", "Done 172"]);
  });

  it("shows no column counts when the live read failed", () => {
    const { container } = render(<AuroraBoard counts={null} />);
    expect(headings(container)).toEqual(["To Do", "In Progress", "Verify", "Done"]);
  });

  it("shows the board buttons and both terminal sessions", () => {
    const { container } = render(<AuroraBoard counts={null} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Launch Claude Code");
    expect(text).toContain("AI Generate Tasks");
    expect(text).toContain("2 running");
    expect(text).toContain("Terminal sessions survive the laptop sleeping");
    expect(text).toContain("Next-card bar");
    expect(text).toContain("Codex");
  });
});
