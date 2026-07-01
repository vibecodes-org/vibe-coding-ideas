import { describe, it, expect } from "vitest";
import {
  resolveDockView,
  nextLaunchPhaseOnTimeout,
  isTimeoutFallbackView,
} from "./first-run-flow";

describe("resolveDockView — install-first entry", () => {
  it("idle + unsupported → coming-soon (never a deep-link target)", () => {
    expect(resolveDockView("idle", "idle", false, false)).toBe("coming-soon");
    // Even a stray paired flag on an unsupported machine stays coming-soon.
    expect(resolveDockView("idle", "idle", false, true)).toBe("coming-soon");
  });

  it("idle + supported + unpaired → setup (no deep link yet)", () => {
    expect(resolveDockView("idle", "idle", true, false)).toBe("setup");
  });

  it("connecting maps to the returning variant when paired", () => {
    expect(resolveDockView("connecting", "opening", true, false)).toBe("connecting");
    expect(resolveDockView("connecting", "opening", true, true)).toBe("connecting-returning");
  });

  it("waiting-to-pair while opening shows the connecting panel", () => {
    expect(resolveDockView("waiting-to-pair", "opening", true, false)).toBe("connecting");
  });

  it("waiting-to-pair with the idle launch phase is the legacy manual pairing flow", () => {
    expect(resolveDockView("waiting-to-pair", "idle", true, true)).toBe("legacy-waiting");
  });
});

describe("resolveDockView — the ~8s timeout fallback", () => {
  it("new user vs returning user pick different fallback copy", () => {
    expect(resolveDockView("waiting-to-pair", "helper-timeout", true, false)).toBe("timeout-new");
    expect(resolveDockView("waiting-to-pair", "helper-timeout", true, true)).toBe("timeout-returning");
  });

  it("both fallbacks are recognised as the calm timeout view", () => {
    expect(isTimeoutFallbackView("timeout-new")).toBe(true);
    expect(isTimeoutFallbackView("timeout-returning")).toBe(true);
    expect(isTimeoutFallbackView("connecting")).toBe(false);
  });
});

describe("nextLaunchPhaseOnTimeout — opening → helper-timeout, else untouched", () => {
  it("an 'opening' launch drops to the calm fallback", () => {
    expect(nextLaunchPhaseOnTimeout("opening")).toBe("helper-timeout");
  });

  it("a launch that already succeeded (idle) is left alone — no spurious fallback", () => {
    expect(nextLaunchPhaseOnTimeout("idle")).toBe("idle");
  });

  it("a fallback already showing stays put (idempotent)", () => {
    expect(nextLaunchPhaseOnTimeout("helper-timeout")).toBe("helper-timeout");
  });
});
