import { describe, it, expect } from "vitest";
import {
  MACHINE_DEFAULT_TERMINAL_MODEL,
  KNOWN_TERMINAL_MODEL_ALIASES,
  isKnownTerminalModelAlias,
  validateTerminalModelValue,
  resolveEffectiveTerminalModel,
  resolveTerminalModelSource,
  terminalLaunchModelLine,
  terminalDialogModelLine,
  capitalizeTerminalModelName,
} from "./model-resolution";

describe("isKnownTerminalModelAlias", () => {
  it("recognises all 4 known aliases", () => {
    for (const alias of KNOWN_TERMINAL_MODEL_ALIASES) {
      expect(isKnownTerminalModelAlias(alias)).toBe(true);
    }
  });

  it("rejects an unknown/custom value", () => {
    expect(isKnownTerminalModelAlias("claude-opus-5-20260101")).toBe(false);
    expect(isKnownTerminalModelAlias("Opus")).toBe(false); // case-sensitive — stored values are lowercase aliases
  });
});

describe("validateTerminalModelValue (AC-12)", () => {
  it("accepts known aliases and plausible custom ids", () => {
    expect(validateTerminalModelValue("opus")).toEqual({ ok: true });
    expect(validateTerminalModelValue("claude-opus-5-20260101")).toEqual({ ok: true });
    expect(validateTerminalModelValue("opus-5.5")).toEqual({ ok: true });
  });

  it("rejects an empty or whitespace-only value", () => {
    expect(validateTerminalModelValue("").ok).toBe(false);
    expect(validateTerminalModelValue("   ").ok).toBe(false);
  });

  it("rejects a value containing whitespace anywhere", () => {
    const result = validateTerminalModelValue("opus 5!");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/space/i);
  });

  it("rejects values containing shell metacharacters", () => {
    for (const bad of ["opus;rm", "opus$(x)", "opus`x`", "opus|x", "opus&x", "opus<x>", "opus\"x", "opus'x", "opus\\x"]) {
      const result = validateTerminalModelValue(bad);
      expect(result.ok, `expected "${bad}" to be rejected`).toBe(false);
    }
  });

  it("never rejects the machine-default sentinel itself (no spaces/metacharacters)", () => {
    expect(validateTerminalModelValue(MACHINE_DEFAULT_TERMINAL_MODEL)).toEqual({ ok: true });
  });

  it("rejects a value over the 100-char cap (QA Bug 1 — overflowed the deep link's 2048-char cap)", () => {
    const result = validateTerminalModelValue("a".repeat(101));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/100 characters/i);
  });

  it("boundary: exactly 100 chars passes, 101 fails", () => {
    expect(validateTerminalModelValue("a".repeat(100))).toEqual({ ok: true });
    expect(validateTerminalModelValue("a".repeat(101)).ok).toBe(false);
  });
});

describe("resolveEffectiveTerminalModel (AC-7 — every branch)", () => {
  it("user override set -> user override wins over the platform default", () => {
    expect(resolveEffectiveTerminalModel({ userValue: "sonnet", platformValue: "opus" })).toBe("sonnet");
  });

  it("user set to the machine-default sentinel -> omit, even when a platform default is set (AC-5 beats AC-1/3)", () => {
    expect(
      resolveEffectiveTerminalModel({ userValue: MACHINE_DEFAULT_TERMINAL_MODEL, platformValue: "opus" })
    ).toBeUndefined();
  });

  it("user unset (null), platform set -> platform default (AC-6)", () => {
    expect(resolveEffectiveTerminalModel({ userValue: null, platformValue: "opus" })).toBe("opus");
  });

  it("user unset (undefined), platform set -> platform default", () => {
    expect(resolveEffectiveTerminalModel({ userValue: undefined, platformValue: "opus" })).toBe("opus");
  });

  it("user unset, platform ALSO unset -> omit entirely, no seed (binding approval-gate note)", () => {
    expect(resolveEffectiveTerminalModel({ userValue: null, platformValue: null })).toBeUndefined();
    expect(resolveEffectiveTerminalModel({ userValue: undefined, platformValue: undefined })).toBeUndefined();
  });

  it("user override empty string is treated as unset, never spawns --model ''", () => {
    expect(resolveEffectiveTerminalModel({ userValue: "", platformValue: "opus" })).toBe("opus");
    expect(resolveEffectiveTerminalModel({ userValue: "", platformValue: null })).toBeUndefined();
  });
});

describe("resolveTerminalModelSource", () => {
  it("reports 'user' when the user's own override applies", () => {
    expect(resolveTerminalModelSource({ userValue: "sonnet", platformValue: "opus" })).toBe("user");
  });

  it("reports 'machine' for the machine-default sentinel", () => {
    expect(resolveTerminalModelSource({ userValue: MACHINE_DEFAULT_TERMINAL_MODEL, platformValue: "opus" })).toBe(
      "machine"
    );
  });

  it("reports 'platform' when the user has no override", () => {
    expect(resolveTerminalModelSource({ userValue: null, platformValue: "opus" })).toBe("platform");
    expect(resolveTerminalModelSource({ userValue: null, platformValue: null })).toBe("platform");
  });
});

describe("terminalLaunchModelLine (design §4.2/§4.3)", () => {
  it("names the model and source when a platform default applies", () => {
    expect(terminalLaunchModelLine("opus", "platform")).toBe("New sessions start on Opus · platform default.");
  });

  it("names the model and 'your setting' when a user override applies", () => {
    expect(terminalLaunchModelLine("sonnet", "user")).toBe("New sessions start on Sonnet · your setting.");
  });

  it("describes the machine-default case without naming a model", () => {
    expect(terminalLaunchModelLine(undefined, "machine")).toBe("New sessions use your machine's default model.");
  });

  it("returns null when nothing would be passed at all (both unset) — omit the line entirely", () => {
    expect(terminalLaunchModelLine(undefined, "platform")).toBeNull();
  });
});

describe("terminalDialogModelLine (design §4.3, Design Review note 2 — terser copy)", () => {
  it("uses the terser 'Starts on <Model> · <source>' format", () => {
    expect(terminalDialogModelLine("sonnet", "user")).toBe("Starts on Sonnet · your setting.");
    expect(terminalDialogModelLine("opus", "platform")).toBe("Starts on Opus · platform default.");
  });

  it("describes the machine-default case without naming a model", () => {
    expect(terminalDialogModelLine(undefined, "machine")).toBe("Starts on your machine's default model.");
  });

  it("returns null when nothing would be passed at all", () => {
    expect(terminalDialogModelLine(undefined, "platform")).toBeNull();
  });
});

describe("capitalizeTerminalModelName", () => {
  it("capitalises the first letter only", () => {
    expect(capitalizeTerminalModelName("sonnet")).toBe("Sonnet");
    expect(capitalizeTerminalModelName("claude-opus-5")).toBe("Claude-opus-5");
  });
});
