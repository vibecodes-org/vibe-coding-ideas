import { describe, it, expect } from "vitest";
import {
  REGISTRY_SESSION_TTL_MS,
  RATE_LIMIT_WINDOW_MS,
  computeSessionExpiresAt,
  isSessionExpired,
  rateLimitWindowStart,
  decideCap,
  decideRateLimit,
  formatSessionAge,
  formatSessionIdentity,
} from "./session-registry";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");

describe("computeSessionExpiresAt", () => {
  it("adds the 4h TTL to the mint time", () => {
    expect(REGISTRY_SESSION_TTL_MS).toBe(4 * 60 * 60 * 1000);
    expect(computeSessionExpiresAt(NOW)).toBe(new Date(NOW + REGISTRY_SESSION_TTL_MS).toISOString());
  });

  it("honors a custom TTL", () => {
    expect(computeSessionExpiresAt(NOW, 1000)).toBe(new Date(NOW + 1000).toISOString());
  });
});

describe("isSessionExpired", () => {
  it("is false while expires_at is in the future", () => {
    const future = new Date(NOW + 60_000).toISOString();
    expect(isSessionExpired(future, NOW)).toBe(false);
  });

  it("is true once expires_at has passed, including exactly at the boundary", () => {
    const past = new Date(NOW - 1).toISOString();
    expect(isSessionExpired(past, NOW)).toBe(true);
    expect(isSessionExpired(new Date(NOW).toISOString(), NOW)).toBe(true);
  });

  it("never reaps on a malformed timestamp", () => {
    expect(isSessionExpired("not-a-date", NOW)).toBe(false);
    expect(isSessionExpired("", NOW)).toBe(false);
  });
});

describe("rateLimitWindowStart", () => {
  it("subtracts the trailing window", () => {
    expect(RATE_LIMIT_WINDOW_MS).toBe(5 * 60 * 1000);
    expect(rateLimitWindowStart(NOW)).toBe(new Date(NOW - RATE_LIMIT_WINDOW_MS).toISOString());
  });
});

describe("decideCap", () => {
  it("allows a mint strictly below the cap", () => {
    expect(decideCap(4, 5)).toEqual({ ok: true });
    expect(decideCap(0, 5)).toEqual({ ok: true });
  });

  it("refuses AT the cap, not just over it", () => {
    expect(decideCap(5, 5)).toEqual({ ok: false, active: 5, cap: 5 });
  });

  it("refuses over the cap", () => {
    expect(decideCap(9, 5)).toEqual({ ok: false, active: 9, cap: 5 });
  });
});

describe("decideRateLimit", () => {
  it("allows below the limit", () => {
    expect(decideRateLimit(9, 10)).toEqual({ ok: true });
  });

  it("refuses AT and over the limit", () => {
    expect(decideRateLimit(10, 10)).toEqual({ ok: false, recent: 10, limit: 10 });
    expect(decideRateLimit(15, 10)).toEqual({ ok: false, recent: 15, limit: 10 });
  });
});

describe("formatSessionAge", () => {
  it("formats sub-hour ages in minutes", () => {
    expect(formatSessionAge(new Date(NOW - 0).toISOString(), NOW)).toBe("0m");
    expect(formatSessionAge(new Date(NOW - 12 * 60_000).toISOString(), NOW)).toBe("12m");
    expect(formatSessionAge(new Date(NOW - 59 * 60_000).toISOString(), NOW)).toBe("59m");
  });

  it("formats hour-plus ages, dropping zero minutes", () => {
    expect(formatSessionAge(new Date(NOW - 60 * 60_000).toISOString(), NOW)).toBe("1h");
    expect(formatSessionAge(new Date(NOW - 120 * 60_000).toISOString(), NOW)).toBe("2h");
    expect(formatSessionAge(new Date(NOW - 230 * 60_000).toISOString(), NOW)).toBe("3h 50m");
  });

  it("never goes negative for a clock-skewed 'future' timestamp", () => {
    expect(formatSessionAge(new Date(NOW + 60_000).toISOString(), NOW)).toBe("0m");
  });

  it("treats a malformed timestamp as age zero rather than throwing", () => {
    expect(formatSessionAge("garbage", NOW)).toBe("0m");
  });
});

describe("formatSessionIdentity", () => {
  it("joins whichever parts are non-null, sid always last", () => {
    expect(
      formatSessionIdentity({ machineLabel: "Nick's MacBook Pro", cwd: "~/projects/recipe-saver", sid: "a3f9beef" }),
    ).toBe("Nick's MacBook Pro · ~/projects/recipe-saver · a3f9beef");
  });

  it("falls back to just the short sid (first 8 chars) when nothing else is known", () => {
    expect(formatSessionIdentity({ machineLabel: null, cwd: null, sid: "a3f9beef1234" })).toBe("a3f9beef");
  });

  it("omits a missing cwd but keeps a known machine label", () => {
    expect(formatSessionIdentity({ machineLabel: "Nick's MacBook Pro", cwd: null, sid: "a3f9beef" })).toBe(
      "Nick's MacBook Pro · a3f9beef",
    );
  });
});
