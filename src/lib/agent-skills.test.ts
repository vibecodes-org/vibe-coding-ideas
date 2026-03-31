import { describe, it, expect } from "vitest";
import { getDefaultSkillsForRole } from "./agent-skills";

describe("getDefaultSkillsForRole", () => {
  it("returns skills for known roles (case-insensitive)", () => {
    expect(getDefaultSkillsForRole("Full Stack Engineer")).toEqual([
      "TypeScript", "React", "Next.js", "Node.js", "PostgreSQL",
    ]);
    expect(getDefaultSkillsForRole("full stack engineer")).toEqual([
      "TypeScript", "React", "Next.js", "Node.js", "PostgreSQL",
    ]);
    expect(getDefaultSkillsForRole("UX Designer")).toEqual([
      "Wireframing", "Accessibility (WCAG 2.1)", "Responsive Design", "User Flows",
    ]);
  });

  it("returns empty array for unknown roles", () => {
    expect(getDefaultSkillsForRole("Underwater Basket Weaver")).toEqual([]);
    expect(getDefaultSkillsForRole("")).toEqual([]);
  });

  it("returns empty array for null", () => {
    expect(getDefaultSkillsForRole(null)).toEqual([]);
  });

  it("trims whitespace before matching", () => {
    expect(getDefaultSkillsForRole("  QA Engineer  ")).toEqual([
      "E2E Testing", "Cross-browser", "Accessibility Audit", "Performance Budget",
    ]);
  });

  it("covers all common agent roles", () => {
    const commonRoles = [
      "Full Stack Engineer", "Front End Engineer", "Backend Engineer",
      "UX Designer", "QA Engineer", "DevOps Engineer", "Developer",
      "Product Owner", "Business Analyst", "Code Reviewer",
      "Security Engineer", "Mobile Developer", "Data Engineer",
    ];
    for (const role of commonRoles) {
      const skills = getDefaultSkillsForRole(role);
      expect(skills.length).toBeGreaterThan(0);
    }
  });
});
