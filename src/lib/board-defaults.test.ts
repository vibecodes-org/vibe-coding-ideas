import { describe, it, expect } from "vitest";
import { DEFAULT_BOARD_COLUMNS, isInProgressColumnTitle } from "./board-defaults";

describe("DEFAULT_BOARD_COLUMNS", () => {
  it("contains exactly 6 columns", () => {
    expect(DEFAULT_BOARD_COLUMNS).toHaveLength(6);
  });

  it("matches the canonical order from mcp-server/src/constants.ts", () => {
    const titles = DEFAULT_BOARD_COLUMNS.map((c) => c.title);
    expect(titles).toEqual([
      "Backlog",
      "To Do",
      "Blocked/Requires User Input",
      "In Progress",
      "Verify",
      "Done",
    ]);
  });

  it("only marks the final column as the done column", () => {
    const doneFlags = DEFAULT_BOARD_COLUMNS.map((c) => c.is_done_column);
    expect(doneFlags).toEqual([false, false, false, false, false, true]);
  });

  it("uses position increments of 1000 starting at 0", () => {
    const positions = DEFAULT_BOARD_COLUMNS.map((c) => c.position);
    expect(positions).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
  });
});

describe("isInProgressColumnTitle", () => {
  it("matches the canonical In Progress title", () => {
    expect(isInProgressColumnTitle("In Progress")).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    expect(isInProgressColumnTitle("in progress")).toBe(true);
    expect(isInProgressColumnTitle("  IN PROGRESS  ")).toBe(true);
  });

  it("rejects other columns and renamed variants (fail-safe: no false spinner)", () => {
    for (const title of ["Backlog", "To Do", "Verify", "Done", "Doing", "WIP", ""]) {
      expect(isInProgressColumnTitle(title)).toBe(false);
    }
  });

  it("handles null/undefined without throwing", () => {
    expect(isInProgressColumnTitle(null)).toBe(false);
    expect(isInProgressColumnTitle(undefined)).toBe(false);
  });
});
