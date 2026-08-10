import { describe, it, expect, beforeEach } from "vitest";
import {
  MACHINE_IDENTITY_KEY,
  getMachineIdentity,
  setMachineIdentity,
  clearMachineIdentity,
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
