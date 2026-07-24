import { describe, it, expect } from "vitest";
import {
  MINIMUM_RECOMMENDED_HELPER_VERSION,
  parseHelperVersion,
  compareHelperVersions,
  shouldShowHelperUpdateNudge,
} from "./helper-version";

describe("parseHelperVersion", () => {
  it("parses a strict x.y.z version", () => {
    expect(parseHelperVersion("0.2.0")).toEqual([0, 2, 0]);
    expect(parseHelperVersion("12.34.56")).toEqual([12, 34, 56]);
  });

  it("trims surrounding whitespace", () => {
    expect(parseHelperVersion("  0.2.0  ")).toEqual([0, 2, 0]);
  });

  it("returns null for missing / empty input", () => {
    expect(parseHelperVersion(null)).toBeNull();
    expect(parseHelperVersion(undefined)).toBeNull();
    expect(parseHelperVersion("")).toBeNull();
  });

  it("returns null for malformed versions", () => {
    expect(parseHelperVersion("0.2")).toBeNull();
    expect(parseHelperVersion("0.2.0.1")).toBeNull();
    expect(parseHelperVersion("v0.2.0")).toBeNull();
    expect(parseHelperVersion("0.2.0-beta")).toBeNull();
    expect(parseHelperVersion("not-a-version")).toBeNull();
    expect(parseHelperVersion("0.2.x")).toBeNull();
  });
});

describe("compareHelperVersions", () => {
  it("is negative when a < b", () => {
    expect(compareHelperVersions([0, 1, 0], [0, 2, 0])).toBeLessThan(0);
    expect(compareHelperVersions([0, 2, 0], [1, 0, 0])).toBeLessThan(0);
    expect(compareHelperVersions([0, 2, 0], [0, 2, 1])).toBeLessThan(0);
  });

  it("is zero when equal", () => {
    expect(compareHelperVersions([0, 2, 0], [0, 2, 0])).toBe(0);
  });

  it("is positive when a > b", () => {
    expect(compareHelperVersions([0, 2, 1], [0, 2, 0])).toBeGreaterThan(0);
    expect(compareHelperVersions([1, 0, 0], [0, 9, 9])).toBeGreaterThan(0);
  });
});

describe("shouldShowHelperUpdateNudge", () => {
  const min = "0.2.0";

  it("nudges when the version is missing (every pre-2a helper)", () => {
    expect(shouldShowHelperUpdateNudge(null, min)).toBe(true);
    expect(shouldShowHelperUpdateNudge(undefined, min)).toBe(true);
    expect(shouldShowHelperUpdateNudge("", min)).toBe(true);
  });

  it("nudges when the version is malformed", () => {
    expect(shouldShowHelperUpdateNudge("not-a-version", min)).toBe(true);
    expect(shouldShowHelperUpdateNudge("0.2", min)).toBe(true);
    expect(shouldShowHelperUpdateNudge("v0.2.0", min)).toBe(true);
  });

  it("nudges when the version is older than the minimum", () => {
    expect(shouldShowHelperUpdateNudge("0.1.0", min)).toBe(true);
    expect(shouldShowHelperUpdateNudge("0.1.99", min)).toBe(true);
  });

  it("does not nudge when the version equals the minimum", () => {
    expect(shouldShowHelperUpdateNudge("0.2.0", min)).toBe(false);
  });

  it("does not nudge when the version is newer than the minimum", () => {
    expect(shouldShowHelperUpdateNudge("0.2.1", min)).toBe(false);
    expect(shouldShowHelperUpdateNudge("1.0.0", min)).toBe(false);
  });

  it("uses MINIMUM_RECOMMENDED_HELPER_VERSION as the default threshold", () => {
    expect(shouldShowHelperUpdateNudge(MINIMUM_RECOMMENDED_HELPER_VERSION)).toBe(false);
    expect(shouldShowHelperUpdateNudge(null)).toBe(true);
  });

  it("fails open (never nudges) if the configured minimum is itself malformed", () => {
    expect(shouldShowHelperUpdateNudge("0.1.0", "not-a-version")).toBe(false);
    expect(shouldShowHelperUpdateNudge(null, "not-a-version")).toBe(false);
  });
});
