import { describe, it, expect, beforeEach } from "vitest";
import {
  PAIRED_FLAG_KEY,
  isBrowserPaired,
  markBrowserPaired,
  clearBrowserPaired,
  resolveFirstRunEntry,
} from "./paired-flag";

describe("paired flag — localStorage round-trip", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("is false before any successful pairing", () => {
    expect(isBrowserPaired()).toBe(false);
  });

  it("marks + reads the paired flag under the versioned key", () => {
    markBrowserPaired();
    expect(isBrowserPaired()).toBe(true);
    expect(window.localStorage.getItem(PAIRED_FLAG_KEY)).toBe("1");
  });

  it("clearBrowserPaired resets it", () => {
    markBrowserPaired();
    clearBrowserPaired();
    expect(isBrowserPaired()).toBe(false);
  });

  it("treats a non-'1' value as not paired", () => {
    window.localStorage.setItem(PAIRED_FLAG_KEY, "true");
    expect(isBrowserPaired()).toBe(false);
  });
});

describe("resolveFirstRunEntry — the unpaired vs paired gate", () => {
  it("unsupported machine → coming-soon regardless of the paired flag", () => {
    expect(resolveFirstRunEntry({ supported: false, paired: false })).toBe("coming-soon");
    expect(resolveFirstRunEntry({ supported: false, paired: true })).toBe("coming-soon");
  });

  it("supported + never paired → setup (no deep link yet)", () => {
    expect(resolveFirstRunEntry({ supported: true, paired: false })).toBe("setup");
  });

  it("supported + paired before → connecting (auto-connect, skip setup)", () => {
    expect(resolveFirstRunEntry({ supported: true, paired: true })).toBe("connecting");
  });

  it("end-to-end: a machine that pairs graduates from setup to connecting", () => {
    window.localStorage.clear();
    const supported = true;
    expect(resolveFirstRunEntry({ supported, paired: isBrowserPaired() })).toBe("setup");
    markBrowserPaired();
    expect(resolveFirstRunEntry({ supported, paired: isBrowserPaired() })).toBe("connecting");
  });
});
