import { describe, it, expect } from "vitest";
import { skillLineLabel, stepSkillsLead } from "./skill-line";

describe("skillLineLabel", () => {
  it("is null with no skills", () => {
    expect(skillLineLabel([])).toBeNull();
  });
  it("says '1 skill:' for one", () => {
    expect(skillLineLabel(["checking-pages-in-a-browser"])).toEqual({
      lead: "1 skill:",
      names: "checking-pages-in-a-browser",
    });
  });
  it("lists several", () => {
    expect(skillLineLabel(["a", "b", "c"])).toEqual({ lead: "3 skills:", names: "a, b, c" });
  });
});

describe("stepSkillsLead", () => {
  it("pluralises", () => {
    expect(stepSkillsLead(1)).toBe("Gets 1 skill with this step:");
    expect(stepSkillsLead(2)).toBe("Gets 2 skills with this step:");
  });
});
