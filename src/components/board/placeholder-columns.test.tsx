import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { PlaceholderColumns } from "./placeholder-columns";
import { DEFAULT_BOARD_COLUMNS } from "@/lib/board-defaults";

afterEach(cleanup);

describe("PlaceholderColumns", () => {
  it("renders one column per default board column", () => {
    render(<PlaceholderColumns />);
    for (const col of DEFAULT_BOARD_COLUMNS) {
      // Each column header text appears verbatim
      expect(screen.getAllByText(col.title).length).toBeGreaterThan(0);
    }
    // Sanity: 6 columns total — { hidden: true } looks past the aria-hidden wrapper
    const headings = screen.getAllByRole("heading", { level: 3, hidden: true });
    expect(headings).toHaveLength(DEFAULT_BOARD_COLUMNS.length);
  });

  it("renders the (0) zero-task count for every column", () => {
    render(<PlaceholderColumns />);
    const zeros = screen.getAllByText("(0)");
    expect(zeros).toHaveLength(DEFAULT_BOARD_COLUMNS.length);
  });

  it("renders the soft 'Tasks will appear here' hint inside every column", () => {
    render(<PlaceholderColumns />);
    const hints = screen.getAllByText("Tasks will appear here");
    expect(hints).toHaveLength(DEFAULT_BOARD_COLUMNS.length);
  });

  it("decorates only the Done column with the green check icon", () => {
    const { container } = render(<PlaceholderColumns />);
    // The done indicator is the only emerald-coloured icon in the headers
    const checks = container.querySelectorAll(".text-emerald-500");
    expect(checks).toHaveLength(1);
    // And it lives inside the Done column header
    const doneHeader = screen.getByText("Done").closest("h3");
    expect(doneHeader).not.toBeNull();
    expect(within(doneHeader as HTMLElement).getByText("Done")).toBeDefined();
  });

  it("renders no buttons at all (placeholders are read-only — no Add Task, no menu, no drag handle)", () => {
    const { container } = render(<PlaceholderColumns />);
    // Query the DOM directly because aria-hidden masks role queries
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("is marked aria-hidden so screen readers skip it (orientation aid only)", () => {
    render(<PlaceholderColumns />);
    const wrapper = screen.getByTestId("placeholder-columns");
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
  });
});
