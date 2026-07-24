import { describe, it, expect } from "vitest";
import {
  DEFAULT_TERMINAL_DAILY_BUDGET,
  DEFAULT_TERMINAL_BUDGET_SOFT_PCT,
  DEFAULT_ASSUMED_REQUESTS_PER_SESSION,
  getTerminalDailyBudget,
  getTerminalBudgetSoftPct,
  getAssumedRequestsPerSession,
  estimateDailyRelayRequestSpend,
  decideRelayBudget,
  utcDayStart,
} from "./relay-budget";

describe("getTerminalDailyBudget", () => {
  it("defaults to 100k when unset", () => {
    expect(getTerminalDailyBudget(undefined)).toBe(100_000);
    expect(DEFAULT_TERMINAL_DAILY_BUDGET).toBe(100_000);
  });

  it("uses a positive integer override verbatim", () => {
    expect(getTerminalDailyBudget("50000")).toBe(50_000);
  });

  it("falls back for zero, negative, non-numeric, or fractional values", () => {
    expect(getTerminalDailyBudget("0")).toBe(DEFAULT_TERMINAL_DAILY_BUDGET);
    expect(getTerminalDailyBudget("-1")).toBe(DEFAULT_TERMINAL_DAILY_BUDGET);
    expect(getTerminalDailyBudget("abc")).toBe(DEFAULT_TERMINAL_DAILY_BUDGET);
    expect(getTerminalDailyBudget("")).toBe(DEFAULT_TERMINAL_DAILY_BUDGET);
    expect(getTerminalDailyBudget("1000.5")).toBe(DEFAULT_TERMINAL_DAILY_BUDGET);
  });
});

describe("getTerminalBudgetSoftPct", () => {
  it("defaults to 0.95 when unset", () => {
    expect(getTerminalBudgetSoftPct(undefined)).toBe(0.95);
    expect(DEFAULT_TERMINAL_BUDGET_SOFT_PCT).toBe(0.95);
  });

  it("uses a valid fraction override verbatim", () => {
    expect(getTerminalBudgetSoftPct("0.5")).toBe(0.5);
    expect(getTerminalBudgetSoftPct("1")).toBe(1);
  });

  it("falls back for 0, negative, >1, non-numeric, or empty values", () => {
    expect(getTerminalBudgetSoftPct("0")).toBe(DEFAULT_TERMINAL_BUDGET_SOFT_PCT);
    expect(getTerminalBudgetSoftPct("-0.2")).toBe(DEFAULT_TERMINAL_BUDGET_SOFT_PCT);
    expect(getTerminalBudgetSoftPct("1.5")).toBe(DEFAULT_TERMINAL_BUDGET_SOFT_PCT);
    expect(getTerminalBudgetSoftPct("abc")).toBe(DEFAULT_TERMINAL_BUDGET_SOFT_PCT);
    expect(getTerminalBudgetSoftPct("")).toBe(DEFAULT_TERMINAL_BUDGET_SOFT_PCT);
  });
});

describe("getAssumedRequestsPerSession", () => {
  it("defaults to 500 when unset", () => {
    expect(getAssumedRequestsPerSession(undefined)).toBe(500);
    expect(DEFAULT_ASSUMED_REQUESTS_PER_SESSION).toBe(500);
  });

  it("uses a positive integer override verbatim", () => {
    expect(getAssumedRequestsPerSession("200")).toBe(200);
  });

  it("falls back for zero, negative, or non-numeric values", () => {
    expect(getAssumedRequestsPerSession("0")).toBe(DEFAULT_ASSUMED_REQUESTS_PER_SESSION);
    expect(getAssumedRequestsPerSession("-5")).toBe(DEFAULT_ASSUMED_REQUESTS_PER_SESSION);
    expect(getAssumedRequestsPerSession("nope")).toBe(DEFAULT_ASSUMED_REQUESTS_PER_SESSION);
  });
});

