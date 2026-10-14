import { describe, it, expect } from "vitest";
import {
  resolveTerminalClaudeEffort,
  claudeEffortForLaunch,
  claudeEffortDefaultSubLabel,
  claudeEffortDefaultAriaLabel,
  claudeEffortHelp,
} from "./claude-effort";

describe("resolveTerminalClaudeEffort", () => {
  it("user level wins over the site level", () => {
    expect(resolveTerminalClaudeEffort({ userValue: "xhigh", platformValue: "high" })).toEqual({ effort: "xhigh", source: "user" });
  });
  it("falls to the site level when the user is on Default", () => {
    for (const userValue of [null, undefined]) {
      expect(resolveTerminalClaudeEffort({ userValue, platformValue: "high" })).toEqual({ effort: "high", source: "platform" });
    }
  });
  it("is none when neither is set", () => {
    expect(resolveTerminalClaudeEffort({ userValue: null, platformValue: null })).toEqual({ effort: undefined, source: "none" });
    expect(resolveTerminalClaudeEffort({})).toEqual({ effort: undefined, source: "none" });
  });
  it("user High with no site level is High", () => {
    expect(resolveTerminalClaudeEffort({ userValue: "high", platformValue: null })).toEqual({ effort: "high", source: "user" });
  });
  it("treats invalid values as unset and never mixes", () => {
    expect(resolveTerminalClaudeEffort({ userValue: "ultracode", platformValue: "low" })).toEqual({ effort: "low", source: "platform" });
    expect(resolveTerminalClaudeEffort({ userValue: "high", platformValue: "minimal" })).toEqual({ effort: "high", source: "user" });
    expect(resolveTerminalClaudeEffort({ userValue: "minimal", platformValue: "foo" })).toEqual({ effort: undefined, source: "none" });
  });
  it("accepts max", () => {
    expect(resolveTerminalClaudeEffort({ userValue: "max" }).effort).toBe("max");
  });
});

describe("claudeEffortForLaunch", () => {
  it("passes a valid level for Claude (and unspecified agents)", () => {
    expect(claudeEffortForLaunch({ effort: "high", agent: "claude" })).toBe("high");
    expect(claudeEffortForLaunch({ effort: "max", agent: undefined })).toBe("max");
  });
  it("is undefined for Codex or invalid values", () => {
    expect(claudeEffortForLaunch({ effort: "high", agent: "codex" })).toBeUndefined();
    expect(claudeEffortForLaunch({ effort: "minimal", agent: "claude" })).toBeUndefined();
    expect(claudeEffortForLaunch({ effort: undefined, agent: "claude" })).toBeUndefined();
  });
});

describe("copy", () => {
  it("sub-label states the fallback, and is hidden while loading", () => {
    expect(claudeEffortDefaultSubLabel("high")).toBe("site: High");
    expect(claudeEffortDefaultSubLabel("xhigh")).toBe("site: X-High");
    expect(claudeEffortDefaultSubLabel(null)).toBe("Claude's own");
    expect(claudeEffortDefaultSubLabel(undefined)).toBeNull();
  });
  it("aria label", () => {
    expect(claudeEffortDefaultAriaLabel("high")).toBe("Default, site setting High");
    expect(claudeEffortDefaultAriaLabel(null)).toBe("Default, Claude Code decides");
  });
  it("help line matches the state", () => {
    expect(claudeEffortHelp({ userValue: "xhigh", platformValue: "high" })).toMatch(/start at X-High \(your setting\)/);
    expect(claudeEffortHelp({ userValue: null, platformValue: "high" })).toMatch(/^Uses the site default: .* start at High\./);
    expect(claudeEffortHelp({ userValue: null, platformValue: null })).toMatch(/^Claude Code decides:/);
  });
});
