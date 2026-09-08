import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MACHINE_IDENTITY_KEY,
  MACHINE_IDENTITIES_KEY,
  getMachineIdentity,
  setMachineIdentity,
  clearMachineIdentity,
  addMachineIdentity,
  getMachineIdentities,
} from "./machine-identity";

describe("machine identity — localStorage round-trip", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("is null before anything is recorded", () => {
    expect(getMachineIdentity()).toBeNull();
  });

  it("sets + reads the identity under the versioned key", () => {
    setMachineIdentity("Nicks-MacBook-Pro");
    expect(getMachineIdentity()).toBe("Nicks-MacBook-Pro");
    expect(window.localStorage.getItem(MACHINE_IDENTITY_KEY)).toBe("Nicks-MacBook-Pro");
  });

  it("a later set overwrites the previous value", () => {
    setMachineIdentity("Nicks-MacBook-Pro");
    setMachineIdentity("Nicks-Mac-Studio");
    expect(getMachineIdentity()).toBe("Nicks-Mac-Studio");
  });

  it("clearMachineIdentity resets it", () => {
    setMachineIdentity("Nicks-MacBook-Pro");
    clearMachineIdentity();
    expect(getMachineIdentity()).toBeNull();
  });
});

describe("machine identities — accumulated set (two-hostnames-one-Mac fix)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("is empty before anything is recorded", () => {
    expect(getMachineIdentities()).toEqual([]);
  });

  it("addMachineIdentity accumulates distinct names rather than overwriting", () => {
    addMachineIdentity("Nicks-MBP.home.local");
    addMachineIdentity("Nicks-MacBook-Pro.local");
    expect(getMachineIdentities().sort()).toEqual(
      ["Nicks-MBP.home.local", "Nicks-MacBook-Pro.local"].sort(),
    );
  });

  it("dedupes — re-adding an already-known name doesn't create a second entry", () => {
    addMachineIdentity("Nicks-MBP.home.local");
    addMachineIdentity("Nicks-MBP.home.local");
    expect(getMachineIdentities()).toEqual(["Nicks-MBP.home.local"]);
  });

  it("also keeps the legacy single-value key pointing at the latest name", () => {
    addMachineIdentity("Nicks-MBP.home.local");
    addMachineIdentity("Nicks-MacBook-Pro.local");
    expect(window.localStorage.getItem(MACHINE_IDENTITY_KEY)).toBe("Nicks-MacBook-Pro.local");
  });

  it("back-compat: a value written only under the legacy single key is still returned", () => {
    // Simulates an existing user who has one name stored from before this fix
    // shipped — getMachineIdentities() must not lose it.
    window.localStorage.setItem(MACHINE_IDENTITY_KEY, "Nicks-MacBook-Pro.local");
    expect(getMachineIdentities()).toEqual(["Nicks-MacBook-Pro.local"]);
  });

  it("unions the legacy key with the new set key when both are present and differ", () => {
    window.localStorage.setItem(MACHINE_IDENTITY_KEY, "Nicks-MacBook-Pro.local");
    window.localStorage.setItem(MACHINE_IDENTITIES_KEY, JSON.stringify(["Nicks-MBP.home.local"]));
    expect(getMachineIdentities().sort()).toEqual(
      ["Nicks-MBP.home.local", "Nicks-MacBook-Pro.local"].sort(),
    );
  });

  it("caps the remembered set so it can't grow unbounded", () => {
    for (let i = 0; i < 25; i++) {
      addMachineIdentity(`host-${i}`);
    }
    const names = getMachineIdentities();
    expect(names.length).toBeLessThanOrEqual(20);
    // The most-recently-added names survive; the earliest are evicted.
    expect(names).toContain("host-24");
    expect(names).not.toContain("host-0");
  });

  it("clearMachineIdentity clears both the legacy and the accumulated key", () => {
    addMachineIdentity("Nicks-MBP.home.local");
    clearMachineIdentity();
    expect(getMachineIdentities()).toEqual([]);
    expect(window.localStorage.getItem(MACHINE_IDENTITIES_KEY)).toBeNull();
  });

  it("SSR-safe: returns empty / no-op when window is undefined", () => {
    const original = globalThis.window;
    // @ts-expect-error simulating an SSR environment for this assertion only
    delete globalThis.window;
    try {
      expect(getMachineIdentities()).toEqual([]);
      expect(() => addMachineIdentity("Nicks-MBP.home.local")).not.toThrow();
    } finally {
      globalThis.window = original;
    }
  });

  it("storage-throws path doesn't throw and reads back empty", () => {
    const originalGetItem = window.localStorage.getItem.bind(window.localStorage);
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.getItem = vi.fn(() => {
      throw new Error("storage disabled");
    });
    window.localStorage.setItem = vi.fn(() => {
      throw new Error("storage disabled");
    });
    try {
      expect(() => addMachineIdentity("Nicks-MBP.home.local")).not.toThrow();
      expect(getMachineIdentities()).toEqual([]);
    } finally {
      window.localStorage.getItem = originalGetItem;
      window.localStorage.setItem = originalSetItem;
    }
  });
});
