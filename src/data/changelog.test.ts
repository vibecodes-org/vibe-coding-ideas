import { describe, it, expect } from "vitest";
import { changelog } from "./changelog";
import type { ChangelogEntryType } from "./changelog";

const VALID_TYPES: ChangelogEntryType[] = [
  "feature",
  "improvement",
  "fix",
  "breaking",
];

describe("changelog data", () => {
  it("has at least one entry", () => {
    expect(changelog.length).toBeGreaterThan(0);
  });

  it("every entry has an isoDate, date, title, and at least one item", () => {
    for (const entry of changelog) {
      expect(entry.isoDate).toBeTruthy();
      expect(entry.date).toBeTruthy();
      expect(entry.title).toBeTruthy();
      expect(entry.items.length).toBeGreaterThan(0);
    }
  });

  it("isoDate values are valid YYYY-MM-DD format", () => {
    for (const entry of changelog) {
      expect(entry.isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("every item has a valid type and non-empty description", () => {
    for (const entry of changelog) {
      for (const item of entry.items) {
        expect(VALID_TYPES).toContain(item.type);
        expect(item.description.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("dates are unique", () => {
    const dates = changelog.map((e) => e.isoDate);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("entries are in reverse chronological order", () => {
    for (let i = 1; i < changelog.length; i++) {
      expect(changelog[i - 1].isoDate >= changelog[i].isoDate).toBe(true);
    }
  });
});
