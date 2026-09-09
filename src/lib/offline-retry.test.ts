import { describe, it, expect } from "vitest";
import {
  nextOfflineRetryDelay,
  OFFLINE_RETRY_MIN_DELAY_MS,
  OFFLINE_RETRY_MAX_DELAY_MS,
} from "./offline-retry";

describe("nextOfflineRetryDelay", () => {
  it("doubles the delay on each call", () => {
    expect(nextOfflineRetryDelay(OFFLINE_RETRY_MIN_DELAY_MS)).toBe(8000);
    expect(nextOfflineRetryDelay(8000)).toBe(15000);
  });

  it("caps the delay at the configured maximum", () => {
    expect(nextOfflineRetryDelay(OFFLINE_RETRY_MAX_DELAY_MS)).toBe(OFFLINE_RETRY_MAX_DELAY_MS);
    expect(nextOfflineRetryDelay(1_000_000)).toBe(OFFLINE_RETRY_MAX_DELAY_MS);
  });

  it("never exceeds the max even from an already-large starting delay", () => {
    let delay = OFFLINE_RETRY_MIN_DELAY_MS;
    for (let i = 0; i < 10; i++) {
      delay = nextOfflineRetryDelay(delay);
    }
    expect(delay).toBe(OFFLINE_RETRY_MAX_DELAY_MS);
  });
});
