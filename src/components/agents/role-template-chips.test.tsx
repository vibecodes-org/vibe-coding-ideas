import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RoleTemplateChips } from "./role-template-chips";
import { ROLE_TEMPLATE_CHIPS } from "@/lib/constants";

describe("RoleTemplateChips", () => {
  it("shows one chip per template and no More… button when nothing sits under More", () => {
    render(<RoleTemplateChips selected={null} onSelect={() => {}} />);
    for (const chip of ROLE_TEMPLATE_CHIPS) {
      expect(screen.getByRole("button", { name: new RegExp(chip.role) })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button")).toHaveLength(ROLE_TEMPLATE_CHIPS.length);
    expect(screen.queryByText("More…")).not.toBeInTheDocument();
  });

  it("calls onSelect with the chip's role", () => {
    const onSelect = vi.fn();
    render(<RoleTemplateChips selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Code Reviewer/ }));
    expect(onSelect).toHaveBeenCalledWith("Code Reviewer");
  });
});
