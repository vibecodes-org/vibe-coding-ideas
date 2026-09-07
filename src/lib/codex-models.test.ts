import { describe, it, expect } from "vitest";
import {
  KNOWN_CODEX_MODELS,
  isKnownCodexModel,
  validateCodexModelValue,
  validateReasoningEffort,
  REASONING_EFFORT_LEVELS,
} from "./codex-models";

describe("isKnownCodexModel", () => {
  it("recognises the seeded catalogue entries", () => {
    for (const m of KNOWN_CODEX_MODELS) {
      expect(isKnownCodexModel(m.value)).toBe(true);
    }
  });

  it("returns false for an unknown model — advisory only, never blocks", () => {
    expect(isKnownCodexModel("some-future-model")).toBe(false);
  });
});

describe("validateCodexModelValue", () => {
  it("accepts a realistic model id", () => {
    expect(validateCodexModelValue("gpt-5.1-codex")).toEqual({ ok: true });
  });

  it("accepts a novel/unknown model id — free text always valid (FR-1)", () => {
    expect(validateCodexModelValue("some-brand-new-model-2099")).toEqual({ ok: true });
  });

  it("rejects an empty/whitespace-only value", () => {
    expect(validateCodexModelValue("")).toEqual({ ok: false, reason: expect.any(String) });
    expect(validateCodexModelValue("   ")).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects a value over the length cap", () => {
    expect(validateCodexModelValue("a".repeat(101)).ok).toBe(false);
  });

  it("accepts a value right at the length cap", () => {
    expect(validateCodexModelValue("a".repeat(100)).ok).toBe(true);
  });

  it("rejects whitespace inside the value", () => {
    expect(validateCodexModelValue("gpt 5").ok).toBe(false);
  });

  it("rejects shell metacharacters", () => {
    for (const bad of ["gpt-5;rm -rf", "gpt-5`echo`", "gpt-5$(whoami)", "gpt-5|cat", "gpt-5&"]) {
      expect(validateCodexModelValue(bad).ok).toBe(false);
    }
  });
});

describe("validateReasoningEffort", () => {
  it("accepts every level in the ladder", () => {
    for (const level of REASONING_EFFORT_LEVELS) {
      expect(validateReasoningEffort(level)).toEqual({ ok: true });
    }
  });

  it("rejects a value outside the ladder", () => {
    expect(validateReasoningEffort("minimal").ok).toBe(false);
    expect(validateReasoningEffort("extreme").ok).toBe(false);
    expect(validateReasoningEffort("").ok).toBe(false);
  });
});
