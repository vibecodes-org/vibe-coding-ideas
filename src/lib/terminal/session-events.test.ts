import { describe, expect, it } from "vitest";
import { cleanDetail, cleanSessionEvents, MAX_EVENTS_PER_REQUEST } from "./session-events";

const NOW = Date.parse("2026-11-12T08:00:00Z");

describe("cleanSessionEvents", () => {
  it("keeps a good event and turns its time into ISO", () => {
    const out = cleanSessionEvents([{ sid: "abc-123", event: "socket.closed", at: NOW - 1000, detail: { code: 1006 } }], NOW);
    expect(out).toEqual([{ sid: "abc-123", event: "socket.closed", at: "2026-11-12T07:59:59.000Z", detail: { code: 1006 } }]);
  });

  it("drops bad entries one by one and keeps the rest", () => {
    const out = cleanSessionEvents(
      [
        { sid: "bad sid!", event: "x", at: NOW },
        { sid: "a", event: "Bad Name", at: NOW },
        { sid: "a", event: "ok", at: "not a date" },
        { sid: "a", event: "too.old", at: NOW - 31 * 24 * 3600 * 1000 },
        { sid: "a", event: "future", at: NOW + 60 * 60 * 1000 },
        null,
        { sid: "a", event: "ok", at: new Date(NOW).toISOString() },
      ],
      NOW,
    );
    expect(out.map((e) => e.event)).toEqual(["ok"]);
  });

  it("caps the batch size", () => {
    const many = Array.from({ length: MAX_EVENTS_PER_REQUEST + 20 }, () => ({ sid: "a", event: "e", at: NOW }));
    expect(cleanSessionEvents(many, NOW)).toHaveLength(MAX_EVENTS_PER_REQUEST);
  });

  it("returns nothing for a non-array", () => {
    expect(cleanSessionEvents({ sid: "a" }, NOW)).toEqual([]);
  });
});

describe("cleanDetail", () => {
  it("keeps plain values, trims long strings and flattens nested objects", () => {
    const out = cleanDetail({ a: "x".repeat(500), b: 2, c: true, d: null, e: { deep: 1 }, f: [1, "y", { z: 1 }], g: Infinity });
    expect((out.a as string).length).toBe(300);
    expect(out).toMatchObject({ b: 2, c: true, d: null, e: "[object]", f: [1, "y", null], g: null });
  });

  it("refuses non-objects", () => {
    expect(cleanDetail("hi")).toEqual({});
    expect(cleanDetail([1])).toEqual({});
  });
});
