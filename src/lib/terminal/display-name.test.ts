import { describe, it, expect } from "vitest";
import {
  DISPLAY_NAME_MAX_CODE_POINTS,
  codePointLength,
  clampToCodePoints,
  normalizeDisplayNameInput,
} from "./display-name";

describe("codePointLength", () => {
  it("counts plain ASCII the same as .length", () => {
    expect(codePointLength("Auth spike")).toBe(10);
  });

  it("counts an astral-plane emoji as ONE code point, unlike .length (which sees 2 UTF-16 units)", () => {
    expect("🚀".length).toBe(2);
    expect(codePointLength("🚀")).toBe(1);
  });

  it("counts a mixed emoji + text name correctly", () => {
    expect(codePointLength("🚀 Ship the launch page")).toBe(22);
  });
});

describe("clampToCodePoints", () => {
  it("leaves a value at or under the limit untouched", () => {
    expect(clampToCodePoints("Auth spike", 100)).toBe("Auth spike");
  });

  it("clamps a plain-ASCII value over the limit", () => {
    const value = "a".repeat(150);
    expect(clampToCodePoints(value, 100)).toBe("a".repeat(100));
  });

  it("never splits a surrogate pair — clamping by code point, not UTF-16 unit", () => {
    // 60 emoji = 120 UTF-16 units but only 60 code points; clamping to 50
    // code points must yield exactly 50 whole emoji, never a half-emoji.
    const value = "🚀".repeat(60);
    const clamped = clampToCodePoints(value, 50);
    expect(codePointLength(clamped)).toBe(50);
    expect(clamped).toBe("🚀".repeat(50));
  });

  it("defaults to DISPLAY_NAME_MAX_CODE_POINTS when no max is given", () => {
    const value = "a".repeat(150);
    expect(clampToCodePoints(value)).toBe("a".repeat(DISPLAY_NAME_MAX_CODE_POINTS));
  });
});

describe("normalizeDisplayNameInput", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeDisplayNameInput("  Auth spike  ")).toBe("Auth spike");
  });

  it("turns an empty string into null — the clear-back-to-auto-name signal", () => {
    expect(normalizeDisplayNameInput("")).toBeNull();
  });

  it("turns a whitespace-only string into null, never an empty string", () => {
    expect(normalizeDisplayNameInput("   \n\t  ")).toBeNull();
  });

  it("clamps an over-limit value to the code-point limit after trimming", () => {
    const value = `  ${"a".repeat(150)}  `;
    const result = normalizeDisplayNameInput(value);
    expect(result).toHaveLength(DISPLAY_NAME_MAX_CODE_POINTS);
    expect(result).toBe("a".repeat(DISPLAY_NAME_MAX_CODE_POINTS));
  });

  it("clamps emoji-heavy input by code points, not UTF-16 units", () => {
    const value = "🚀".repeat(120);
    const result = normalizeDisplayNameInput(value);
    expect(result).not.toBeNull();
    expect(codePointLength(result as string)).toBe(DISPLAY_NAME_MAX_CODE_POINTS);
  });
});
