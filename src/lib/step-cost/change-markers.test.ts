import { describe, it, expect } from "vitest";
import { CHANGE_MARKERS, visibleMarkers } from "./change-markers";

describe("change markers", () => {
  it("has entries with real dates and plain labels, and none mention the assistant", () => {
    expect(CHANGE_MARKERS.length).toBeGreaterThan(0);
    for (const m of CHANGE_MARKERS) {
      expect(m.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(m.label.length).toBeGreaterThan(10);
      expect(m.label.toLowerCase()).not.toMatch(/\bbot\b|assistant/);
    }
  });
  it("hides changes before the chart starts and sorts by date", () => {
    const list = visibleMarkers("2026-10-20", [
      { date: "2026-10-25", label: "c" },
      { date: "2026-10-01", label: "a" },
      { date: "2026-10-22", label: "b" },
    ]);
    expect(list.map((m) => m.label)).toEqual(["b", "c"]);
    expect(list.map((m) => m.number)).toEqual([2, 3]);
  });
  it("a change on the first day is shown", () => {
    expect(visibleMarkers("2026-10-14").map((m) => m.date)[0]).toBe("2026-10-14");
  });
});
