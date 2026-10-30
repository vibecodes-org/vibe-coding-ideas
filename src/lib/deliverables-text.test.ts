import { describe, it, expect } from "vitest";
import { parseDeliverablesText, formatDeliverablesText } from "./deliverables-text";

describe("parseDeliverablesText", () => {
  it("matches the old comma-only behaviour", () => {
    const text = " Design doc, API schema ,, Tests ";
    const old = text.split(",").map((d) => d.trim()).filter(Boolean);
    expect(parseDeliverablesText(text)).toEqual(old);
  });
  it("splits on line breaks too", () => {
    expect(parseDeliverablesText("A\nB, C\r\nD")).toEqual(["A", "B", "C", "D"]);
  });
  it("drops blanks", () => {
    expect(parseDeliverablesText("\n , \n")).toEqual([]);
  });
});

describe("formatDeliverablesText", () => {
  it("joins with comma and space", () => {
    expect(formatDeliverablesText(["A", "B"])).toBe("A, B");
    expect(formatDeliverablesText(undefined)).toBe("");
  });
  it("round trips", () => {
    expect(parseDeliverablesText(formatDeliverablesText(["A", "B C"]))).toEqual(["A", "B C"]);
  });
});
