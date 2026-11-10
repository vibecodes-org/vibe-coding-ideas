import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelperAgentsPicker } from "./helper-agents-picker";

describe("HelperAgentsPicker", () => {
  it("shows both options with the chosen one selected", () => {
    render(<HelperAgentsPicker value="blocked" onChange={() => {}} />);
    expect(screen.getByText("Helper agents")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Can start helpers/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Works alone/ })).toBeChecked();
  });

  it("reports a change", () => {
    const onChange = vi.fn();
    render(<HelperAgentsPicker value="allowed" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /Works alone/ }));
    expect(onChange).toHaveBeenCalledWith("blocked");
  });

  it("says how it is enforced", () => {
    render(<HelperAgentsPicker value="allowed" onChange={() => {}} />);
    expect(screen.getByText(/In Claude Code this is enforced/)).toBeInTheDocument();
  });
});
