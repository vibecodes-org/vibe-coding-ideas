import { describe, it, expect } from "vitest";
import {
  AUTO_COMPACT_MAX,
  AUTO_COMPACT_MIN,
  AUTO_COMPACT_STEPS,
  BOARD_AGENT_AUTO_COMPACT_WINDOW,
  autoCompactDefaultAriaLabel,
  autoCompactDefaultSubLabel,
  autoCompactHelp,
  autoCompactShortLabel,
  isAutoCompactStep,
  isValidAutoCompactWindow,
  resolveTerminalAutoCompact,
} from "./auto-compact";

describe("isValidAutoCompactWindow", () => {
  it("accepts whole numbers from 100k to 1M inclusive", () => {
    for (const n of [AUTO_COMPACT_MIN, 150_000, 300_000, AUTO_COMPACT_MAX]) expect(isValidAutoCompactWindow(n)).toBe(true);
  });
  it("rejects out of range, fractions, strings and non-numbers", () => {
    for (const v of [0, -1, 99_999, 1_000_001, 300_000.5, "300000", "300k", null, undefined, NaN, Infinity, {}, []]) {
      expect(isValidAutoCompactWindow(v)).toBe(false);
    }
  });
});

describe("steps", () => {
  it("offers the approved steps per agent", () => {
    expect(AUTO_COMPACT_STEPS.claude).toEqual([200_000, 300_000, 400_000, 500_000, 1_000_000]);
    expect(AUTO_COMPACT_STEPS.codex).toEqual([100_000, 150_000, 200_000]);
  });
  it("accepts only that agent's steps", () => {
    expect(isAutoCompactStep("claude", 300_000)).toBe(true);
    expect(isAutoCompactStep("claude", 100_000)).toBe(false);
    expect(isAutoCompactStep("codex", 100_000)).toBe(true);
    expect(isAutoCompactStep("codex", 300_000)).toBe(false);
    expect(isAutoCompactStep("codex", "150000")).toBe(false);
  });
});

describe("resolveTerminalAutoCompact", () => {
  it("prefers the user's value", () => {
    expect(resolveTerminalAutoCompact({ userValue: 400_000, platformValue: 300_000 })).toEqual({ window: 400_000, source: "user" });
  });
  it("falls back to the site value", () => {
    expect(resolveTerminalAutoCompact({ userValue: null, platformValue: 300_000 })).toEqual({ window: 300_000, source: "platform" });
  });
  it("gives nothing when neither is set", () => {
    expect(resolveTerminalAutoCompact({})).toEqual({ window: undefined, source: "none" });
  });
  it("treats an invalid value on either side as unset, never mixing", () => {
    expect(resolveTerminalAutoCompact({ userValue: 5, platformValue: 300_000 })).toEqual({ window: 300_000, source: "platform" });
    expect(resolveTerminalAutoCompact({ userValue: 400_000, platformValue: "x" })).toEqual({ window: 400_000, source: "user" });
    expect(resolveTerminalAutoCompact({ userValue: "x", platformValue: 5 })).toEqual({ window: undefined, source: "none" });
  });
});

describe("labels", () => {
  it("shortens", () => {
    expect(autoCompactShortLabel(300_000)).toBe("300k");
    expect(autoCompactShortLabel(1_000_000)).toBe("1M");
    expect(autoCompactShortLabel(100_000)).toBe("100k");
  });
  it("default sub-label", () => {
    expect(autoCompactDefaultSubLabel("claude", undefined)).toBeNull();
    expect(autoCompactDefaultSubLabel("claude", 300_000)).toBe("site: 300k");
    expect(autoCompactDefaultSubLabel("claude", null)).toBe("Claude's own");
    expect(autoCompactDefaultSubLabel("codex", null)).toBe("Codex's own");
  });
  it("default aria label", () => {
    expect(autoCompactDefaultAriaLabel("claude", 300_000)).toBe("Default, site setting 300k");
    expect(autoCompactDefaultAriaLabel("claude", null)).toBe("Default, Claude Code decides");
    expect(autoCompactDefaultAriaLabel("codex", null)).toBe("Default, Codex decides");
  });
});

describe("autoCompactHelp (the six lines from the approved mock)", () => {
  it("claude, own choice", () => {
    expect(autoCompactHelp({ agent: "claude", userValue: 300_000, platformValue: null })).toBe(
      "New and resumed Claude Code sessions tidy up their memory when it reaches 300,000 tokens (your setting). Board agents tidy up at 400,000 tokens, or sooner if your memory limit is lower. Change it any time by typing /autocompact in the terminal."
    );
  });
  it("claude, site default", () => {
    expect(autoCompactHelp({ agent: "claude", userValue: null, platformValue: 300_000 })).toBe(
      "Uses the site default: new and resumed Claude Code sessions tidy up their memory when it reaches 300,000 tokens. Board agents tidy up at 400,000 tokens, or sooner if your memory limit is lower. Change it any time by typing /autocompact in the terminal."
    );
  });
  it("claude, nothing", () => {
    expect(autoCompactHelp({ agent: "claude", userValue: null, platformValue: null })).toBe(
      "Claude Code decides: the size you last saved with /autocompact, otherwise about 967,000 tokens. Applies to new and resumed sessions. Board agents tidy up at 400,000 tokens, or sooner if your memory limit is lower."
    );
  });
  it("codex, own choice", () => {
    expect(autoCompactHelp({ agent: "codex", userValue: 200_000, platformValue: null })).toBe(
      "New and resumed Codex sessions tidy up their memory when it reaches 200,000 tokens (your setting). Takes effect from your next launch or resume."
    );
  });
  it("codex, site default", () => {
    expect(autoCompactHelp({ agent: "codex", userValue: null, platformValue: 150_000 })).toBe(
      "Uses the site default: new and resumed Codex sessions tidy up their memory when it reaches 150,000 tokens. Takes effect from your next launch or resume."
    );
  });
  it("codex, nothing", () => {
    expect(autoCompactHelp({ agent: "codex", userValue: null, platformValue: null })).toBe(
      "Codex decides: about 245,000 tokens on today's Codex models. Applies to new and resumed sessions."
    );
  });
});

describe("BOARD_AGENT_AUTO_COMPACT_WINDOW (task 5e654dd1 stage 9)", () => {
  it("is 400k, inside the allowed range", () => {
    expect(BOARD_AGENT_AUTO_COMPACT_WINDOW).toBe(400_000);
    expect(isValidAutoCompactWindow(BOARD_AGENT_AUTO_COMPACT_WINDOW)).toBe(true);
  });
});
