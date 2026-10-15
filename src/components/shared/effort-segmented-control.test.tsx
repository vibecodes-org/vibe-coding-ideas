import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EffortSegmentedControl } from "./effort-segmented-control";

afterEach(cleanup);

describe("EffortSegmentedControl", () => {
  it("has no Default segment unless defaultOption is given (existing callers unchanged)", () => {
    render(<EffortSegmentedControl agent="claude" value="high" disabled={false} onChange={() => {}} />);
    expect(screen.queryByText("Default")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Low", "Medium", "High", "X-High", "Max"]);
  });

  it("Codex ladder is unchanged", () => {
    render(<EffortSegmentedControl agent="codex" value="medium" disabled={false} onChange={() => {}} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Minimal", "Low", "Medium", "High", "X-High"]);
  });

  it("renders a leading Default segment, pressed for null, with its sub-label and aria name", () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();
    render(
      <EffortSegmentedControl
        agent="claude"
        value={null}
        disabled={false}
        onChange={onChange}
        defaultOption={{ subLabel: "site: High", ariaLabel: "Default, site setting High", onSelect }}
      />
    );
    const def = screen.getByRole("button", { name: "Default, site setting High" });
    expect(def).toHaveAttribute("aria-pressed", "true");
    expect(def).toHaveTextContent("site: High");
    expect(screen.getAllByRole("button")[0]).toBe(def);
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(onChange).toHaveBeenCalledWith("max");
    fireEvent.click(def);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("Default is not pressed when a level is chosen, and hides a null sub-label", () => {
    render(
      <EffortSegmentedControl
        agent="claude"
        value="low"
        disabled={false}
        onChange={() => {}}
        defaultOption={{ subLabel: null, onSelect: () => {} }}
      />
    );
    expect(screen.getByRole("button", { name: "Default" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Low" })).toHaveAttribute("aria-pressed", "true");
  });
});
