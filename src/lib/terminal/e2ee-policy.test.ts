import { describe, it, expect } from "vitest";
import { decideE2eePolicy, isE2eeRequired } from "./e2ee-policy";

describe("decideE2eePolicy", () => {
  it("is active when both legs are capable, required or not", () => {
    expect(decideE2eePolicy({ required: false, browserHasKey: true, bridgeE2ee: true })).toBe("active");
    expect(decideE2eePolicy({ required: true, browserHasKey: true, bridgeE2ee: true })).toBe("active");
  });

  it("Phase A (not required): missing capability degrades to plaintext, never fails closed", () => {
    expect(decideE2eePolicy({ required: false, browserHasKey: false, bridgeE2ee: false })).toBe("plaintext");
    expect(decideE2eePolicy({ required: false, browserHasKey: true, bridgeE2ee: false })).toBe("plaintext");
    expect(decideE2eePolicy({ required: false, browserHasKey: false, bridgeE2ee: true })).toBe("plaintext");
  });

  it("Phase B (required): missing capability fails closed instead of silently downgrading", () => {
    expect(decideE2eePolicy({ required: true, browserHasKey: false, bridgeE2ee: false })).toBe("fail-closed");
    expect(decideE2eePolicy({ required: true, browserHasKey: true, bridgeE2ee: false })).toBe("fail-closed");
    expect(decideE2eePolicy({ required: true, browserHasKey: false, bridgeE2ee: true })).toBe("fail-closed");
  });
});

describe("isE2eeRequired", () => {
  it("is true only for the exact literal '1'", () => {
    expect(isE2eeRequired("1")).toBe(true);
  });

  it("defaults OFF for undefined, blank, whitespace-only, or any other value (blank-env hazard)", () => {
    expect(isE2eeRequired(undefined)).toBe(false);
    expect(isE2eeRequired("")).toBe(false);
    expect(isE2eeRequired("   ")).toBe(false);
    expect(isE2eeRequired("true")).toBe(false);
    expect(isE2eeRequired("0")).toBe(false);
    expect(isE2eeRequired("  1  ")).toBe(true); // trimmed, still the literal 1
  });
});
