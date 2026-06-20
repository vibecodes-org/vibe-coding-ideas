import { describe, it, expect } from "vitest";
import { chunkIds, IN_FILTER_CHUNK_SIZE } from "./db-helpers";

describe("chunkIds", () => {
  it("returns an empty array for an empty input", () => {
    expect(chunkIds([], 100)).toEqual([]);
  });

  it("returns a single chunk when length < size", () => {
    expect(chunkIds([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });

  it("splits an exact multiple of size into equal chunks", () => {
    const ids = Array.from({ length: 200 }, (_, i) => i);
    const chunks = chunkIds(ids, 100);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[1]).toHaveLength(100);
  });

  it("puts the remainder in a smaller final chunk", () => {
    const ids = Array.from({ length: 250 }, (_, i) => i);
    const chunks = chunkIds(ids, 100);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it("supports size = 1 (one id per chunk)", () => {
    expect(chunkIds([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it("loses or duplicates no element for a large array", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const chunks = chunkIds(ids, 100);
    const flattened = chunks.flat();
    expect(flattened).toEqual(ids);
    expect(new Set(flattened).size).toBe(ids.length);
  });

  it("uses IN_FILTER_CHUNK_SIZE as the default size", () => {
    const ids = Array.from({ length: IN_FILTER_CHUNK_SIZE + 1 }, (_, i) => i);
    const chunks = chunkIds(ids);
    expect(chunks.map((c) => c.length)).toEqual([IN_FILTER_CHUNK_SIZE, 1]);
  });

  it("throws when size <= 0", () => {
    expect(() => chunkIds([1, 2, 3], 0)).toThrow("chunkIds: size must be > 0");
    expect(() => chunkIds([1, 2, 3], -5)).toThrow("chunkIds: size must be > 0");
  });
});
