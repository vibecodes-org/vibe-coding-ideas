import { describe, it, expect } from "vitest";
import {
  isMarkerLive,
  markerWindowStart,
  applyModelAvailability,
  modelSwitchNotice,
  shouldRescueStep,
  inferUnavailableFromSubstitution,
  rescueSentence,
} from "./model-availability";

const NOW = new Date("2026-09-04T09:15:00.000Z");

describe("isMarkerLive", () => {
  it("is live for a marker set earlier the same UTC day", () => {
    expect(isMarkerLive("2026-09-04T00:00:01.000Z", NOW)).toBe(true);
    expect(isMarkerLive("2026-09-04T09:14:59.000Z", NOW)).toBe(true);
  });

  it("expires at the next UTC midnight (AC-5)", () => {
    expect(isMarkerLive("2026-09-03T23:59:59.000Z", NOW)).toBe(false);
  });

  it("treats a missing or unparseable marker as not live", () => {
    expect(isMarkerLive(null, NOW)).toBe(false);
    expect(isMarkerLive(undefined, NOW)).toBe(false);
    expect(isMarkerLive("not a date", NOW)).toBe(false);
  });

  it("never honours a future marker (clock skew must not strand a model)", () => {
    expect(isMarkerLive("2026-09-04T23:00:00.000Z", NOW)).toBe(false);
  });

  it("accepts a Date as well as a string", () => {
    expect(isMarkerLive(new Date("2026-09-04T05:00:00.000Z"), NOW)).toBe(true);
  });

  it("agrees with markerWindowStart at the exact boundary", () => {
    const start = markerWindowStart(NOW);
    expect(start).toBe("2026-09-04T00:00:00.000Z");
    expect(isMarkerLive(start, NOW)).toBe(true);
    expect(isMarkerLive(new Date(Date.parse(start) - 1).toISOString(), NOW)).toBe(false);
  });
});

describe("applyModelAvailability", () => {
  const frontier = { resolved: "fable", fallback: "opus" };

  it("switches to the backup when the marker names the directed model (AC-2)", () => {
    expect(applyModelAvailability(frontier, "fable")).toEqual({
      directed: "opus",
      fallback: "fable",
      switched: true,
      unavailable: "fable",
    });
  });

  it("leaves the resolution untouched with no marker (AC-6)", () => {
    expect(applyModelAvailability(frontier, null)).toEqual({
      directed: "fable",
      fallback: "opus",
      switched: false,
      unavailable: null,
    });
  });

  it("ignores a marker for a model this tier does not use", () => {
    // The user's cheap tier died; frontier has no reason to move.
    expect(applyModelAvailability(frontier, "haiku").switched).toBe(false);
  });

  it("refuses to switch onto the very model that is down", () => {
    // Reciprocal chains are real: the seed has opus -> fable.
    const reciprocal = { resolved: "opus", fallback: "opus" };
    expect(applyModelAvailability(reciprocal, "opus").switched).toBe(false);
  });

  it("never returns the dead model as the directed model", () => {
    for (const chain of [
      { resolved: "fable", fallback: "opus" },
      { resolved: "sonnet", fallback: "opus" },
      { resolved: "haiku", fallback: "sonnet" },
    ]) {
      const applied = applyModelAvailability(chain, chain.resolved);
      expect(applied.directed).not.toBe(chain.resolved);
    }
  });
});

describe("modelSwitchNotice", () => {
  it("names the dead model, the backup, and the reason (AC-3)", () => {
    const notice = modelSwitchNotice(applyModelAvailability({ resolved: "fable", fallback: "opus" }, "fable"));
    expect(notice).toContain("fable");
    expect(notice).toContain("opus");
    expect(notice).toMatch(/unavailable/i);
    expect(notice).toMatch(/end of the day/i);
  });

  it("is empty when nothing switched, so the happy-path directive is unchanged (AC-6)", () => {
    expect(modelSwitchNotice(applyModelAvailability({ resolved: "fable", fallback: "opus" }, null))).toBe("");
  });
});

describe("shouldRescueStep", () => {
  it("rescues a first model-unavailability failure (AC-1)", () => {
    expect(shouldRescueStep(true, false)).toEqual({ rescue: true, reason: "rescued" });
    expect(shouldRescueStep(true, null)).toEqual({ rescue: true, reason: "rescued" });
  });

  it("refuses a second rescue of the same step — no infinite bounce (AC-1)", () => {
    expect(shouldRescueStep(true, true)).toEqual({ rescue: false, reason: "already-rescued" });
  });

  it("leaves ordinary failures alone", () => {
    expect(shouldRescueStep(false, false).rescue).toBe(false);
    expect(shouldRescueStep(undefined, false).rescue).toBe(false);
  });
});

describe("inferUnavailableFromSubstitution", () => {
  const frontier = { resolved: "fable", fallback: "opus" };

  it("infers unavailability when the agent self-reports running the backup (AC-4)", () => {
    expect(inferUnavailableFromSubstitution("frontier", frontier, "opus")).toBe(true);
  });

  it("infers nothing when the directed model was used", () => {
    expect(inferUnavailableFromSubstitution("frontier", frontier, "fable")).toBe(false);
  });

  it("infers nothing from an Auto step — it promised no model", () => {
    expect(inferUnavailableFromSubstitution(null, frontier, "opus")).toBe(false);
  });

  it("infers nothing from unknown/other/omitted reports", () => {
    expect(inferUnavailableFromSubstitution("frontier", frontier, "unknown")).toBe(false);
    expect(inferUnavailableFromSubstitution("frontier", frontier, "other")).toBe(false);
    expect(inferUnavailableFromSubstitution("frontier", frontier, undefined)).toBe(false);
  });

  it("infers nothing when the chain has no real backup", () => {
    expect(inferUnavailableFromSubstitution("frontier", { resolved: "opus", fallback: "opus" }, "opus")).toBe(false);
  });

  it("does not fire on a model that is neither the directed one nor the backup", () => {
    // That is an ordinary dishonored tier, already handled by tier_honored.
    expect(inferUnavailableFromSubstitution("frontier", frontier, "haiku")).toBe(false);
  });
});

describe("rescueSentence", () => {
  it("explains the switch and that it happens only once", () => {
    const sentence = rescueSentence("fable", "opus");
    expect(sentence).toContain("fable");
    expect(sentence).toContain("opus");
    expect(sentence).toMatch(/once/i);
  });
});
