import { describe, it, expect } from "vitest";
import { chunkIds, IN_FILTER_CHUNK_SIZE, fetchAllRows } from "./db-helpers";

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

describe("fetchAllRows", () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
  const page = (from: number, to: number) =>
    Promise.resolve({ data: rows.slice(from, to + 1).slice(0, 1000), error: null });

  it("returns every row across several pages", async () => {
    const result = await fetchAllRows(page);
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2500);
  });

  it("an exact multiple of the page size needs one extra empty page and loses nothing", async () => {
    const exact = rows.slice(0, 2000);
    const result = await fetchAllRows((f, t) => Promise.resolve({ data: exact.slice(f, t + 1), error: null }));
    expect(result.data).toHaveLength(2000);
  });

  it("returns an empty list for no rows", async () => {
    expect((await fetchAllRows(() => Promise.resolve({ data: [], error: null }))).data).toEqual([]);
  });

  it("returns the error, not a partial list, when a later page fails", async () => {
    let n = 0;
    const result = await fetchAllRows(() =>
      Promise.resolve(++n === 1 ? { data: rows.slice(0, 1000), error: null } : { data: null, error: { message: "boom" } })
    );
    expect(result).toEqual({ data: null, error: { message: "boom" } });
  });
});
