import { describe, it, expect } from "vitest";
import { formatSkillSize } from "./format-skill-size";

describe("formatSkillSize", () => {
  it("shows one decimal place in KB", () => {
    expect(formatSkillSize(1156)).toBe("1.2 KB");
    expect(formatSkillSize(0)).toBe("0.0 KB");
    expect(formatSkillSize(12000)).toBe("12.0 KB");
  });
});
