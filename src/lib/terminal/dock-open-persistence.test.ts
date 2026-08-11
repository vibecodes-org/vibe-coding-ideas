import { describe, it, expect } from "vitest";
import { DOCK_OPEN_KEY, writeDockOpen, readDockOpen } from "./dock-open-persistence";

/** A minimal in-memory `Storage` stub — no jsdom/browser required. Mirrors session-snapshot.test.ts's own fixture. */
class FakeStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

/** Always throws — simulates quota exceeded / disabled storage / privacy mode. */
class ThrowingStorage extends FakeStorage {
  setItem(): never {
    const err = new Error("QuotaExceededError");
    err.name = "QuotaExceededError";
    throw err;
  }
  getItem(): never {
    throw new Error("SecurityError");
  }
  removeItem(): never {
    throw new Error("QuotaExceededError");
  }
}

describe("readDockOpen", () => {
  it("defaults to false (collapsed) when nothing was ever written", () => {
    expect(readDockOpen(new FakeStorage())).toBe(false);
  });

  it("returns true once writeDockOpen(true) has run", () => {
    const storage = new FakeStorage();
    writeDockOpen(true, storage);
    expect(readDockOpen(storage)).toBe(true);
  });

  it("returns false when storage is null (SSR)", () => {
    expect(readDockOpen(null)).toBe(false);
  });

  it("returns false, never throws, when storage.getItem throws", () => {
    expect(readDockOpen(new ThrowingStorage())).toBe(false);
  });

  it("ignores a foreign/garbage value under the key — only the exact '1' marker counts", () => {
    const storage = new FakeStorage();
    storage.setItem(DOCK_OPEN_KEY, "true");
    expect(readDockOpen(storage)).toBe(false);
  });
});

describe("writeDockOpen", () => {
  it("writes the exact '1' marker for expanded", () => {
    const storage = new FakeStorage();
    writeDockOpen(true, storage);
    expect(storage.getItem(DOCK_OPEN_KEY)).toBe("1");
  });

  it("removes the key entirely for collapsed — not a '0' value", () => {
    const storage = new FakeStorage();
    writeDockOpen(true, storage);
    writeDockOpen(false, storage);
    expect(storage.getItem(DOCK_OPEN_KEY)).toBeNull();
  });

  it("collapsing a tab that never opened the dock is a harmless no-op", () => {
    const storage = new FakeStorage();
    writeDockOpen(false, storage);
    expect(readDockOpen(storage)).toBe(false);
  });

  it("is a silent no-op when storage is null (SSR)", () => {
    expect(() => writeDockOpen(true, null)).not.toThrow();
  });

  it("quota-safe: a throwing setItem never propagates", () => {
    expect(() => writeDockOpen(true, new ThrowingStorage())).not.toThrow();
  });

  it("quota-safe: a throwing removeItem never propagates", () => {
    expect(() => writeDockOpen(false, new ThrowingStorage())).not.toThrow();
  });

  it("round-trips true then false then true across independent calls", () => {
    const storage = new FakeStorage();
    writeDockOpen(true, storage);
    expect(readDockOpen(storage)).toBe(true);
    writeDockOpen(false, storage);
    expect(readDockOpen(storage)).toBe(false);
    writeDockOpen(true, storage);
    expect(readDockOpen(storage)).toBe(true);
  });
});