describe("estimateDailyRelayRequestSpend", () => {
  it("multiplies sessions-started-today by the per-session cost", () => {
    expect(estimateDailyRelayRequestSpend(10, 500)).toBe(5_000);
    expect(estimateDailyRelayRequestSpend(0, 500)).toBe(0);
  });

  it("floors a negative session count at 0 rather than going negative", () => {
    expect(estimateDailyRelayRequestSpend(-3, 500)).toBe(0);
  });
});

describe("decideRelayBudget", () => {
  const budget = 100_000;
  const softPct = 0.8; // soft limit = 80,000

  it("is ok when estimated spend is comfortably under the soft limit", () => {
    expect(decideRelayBudget(1_000, budget, softPct)).toEqual({ ok: true });
  });

  it("is ok at just under the soft limit", () => {
    expect(decideRelayBudget(79_999, budget, softPct)).toEqual({ ok: true });
  });

  it("trips exactly AT the soft limit (meets-or-exceeds)", () => {
    const d = decideRelayBudget(80_000, budget, softPct);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.estimatedSpend).toBe(80_000);
      expect(d.dailyBudget).toBe(budget);
      expect(d.softLimit).toBe(80_000);
    }
  });

  it("trips when estimated spend is over the soft limit", () => {
    const d = decideRelayBudget(95_000, budget, softPct);
    expect(d.ok).toBe(false);
  });

  it("honors a custom soft pct (e.g. 1.0 == hard cap only)", () => {
    expect(decideRelayBudget(90_000, budget, 1).ok).toBe(true);
    expect(decideRelayBudget(100_000, budget, 1).ok).toBe(false);
  });
});

describe("decideRelayBudget at the production default (0.95 soft pct)", () => {
  const budget = 100_000;
  const softPct = DEFAULT_TERMINAL_BUDGET_SOFT_PCT; // soft limit = 95,000

  it("is ok comfortably under the raised 95k soft limit (traffic the old 0.8 default used to block)", () => {
    // Under the OLD 0.8 default this would have tripped (80k soft limit); at
    // 0.95 it must now pass — this is the whole point of the release-gate change.
    expect(decideRelayBudget(85_000, budget, softPct)).toEqual({ ok: true });
  });

  it("is ok at just under the 95k soft limit", () => {
    expect(decideRelayBudget(94_999, budget, softPct)).toEqual({ ok: true });
  });

  it("trips exactly AT the 95k soft limit (meets-or-exceeds)", () => {
    const d = decideRelayBudget(95_000, budget, softPct);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.estimatedSpend).toBe(95_000);
      expect(d.dailyBudget).toBe(budget);
      expect(d.softLimit).toBe(95_000);
    }
  });

  it("trips just over the 95k soft limit", () => {
    expect(decideRelayBudget(95_001, budget, softPct).ok).toBe(false);
  });
});

describe("utcDayStart", () => {
  it("returns midnight UTC of the given day", () => {
    // 2026-07-24T15:42:07.123Z -> 2026-07-24T00:00:00.000Z
    const nowMs = Date.parse("2026-07-24T15:42:07.123Z");
    expect(utcDayStart(nowMs)).toBe("2026-07-24T00:00:00.000Z");
  });

  it("is stable for any time within the same UTC day", () => {
    const early = Date.parse("2026-07-24T00:00:00.001Z");
    const late = Date.parse("2026-07-24T23:59:59.999Z");
    expect(utcDayStart(early)).toBe(utcDayStart(late));
  });

  it("resets across a UTC day boundary", () => {
    const beforeMidnight = Date.parse("2026-07-24T23:59:59.999Z");
    const afterMidnight = Date.parse("2026-07-25T00:00:00.000Z");
    expect(utcDayStart(beforeMidnight)).not.toBe(utcDayStart(afterMidnight));
    expect(utcDayStart(afterMidnight)).toBe("2026-07-25T00:00:00.000Z");
  });
});
