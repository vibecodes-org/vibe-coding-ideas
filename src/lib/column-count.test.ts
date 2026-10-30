import { describe, expect, it } from "vitest";
import { formatColumnCount } from "./column-count";

describe("formatColumnCount", () => {
  it("shows just the total when no filter is on", () => {
    expect(formatColumnCount(40)).toBe("40");
  });

  it("shows matching out of total when a filter is on", () => {
    expect(formatColumnCount(40, 3)).toBe("3 of 40");
  });

  it("shows zero matches rather than falling back to the total", () => {
    expect(formatColumnCount(15, 0)).toBe("0 of 15");
  });

  it("shows all-match counts in the same shape", () => {
    expect(formatColumnCount(5, 5)).toBe("5 of 5");
  });
});
