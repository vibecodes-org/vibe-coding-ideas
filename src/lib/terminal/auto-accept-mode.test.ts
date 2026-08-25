import { describe, expect, it } from "vitest";
import {
  AUTO_PERMISSION_MODE,
  isValidPermissionModeValue,
  terminalLaunchAutoAcceptChip,
} from "./auto-accept-mode";

describe("isValidPermissionModeValue (task d3de150c)", () => {
  it("accepts only the exact literal 'auto'", () => {
    expect(isValidPermissionModeValue(AUTO_PERMISSION_MODE)).toBe(true);
    expect(isValidPermissionModeValue("auto")).toBe(true);
  });

  it("rejects the dangerous bypassPermissions mode — hard safety requirement", () => {
    expect(isValidPermissionModeValue("bypassPermissions")).toBe(false);
  });

  it("rejects every other real Claude Code permission mode", () => {
    for (const bad of ["plan", "default", "ask", "acceptAll"]) {
      expect(isValidPermissionModeValue(bad)).toBe(false);
    }
  });

  it("rejects case variants and whitespace", () => {
    expect(isValidPermissionModeValue("AcceptEdits")).toBe(false);
    expect(isValidPermissionModeValue("ACCEPTEDITS")).toBe(false);
    expect(isValidPermissionModeValue(" auto")).toBe(false);
    expect(isValidPermissionModeValue("auto ")).toBe(false);
    expect(isValidPermissionModeValue("accept edits")).toBe(false);
  });

  it("rejects non-string / empty / nullish values", () => {
    expect(isValidPermissionModeValue("")).toBe(false);
    expect(isValidPermissionModeValue(undefined)).toBe(false);
    expect(isValidPermissionModeValue(null)).toBe(false);
    expect(isValidPermissionModeValue(true)).toBe(false);
    expect(isValidPermissionModeValue(1)).toBe(false);
  });
});

describe("terminalLaunchAutoAcceptChip", () => {
  it("returns the chip text when on", () => {
    expect(terminalLaunchAutoAcceptChip(true)).toBe("⚡ auto mode on");
  });

  it("returns null when off — nothing renders, byte-identical to today", () => {
    expect(terminalLaunchAutoAcceptChip(false)).toBeNull();
  });
});
