import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VisibilitySelector } from "./visibility-selector";

describe("VisibilitySelector", () => {
  it("renders both Public and Private options with descriptions", () => {
    render(<VisibilitySelector value="public" onChange={() => {}} />);
    expect(screen.getByText("Public")).toBeDefined();
    expect(screen.getByText("Private")).toBeDefined();
    // Each option has a one-line description (not colour-only meaning)
    expect(
      screen.getByText(/Discoverable in the community feed/i)
    ).toBeDefined();
    expect(
      screen.getByText(/Only you and invited collaborators/i)
    ).toBeDefined();
  });

  it("uses a radiogroup with two radios for accessibility", () => {
    const { container } = render(
      <VisibilitySelector value="public" onChange={() => {}} />
    );
    expect(container.querySelector("[role='radiogroup']")).toBeTruthy();
    expect(container.querySelectorAll("[role='radio']")).toHaveLength(2);
  });

  it("marks the selected option with aria-checked", () => {
    const { container } = render(
      <VisibilitySelector value="private" onChange={() => {}} />
    );
    const checked = container.querySelector("[aria-checked='true']");
    expect(checked?.textContent).toContain("Private");
    // The non-selected radio is explicitly aria-checked=false
    expect(
      container.querySelectorAll("[aria-checked='false']")
    ).toHaveLength(1);
  });

  it("calls onChange when a different option is clicked", () => {
    const onChange = vi.fn();
    render(<VisibilitySelector value="public" onChange={onChange} />);
    fireEvent.click(screen.getByText("Private"));
    expect(onChange).toHaveBeenCalledWith("private");
  });

  it("only the selected radio is in the tab order (roving tabindex)", () => {
    const { container } = render(
      <VisibilitySelector value="public" onChange={() => {}} />
    );
    const radios = Array.from(
      container.querySelectorAll<HTMLButtonElement>("[role='radio']")
    );
    const tabbable = radios.filter((r) => r.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].textContent).toContain("Public");
  });

  it("ArrowRight moves selection to the next option via keyboard", () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisibilitySelector value="public" onChange={onChange} />
    );
    const group = container.querySelector("[role='radiogroup']")!;
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("private");
  });

  it("ArrowLeft wraps from the first option back to the last", () => {
    const onChange = vi.fn();
    const { container } = render(
      <VisibilitySelector value="public" onChange={onChange} />
    );
    const group = container.querySelector("[role='radiogroup']")!;
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("private");
  });

  it("scopes radio ids with the idPrefix to avoid collisions when used twice", () => {
    const { container } = render(
      <VisibilitySelector
        value="public"
        onChange={() => {}}
        idPrefix="onboarding-visibility"
      />
    );
    expect(container.querySelector("#onboarding-visibility-public")).toBeTruthy();
    expect(
      container.querySelector("#onboarding-visibility-private")
    ).toBeTruthy();
  });
});
