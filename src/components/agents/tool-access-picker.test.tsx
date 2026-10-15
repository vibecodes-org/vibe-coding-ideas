import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolAccessPicker } from "./tool-access-picker";

describe("ToolAccessPicker", () => {
  it("offers exactly Full access and Read-only, with the chosen one selected", () => {
    render(<ToolAccessPicker value="full" onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(screen.getByRole("radio", { name: /Full access/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Read-only/ })).not.toBeChecked();
  });

  it("reports the new choice", () => {
    const onChange = vi.fn();
    render(<ToolAccessPicker value="full" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /Read-only/ }));
    expect(onChange).toHaveBeenCalledWith("read_only");
  });

  it("says how it is enforced", () => {
    render(<ToolAccessPicker value="read_only" onChange={() => {}} />);
    expect(screen.getByText(/In the browser terminal this is enforced/)).toBeInTheDocument();
  });
});
