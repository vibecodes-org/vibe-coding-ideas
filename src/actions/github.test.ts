/**
 * These tests cover the pure validation logic inside the server actions
 * by exercising the underlying helpers — full integration of the actions
 * (auth + supabase + fetch + encryption) is covered by E2E in QA step.
 */

import { describe, expect, it } from "vitest";
import { parseRepoUrl, toRepoName } from "@/lib/github";

describe("linkRepoToIdea — URL validation rules", () => {
  it("manual source rejects non-github URLs", () => {
    expect(parseRepoUrl("https://gitlab.com/foo/bar")).toBeNull();
  });

  it("manual source accepts a clean github URL", () => {
    expect(parseRepoUrl("https://github.com/nicholasmball/vibe-coding-ideas")).toBe(
      "https://github.com/nicholasmball/vibe-coding-ideas"
    );
  });

  it("manual source normalises trailing slash and .git", () => {
    expect(parseRepoUrl("https://github.com/foo/bar/")).toBe("https://github.com/foo/bar");
    expect(parseRepoUrl("https://github.com/foo/bar.git")).toBe("https://github.com/foo/bar");
  });
});

describe("createGithubRepo — name sanitisation", () => {
  it("rejects empty after sanitisation", () => {
    // toRepoName('!!!') returns '' — server action throws "Repository name is required"
    expect(toRepoName("!!!")).toBe("");
  });

  it("kebab-cases idea titles into valid repo names", () => {
    expect(toRepoName("Balla Bot — Home Assistant!")).toBe("balla-bot-home-assistant");
  });

  it("caps at GitHub's 100-char limit", () => {
    expect(toRepoName("x".repeat(120)).length).toBeLessThanOrEqual(100);
  });
});
