import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SkillRow } from "./skill-row";
import type { AgentSkill } from "@/types";

const skill = {
  id: "s1",
  bot_id: "b1",
  name: "checking-pages-in-a-browser",
  description: "How pages are opened and checked.",
  content: "Line one of the skill.\n\n- a list item",
  source_url: "https://github.com/example/repo/blob/main/SKILL.md",
  source_type: "github",
  category: null,
  created_at: "2026-10-14T10:00:00Z",
} as unknown as AgentSkill;

describe("SkillRow", () => {
  it("shows the full name, description, size and source link", () => {
    render(<SkillRow skill={skill} />);
    expect(screen.getByText("checking-pages-in-a-browser")).toBeTruthy();
    expect(screen.getByText("How pages are opened and checked.")).toBeTruthy();
    expect(screen.getByText("0.0 KB")).toBeTruthy();
    expect(screen.getByRole("link", { name: /From GitHub/ }).getAttribute("href")).toBe(skill.source_url);
  });

  it("reveals and hides the text read-only", () => {
    render(<SkillRow skill={skill} />);
    expect(screen.queryByTestId("skill-text")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show text/ }));
    expect(screen.getByTestId("skill-text").textContent).toContain("Line one of the skill.");
    fireEvent.click(screen.getByRole("button", { name: /Hide text/ }));
    expect(screen.queryByTestId("skill-text")).toBeNull();
  });

  it("offers remove only when given a handler", () => {
    const onRemove = vi.fn();
    const { rerender } = render(<SkillRow skill={skill} />);
    expect(screen.queryByLabelText(/Remove skill/)).toBeNull();
    rerender(<SkillRow skill={skill} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText(/Remove skill checking-pages-in-a-browser/));
    expect(onRemove).toHaveBeenCalled();
  });
});
