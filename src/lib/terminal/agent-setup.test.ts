import { describe, expect, it } from "vitest";
import { helperCanRunSetup, setupScreen } from "./agent-setup";
import { SETUP_MIN_HELPER_VERSION } from "./helper-version";

const NEW = SETUP_MIN_HELPER_VERSION;

describe("setupScreen", () => {
  it("agent not installed + new enough helper → the setup screen (mock 1); DIY link → mock 7a", () => {
    expect(setupScreen({ reason: "agent-not-installed", helperVersion: NEW, diyOpen: false })).toBe("start");
    expect(setupScreen({ reason: "agent-not-installed", helperVersion: NEW, diyOpen: true })).toBe("diy");
  });

  it("AC9: helper just below the minimum → mock 7b; at the minimum → mock 1", () => {
    expect(setupScreen({ reason: "agent-not-installed", helperVersion: "0.3.32", diyOpen: false })).toBe("old-helper");
    expect(setupScreen({ reason: "agent-not-installed", helperVersion: "0.3.29", diyOpen: false })).toBe("old-helper");
    expect(setupScreen({ reason: "agent-not-installed", helperVersion: NEW, diyOpen: false })).toBe("start");
    expect(setupScreen({ reason: "agent-not-installed", helperVersion: "0.4.0", diyOpen: false })).toBe("start");
  });

  it("an unknown or unreadable helper version never gets a one-click button", () => {
    for (const v of [null, undefined, "", "banana", "0.3"]) {
      expect(setupScreen({ reason: "agent-not-installed", helperVersion: v, diyOpen: false })).toBe("old-helper");
    }
    // the old-helper screen already shows the copy box, so DIY can't change it
    expect(setupScreen({ reason: "agent-not-installed", helperVersion: null, diyOpen: true })).toBe("old-helper");
  });

  it("each setup ending maps to its screen, whatever the helper version", () => {
    for (const v of [null, NEW]) {
      expect(setupScreen({ reason: "setup-installed", helperVersion: v, diyOpen: false })).toBe("signin");
      expect(setupScreen({ reason: "setup-signed-in", helperVersion: v, diyOpen: false })).toBe("ready");
      expect(setupScreen({ reason: "setup-install-failed", helperVersion: v, diyOpen: false })).toBe("install-failed");
      expect(setupScreen({ reason: "setup-signin-failed", helperVersion: v, diyOpen: false })).toBe("signin-failed");
    }
  });

  it("every other ending is not a setup situation", () => {
    for (const reason of [null, "user", "remote", "idle", "agent-stopped-early", "folder-missing", "helper-closed"] as const) {
      expect(setupScreen({ reason, helperVersion: NEW, diyOpen: false })).toBeNull();
    }
  });
});

describe("helperCanRunSetup", () => {
  it("compares as versions, not strings", () => {
    expect(helperCanRunSetup("0.3.100")).toBe(true);
    expect(helperCanRunSetup("0.10.0")).toBe(true);
  });
});
