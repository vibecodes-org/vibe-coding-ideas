import { describe, it, expect, beforeEach } from "vitest";
import {
  HELPER_IDLE_QUIT_OBSERVED_KEY,
  RELAUNCH_WITHIN_MS,
  recordHelperIdleQuitObserved,
  consumeRecentHelperIdleQuit,
} from "./helper-relaunch-signal";

describe("helper idle-quit relaunch signal", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("nothing observed -> consume reports false", () => {
    expect(consumeRecentHelperIdleQuit()).toBe(false);
  });

  it("records under the versioned key", () => {
    recordHelperIdleQuitObserved(1_000);
    expect(window.localStorage.getItem(HELPER_IDLE_QUIT_OBSERVED_KEY)).toBe("1000");
  });

  it("a mint within the window consumes the flag and reports true", () => {
    recordHelperIdleQuitObserved(1_000);
    expect(consumeRecentHelperIdleQuit(1_000 + RELAUNCH_WITHIN_MS - 1)).toBe(true);
    // consumed — a second check right after finds nothing left to pair.
    expect(consumeRecentHelperIdleQuit(1_000 + RELAUNCH_WITHIN_MS - 1)).toBe(false);
  });

  it("exactly at the window boundary no longer counts (strict <)", () => {
    recordHelperIdleQuitObserved(1_000);
    expect(consumeRecentHelperIdleQuit(1_000 + RELAUNCH_WITHIN_MS)).toBe(false);
  });

  it("a mint before the observed time (clock skew) is never treated as a match", () => {
    recordHelperIdleQuitObserved(5_000);
    expect(consumeRecentHelperIdleQuit(1_000)).toBe(false);
  });

  it("a stale flag is cleared even when it doesn't match (never leaks into a later unrelated mint)", () => {
    recordHelperIdleQuitObserved(1_000);
    consumeRecentHelperIdleQuit(1_000 + RELAUNCH_WITHIN_MS + 60_000);
    expect(window.localStorage.getItem(HELPER_IDLE_QUIT_OBSERVED_KEY)).toBeNull();
  });

  it("garbage in storage is treated as absent, not a crash", () => {
    window.localStorage.setItem(HELPER_IDLE_QUIT_OBSERVED_KEY, "not-a-number");
    expect(consumeRecentHelperIdleQuit()).toBe(false);
  });
});
