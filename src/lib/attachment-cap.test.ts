import { describe, it, expect } from "vitest";
import { acceptFilesWithinCap } from "./attachment-cap";

function makeFiles(count: number): File[] {
  return Array.from({ length: count }, (_, i) => new File(["x"], `file-${i}.png`, { type: "image/png" }));
}

describe("acceptFilesWithinCap", () => {
  it("accepts all files when well under the cap", () => {
    const result = acceptFilesWithinCap(2, 0, makeFiles(3), 10);
    expect(result.accepted).toHaveLength(3);
    expect(result.rejectedCount).toBe(0);
  });

  it("accepts exactly the files that fit when the batch exactly fills the cap", () => {
    const result = acceptFilesWithinCap(6, 0, makeFiles(4), 10);
    expect(result.accepted).toHaveLength(4);
    expect(result.rejectedCount).toBe(0);
  });

  it("slices an overflowing batch down to the remaining slots", () => {
    const result = acceptFilesWithinCap(4, 0, makeFiles(16), 10);
    expect(result.accepted).toHaveLength(6);
    expect(result.rejectedCount).toBe(10);
  });

  it("rejects everything when no slots remain", () => {
    const result = acceptFilesWithinCap(10, 0, makeFiles(3), 10);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejectedCount).toBe(3);
  });

  it("returns an empty result for an empty file list", () => {
    const result = acceptFilesWithinCap(0, 0, makeFiles(0), 10);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejectedCount).toBe(0);
  });

  it("accounts for in-flight uploads from a not-yet-settled prior call", () => {
    // 8 saved + 2 already uploading from a prior batch leaves only 0 slots.
    const result = acceptFilesWithinCap(8, 2, makeFiles(2), 10);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejectedCount).toBe(2);
  });

  it("never over-clamps remaining slots below zero when currentCount + inFlight exceeds max", () => {
    const result = acceptFilesWithinCap(9, 5, makeFiles(1), 10);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejectedCount).toBe(1);
  });
});
